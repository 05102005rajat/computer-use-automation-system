import Anthropic from "@anthropic-ai/sdk";
import { chromium, type Page } from "playwright";
import { takeSnapshot, findElement, type ElementDescriptor } from "./perception.js";
import { buildLocatorSpec } from "./build-locator.js";
import { AGENT_TOOLS } from "./tools.js";
import { SYSTEM_PROMPT, buildObservationMessage } from "./prompt.js";
import type { FrameRef } from "../artifact/schema.js";
import {
  assertActionTypeAllowed,
  assertOriginAllowed,
  isRiskyAction,
  type Policy,
} from "../guardrails/policy.js";
import type { RunLogger } from "../evidence/logger.js";
import { registerSession, unregisterSession } from "../escalation/session-manager.js";
import { escalate } from "../escalation/escalate.js";
import { resolveFrame, resolveLocator, clickAndSettle } from "../replay/locator.js";

export type DiscoveryStep =
  | { kind: "navigate"; index: number; url: string; description: string }
  | {
      kind: "click" | "type" | "select" | "extract";
      index: number;
      frame: FrameRef;
      element: ElementDescriptor;
      value?: string;
      outputName?: string;
      description: string;
    };

export interface DiscoveryResult {
  success: boolean;
  reason: string;
  transcript: DiscoveryStep[];
  outputsCollected: Record<string, string>;
  finalUrl: string;
}

export interface DiscoveryOptions {
  runId: string;
  goal: string;
  params: Record<string, string>;
  entryUrl: string;
  capabilityName: string;
  policy: Policy;
  logger: RunLogger;
  model?: string;
  maxSteps?: number;
  autoApproveRisky?: boolean;
}

function paramValueFor(params: Record<string, string>, value: string): string | undefined {
  return Object.entries(params).find(([, v]) => v === value)?.[0];
}

