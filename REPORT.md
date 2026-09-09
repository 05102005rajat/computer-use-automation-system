# REPORT

## 1. Architecture

Single Node/TypeScript process, no queues or services, because the brief is explicit that
premature scaling infrastructure isn't rewarded and a single process is simpler to reason about
at this size. Five modules with a deliberate seam between them:

- **`agent/`** — the discovery loop. Claude drives a live Playwright page via tool calls
  (`navigate`, `click`, `type`, `select`, `extract`, `finish`, `request_help`). Perception
  (`agent/perception.ts`) is the key design choice: instead of feeding the model raw HTML, I
  walk every frame at runtime and emit a flat list of `{refId, role, accessibleName, tagName}`
  descriptors for interactive elements *and* leaf table cells (read-only "text" elements, needed
  because a lot of what this goal needs to read — a balance, a confirmation number — lives in a
  plain `<td>`, not behind a control). This is deliberately DOM-shape-agnostic: it would produce
  the same shape of observation over an accessibility tree API on a desktop app. Every action
  tool requires a `reasoning` field in its own input schema (not a separate preamble message) —
  `tool_choice: "any"` forces a tool call and Claude otherwise skips free-form text, so without
  this the evidence log would show *what* the agent did with no record of *why*.
- **`artifact/`** — the schema (zod-validated) and the recorder that mechanically turns a
  successful transcript into a versioned `CapabilityArtifact`. The recorder is not an LLM step;
  it is a pure transform, so every field in the artifact traces back to one concrete action the
  agent actually performed.
- **`replay/`** — the deterministic executor. Same locator-resolution and frame-handling code as
  discovery-time execution (shared via `replay/locator.ts`), so "how we act on a step" is
  identical whether a human-in-the-loop LLM or a saved artifact is driving.
- **`guardrails/`** — allowlist, risk classification, redaction. Consulted by *both* the
  discovery loop and the replay executor, not just one.
- **`escalation/`** — an in-memory session registry plus a small HTTP operator API, shared by
  discovery and replay.

**Key trade-off:** perception re-derives structure from the live DOM every step rather than
caching it, which is slower but means there is no state to invalidate when the page changes
underneath — the actual bug I hit and fixed during discovery (see §3) was exactly a caching/race
problem, not a re-derivation problem, which reinforced this choice.

## 2. Artifact schema

The schema (`artifact/schema.ts`) is built around one idea: **a capability is a contract, not a
recording.** Concretely it separates:

- **Steps** — ordered actions, each carrying a `LocatorSpec`: an ordered list of fallback
  strategies (`role+name` → `name`/`id` attribute → `text` → structural CSS path), each tagged
  with a human-readable `robustnessNote` explaining *why* that ordering was chosen. A reviewer
  can see at a glance that a step relying only on a CSS path is brittle, without inspecting
  replay logs.
- **Frame references** — `"main"` or `{iframeLocator}`, resolved the same way a step's own
  locator is. This is what lets the artifact describe a flow that spans an `<iframe>` without
  hardcoding frame indices.
- **Typed `inputs`/`outputs`** — the calling contract an AI agent sees, independent of how many
  internal steps it takes to satisfy it (login credentials, for instance, are steps but are *not*
  part of the public `inputs` — see §6).
- **A single `successCheckpoint`** plus a declared **`outcomes`** list, each an explicit
  `{name, category: business_outcome | recoverable, detector, recovery?}`. This is the field I'd
  point to first: it's what makes "no such member" a typed, first-class result instead of an
  exception, and it's declared once, by a reviewer, against the target app's known behavior —
  not inferred from the one happy-path transcript that produced the artifact (a single successful
  run only ever observes the branch it took).
- **`riskLevel`/`approval`** at the capability level, plus a per-step `risky: boolean` computed
  once at record time from the safety policy. Both exist because a capability can be net "risky"
  while only one of its ten steps actually needs authorization — gating every click on capability
  risk was a real bug I introduced and then fixed (§3).
- **`discovery.transcriptRef`** — a pointer into `/evidence`, not an embedded transcript. The
  artifact is explicitly decoupled from the raw model conversation per the brief; provenance is
  preserved without bloating the reviewable contract.

## 3. Determinism & error handling

Replay never calls an LLM. Determinism rests on three things: (1) the same fallback-locator
resolution code as discovery, (2) an explicit three-way result taxonomy, and (3) waiting for the
*right* thing before treating a step as done.

**The taxonomy**, returned as a structured `ReplayResult`:
- `success` (with typed `outputs` and which checkpoint matched),
- `business_outcome` (a named, declared, expected result — `member_not_found`, `member_frozen`,
  three validation-error variants),
- `error`, itself split into `errorType`: `locator_resolution`, `checkpoint_failed`,
  `input_validation`, `policy_violation`, `operator_rejected`, `unrecognized_state` — each
  carrying `step`, `expected`, `observed`, and an `evidencePath` screenshot.

