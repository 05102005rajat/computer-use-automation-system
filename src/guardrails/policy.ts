// Explicit, configurable safety policy. Both the discovery agent and the
// replay executor consult this before acting -- it is not advisory, actions
// outside it are refused rather than logged-and-continued.

export type ActionType = "navigate" | "click" | "type" | "select" | "extract" | "wait_for";

export interface Policy {
  allowedOrigins: string[];
  allowedActionTypes: ActionType[];
  // Action descriptions (case-insensitive substring match against the
  // element's accessible name / step description) treated as risky and
  // irreversible -- money movement, account creation, anything that writes
  // state a person would need to manually undo.
  riskyActionMatchers: string[];
  maxStepsPerRun: number;
  maxRunTimeoutMs: number;
}

export const defaultPolicy: Policy = {
  allowedOrigins: [`http://localhost:${process.env.TARGET_APP_PORT ?? 4100}`],
  allowedActionTypes: ["navigate", "click", "type", "select", "extract", "wait_for"],
  riskyActionMatchers: ["open sub-account", "submit"],
  maxStepsPerRun: 25,
  maxRunTimeoutMs: 120_000,
};

export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

export function assertOriginAllowed(policy: Policy, url: string): void {
  const origin = new URL(url).origin;
  if (!policy.allowedOrigins.includes(origin)) {
    throw new PolicyViolationError(
      `Origin not on allowlist: ${origin} (allowed: ${policy.allowedOrigins.join(", ")})`
    );
  }
}

export function assertActionTypeAllowed(policy: Policy, actionType: ActionType): void {
  if (!policy.allowedActionTypes.includes(actionType)) {
    throw new PolicyViolationError(`Action type not on allowlist: ${actionType}`);
  }
}

export function isRiskyAction(policy: Policy, actionLabel: string): boolean {
  const lower = actionLabel.toLowerCase();
  return policy.riskyActionMatchers.some((m) => lower.includes(m.toLowerCase()));
}

/** A run's wall-clock cutoff under `policy.maxRunTimeoutMs`, computed once at
 * the start of a run and checked on every iteration by both the discovery
 * loop and the replay executor -- shared so the two bounded loops enforce
 * the exact same guardrail rather than each hand-rolling the same
 * Date.now()-plus-timeout arithmetic. */
export function deadlineFor(policy: Policy): number {
  return Date.now() + policy.maxRunTimeoutMs;
}

export function isPastDeadline(deadline: number): boolean {
  return Date.now() > deadline;
}