export async function runDiscovery(opts: DiscoveryOptions): Promise<DiscoveryResult> {
  const anthropic = new Anthropic();
  const model = opts.model ?? "claude-sonnet-4-5";
  const maxSteps = opts.maxSteps ?? 20;
  const { logger, policy } = opts;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  registerSession(opts.runId, page);

  const transcript: DiscoveryStep[] = [];
  const outputsCollected: Record<string, string> = {};
  const history: string[] = [];
  let stepIndex = 0;

  try {
    assertOriginAllowed(policy, opts.entryUrl);
    assertActionTypeAllowed(policy, "navigate");
    await page.goto(opts.entryUrl, { waitUntil: "networkidle" });
    transcript.push({ kind: "navigate", index: stepIndex++, url: opts.entryUrl, description: "Enter application" });
    history.push(`navigate(${opts.entryUrl})`);
    logger.event("discovery_step", { kind: "navigate", url: opts.entryUrl });

    const messages: Anthropic.MessageParam[] = [];

    for (let step = 0; step < maxSteps; step++) {
      const snapshot = await takeSnapshot(page);
      const observation = buildObservationMessage({
        goal: opts.goal,
        params: opts.params,
        snapshot,
        stepsTaken: step,
        maxSteps,
        history,
      });
      messages.push({ role: "user", content: observation });
      if (process.env.DEBUG_OBSERVATIONS) logger.event("debug_observation", { step, observation });

      const response = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: AGENT_TOOLS,
        tool_choice: { type: "any" },
        messages,
      });

      const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!toolUse) {
        logger.event("discovery_error", { reason: "model returned no tool_use block" });
        break;
      }
      messages.push({ role: "assistant", content: response.content });

      const input = toolUse.input as any;
      logger.event("model_decision", { tool: toolUse.name, input });

      if (toolUse.name === "finish") {
        logger.event("discovery_finished", { success: input.success, reason: input.reason });
        await browser.close();
        unregisterSession(opts.runId);
        return { success: !!input.success, reason: input.reason, transcript, outputsCollected, finalUrl: page.url() };
      }

      if (toolUse.name === "request_help") {
        await logger.screenshot(page, `help-request-${step}`);
        const resolved = await escalate(opts.runId, page, logger, {
          reason: input.reason,
          capability: opts.capabilityName,
          goal: opts.goal,
          stepDescription: `discovery step ${step}: agent requested help`,
        });
        messages.push({
          role: "user",
          content: `A human operator intervened (${resolved.resolution}, ${resolved.humanActions.length} manual actions). Re-observe the page and continue.`,
        });
        history.push(`request_help(${input.reason}) -> ${resolved.resolution}`);
        continue;
      }

      let toolResultText = "ok";
      try {
        if (toolUse.name === "navigate") {
          assertActionTypeAllowed(policy, "navigate");
          assertOriginAllowed(policy, input.url);
          await page.goto(input.url, { waitUntil: "networkidle" });
          transcript.push({ kind: "navigate", index: stepIndex++, url: input.url, description: `Navigate to ${input.url}` });
          history.push(`navigate(${input.url})`);
        } else {
          const el = findElement(snapshot, input.refId);
          if (!el) throw new Error(`refId ${input.refId} not found in latest observation`);

          if (toolUse.name === "click" && isRiskyAction(policy, el.accessibleName) && !opts.autoApproveRisky) {
            const resolved = await escalate(opts.runId, page, logger, {
              reason: `Risky/irreversible action requires authorization: "${el.accessibleName}"`,
              capability: opts.capabilityName,
              goal: opts.goal,
              stepDescription: `discovery step ${step}: click "${el.accessibleName}"`,
            });
            if (resolved.resolution === "rejected") {
              await browser.close();
              unregisterSession(opts.runId);
              return {
                success: false,
                reason: `Risky action rejected by operator: ${el.accessibleName}`,
                transcript,
                outputsCollected,
                finalUrl: page.url(),
              };
            }
          }

          const scope = await resolveFrame(page, el.frame, 5000);
          const { locator } = await resolveLocator(scope, buildLocatorSpec(el), 5000);

          if (toolUse.name === "click") {
            assertActionTypeAllowed(policy, "click");
            await clickAndSettle(scope, locator, 5000);
            transcript.push({ kind: "click", index: stepIndex++, frame: el.frame, element: el, description: `Click "${el.accessibleName}"` });
            history.push(`click(${input.refId} "${el.accessibleName}")`);
          } else if (toolUse.name === "type") {
            assertActionTypeAllowed(policy, "type");
            await locator.fill(input.text);
            transcript.push({
              kind: "type",
              index: stepIndex++,
              frame: el.frame,
              element: el,
              value: input.text,
              description: `Type into "${el.accessibleName}"`,
            });
            history.push(`type(${input.refId} "${el.accessibleName}" = ${paramValueFor(opts.params, input.text) ? "<param>" : input.text})`);
          } else if (toolUse.name === "select") {
            assertActionTypeAllowed(policy, "select");
            await locator.selectOption(input.value);
            transcript.push({
              kind: "select",
              index: stepIndex++,
              frame: el.frame,
              element: el,
              value: input.value,
              description: `Select "${input.value}" in "${el.accessibleName}"`,
            });
            history.push(`select(${input.refId} = ${input.value})`);
          } else if (toolUse.name === "extract") {
            assertActionTypeAllowed(policy, "extract");
            const text = (await locator.textContent()) ?? "";
            outputsCollected[input.outputName] = text.trim();
            transcript.push({
              kind: "extract",
              index: stepIndex++,
              frame: el.frame,
              element: el,
              outputName: input.outputName,
              description: `Extract "${input.outputName}" from "${el.accessibleName}"`,
            });
            history.push(`extract(${input.refId} -> ${input.outputName} = "${text.trim()}")`);
          }
        }
      } catch (err) {
        toolResultText = `error: ${String(err)}`;
        logger.event("discovery_action_error", { tool: toolUse.name, error: String(err) });
      }

      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUse.id, content: toolResultText }],
      });
    }

    logger.event("discovery_stopped", { reason: "max_steps_exceeded" });
    await browser.close();
    unregisterSession(opts.runId);
    return { success: false, reason: "max_steps_exceeded", transcript, outputsCollected, finalUrl: page.url() };
  } catch (err) {
    logger.event("discovery_fatal_error", { error: String(err) });
    await browser.close().catch(() => {});
    unregisterSession(opts.runId);
    return { success: false, reason: `fatal error: ${String(err)}`, transcript, outputsCollected, finalUrl: page.url() };
  }
}
