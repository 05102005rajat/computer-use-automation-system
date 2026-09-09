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

export function matchesUrlPattern(url: string, pattern: string): boolean {
  const pathname = new URL(url).pathname;
  const patternPath = pattern.startsWith("http") ? new URL(pattern).pathname : pattern;
  const regex = new RegExp(
    "^" +
      patternPath
        .split("*")
        .map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]+") +
      "$"
  );
  return regex.test(pathname);
}
