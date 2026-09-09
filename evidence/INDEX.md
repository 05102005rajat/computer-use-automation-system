# Evidence index

All runs below are real: a live Chromium (via Playwright) driving the mock target app in
`src/target-app`, and the `discovery-*` run is a genuine live call to Claude
(`claude-sonnet-4-5`) via the Anthropic API. Each directory has `run.jsonl` (structured,
redacted event log) and one or more `.png` screenshots. This set was regenerated after a
`/code-review` pass (8 confirmed findings, all fixed) and a `/simplify` pass on top of those
fixes — see the notes at the bottom for what each one caught.

| Directory | What it demonstrates |
|---|---|
| `discovery-1788937005223` | **The required live LLM-driven discovery run.** Goal: log in, look up member 10023, extract the savings balance, open a new "share" sub-account with nickname "Holiday Fund" and a $50 deposit, extract the confirmation number. Produced `artifacts/open_sub_account.v1.json`. |
| `replay-1788937051178` | **Deterministic replay, happy path**, member 40040. Also exercises the *recoverable* condition path: this member forces a one-time "session expired" interstitial, which replay detects and clears automatically (see `replay_recoverable_condition` in the log) before completing. |
| `replay-1788937098495` | **Business outcome**, not a crash: member 99999 doesn't exist -> `{"status":"business_outcome","outcome":"member_not_found"}`. |
| `replay-1788937109781` | **Business outcome**: member 10099 is frozen -> `{"status":"business_outcome","outcome":"member_frozen"}`. |
| `replay-1788937126776` | **Escalation demo 1 -- risky-action authorization, human performs the action directly.** Artifact temporarily reverted to `draft`. Replay pauses for real (`escalation_requested`) before the "Open Sub-Account" click -- the *only* step flagged `risky`. The (scripted) operator called `POST /interventions/:id/actions {"type":"click","refId":"f0_3"}` against the live session -- i.e. clicked the button itself, not just "approved" -- then resumed. `run.jsonl` shows `replay_step_completed_by_human` for `step-10`: automation recognized the step was already performed and did **not** click it again (this was a real double-submission bug caught by code review and fixed before this run -- see notes below). |
| `replay-1788937168469` | **Escalation demo 2 -- UI-drift manual recovery.** Run against `artifacts/open_sub_account.v1-drift-demo.json`, a hand-edited copy where the "Initial Deposit" field's locator candidates are deliberately broken (simulating the target app renaming that field after the capability was recorded). Replay exhausts the fallback chain, finds no declared outcome matches the page either, and escalates. The (scripted) operator fetched the live snapshot, found the field's current `refId`, and issued `POST /interventions/:id/actions {"type":"type","refId":"f0_2","value":"80"}` directly against the live session, then resumed. Automation continued from the very next step and completed. `humanActions` in the resolved event shows exactly what the human did. |
| `replay-1788937220535` | **Stretch: agent-facing invocation.** Produced by `catalog invoke open_sub_account '{"memberId":"10023",...}'` -- the same replay path, reached the way a calling AI agent would: by capability name and typed JSON args, not CLI flags. |

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

## Note on the `/code-review` pass

A review of the initial implementation found 8 confirmed issues, all fixed before this evidence
was captured:

- **Double-execution**: the risky-action gate only checked `resolution === "rejected"`, so an
  operator who resolved with `"manual_actions_completed"` (meaning *they* already performed the
  action) had it performed a second time by automation. Fixed by skipping re-execution whenever
  `humanActions` is non-empty -- `replay-1788937126776` above is the regression check.
- A `request_help` tool call left its `tool_use` block unresolved (no matching `tool_result`),
  which would have crashed the very next Anthropic API call, and never checked for an operator
  rejecting the help request.
- The operator API accepted any string as `resolution` with no validation; a typo like
  `"aproved"` would silently fall through to treating a risky action as authorized.
- A `PolicyViolationError` (an allowlist/guardrail violation) was being caught by the generic
  per-step error handler and routed into human escalation instead of a hard refusal.
- `cli.ts approve`/`unapprove` wrote artifacts back with raw `fs.writeFileSync`, bypassing both
  schema validation and redaction.
- An `extract` step retried after a recoverable condition (e.g. the session-timeout interstitial)
  fell through unhandled and silently skipped writing its output.
- `Policy.maxStepsPerRun`/`maxRunTimeoutMs` were declared but never enforced anywhere.

A follow-up `/simplify` pass (4 parallel reviewers: reuse, simplification, efficiency, altitude)
found the deadline-check and step-limit logic duplicated between the discovery loop and the
replay executor and the resolution enum duplicated between the operator API and the session
manager; both are now shared (`guardrails/policy.ts`'s `deadlineFor`/`isPastDeadline`,
`escalation/session-manager.ts`'s exported `Resolution` type), and a `PolicyViolationError`
response that was being constructed twice (once per-step, once at the top level) is now built
once by re-throwing to the outer handler.
