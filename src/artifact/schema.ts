import { z } from "zod";

// ---------------------------------------------------------------------------
// Locators: how a step finds its target control.
//
// Ordered list, tried in priority order at replay time. Each entry declares
// *why* it should be robust, because in a legacy/no-test-id surface there is
// no single reliable strategy -- the artifact records the reasoning so a
// human reviewer can judge how brittle a step really is, not just what
// selector string it happens to contain.
// ---------------------------------------------------------------------------

export const LocatorStrategySchema = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("role"), role: z.string(), name: z.string() }),
  z.object({ strategy: z.literal("label"), text: z.string() }),
  z.object({ strategy: z.literal("text"), text: z.string(), exact: z.boolean().default(false) }),
  z.object({ strategy: z.literal("css"), selector: z.string() }),
  z.object({ strategy: z.literal("attribute"), attribute: z.string(), value: z.string() }),
]);
export type LocatorStrategy = z.infer<typeof LocatorStrategySchema>;

export const LocatorSpecSchema = z.object({
  // Ordered fallback chain, most-robust first.
  candidates: z.array(LocatorStrategySchema).min(1),
  // Why this order was chosen -- human-reviewable robustness reasoning,
  // not just the selector itself.
  robustnessNote: z.string(),
});
export type LocatorSpec = z.infer<typeof LocatorSpecSchema>;

// Which frame a locator should be resolved in. Legacy pages nest content in
// iframes/framesets; "main" is the top-level document.
export const FrameRefSchema = z.union([
  z.literal("main"),
  z.object({ iframeLocator: LocatorSpecSchema }),
]);
export type FrameRef = z.infer<typeof FrameRefSchema>;

// A value a step consumes: either a literal recorded during discovery, or a
// reference to one of the capability's declared input parameters.
export const ValueRefSchema = z.union([
  z.object({ kind: z.literal("literal"), value: z.string() }),
  z.object({ kind: z.literal("param"), name: z.string() }),
]);
export type ValueRef = z.infer<typeof ValueRefSchema>;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const StepBase = {
  id: z.string(),
  description: z.string(),
  frame: FrameRefSchema.default("main"),
  timeoutMs: z.number().int().positive().default(8000),
};

export const StepSchema = z.discriminatedUnion("kind", [
  z.object({ ...StepBase, kind: z.literal("navigate"), url: ValueRefSchema }),
  z.object({
    ...StepBase,
    kind: z.literal("click"),
    locator: LocatorSpecSchema,
    // Computed once at record time from the safety policy in force then --
    // not re-derived from text at replay time, so risk classification can't
    // silently drift depending on how a locator happens to be described.
    risky: z.boolean().default(false),
  }),
  z.object({
    ...StepBase,
    kind: z.literal("type"),
    locator: LocatorSpecSchema,
    value: ValueRefSchema,
  }),
  z.object({
    ...StepBase,
    kind: z.literal("select"),
    locator: LocatorSpecSchema,
    value: ValueRefSchema,
  }),
  z.object({
    ...StepBase,
    kind: z.literal("extract"),
    locator: LocatorSpecSchema,
    outputName: z.string(),
    attribute: z.enum(["text", "value"]).default("text"),
  }),
  z.object({
    ...StepBase,
    kind: z.literal("wait_for"),
    locator: LocatorSpecSchema,
  }),
]);
export type Step = z.infer<typeof StepSchema>;

// ---------------------------------------------------------------------------
// Outcomes: how replay tells "this is the answer" apart from "this is broken".
//
// A capability declares the runtime conditions it *expects* to be able to
// recognize. Anything replay observes that matches none of these is a hard
// failure, surfaced with full debugging context rather than silently
// swallowed or misreported as success.
// ---------------------------------------------------------------------------

export const OutcomeDetectorSchema = z.object({
  urlPattern: z.string().optional(),
  textPresent: z.string().optional(),
  frame: FrameRefSchema.default("main"),
});

export const BusinessOutcomeSchema = z.object({
  name: z.string(), // e.g. "member_not_found", "member_frozen", "validation_error"
  description: z.string(),
  category: z.enum(["business_outcome", "recoverable"]),
  detector: OutcomeDetectorSchema,
  // For "recoverable": a bounded, declarative remediation -- never an
  // open-ended LLM call. Replay applies it once, then re-checks the
  // checkpoint for the step it interrupted.
  recovery: z
    .object({
      action: z.enum(["click", "navigate"]),
      locator: LocatorSpecSchema.optional(),
      url: ValueRefSchema.optional(),
    })
    .optional(),
});
export type BusinessOutcome = z.infer<typeof BusinessOutcomeSchema>;

export const CheckpointSchema = z.object({
  description: z.string(),
  detector: OutcomeDetectorSchema,
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

// ---------------------------------------------------------------------------
// Input / output contract
// ---------------------------------------------------------------------------

export const ParamSpecSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number"]),
  description: z.string(),
  required: z.boolean().default(true),
  sensitive: z.boolean().default(false), // never logged/persisted in the clear
});
export type ParamSpec = z.infer<typeof ParamSpecSchema>;

export const OutputSpecSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number"]),
  description: z.string(),
});
export type OutputSpec = z.infer<typeof OutputSpecSchema>;

// ---------------------------------------------------------------------------
// The capability artifact itself
// ---------------------------------------------------------------------------

export const CapabilityArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  version: z.number().int().positive(),
  description: z.string(),
  createdAt: z.string(),

  // Provenance: decoupled from the raw model transcript, but not amnesiac
  // about where the capability came from.
  discovery: z.object({
    sourceGoal: z.string(),
    model: z.string(),
    transcriptRef: z.string(), // pointer into /evidence, not embedded here
  }),

  target: z.object({
    vendorProduct: z.string(), // e.g. "meridian-teller-console" -- the reusable unit across tenants
    baseUrl: z.string(),
    entryPath: z.string(),
  }),

  riskLevel: z.enum(["safe", "risky"]),
  approval: z.enum(["draft", "approved"]).default("draft"),

  inputs: z.array(ParamSpecSchema),
  outputs: z.array(OutputSpecSchema),
  steps: z.array(StepSchema).min(1),
  outcomes: z.array(BusinessOutcomeSchema),
  successCheckpoint: CheckpointSchema,
});
export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>;
