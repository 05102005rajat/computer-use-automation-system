# Evidence index

All runs below are real: a live Chromium (via Playwright) driving the mock target app in
`src/target-app`, and the `discovery-*` run is a genuine live call to Claude
(`claude-sonnet-4-5`) via the Anthropic API. Each directory has `run.jsonl` (structured,
redacted event log) and one or more `.png` screenshots.

| Directory | What it demonstrates |
|---|---|
| `discovery-1788939753680` | **The required live LLM-driven discovery run.** Goal: log in, look up member 10023, extract the savings balance, open a new "share" sub-account with nickname "Holiday Fund" and a $50 deposit, extract the confirmation number. Produced `artifacts/open_sub_account.v1.json` (`approval: "approved"`, from `--auto-approve-risky`). `model_decision` events carry a `reasoning` string for every action. |
| `replay-1788939814623` | **Deterministic replay, happy path**, member 40040 — `npm run replay -- --member 40040 --type money_market --nickname "Retirement Boost" --deposit 200`. Also exercises the *recoverable* condition path for free: this member forces a one-time "session expired" interstitial, which replay detects and clears automatically (`replay_recoverable_condition` in the log) before completing. |
| `replay-1788939868039` | **Business outcome, not a crash** — `npm run replay -- --member 99999 --type share --nickname "Test" --deposit 25` → `{"status":"business_outcome","outcome":"member_not_found"}`. |
| `replay-1788939884951` | **Escalation demo — risky-action authorization, human performs the action directly.** Run against `artifacts/open_sub_account.v1-draft.json` (a copy of the approved artifact with `approval` reverted to `"draft"`, kept only so this demo has something to pause against — no CLI command flips it). Replay pauses for real (`escalation_requested`) before the "Open Sub-Account" click — the *only* step flagged `risky`. The operator called `POST /interventions/:id/actions {"type":"click","refId":"f0_3"}` against the live session — i.e. clicked the button itself, not just "approved" — then resumed. `run.jsonl` shows `replay_step_completed_by_human` for `step-10`: automation recognized the step was already performed and did **not** click it again. |

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
