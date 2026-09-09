# Computer-Use Automation System

A small, real implementation of the interface.ai take-home: an LLM ("computer use") discovers
how to complete a task in a legacy, no-API back-office application; the successful run is
recorded as a typed, versioned **capability artifact**; the artifact then **replays
deterministically**, with no model in the loop, distinguishing business outcomes from
recoverable conditions from hard failures; and a real human-escalation/handoff mechanism lets
an operator take over the *same live session* and hand control back.

See `/REPORT.md` for the design write-up (architecture, artifact schema, determinism/error
handling, heterogeneity & multi-tenant story, escalation model, safety model, cuts).

## What's here

- **Target application** (`src/target-app`): a mock "Meridian Credit Union" teller console --
  server-rendered HTML, table-based layout, no test IDs, one `<iframe>` (deliberately, to force
  frame-aware perception/locating). This stands in for the real thing per the assignment's
  ground rules (no real bank system, no real credentials/PII).
- **Discovery agent** (`src/agent`): an observe -> decide -> act loop driven by Claude
  (`claude-sonnet-4-5`), perceiving the page via a runtime-derived accessibility-style snapshot
  (role, accessible name, visible text) rather than a fixed DOM -- built to survive a surface
  with no clean DOM or test IDs.
- **Capability artifact** (`src/artifact`): a versioned, zod-validated schema for the recorded
  flow -- steps, locator fallback chains with robustness reasoning, typed inputs/outputs, a
  success checkpoint, and a declared outcome taxonomy.
- **Replay executor** (`src/replay`): deterministic, no-LLM execution of a saved artifact, with
  a real error taxonomy (business outcome / recoverable / hard failure) and stable locator
  resolution with fallbacks.
- **Guardrails** (`src/guardrails`): an explicit allowlist, risk classification (computed once
  at record time, not re-derived from text at replay time), and redaction of sensitive data from
  every log and artifact.
- **Escalation & handoff** (`src/escalation`): a session manager that lets automation pause,
  cede control of the *live* Playwright session, and resume, plus a minimal (but real) HTTP
  operator API and console.
- **Evidence** (`/evidence`): real logs + screenshots from an actual discovery run and several
  replay runs, including error/business-outcome cases and two escalation demos. See
  `evidence/INDEX.md`.

## Setup

Requires Node 20+ and an Anthropic API key (only needed for `discover`; `replay` and `catalog`
never call an LLM).

```bash
npm install
npx playwright install chromium
cp .env.example .env   # then fill in ANTHROPIC_API_KEY
```

`.env` variables:

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | required for `discover` only |
| `TARGET_APP_PORT` | 4100 | the mock target app |
| `OPERATOR_PORT` | 4200 | the operator HTTP API (started automatically by `discover`/`replay`) |
| `TARGET_APP_USERNAME` / `TARGET_APP_PASSWORD` | `teller` / `teller123` | mock app login, injected at replay time, never accepted as an agent-supplied parameter |

## Demo path

1. Start the target app in one terminal:

   ```bash
   npm run target-app
   ```

2. In another terminal, run the agent on a goal (a **real** LLM-driven run against the live
   app above -- this is the part that has to be genuine, per the assignment):

   ```bash
   npm run discover -- --member 10023 --type share --nickname "Holiday Fund" --deposit 50 --auto-approve-risky true
   ```

   This logs into the mock console, looks up member `10023`, reads their savings balance,
   opens a new sub-account, and reaches the confirmation screen -- then saves
   `artifacts/open_sub_account.v1.json`.

   `--auto-approve-risky` skips the interactive risk-confirmation gate on the (correctly
   risk-classified) "Open Sub-Account" click, so the discovery run completes end-to-end
   unattended. Omit it to see that gate for real -- the run will pause and wait for an operator
   to resolve `POST http://localhost:4200/interventions/:id/resume` (see below).

3. A human reviewer approves the artifact for unattended production replay:

   ```bash
   npm run build >/dev/null 2>&1 || true   # optional; tsx runs .ts directly
   npx tsx src/cli.ts approve
   ```

4. Replay the recorded capability -- **no LLM involved** -- with fresh parameters:

   ```bash
   npm run replay -- --member 40040 --type money_market --nickname "Retirement Boost" --deposit 200
   ```

   Member `40040` also exercises the *recoverable* condition path: the mock app forces a
   one-time "session expired" interstitial the first time this flow runs in a session, and
   replay detects and clears it automatically before continuing.

5. See a business outcome (not a crash) reported cleanly:

   ```bash
   npm run replay -- --member 99999 --type share --nickname "Test" --deposit 25
   # -> {"status":"business_outcome","outcome":"member_not_found", ...}

   npm run replay -- --member 10099 --type share --nickname "Test" --deposit 25
   # -> {"status":"business_outcome","outcome":"member_frozen", ...}
   ```

6. See the escalation/handoff mechanism for real. Revert approval, start a replay in the
   background, then act as the operator over plain HTTP against the *same live session*:

   ```bash
   npx tsx src/cli.ts unapprove
   npm run replay -- --member 10023 --type christmas_club --nickname "Escalation Demo" --deposit 60 &

   curl -s http://localhost:4200/interventions            # see the pending intervention + reason
   curl -s http://localhost:4200/interventions/intervention-1   # live snapshot + screenshot path
   curl -s -X POST http://localhost:4200/interventions/intervention-1/resume \
     -H "Content-Type: application/json" -d '{"resolution":"approved"}'
   ```

   The backgrounded replay resumes on the same page and completes. A second, richer escalation
   demo (a human manually filling a drifted field via the operator API, not just approving) is
   in `evidence/replay-1788930527588` -- see `evidence/INDEX.md` for exactly how it was driven.

7. (Stretch) List and invoke capabilities the way an AI agent would -- by name, with typed args:

   ```bash
   npx tsx src/cli.ts catalog
   npx tsx src/cli.ts catalog invoke open_sub_account \
     '{"memberId":"10023","subAccountType":"share","nickname":"Catalog Invoke Demo","depositAmount":90}'
   ```

## Running without live services

`discover` requires the target app running and a live Anthropic API key -- there is no offline
mode for it (the assignment explicitly requires a genuine LLM-driven run). `replay` and
`catalog` only need the target app running; they never call an LLM. Everything in `/evidence`
is a real, already-captured run if you just want to read the logs without running anything.

## Tests

```bash
npm test        # node's built-in test runner, no extra framework
npm run typecheck
```

Tests cover the locator fallback ordering/robustness logic, the URL-pattern matcher used by
outcome/checkpoint detection, and the redaction utilities -- the parts where a silent regression
would be hardest to notice by just eyeballing a passing demo run.
