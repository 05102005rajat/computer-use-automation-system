import type { Page } from "playwright";

// The seam the brief asks for: automation must be able to pause, cede
// control of the *live* session, and resume -- and there must be a single
// source of truth for who is in control. This module is that source of
// truth. It is process-local (in-memory), which is enough for this project;
// see REPORT.md for how it would become a durable/shared store in production.

export type ControlState = "automation" | "human";

// The single source of truth for valid resolution values -- imported by the
// operator API's request validation instead of re-declared there, so the two
// can't silently drift apart.
export const RESOLUTIONS = ["approved", "rejected", "manual_actions_completed"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export interface HumanAction {
  type: "click" | "type" | "select";
  refId: string;
  value?: string;
  timestamp: string;
}

export interface InterventionRequest {
  id: string;
  runId: string;
  reason: string;
  capability: string;
  goal: string;
  stepDescription: string;
  createdAt: string;
  screenshotPath?: string;
  status: "pending" | "resolved";
  resolution?: Resolution;
  humanActions: HumanAction[];
}

interface SessionEntry {
  runId: string;
  page: Page;
  control: ControlState;
  pending?: InterventionRequest;
  resumeWaiters: Array<(resolution: InterventionRequest) => void>;
}

const sessions = new Map<string, SessionEntry>();
let seq = 0;

export function registerSession(runId: string, page: Page): void {
  sessions.set(runId, { runId, page, control: "automation", resumeWaiters: [] });
}

export function unregisterSession(runId: string): void {
  sessions.delete(runId);
}

export function getPage(runId: string): Page {
  const entry = sessions.get(runId);
  if (!entry) throw new Error(`Unknown session: ${runId}`);
  return entry.page;
}

export function getControl(runId: string): ControlState {
  return sessions.get(runId)?.control ?? "automation";
}

export function listPending(): InterventionRequest[] {
  return [...sessions.values()]
    .map((s) => s.pending)
    .filter((p): p is InterventionRequest => !!p && p.status === "pending");
}

export function getPending(runId: string): InterventionRequest | undefined {
  return sessions.get(runId)?.pending;
}

/** Called by automation when it cannot safely proceed. Flips control to
 * "human" and blocks until an operator resumes the session -- the automation
 * call site is a plain `await`, same as any other async step. */
export function requestEscalation(
  runId: string,
  info: { reason: string; capability: string; goal: string; stepDescription: string; screenshotPath?: string }
): Promise<InterventionRequest> {
  const entry = sessions.get(runId);
  if (!entry) throw new Error(`Unknown session: ${runId}`);
  seq += 1;
  const req: InterventionRequest = {
    id: `intervention-${seq}`,
    runId,
    ...info,
    createdAt: new Date().toISOString(),
    status: "pending",
    humanActions: [],
  };
  entry.pending = req;
  entry.control = "human";
  return new Promise((resolve) => {
    entry.resumeWaiters.push(resolve);
  });
}

/** Called by the operator surface while control === "human": performs one
 * action directly on the live page and records it against the intervention,
 * so the artifact/evidence trail shows exactly what a person did. */
export async function performHumanAction(runId: string, action: Omit<HumanAction, "timestamp">): Promise<void> {
  const entry = sessions.get(runId);
  if (!entry?.pending) throw new Error("No pending intervention for this session");
  if (entry.control !== "human") throw new Error("Session is not under human control");
  entry.pending.humanActions.push({ ...action, timestamp: new Date().toISOString() });
}

/** Hands control back to automation. */
export function resumeSession(
  runId: string,
  resolution: "approved" | "rejected" | "manual_actions_completed"
): void {
  const entry = sessions.get(runId);
  if (!entry?.pending) throw new Error("No pending intervention for this session");
  entry.pending.status = "resolved";
  entry.pending.resolution = resolution;
  entry.control = "automation";
  const waiters = entry.resumeWaiters.splice(0);
  waiters.forEach((w) => w(entry.pending!));
}
