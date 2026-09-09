# Evidence index

All runs below are real: a live Chromium (via Playwright) driving the mock target app in
`src/target-app`, and the `discovery-*` run is a genuine live call to Claude
(`claude-sonnet-4-5`) via the Anthropic API. Each directory has `run.jsonl` (structured,
redacted event log) and one or more `.png` screenshots.

| Directory | What it demonstrates |
|---|---|
| `discovery-1788944996038` | **The required live LLM-driven discovery run.** Goal: log in, look up member 10023, extract the savings balance, open a new "share" sub-account with nickname "Holiday Fund" and a $50 deposit, extract the confirmation number. Produced `artifacts/open_sub_account.v1.json` (`approval: "approved"`, from `--auto-approve-risky`). `model_decision` events carry a `reasoning` string for every action. |
| `replay-1788945052256` | **Deterministic replay, happy path**, member 40040 — `npm run replay -- --member 40040 --type money_market --nickname "Retirement Boost" --deposit 200`. Also exercises the *recoverable* condition path for free: this member forces a one-time "session expired" interstitial, which replay detects and clears automatically (`replay_recoverable_condition` in the log) before completing. |
| `replay-1788945082671` | **Business outcome, not a crash** — `npm run replay -- --member 99999 --type share --nickname "Test" --deposit 25` → `{"status":"business_outcome","outcome":"member_not_found"}`. |
| `replay-1788945101208` | **Escalation demo — risky-action authorization, human performs the action directly.** Run against `artifacts/open_sub_account.v1-draft.json` (a copy of the approved artifact with `approval` reverted to `"draft"`, kept only so this demo has something to pause against — no CLI command flips it). Replay pauses for real (`escalation_requested`) before the "Open Sub-Account" click — the *only* step flagged `risky`. The operator called `POST /interventions/:id/actions {"type":"click","refId":"f0_3"}` against the live session — i.e. clicked the button itself, not just "approved" — then resumed. `run.jsonl` shows `replay_step_completed_by_human` for `step-10`: automation recognized the step was already performed and did **not** click it again. |

See `README.md`'s "Quick demo" for the exact commands that produced these four runs.

## Design notes

- **One escalation demo, not two.** The `escalate()` mechanism (`escalation/escalate.ts`) is
  generic — a hard-failure/UI-drift scenario would go through the identical pause → operator acts
  on the live session → resume path — but only the risky-action trigger above is demonstrated.
  See `REPORT.md` §5 and §7.
- **Three declared outcomes, not six.** `known-outcomes.meridian.ts` declares `member_not_found`,
  `member_frozen`, and `session_expired` (recoverable) — enough to show the taxonomy isn't binary.
  Only `member_not_found` and `session_expired` are exercised above; `member_frozen` and three
  validation-error variants the target app also has are not built into this evidence set. See
  `REPORT.md` §7.
- **No `catalog`/`approve`/`unapprove` commands.** `replay` with typed CLI flags is the agent
  invocation demo; a capability catalog layer was considered and cut (`REPORT.md` §7). The
  artifact's `approval` field is a plain JSON edit a reviewer makes directly — `discover
  --auto-approve-risky` is the only thing in this build that sets it programmatically.

## Note on a second `/code-review` pass

A full-codebase review (not just the recent diff) found 8 more confirmed issues, all fixed and
re-verified against the four runs above:

- **The discovery loop had the same double-execution bug** the replay executor's risk gate was
  already fixed for — an operator who performed a risky click themselves during discovery would
  have had automation click it again. Same fix (check `humanActions` before re-executing).
- **The route allowlist only ever checked explicit `navigate` steps**, never a click-triggered
  navigation — the dominant way this fully server-rendered app actually navigates. Now checked
  after every click too (`replay/executor.ts`'s `performAction`, `agent/loop.ts`'s click branch).
- **The operator's manual-action endpoint bypassed the shared click/type/select dispatch** (raw
  `locator.click()` instead of `performLocatorAction`/`clickAndSettle`) and ran with no guardrail
  checks at all, unlike every other action path in the codebase. Fixed to use the same dispatch
  and the same allowlist checks.
- **A control-state race**: the operator endpoint mutated the live page *before* checking whether
  the session was still under human control, only validating afterward when recording the action.
  Added `assertHumanControl`, checked immediately before the mutation.
- **Reflected XSS** in the mock target app: `memberId`/`nickname` were interpolated into HTML with
  no escaping. Added `escapeHtml`, applied everywhere a request-derived string reaches a template;
  regression tests in `target-app/views.test.ts`.
- **`resolveLocator` accepted an ambiguous match** (`count >= 1`, not `=== 1`) and silently took
  the first element — now falls through to the next fallback candidate instead.
- **The iframe locator's "wildcarded" `src` match was inert**: it embedded a literal `*` character
  into a CSS substring selector, which never matches (CSS has no glob semantics there), so
  resolution always fell through to the bare `iframe` fallback. Fixed to use the real stable path
  suffix instead of a fake wildcard.
- **A missing `username`/`password` param** (excluded from the artifact's public `inputs` by
  design) produced an unclassified hard failure instead of `errorType: "input_validation"`. Added
  a dedicated error type so it's now classified correctly.

## Test coverage for the second review pass

A follow-up self-audit found that only 1 of these 8 fixes (the XSS one) had a regression test.
Added fast tests for 6 more, several of which launch a real headless Chromium against a
self-contained `page.setContent()` fixture rather than mocking Playwright, so they exercise real
locator resolution: `agent/perception.test.ts` (the iframe path-suffix fix, plus a direct assertion
that the computed value is never a substring the literal-`*` bug would have produced),
`replay/locator.test.ts` (ambiguous-match rejection), `replay/executor.test.ts` (the
`MissingParamError` classification, and the post-click route-allowlist check via a direct call to
`performAction` with both a restrictive and a permissive policy), and
`escalation/session-manager.test.ts` (`assertHumanControl` correctly denies before an escalation
and after one resumes, not just during).

Two of the 8 remain covered only by live regression runs against the real target app, not a fast
test, and this is a real gap rather than a hidden one:
- **The discovery loop's double-execution fix** (`agent/loop.ts`) sits inside the live
  Anthropic tool-call loop; a fast test would need to mock streaming tool-use responses, which is
  disproportionate effort for a take-home relative to what it would catch beyond what
  `replay/executor.test.ts`'s equivalent logic already exercises (both call sites use the same
  `humanActions.length > 0` check).
- **`escalation/operator-server.ts`'s HTTP route** wiring `assertHumanControl` +
  `performLocatorAction` + the guardrail checks together is exercised by the live escalation demo
  (`replay-1788945101208` above, re-run again after this change) but has no dedicated
  Express-level test; the pieces it composes are each tested individually.

## Screen recordings (`videos/`)

Real Playwright video capture (`evidence/video.ts`'s `launchPage`, gated behind a
`RECORD_VIDEO_DIR` env var normal runs never set) of a separate run of the exact commands in
`README.md`'s Quick demo -- `discovery.mp4`, `replay-happy.mp4`, and `escalation.mp4` (the
`escalation-preview.gif` embedded in the README is a downsampled clip of the last one). These are
illustrative, not the numbered runs listed above -- a fresh `discover` run always creates a new
artifact version (`v2`, since `v1` already exists in the repo), so the video-backing runs used a
`v2` artifact rather than replacing the four canonical logs above.
