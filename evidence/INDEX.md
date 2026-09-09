# Evidence index

All runs below are real: a live Chromium (via Playwright) driving the mock target app in
`src/target-app`, and the `discovery-*` run is a genuine live call to Claude
(`claude-sonnet-4-5`) via the Anthropic API. Each directory has `run.jsonl` (structured,
redacted event log) and one or more `.png` screenshots.

| Directory | What it demonstrates |
|---|---|
| `discovery-1788930310094` | **The required live LLM-driven discovery run.** Goal: log in, look up member 10023, extract the savings balance, open a new "share" sub-account with nickname "Holiday Fund" and a $50 deposit, extract the confirmation number. Produced `artifacts/open_sub_account.v1.json`. |
| `replay-1788930368021` | **Deterministic replay, happy path**, member 40040. Also exercises the *recoverable* condition path: this member forces a one-time "session expired" interstitial, which replay detects and clears automatically (see `replay_recoverable_condition` in the log) before completing. |
| `replay-1788930421252` | **Business outcome**, not a crash: member 99999 doesn't exist -> `{"status":"business_outcome","outcome":"member_not_found"}`. |
| `replay-1788930432995` | **Business outcome**: member 10099 is frozen -> `{"status":"business_outcome","outcome":"member_frozen"}`. |
| `replay-1788930450348` | **Escalation demo 1 -- risky-action authorization.** Artifact temporarily reverted to `draft`. Replay pauses for real (`escalation_requested` in the log) before the "Open Sub-Account" click -- the *only* step flagged `risky`, not every click. Resolved by a live `POST /interventions/:id/resume {"resolution":"approved"}` against the running operator API while the replay process was blocked and waiting, then the same session resumed and completed. |
| `replay-1788930527588` | **Escalation demo 2 -- UI-drift manual recovery.** Run against `artifacts/open_sub_account.v1-drift-demo.json`, a hand-edited copy where the "Initial Deposit" field's locator candidates are deliberately broken (simulating the target app renaming that field after the capability was recorded). Replay exhausts the fallback chain, finds no declared outcome matches the page either, and escalates. The (scripted) operator fetched the live snapshot, found the field's current `refId`, and issued `POST /interventions/:id/actions {"type":"type","refId":"f0_2","value":"80"}` directly against the live session, then resumed. Automation continued from the very next step and completed. `humanActions` in the resolved event shows exactly what the human did. |
| `replay-1788930593309` | **Stretch: agent-facing invocation.** Produced by `catalog invoke open_sub_account '{"memberId":"10023",...}'` -- the same replay path, reached the way a calling AI agent would: by capability name and typed JSON args, not CLI flags. |

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
