import type Anthropic from "@anthropic-ai/sdk";

// `reasoning` is required on every action tool so a rationale is always
// captured in evidence, regardless of tool_choice mode. With tool_choice:
// "any" (used here so the model always calls something) Claude typically
// skips any free-form preamble text and goes straight to the tool call, so a
// separate "why" would otherwise go unrecorded -- putting it inside the tool
// call itself guarantees it survives into the log.
const REASONING_PROPERTY = {
  reasoning: { type: "string", description: "One short sentence: why this action, given the current observation." },
} as const;

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "navigate",
    description: "Navigate the browser to a URL. Only used for the initial entry point or a full page reload; prefer clicking links/buttons otherwise.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" }, ...REASONING_PROPERTY },
      required: ["url", "reasoning"],
    },
  },
  {
    name: "click",
    description: "Click an element identified by its refId from the current observation.",
    input_schema: {
      type: "object",
      properties: { refId: { type: "string" }, ...REASONING_PROPERTY },
      required: ["refId", "reasoning"],
    },
  },
  {
    name: "type",
    description: "Type text into a text input/textarea identified by its refId. Replaces existing content.",
    input_schema: {
      type: "object",
      properties: { refId: { type: "string" }, text: { type: "string" }, ...REASONING_PROPERTY },
      required: ["refId", "text", "reasoning"],
    },
  },
  {
    name: "select",
    description: "Choose an option (by its value attribute) in a <select> identified by its refId.",
    input_schema: {
      type: "object",
      properties: { refId: { type: "string" }, value: { type: "string" }, ...REASONING_PROPERTY },
      required: ["refId", "value", "reasoning"],
    },
  },
  {
    name: "extract",
    description: "Record a piece of visible text/value as a named output of this capability (e.g. a balance, a confirmation number).",
    input_schema: {
      type: "object",
      properties: {
        refId: { type: "string" },
        outputName: { type: "string" },
        attribute: { type: "string", enum: ["text", "value"] },
        ...REASONING_PROPERTY,
      },
      required: ["refId", "outputName", "reasoning"],
    },
  },
  {
    name: "finish",
    description: "Declare the goal reached (success=true) or unreachable (success=false). Always call this exactly once when done.",
    input_schema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        reason: { type: "string" },
      },
      required: ["success", "reason"],
    },
  },
  {
    name: "request_help",
    description: "Call this instead of guessing when the page state is ambiguous, an unexpected error/dialog appears, or you are not confident which control to use. This pauses automation and brings in a human operator on the same live session.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];
