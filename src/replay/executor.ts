import type { Page, Frame } from "playwright";
import { launchPage } from "../evidence/video.js";
import type { CapabilityArtifact, BusinessOutcome, Checkpoint, ValueRef } from "../artifact/schema.js";
import { resolveFrame, resolveLocator, LocatorResolutionError, performLocatorAction } from "./locator.js";
import { matchesUrlPattern, type ReplayResult } from "./errors.js";
import { assertActionTypeAllowed, assertNavigationAllowed, deadlineFor, isPastDeadline, type Policy, PolicyViolationError } from "../guardrails/policy.js";
import type { RunLogger } from "../evidence/logger.js";
import { registerSession, unregisterSession } from "../escalation/session-manager.js";
import { escalate } from "../escalation/escalate.js";

// A step can reference a param (e.g. "username"/"password") that isn't part
// of the artifact's public `inputs` contract -- credentials are deliberately
// excluded from what a calling agent supplies (see REPORT.md, Safety). That
// means the up-front "Typed input validation" loop below can't check them,
// so a caller missing one fails deep inside step execution instead; this
// dedicated error type lets that still be reported as `input_validation`
// rather than falling through to an unclassified hard failure.
export class MissingParamError extends Error {
  constructor(paramName: string) {
    super(`Missing required input parameter: ${paramName}`);
    this.name = "MissingParamError";
  }
}

export function resolveValue(ref: ValueRef, params: Record<string, string>): string {
  if (ref.kind === "literal") return ref.value;
  const v = params[ref.name];
  if (v === undefined) throw new MissingParamError(ref.name);
  return v;
}

export type ActionableStep = Extract<CapabilityArtifact["steps"][number], { kind: "click" | "type" | "select" | "extract" | "wait_for" }>;

function isActionable(step: CapabilityArtifact["steps"][number]): step is ActionableStep {
  return step.kind !== "navigate";
}

/** Turns one artifact step into the generic `LocatorAction` shape and hands
 * it to `performLocatorAction` -- the actual click/type/select/extract
 * dispatch lives in exactly one place (`replay/locator.ts`), shared with the
 * discovery agent loop. This function's own job is just translating a
 * step's `ValueRef` into a concrete string and, for extract, writing the
 * result into `outputs`. Used by both the main execution path and the
 * recoverable-condition retry path, so an extract step retried after a
 * recovery can no longer fall through unhandled the way it once did when
 * the two call sites had drifted apart. */
export async function performAction(
  step: ActionableStep,
  scope: Page | Frame,
  locator: import("playwright").Locator,
  params: Record<string, string>,
  outputs: Record<string, string>,
  policy: Policy
): Promise<void> {
  if (step.kind === "click") {
    await performLocatorAction(scope, locator, { kind: "click" }, step.timeoutMs);
    // The route allowlist previously only guarded explicit `navigate` steps,
    // but in this fully server-rendered app a click is the dominant way the
    // page actually navigates (see clickAndSettle's doc comment) -- so this
    // is the check that actually stops the agent wandering into an
    // unreviewed route, not the one on `navigate` alone.
    assertNavigationAllowed(policy, scope.url());
  } else if (step.kind === "type") {
    await performLocatorAction(scope, locator, { kind: "type", value: resolveValue(step.value, params) }, step.timeoutMs);
  } else if (step.kind === "select") {
    await performLocatorAction(scope, locator, { kind: "select", value: resolveValue(step.value, params) }, step.timeoutMs);
  } else if (step.kind === "extract") {
    const text = await performLocatorAction(scope, locator, { kind: "extract", attribute: step.attribute }, step.timeoutMs);
    outputs[step.outputName] = text ?? "";
  }
  // "wait_for" has nothing left to do: resolveLocator already waited for visibility.
}

async function detectorMatches(
  page: Page,
  outcome: { detector: { urlPattern?: string; textPresent?: string; frame: any } },
  timeoutMs: number
): Promise<boolean> {
  const { detector } = outcome;
  try {
    const scope = await resolveFrame(page, detector.frame, timeoutMs);
    // Check the URL of the frame the detector actually names, not the
    // top-level page -- a same-origin iframe navigation (our confirmation
    // screen included) never changes page.url() at all.
    const scopeUrl = "url" in scope ? scope.url() : page.url();
    if (detector.urlPattern && !matchesUrlPattern(scopeUrl, detector.urlPattern)) return false;
    if (detector.textPresent) {
      const text = await (scope as Page | Frame).evaluate(() => document.body?.innerText ?? "");
      if (!text.includes(detector.textPresent)) return false;
    }
  } catch {
    return false;
  }
  return true;
}

