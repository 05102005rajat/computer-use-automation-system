import type { Page } from "playwright";
import type { RunLogger } from "../evidence/logger.js";
import { requestEscalation, type InterventionRequest } from "./session-manager.js";

export async function escalate(
  runId: string,
  page: Page,
  logger: RunLogger,
  info: { reason: string; capability: string; goal: string; stepDescription: string }
): Promise<InterventionRequest> {
  const screenshotPath = await logger.screenshot(page, `escalation-${Date.now()}`);
  logger.event("escalation_requested", { ...info, screenshotPath });
  const resolved = await requestEscalation(runId, { ...info, screenshotPath });
  logger.event("escalation_resolved", {
    resolution: resolved.resolution,
    humanActions: resolved.humanActions,
  });
  return resolved;
}
