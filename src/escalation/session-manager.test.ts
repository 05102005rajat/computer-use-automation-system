import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import {
  registerSession,
  unregisterSession,
  assertHumanControl,
  requestEscalation,
  resumeSession,
} from "./session-manager.js";

// A stale or duplicate request that mutates the live page must not slip
// through between "control flipped back to automation" and "we got around
// to recording it" -- this is the regression for that race: assertHumanControl
// has to be checked immediately before the mutation, and must reflect the
// current state at each point in the session's lifecycle.
const fakePage = {} as Page;

test("assertHumanControl throws before any escalation has been requested", () => {
  const runId = "test-run-1";
  registerSession(runId, fakePage);
  assert.throws(() => assertHumanControl(runId));
  unregisterSession(runId);
});

test("assertHumanControl allows action only while an escalation is pending", async () => {
  const runId = "test-run-2";
  registerSession(runId, fakePage);

  // requestEscalation flips control synchronously before its returned
  // promise ever resolves -- don't await it, just let it sit pending.
  const pendingResolution = requestEscalation(runId, {
    reason: "test",
    capability: "test-capability",
    goal: "test goal",
    stepDescription: "test step",
  });

  assert.doesNotThrow(() => assertHumanControl(runId));

  resumeSession(runId, "approved");
  await pendingResolution;

  // Control is back with automation -- a stale action request must now be
  // rejected instead of silently mutating the live page.
  assert.throws(() => assertHumanControl(runId));

  unregisterSession(runId);
});
