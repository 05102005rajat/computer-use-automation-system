import type { LocatorSpec, LocatorStrategy } from "../artifact/schema.js";
import type { ElementDescriptor } from "./perception.js";

const ROLE_SUPPORTS_ACCESSIBLE_NAME = new Set(["button", "link", "combobox"]);

/** Turns a runtime element descriptor into a versioned, prioritized locator
 * spec. Ordering encodes robustness judgment: prefer role+accessible-name
 * (survives markup/attribute churn), then a stable identifying attribute
 * (survives layout churn), and fall back to a structural CSS path only as a
 * last resort (the most brittle option -- breaks the moment a row is added
 * above it). */
export function buildLocatorSpec(el: ElementDescriptor): LocatorSpec {
  const candidates: LocatorStrategy[] = [];
  const notes: string[] = [];

  if (el.accessibleName && ROLE_SUPPORTS_ACCESSIBLE_NAME.has(el.role)) {
    candidates.push({ strategy: "role", role: el.role, name: el.accessibleName });
    notes.push(`role="${el.role}" name="${el.accessibleName}" is the browser-computed accessible name (works for input[type=submit]'s value attribute too), stable across markup/CSS refactors`);
  }

  if (el.attrName) {
    candidates.push({ strategy: "attribute", attribute: "name", value: el.attrName });
    notes.push(`form field "name" attribute is a developer-chosen identifier, changes less often than layout`);
  } else if (el.attrId) {
    candidates.push({ strategy: "attribute", attribute: "id", value: el.attrId });
    notes.push(`element id, changes less often than layout`);
  }

  if (el.accessibleName && !candidates.some((c) => c.strategy === "role")) {
    candidates.push({ strategy: "text", text: el.accessibleName, exact: false });
    notes.push(`visible text match as a secondary, content-based fallback`);
  }

  // Structural fallback: always present, always last.
  candidates.push({ strategy: "css", selector: el.cssPath });
  notes.push(`structural CSS path -- last resort, brittle against added/removed sibling rows`);

  return {
    candidates,
    robustnessNote: notes.join("; "),
  };
}
