import type { Frame, Locator, Page } from "playwright";
import type { FrameRef, LocatorSpec, LocatorStrategy } from "../artifact/schema.js";

export class LocatorResolutionError extends Error {
  constructor(
    message: string,
    public readonly triedCandidates: LocatorStrategy[]
  ) {
    super(message);
    this.name = "LocatorResolutionError";
  }
}

function candidateToLocator(scope: Page | Frame, candidate: LocatorStrategy): Locator {
  switch (candidate.strategy) {
    case "role":
      return scope.getByRole(candidate.role as any, { name: candidate.name });
    case "label":
      return scope.getByLabel(candidate.text);
    case "text":
      return scope.getByText(candidate.text, { exact: candidate.exact });
    case "css":
      return scope.locator(candidate.selector);
    case "attribute":
      return scope.locator(`[${candidate.attribute}*="${candidate.value}"]`);
  }
}

/** Tries each candidate in priority order; returns the first that resolves to
 * exactly one visible element. This is the fallback chain that makes replay
 * tolerant of small markup differences without ever guessing silently. */
export async function resolveLocator(
  scope: Page | Frame,
  spec: LocatorSpec,
  timeoutMs: number
): Promise<{ locator: Locator; usedCandidate: LocatorStrategy; candidateIndex: number }> {
  const tried: LocatorStrategy[] = [];
  for (let i = 0; i < spec.candidates.length; i++) {
    const candidate = spec.candidates[i];
    tried.push(candidate);
    try {
      const locator = candidateToLocator(scope, candidate);
      await locator.first().waitFor({ state: "visible", timeout: timeoutMs / spec.candidates.length });
      const count = await locator.count();
      if (count >= 1) {
        return { locator: locator.first(), usedCandidate: candidate, candidateIndex: i };
      }
    } catch {
      // Try next candidate.
    }
  }
  throw new LocatorResolutionError(
    `No candidate locator resolved (tried ${tried.length}): ${JSON.stringify(tried)}`,
    tried
  );
}

/** Clicks and -- race-free -- waits for any navigation the click triggers on
 * that same scope (page or a specific frame) to settle before returning.
 *
 * `locator.click()` alone does not reliably wait for a *sub-frame's* own
 * navigation (only the frame it targets, and even then a follow-up
 * `waitForLoadState()` called *after* the click is racy: if it fires before
 * the click's request has actually started, "networkidle" is already
 * (trivially) true and resolves immediately, before the real navigation
 * happens). This bit us for real during discovery: a legacy form submit
 * inside the target app's <iframe> looked like a silent no-op because the
 * very next snapshot ran before the iframe's navigation had actually
 * started, even though the click had genuinely worked. The fix is to start
 * listening for the navigation *before* the click fires it, exactly as
 * Playwright's own `waitForNavigation` pattern recommends. Every click in
 * this legacy, fully server-rendered app is expected to cause a full
 * round-trip, so this is the right default here (see REPORT.md). */
export async function clickAndSettle(scope: Page | Frame, locator: Locator, timeoutMs: number): Promise<void> {
  const navigation = scope.waitForNavigation({ waitUntil: "networkidle", timeout: timeoutMs }).catch(() => {});
  await locator.click({ timeout: timeoutMs });
  await navigation;
}

export async function resolveFrame(page: Page, ref: FrameRef, timeoutMs: number): Promise<Page | Frame> {
  if (ref === "main") return page;
  const { locator } = await resolveLocator(page, ref.iframeLocator, timeoutMs);
  const handle = await locator.elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) {
    throw new LocatorResolutionError("Matched iframe element but could not obtain its contentFrame()", [
      ref.iframeLocator.candidates[0],
    ]);
  }
  return frame;
}
