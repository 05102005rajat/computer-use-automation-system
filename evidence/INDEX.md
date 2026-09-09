# Evidence index

All runs below are real: a live Chromium (via Playwright) driving the mock target app in
`src/target-app`, and the `discovery-*` run is a genuine live call to Claude
(`claude-sonnet-4-5`) via the Anthropic API. Each directory has `run.jsonl` (structured,
redacted event log) and one or more `.png` screenshots. This set reflects a `/code-review` pass
(8 confirmed findings, all fixed), a `/simplify` pass on top of those fixes, and a self-audit
against the assignment brief that found two more gaps (route-level allowlisting, and every
action now carrying a "why") -- see the notes at the bottom for each.

| Directory | What it demonstrates |
|---|---|
| `discovery-1788937596216` | **The required live LLM-driven discovery run.** Goal: log in, look up member 10023, extract the savings balance, open a new "share" sub-account with nickname "Holiday Fund" and a $50 deposit, extract the confirmation number. Produced `artifacts/open_sub_account.v1.json`. `run.jsonl`'s `model_decision` events now carry a `reasoning` string for every action (e.g. `"I need to click the \"Sign In\" button to submit the login credentials..."`). |
| `replay-1788937656060` | **Deterministic replay, happy path**, member 40040. Also exercises the *recoverable* condition path: this member forces a one-time "session expired" interstitial, which replay detects and clears automatically (see `replay_recoverable_condition` in the log) before completing. |
| `replay-1788937703881` | **Business outcome**, not a crash: member 99999 doesn't exist -> `{"status":"business_outcome","outcome":"member_not_found"}`. |
| `replay-1788937715402` | **Business outcome**: member 10099 is frozen -> `{"status":"business_outcome","outcome":"member_frozen"}`. |
| `replay-1788937731493` | **Escalation demo 1 -- risky-action authorization, human performs the action directly.** Artifact temporarily reverted to `draft`. Replay pauses for real (`escalation_requested`) before the "Open Sub-Account" click -- the *only* step flagged `risky`. The (scripted) operator called `POST /interventions/:id/actions {"type":"click","refId":"f0_3"}` against the live session -- i.e. clicked the button itself, not just "approved" -- then resumed. `run.jsonl` shows `replay_step_completed_by_human` for `step-10`: automation recognized the step was already performed and did **not** click it again (a real double-submission bug caught by code review; see notes below). |
| `replay-1788937773593` | **Escalation demo 2 -- UI-drift manual recovery.** Run against `artifacts/open_sub_account.v1-drift-demo.json`, a hand-edited copy where the "Initial Deposit" field's locator candidates are deliberately broken (simulating the target app renaming that field after the capability was recorded). Replay exhausts the fallback chain, finds no declared outcome matches the page either, and escalates. The (scripted) operator fetched the live snapshot, found the field's current `refId`, and issued `POST /interventions/:id/actions {"type":"type","refId":"f0_2","value":"80"}` directly against the live session, then resumed. Automation continued from the very next step and completed. `humanActions` in the resolved event shows exactly what the human did. |
| `replay-1788937825674` | **Stretch: agent-facing invocation.** Produced by `catalog invoke open_sub_account '{"memberId":"10023",...}'` -- the same replay path, reached the way a calling AI agent would: by capability name and typed JSON args, not CLI flags. |

## Note on the two escalation demos

Both use a real mechanism end-to-end: a live Playwright session held open behind an HTTP API
(`src/escalation/operator-server.ts`), a genuine pause/block on the automation side
(`src/escalation/session-manager.ts`'s `requestEscalation` awaits a promise that only resolves
when an operator calls `/resume`), and full context (reason, screenshot, current live
snapshot) available to whoever is deciding. For reproducible evidence generation the operator
side was driven by scripted `curl` calls rather than a person clicking a UI -- documented, not
hidden -- but the same API is what a real (also minimal, per the assignment's scope note)
operator console would call. See `REPORT.md`, "Escalation & handoff", for the full design and
what a production console would add.

## Note on the `/code-review` and `/simplify` passes

A review of the initial implementation found 8 confirmed issues, all fixed:

- **Double-execution**: the risky-action gate only checked `resolution === "rejected"`, so an
  operator who resolved with `"manual_actions_completed"` (meaning *they* already performed the
  action) had it performed a second time by automation. Fixed by skipping re-execution whenever
  `humanActions` is non-empty -- `replay-1788937731493` above is the regression check.
- A `request_help` tool call left its `tool_use` block unresolved (no matching `tool_result`),
  which would have crashed the very next Anthropic API call, and never checked for an operator
  rejecting the help request.
- The operator API accepted any string as `resolution` with no validation.
- A `PolicyViolationError` (an allowlist/guardrail violation) was being caught by the generic
  per-step error handler and routed into human escalation instead of a hard refusal.
- `cli.ts approve`/`unapprove` wrote artifacts back with raw `fs.writeFileSync`, bypassing both
  schema validation and redaction.
- An `extract` step retried after a recoverable condition fell through unhandled and silently
  skipped writing its output.
- `Policy.maxStepsPerRun`/`maxRunTimeoutMs` were declared but never enforced anywhere.

A follow-up `/simplify` pass deduplicated the deadline-check/step-limit logic and the resolution
enum that had drifted into separate copies across files, and removed a duplicated
`PolicyViolationError` response by re-throwing to one shared handler instead.

## Note on the brief re-read

Re-checking the implementation directly against the assignment brief (not just the code) found
two more real gaps, both fixed before this evidence was captured:

- **Route-level allowlisting.** Section 3.4 asks for an allowlist of "permitted domains/routes,"
  but the policy only ever checked the origin -- an agent could navigate to *any* path on an
  allowed host. `guardrails/policy.ts` now also carries `allowedRoutePatterns` (path-shape
  globs, e.g. `/members/*`) and `assertNavigationAllowed` checks both; the recovery-navigate path
  in `replay/executor.ts` (previously unchecked entirely) now goes through the same guard. See
  `src/guardrails/policy.test.ts`.
- **"What it did and why."** Section 3.5 asks for a log of what the agent did *and why*, but with
  `tool_choice: "any"` (used so the model always calls a tool) Claude doesn't reliably emit
  free-form preamble text explaining its reasoning -- the log only ever recorded the tool name and
  arguments. Every action tool (`navigate`/`click`/`type`/`select`/`extract`) now requires a
  `reasoning` field in its own schema, so a one-sentence rationale is captured regardless of
  tool-choice mode. See the `model_decision` events in `discovery-1788937596216/run.jsonl`.