export interface ReplayOptions {
  runId: string;
  artifact: CapabilityArtifact;
  params: Record<string, string>;
  policy: Policy;
  logger: RunLogger;
  capabilityName: string;
}

export async function replayArtifact(opts: ReplayOptions): Promise<ReplayResult> {
  const { artifact, params, policy, logger } = opts;

  // Typed input validation -- a caller-facing contract check, not a UI check.
  for (const input of artifact.inputs) {
    if (input.required && (params[input.name] === undefined || params[input.name] === "")) {
      return {
        status: "error",
        errorType: "input_validation",
        step: "input_validation",
        message: `Missing required input parameter "${input.name}"`,
      };
    }
  }

  if (artifact.steps.length > policy.maxStepsPerRun) {
    return {
      status: "error",
      errorType: "policy_violation",
      step: "policy",
      message: `Artifact has ${artifact.steps.length} steps, exceeding the policy limit of ${policy.maxStepsPerRun}.`,
    };
  }

  const { browser, page } = await launchPage();
  registerSession(opts.runId, page);
  const outputs: Record<string, string> = {};
  const deadline = deadlineFor(policy);

  const cleanup = async () => {
    await browser.close().catch(() => {});
    unregisterSession(opts.runId);
  };

  try {
    for (const step of artifact.steps) {
      if (isPastDeadline(deadline)) {
        logger.event("replay_stopped", { reason: "max_run_timeout_exceeded", stepId: step.id });
        await cleanup();
        return { status: "error", errorType: "policy_violation", step: step.id, message: "max_run_timeout_exceeded" };
      }

      logger.event("replay_step_start", { stepId: step.id, kind: step.kind, description: step.description });

      // Risk gate: an unattended (non-approved) artifact must get explicit
      // human authorization before executing THIS specific step if it was
      // classified risky at record time -- not every click in a capability
      // that happens to contain a risky step somewhere. Exactly the same
      // per-action judgment call as the discovery-time gate, reused.
      if (step.kind === "click" && step.risky && artifact.approval !== "approved") {
        const resolved = await escalate(opts.runId, page, logger, {
          reason: `Unattended replay of a risky-classified step in "${artifact.name}" requires authorization before "${step.description}".`,
          capability: opts.capabilityName,
          goal: artifact.discovery.sourceGoal,
          stepDescription: step.description,
        });
        if (resolved.resolution === "rejected") {
          await cleanup();
          return { status: "error", errorType: "operator_rejected", step: step.id, message: "Operator rejected the risky action." };
        }
        if (resolved.humanActions.length > 0) {
          // The operator already performed this step by hand (recorded in
          // humanActions) rather than merely authorizing automation to
          // proceed -- executing it again here would double-submit an
          // irreversible action.
          logger.event("replay_step_completed_by_human", { stepId: step.id });
          continue;
        }
      }

      try {
        if (step.kind === "navigate") {
          const url = resolveValue(step.url, params);
          assertNavigationAllowed(policy, url);
          assertActionTypeAllowed(policy, "navigate");
          await page.goto(url, { waitUntil: "networkidle", timeout: step.timeoutMs });
          continue;
        }

        assertActionTypeAllowed(policy, step.kind as any);
        const scope = await resolveFrame(page, step.frame, step.timeoutMs);
        const { locator } = await resolveLocator(scope, step.locator, step.timeoutMs);
        await performAction(step, scope, locator, params, outputs, policy);
      } catch (err) {
        // A guardrail violation or a missing required param is a hard
        // refusal, never a "let's ask a human to look at this" situation --
        // rethrow so each reaches its own single response shape in the
        // outer catch below, instead of routing into the outcome-matching/
        // escalation path (which for a policy violation would leave a live
        // page that just broke policy sitting open waiting on an operator).
        if (err instanceof PolicyViolationError || err instanceof MissingParamError) throw err;

        // A locator failed to resolve, or an action timed out. Before
        // declaring a hard failure, check whether the app landed on a
        // *known* runtime condition -- that's the core distinction the
        // brief asks for: business outcome vs. recoverable vs. hard failure.
        const outcomeMatch = await findMatchingOutcome(page, artifact.outcomes, step.timeoutMs);

        if (outcomeMatch?.category === "business_outcome") {
          logger.event("replay_business_outcome", { outcome: outcomeMatch.name, stepId: step.id });
          await cleanup();
          return { status: "business_outcome", outcome: outcomeMatch.name, description: outcomeMatch.description };
        }

        if (outcomeMatch?.category === "recoverable" && outcomeMatch.recovery && isActionable(step)) {
          logger.event("replay_recoverable_condition", { outcome: outcomeMatch.name, stepId: step.id });
          await applyRecovery(page, outcomeMatch, params, step.timeoutMs, policy);
          // Retry the same step once now that the interstitial is cleared.
          try {
            const scope = await resolveFrame(page, step.frame, step.timeoutMs);
            const { locator } = await resolveLocator(scope, step.locator, step.timeoutMs);
            await performAction(step, scope, locator, params, outputs, policy);
            continue;
          } catch (retryErr) {
            const evidencePath = await logger.screenshot(page, `hard-failure-${step.id}`);
            logger.event("replay_hard_failure", { stepId: step.id, error: String(retryErr) });
            await cleanup();
            return {
              status: "error",
              errorType: "locator_resolution",
              step: step.id,
              message: `Recovered from "${outcomeMatch.name}" but the step still failed: ${String(retryErr)}`,
              expected: step.description,
              observed: page.url(),
              evidencePath,
            };
          }
        }

        // No known outcome recognized this state at all: escalate to a human
        // rather than guessing, then re-check the checkpoint once resumed.
        const resolved = await escalate(opts.runId, page, logger, {
          reason: `Step could not proceed and no declared outcome matched the page: ${String(err)}`,
          capability: opts.capabilityName,
          goal: artifact.discovery.sourceGoal,
          stepDescription: step.description,
        });

        if (resolved.humanActions.length === 0) {
          const evidencePath = await logger.screenshot(page, `hard-failure-${step.id}`);
          logger.event("replay_hard_failure", { stepId: step.id, error: String(err) });
          await cleanup();
          return {
            status: "error",
            errorType: err instanceof LocatorResolutionError ? "locator_resolution" : "unrecognized_state",
            step: step.id,
            message: `${step.description}: ${String(err)}`,
            expected: step.description,
            observed: page.url(),
            evidencePath,
          };
        }
        // Human acted manually; continue to the next declared step (the
        // checkpoint/next step's own resolution will confirm whether it worked).
      }
    }

    const checkpointOk = await detectorMatches(page, artifact.successCheckpoint, 5000);
    if (!checkpointOk) {
      const evidencePath = await logger.screenshot(page, "checkpoint-failed");
      await cleanup();
      return {
        status: "error",
        errorType: "checkpoint_failed",
        step: "success_checkpoint",
        message: "All steps executed but the declared success checkpoint was not observed.",
        expected: artifact.successCheckpoint.description,
        observed: page.url(),
        evidencePath,
      };
    }

    await cleanup();
    return { status: "success", outputs, checkpoint: artifact.successCheckpoint.description };
  } catch (err) {
    const evidencePath = await logger.screenshot(page, "fatal-error").catch(() => undefined);
    await cleanup();
    if (err instanceof PolicyViolationError) {
      return { status: "error", errorType: "policy_violation", step: "policy", message: err.message, evidencePath };
    }
    if (err instanceof MissingParamError) {
      return { status: "error", errorType: "input_validation", step: "input_validation", message: err.message, evidencePath };
    }
    return { status: "error", errorType: "unrecognized_state", step: "unknown", message: String(err), evidencePath };
  }
}

async function findMatchingOutcome(page: Page, outcomes: BusinessOutcome[], timeoutMs: number): Promise<BusinessOutcome | undefined> {
  for (const outcome of outcomes) {
    if (await detectorMatches(page, outcome, timeoutMs)) return outcome;
  }
  return undefined;
}

async function applyRecovery(
  page: Page,
  outcome: BusinessOutcome,
  params: Record<string, string>,
  timeoutMs: number,
  policy: Policy
): Promise<void> {
  if (!outcome.recovery) return;
  if (outcome.recovery.action === "navigate" && outcome.recovery.url) {
    const url = resolveValue(outcome.recovery.url, params);
    assertNavigationAllowed(policy, url);
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
  } else if (outcome.recovery.action === "click" && outcome.recovery.locator) {
    // Resolve in the same frame the outcome was detected in -- the
    // interstitial that triggers this recovery is not necessarily on the
    // top-level page (ours renders inside the same <iframe> as the form).
    const scope = await resolveFrame(page, outcome.detector.frame, timeoutMs);
    const { locator } = await resolveLocator(scope, outcome.recovery.locator, timeoutMs);
    await performLocatorAction(scope, locator, { kind: "click" }, timeoutMs);
    assertNavigationAllowed(policy, scope.url());
  }
}
