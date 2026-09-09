// Explicit, configurable safety policy. Both the discovery agent and the
// replay executor consult this before acting -- it is not advisory, actions
// outside it are refused rather than logged-and-continued.

import { matchesUrlPattern } from "./url-pattern.js";

export type ActionType = "navigate" | "click" | "type" | "select" | "extract" | "wait_for";

export interface Policy {
  allowedOrigins: string[];
  // Path-shape allowlist within an allowed origin ("*" matches one segment).
  // The origin check alone would let the agent navigate anywhere on a
  // permitted host; this is what stops it wandering into an
  // unreviewed/unrecorded route of the same app.
  allowedRoutePatterns: string[];
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
  // Every route the open_sub_account capability (and its recovery path)
  // actually visits -- nothing else, so a discovery run can't wander into
  // an unrelated, unreviewed part of the app.
  allowedRoutePatterns: [
    "/login",
    "/reauthenticate",
    "/members/search",
    "/members/*",
    "/members/*/sub-accounts/new",
    "/members/*/sub-accounts",
    "/members/*/sub-accounts/*/confirmation",
  ],
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

/** Checks both that the URL's origin is allowed and that its path matches a
 * declared route shape -- the origin check alone would still let the agent
 * wander into any route of a permitted host, including ones nobody has
 * reviewed or recorded a capability against. */
export function assertNavigationAllowed(policy: Policy, url: string): void {
  const origin = new URL(url).origin;
  if (!policy.allowedOrigins.includes(origin)) {
    throw new PolicyViolationError(
      `Origin not on allowlist: ${origin} (allowed: ${policy.allowedOrigins.join(", ")})`
    );
  }
  const routeOk = policy.allowedRoutePatterns.some((pattern) => matchesUrlPattern(url, pattern));
  if (!routeOk) {
    throw new PolicyViolationError(
      `Route not on allowlist: ${new URL(url).pathname} (allowed patterns: ${policy.allowedRoutePatterns.join(", ")})`
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