A **recoverable** condition (declared the same way as a business outcome, plus a `recovery`
action) is handled transparently: replay detects it, applies a bounded, declarative remediation
(click a known "Re-authenticate" button; never an open-ended LLM call), retries the interrupted
step once, and only escalates if that retry also fails.

**A real bug worth reporting, because it's the most instructive part of this section:** during
discovery, a form submit inside the target app's `<iframe>` looked like a silent no-op — the
agent saw the same form on the next observation and called `request_help`. The actual cause:
`locator.click()` does not reliably block on a *sub-frame's* navigation, and a naive
`frame.waitForLoadState('networkidle')` called immediately after the click is racy — if it fires
before the click's own request has even started, "networkidle" is trivially already true and
resolves instantly, before the real navigation happens. The fix (`replay/locator.ts`,
`clickAndSettle`) starts listening for the navigation *before* the click fires it
(`scope.waitForNavigation(...)` raced against `locator.click()`), on whichever frame actually owns
the clicked element. I also found and fixed a second, compounding bug: the success checkpoint was
defined against `page.url()`, but a same-origin `<iframe>` navigation never changes the top-level
URL at all — the checkpoint must resolve the frame the detector names and check *that* frame's
URL. Both bugs were only visible by actually running the live agent against a live app, which is
exactly why the brief insists the discovery run has to be real.

**Secondarily, UI drift:** the fallback chain (role/name → attribute → text → CSS path) is the
primary drift defense — a renamed CSS class or an added table row doesn't break a step whose
first candidate is `role=button, name="Open Sub-Account"`. `evidence/replay-1788930527588`
demonstrates the case where drift breaks *every* candidate: replay finds no declared outcome
matches either, and escalates with full context rather than guessing.

## 4. Heterogeneity & multi-tenant

**Surface abstraction.** The seam is perception (`agent/perception.ts` + `replay/locator.ts`)
versus the recorded flow (`artifact/schema.ts`). Steps and locators never reference "the DOM" —
they reference a `LocatorStrategy` (role/name, attribute, text, css) and a `FrameRef`. A desktop
surface would implement the same two functions — "snapshot current interactive elements" and
"resolve a `LocatorSpec` to something clickable" — against the OS accessibility tree instead of
`document.querySelectorAll`, and nothing in the artifact schema, recorder, or replay executor
would need to change. A legacy web app with framesets is already exercised here (the one
`<iframe>`); a deeper frameset just means `FrameRef` resolution walks more than one hop, which the
schema already allows (an `iframeLocator` is itself a `LocatorSpec`, so it can nest).

**Multi-tenant reuse.** Two concrete mechanisms, only one of which is built here:
1. *Path-shape canonicalization* (built): the recorder wildcards path segments that vary with the
   invocation's own parameters — see `agent/perception.ts`'s `describeIframe`, which records the
   iframe's locator as `/members/*/sub-accounts/new`, not the literal `/members/10023/...`. The
   same idea extends to a tenant-varying subdomain or path prefix.
2. *Base-artifact + per-tenant overrides* (designed, not built): I'd add a `baseArtifactRef` field
   and a small override object (`{stepId, patch}`) so a tenant running a re-skinned version of the
   same vendor product gets a thin diff artifact rather than a full re-recording — replay would
   apply the base artifact with overrides merged in per step. Drift detection would run the base
   artifact's `successCheckpoint` and locator resolution in a lightweight "dry-run" mode against a
   new tenant instance periodically; a locator whose first N-1 candidates start failing and only
   the CSS fallback still resolves is exactly the signal to flag that tenant for review before it
   silently degrades to the most brittle strategy.

## 5. Escalation & handoff

Three pieces, in `escalation/`:

- **`session-manager.ts`** is the single source of truth for "who is in control." Automation
  calls `requestEscalation(runId, context)`, which flips `control` to `"human"` and returns a
  promise that only resolves when an operator calls `resumeSession`. The call site in both the
  discovery loop and the replay executor is a plain `await` — no separate polling loop.
- **`operator-server.ts`** is a real HTTP API bound to the same in-process session registry:
  `GET /interventions` (what's pending, with full context), `GET /interventions/:id` (a fresh
  live snapshot + screenshot), `POST /interventions/:id/actions` (perform one click/type/select
  directly on the live page, recorded against the intervention), `POST /interventions/:id/resume`
  (hand control back with a resolution). This is the seam the brief calls out: pause, cede
  control of the *live* session, resume, with context and evidence preserved across the handoff.
