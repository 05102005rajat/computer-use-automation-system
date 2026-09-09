import type { PageSnapshot } from "./perception.js";

export const SYSTEM_PROMPT = `You are a computer-use agent operating a legacy internal banking application on \
behalf of a back-office task. You perceive the page as a list of interactive elements (role, \
accessible name, tag) plus the visible text of each frame -- there is no clean DOM, no test IDs, \
and some content lives inside an <iframe> that is listed as a separate frame.

Rules:
- Act ONLY through the provided tools. Never invent a refId that wasn't in the latest observation.
- Use "extract" to record any value the goal asks you to read (e.g. a balance), giving it a clear outputName.
- If the page shows an error, an unexpected dialog, or you are not confident which control matches \
the goal, call "request_help" instead of guessing.
- Call "finish" exactly once you believe the goal is complete (or truly unreachable).
- Only interact with elements on the current page/frame; do not assume elements exist before you observe them.
- Every action tool call must include a one-sentence "reasoning" field explaining why, given the current observation -- this is what gets recorded as the audit trail for the run.
- Elements with role="text" are read-only table cells (not clickable/typeable) -- use "extract" on them to read plain rendered data like a balance or confirmation number.`;

function formatSnapshot(snapshot: PageSnapshot): string {
  const parts: string[] = [`Current URL: ${snapshot.url}`];
  for (const frame of snapshot.frames) {
    const frameLabel = frame.frame === "main" ? "main frame" : "iframe";
    parts.push(`\n--- ${frameLabel} (${frame.url}) ---`);
    parts.push(`Visible text:\n${frame.visibleText.slice(0, 1200)}`);
    parts.push(`Interactive elements:`);
    for (const el of frame.elements) {
      parts.push(
        `  [${el.refId}] role=${el.role} name="${el.accessibleName}" tag=${el.tagName}${
          el.inputType ? ` type=${el.inputType}` : ""
        }`
      );
    }
  }
  return parts.join("\n");
}

export function buildObservationMessage(opts: {
  goal: string;
  params: Record<string, string>;
  snapshot: PageSnapshot;
  stepsTaken: number;
  maxSteps: number;
  history: string[];
}): string {
  return `Goal: ${opts.goal}

Declared parameters for this run: ${JSON.stringify(opts.params)}

Steps taken so far: ${opts.stepsTaken}/${opts.maxSteps}
Recent action history:
${opts.history.slice(-6).join("\n") || "(none yet)"}

${formatSnapshot(opts.snapshot)}

Decide the single next tool call.`;
}
