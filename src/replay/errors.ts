export { matchesUrlPattern } from "../guardrails/url-pattern.js";

export type ReplayResult =
  | { status: "success"; outputs: Record<string, string>; checkpoint: string }
  | { status: "business_outcome"; outcome: string; description: string }
  | {
      status: "error";
      errorType: "policy_violation" | "locator_resolution" | "checkpoint_failed" | "input_validation" | "unrecognized_state" | "operator_rejected";
      step: string;
      message: string;
      expected?: string;
      observed?: string;
      evidencePath?: string;
    };