- Two triggers are wired end-to-end and demonstrated in `/evidence` (see `evidence/INDEX.md`):
  a **risky-action authorization gate** (an unattended, non-approved capability pauses before its
  one `risky`-flagged step) and a **hard-failure recovery** (no declared outcome recognizes the
  page; a human performs the missing action directly through the operator API; automation
  resumes from the next step). `humanActions` on the resolved intervention records exactly what
  the human did, by `refId` and value.

**What's mocked, deliberately:** the operator console is a bare HTML page plus scripted `curl`
calls for reproducible evidence, per the brief's scope note. What's real is everything under it —
the pause, the live-session HTTP access, the resume signal, the action log. A production console
would add: identity/auth on the operator API, a real-time view instead of poll/fetch, and a queue
across multiple concurrent interventions (today, `listPending()` is a linear scan of an in-memory
map — fine at this scale, not the place to add infrastructure prematurely).

## 6. Safety

- **Allowlist** (`guardrails/policy.ts`): explicit origin allowlist, a path-shape route allowlist
  (`allowedRoutePatterns`, e.g. `/members/*` — the origin check alone would still let the agent
  navigate to any route on a permitted host, including ones nobody has reviewed a capability
  against), and an action-type allowlist. All three are enforced by both the discovery loop and
  the replay executor before every navigate/act call, including the recovery-navigate path used
  when clearing a recoverable condition — not just logged after the fact.
- **Risk classification**: computed once, at record time, from a text-matcher against the actual
  policy in force (`isRiskyAction`), stored as `step.risky` on the artifact rather than
  re-evaluated from a description string at replay time (which would let classification drift
  independently of the policy that produced it). An unattended replay of a risky step requires
  explicit authorization unless the artifact carries `approval: "approved"` — a human reviewer
  action (`cli.ts approve`), not an automatic transition.
- **Redaction**: credentials are declared as ordinary parameters (`username`/`password`, injected
  from environment at replay time, never accepted as an agent-supplied invocation argument — see
  `config.ts`), which means the recorder resolves them to `{kind: "param", name: "password"}`
  rather than embedding the literal value. Belt-and-suspenders: `guardrails/redaction.ts` also
  regex-scrubs SSN-shaped and bearer-token-shaped text and masks known-sensitive field names
  everywhere something is written to disk, and `scrubKnownSecrets` additionally strips the actual
  registered secret value out of free text (needed because the discovery goal prompt has to tell
  the agent the literal password to type — I caught this leaking into the artifact's
  `discovery.sourceGoal` field during testing and fixed it; see the redaction tests).
- **Limits:** its known limits: redaction is pattern/name-based, not exhaustive; a secret shaped
  differently than what's registered or matched would not be caught. Production would want a
  denylist informed by the target app's actual PII fields, not a generic pattern set.

## 7. Cuts

- **Multi-tenant plumbing is designed, not built** (§4) — the brief explicitly asks for a credible
  design, not the infrastructure.
- **Desktop/native surface** — not implemented; the perception/locator seam (§4) is the reason I
  believe it wouldn't require touching the artifact schema.
- **Operator console UI** — scripted HTTP calls instead of a person clicking, for reproducible
  evidence (§5); the API underneath is real.
- **Confidence scoring / stability replay (stretch)** — not built. I built one stretch goal
  instead of several, per the brief's "depth over breadth": the agent-facing catalog/invoke
  interface (`cli.ts catalog invoke`), because it's the piece that actually demonstrates "an AI
  agent could call this by name with typed args," which is the project's stated through-line.
- **What I'd build next:** a second recorded capability (to see how much of the schema/recorder
  is truly capability-agnostic vs. accidentally shaped by this one flow), the base-artifact +
  override mechanism for multi-tenant reuse, and multi-run stability scoring before gating
  anything on `approval: "approved"` automatically rather than by human action.
- **A `/code-review` pass caught a real double-execution bug** in the risky-action escalation
  gate: it only checked for `resolution === "rejected"`, so an operator who authorized a risky
  step by performing it themselves through the operator API (rather than just approving it) had
  automation perform the same click a second time. Also caught: a `request_help` tool call
  leaving its `tool_use` block unresolved (would have crashed the next API call), an unvalidated
  `resolution` string on the operator API, a guardrail violation being routed into human
  escalation instead of a hard refusal, `approve`/`unapprove` bypassing schema validation and
  redaction on write, an `extract` step silently skipped during recoverable-condition retries,
  and the declared step/timeout limits never being enforced. All eight are fixed; see
  `evidence/INDEX.md` for the regression run. A follow-up `/simplify` pass then deduplicated the
  deadline/step-limit checks and the resolution-enum declaration across files. Re-reading the
  brief itself (not just the code) afterward found two more real gaps: the allowlist was
  origin-only despite the brief asking for "domains/routes" (fixed with `allowedRoutePatterns`),
  and action logging captured *what* the agent did but not *why* (fixed by making `reasoning` a
  required field on every action tool — see §1).
