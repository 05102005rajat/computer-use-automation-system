import type { DiscoveryStep } from "../agent/loop.js";
import { buildLocatorSpec } from "../agent/build-locator.js";
import type { CapabilityArtifact, ParamSpec, OutputSpec, Step, ValueRef, BusinessOutcome, Checkpoint } from "./schema.js";
import { isRiskyAction, type Policy } from "../guardrails/policy.js";

function valueRefFor(params: Record<string, string>, raw: string): ValueRef {
  const paramName = Object.entries(params).find(([, v]) => v === raw)?.[0];
  return paramName ? { kind: "param", name: paramName } : { kind: "literal", value: raw };
}

export interface RecordArtifactOptions {
  capabilityName: string;
  description: string;
  version: number;
  sourceGoal: string;
  model: string;
  transcriptRef: string;
  entryUrl: string;
  vendorProduct: string;
  params: Record<string, string>;
  paramSpecs: ParamSpec[];
  outputSpecs: OutputSpec[];
  transcript: DiscoveryStep[];
  finalUrl: string;
  knownOutcomes: BusinessOutcome[];
  riskLevel: "safe" | "risky";
  successCheckpoint: Checkpoint;
  policy: Policy;
}

/** Converts a successful discovery transcript into a versioned capability
 * artifact. This is intentionally a mechanical transform -- no LLM involved
 * -- so the artifact's provenance is auditable: every step here traces back
 * to one concrete action the agent actually performed against the live app. */
export function recordArtifact(opts: RecordArtifactOptions): CapabilityArtifact {
  const steps: Step[] = opts.transcript.map((t) => {
    if (t.kind === "navigate") {
      return {
        id: `step-${t.index}`,
        kind: "navigate",
        description: t.description,
        frame: "main",
        timeoutMs: 8000,
        url: valueRefFor(opts.params, t.url),
      };
    }
    const locator = buildLocatorSpec(t.element);
    if (t.kind === "click") {
      return {
        id: `step-${t.index}`,
        kind: "click",
        description: t.description,
        frame: t.frame,
        timeoutMs: 8000,
        locator,
        risky: isRiskyAction(opts.policy, t.element.accessibleName),
      };
    }
    if (t.kind === "type") {
      return {
        id: `step-${t.index}`,
        kind: "type",
        description: t.description,
        frame: t.frame,
        timeoutMs: 8000,
        locator,
        value: valueRefFor(opts.params, t.value ?? ""),
      };
    }
    if (t.kind === "select") {
      return {
        id: `step-${t.index}`,
        kind: "select",
        description: t.description,
        frame: t.frame,
        timeoutMs: 8000,
        locator,
        value: valueRefFor(opts.params, t.value ?? ""),
      };
    }
    return {
      id: `step-${t.index}`,
      kind: "extract",
      description: t.description,
      frame: t.frame,
      timeoutMs: 8000,
      locator,
      outputName: t.outputName ?? "output",
      attribute: "text",
    };
  });

  return {
    schemaVersion: 1,
    id: `${opts.capabilityName}-${Date.now()}`,
    name: opts.capabilityName,
    version: opts.version,
    description: opts.description,
    createdAt: new Date().toISOString(),
    discovery: {
      sourceGoal: opts.sourceGoal,
      model: opts.model,
      transcriptRef: opts.transcriptRef,
    },
    target: {
      vendorProduct: opts.vendorProduct,
      baseUrl: new URL(opts.entryUrl).origin,
      entryPath: new URL(opts.entryUrl).pathname,
    },
    riskLevel: opts.riskLevel,
    approval: "draft",
    inputs: opts.paramSpecs,
    outputs: opts.outputSpecs,
    steps,
    outcomes: opts.knownOutcomes,
    successCheckpoint: opts.successCheckpoint,
  };
}
