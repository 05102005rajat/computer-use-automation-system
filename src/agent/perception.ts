import type { Frame, Page } from "playwright";
import type { FrameRef, LocatorSpec } from "../artifact/schema.js";

// Perception deliberately does NOT assume a clean DOM. It walks the
// accessibility-relevant surface (role, accessible name, visible text) of
// every frame on the page, plus a best-effort structural fallback locator,
// so the same code works whether the underlying markup is a modern SPA or a
// nested-table legacy screen with no test IDs.

export interface ElementDescriptor {
  refId: string;
  frame: FrameRef;
  role: string;
  accessibleName: string;
  tagName: string;
  inputType?: string;
  cssPath: string;
  attrId?: string;
  attrName?: string;
  attrHref?: string;
}

export interface FrameSnapshot {
  frame: FrameRef;
  url: string;
  visibleText: string;
  elements: ElementDescriptor[];
}

export interface PageSnapshot {
  url: string;
  frames: FrameSnapshot[];
}

const COLLECT_SCRIPT = `
(() => {
  function accessibleName(el) {
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return aria.trim();
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'submit' || type === 'button') {
        // For these input types the accessible name IS the value attribute.
        return (el.value || el.getAttribute('value') || '').trim();
      }
    }
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
      if (el.id) {
        const lbl = document.querySelector('label[for="' + el.id + '"]');
        if (lbl && lbl.textContent) return lbl.textContent.trim();
      }
      const parentLabel = el.closest('label');
      if (parentLabel && parentLabel.textContent) return parentLabel.textContent.trim();
      const row = el.closest('tr');
      if (row) {
        const firstCell = row.querySelector('td');
        if (firstCell && firstCell.textContent) return firstCell.textContent.trim();
      }
      if (el.placeholder) return el.placeholder.trim();
      if (el.name) return el.name;
    }
    if (el.textContent) return el.textContent.trim().slice(0, 80);
    return '';
  }

  function role(el) {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'submit' || t === 'button') return 'button';
      return 'textbox';
    }
    return tag;
  }

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 8) {
      let selector = node.tagName.toLowerCase();
      if (node.id) {
        selector += '#' + node.id;
        parts.unshift(selector);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(node) + 1;
          selector += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(selector);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  const selector = 'input, select, textarea, button, a[href], [role="button"]';
  const interactive = Array.from(document.querySelectorAll(selector)).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled;
  });

  // Leaf table cells (no nested table/interactive content) are read-only
  // "text" elements -- the only way to expose plain rendered data (a
  // balance, a status, a confirmation number) that isn't behind a control,
  // which is the common case in table-based legacy layouts.
  const leafCells = Array.from(document.querySelectorAll('td')).filter((td) => {
    if (td.querySelector('table, tr, td, input, select, textarea, button, a')) return false;
    const t = td.textContent && td.textContent.trim();
    return !!t;
  });

  const elements = [...interactive, ...leafCells].map((el, i) => ({
    idx: i,
    role: interactive.includes(el) ? role(el) : 'text',
    accessibleName: interactive.includes(el) ? accessibleName(el) : (el.textContent || '').trim().slice(0, 120),
    tagName: el.tagName.toLowerCase(),
    inputType: el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text') : undefined,
    cssPath: cssPath(el),
    attrId: el.id || undefined,
    attrName: el.getAttribute('name') || undefined,
    attrHref: el.getAttribute('href') || undefined,
  }));

  const bodyText = document.body ? document.body.innerText.slice(0, 3000) : '';
  return { elements, bodyText, url: location.href };
})()
`;

async function snapshotFrame(frame: Frame, frameRef: FrameRef, refPrefix: string): Promise<FrameSnapshot> {
  const result = (await frame.evaluate(COLLECT_SCRIPT)) as {
    elements: Array<{
      idx: number;
      role: string;
      accessibleName: string;
      tagName: string;
      inputType?: string;
      cssPath: string;
      attrId?: string;
      attrName?: string;
      attrHref?: string;
    }>;
    bodyText: string;
    url: string;
  };

  return {
    frame: frameRef,
    url: result.url,
    visibleText: result.bodyText,
    elements: result.elements.map((e) => ({
      refId: `${refPrefix}${e.idx}`,
      frame: frameRef,
      role: e.role,
      accessibleName: e.accessibleName,
      tagName: e.tagName,
      inputType: e.inputType,
      cssPath: e.cssPath,
      attrId: e.attrId,
      attrName: e.attrName,
      attrHref: e.attrHref,
    })),
  };
}

// The "attribute" strategy's match is a literal CSS substring ([attr*=value]),
// not a wildcard/glob -- a "*" placeholder in the value would never match a
// real src, it'd just be a literal asterisk. So instead of embedding a fake
// wildcard for the member id, strip the member-id segment entirely and keep
// only the stable suffix that's the same for every member: a real substring
// that genuinely is present in any member's src, no wildcard syntax needed.
// Exported (and factored out of describeIframe, which needs a live Page) so
// this string transform -- the actual bug that was fixed -- has a fast,
// browser-free unit test instead of only being covered by a live run.
export function computeStableIframeSuffix(src: string): string {
  return src.replace(/^\/members\/[^/]+/, "");
}

/** Builds a locator descriptor for an iframe element found in the main frame,
 * so replay can re-find "the same frame" without relying on frame ordering. */
async function describeIframe(page: Page, iframeIndex: number): Promise<LocatorSpec> {
  const src = await page.evaluate((i) => {
    const frames = Array.from(document.querySelectorAll("iframe"));
    return frames[i]?.getAttribute("src") ?? "";
  }, iframeIndex);

  const stableSuffix = computeStableIframeSuffix(src);

  return {
    candidates: [
      { strategy: "attribute", attribute: "src", value: stableSuffix },
      { strategy: "css", selector: "iframe" },
    ],
    robustnessNote:
      "Only iframe on the page at recording time; matched on the path suffix after the member " +
      `id ("${stableSuffix}"), a real substring present in any member's src (the attribute ` +
      "strategy is a literal CSS substring match, not a wildcard/glob, so the member id segment " +
      "is dropped entirely rather than replaced with a placeholder that would never match), " +
      "with a bare `iframe` css fallback if the app ever adds exactly one frame in a different shape.",
  };
}

export async function takeSnapshot(page: Page): Promise<PageSnapshot> {
  const mainSnapshot = await snapshotFrame(page.mainFrame(), "main", "m");

  const childFrames = page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached());
  const frameSnapshots: FrameSnapshot[] = [mainSnapshot];

  for (let i = 0; i < childFrames.length; i++) {
    const iframeLocator = await describeIframe(page, i);
    const frameRef: FrameRef = { iframeLocator };
    try {
      const snap = await snapshotFrame(childFrames[i], frameRef, `f${i}_`);
      frameSnapshots.push(snap);
    } catch {
      // Frame may be navigating/detached mid-snapshot; skip it for this tick.
    }
  }

  return { url: page.url(), frames: frameSnapshots };
}

export function findElement(snapshot: PageSnapshot, refId: string): ElementDescriptor | undefined {
  for (const frame of snapshot.frames) {
    const found = frame.elements.find((e) => e.refId === refId);
    if (found) return found;
  }
  return undefined;
}
