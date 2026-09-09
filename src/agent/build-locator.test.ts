import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLocatorSpec } from "./build-locator.js";
import type { ElementDescriptor } from "./perception.js";

function el(overrides: Partial<ElementDescriptor>): ElementDescriptor {
  return {
    refId: "m0",
    frame: "main",
    role: "textbox",
    accessibleName: "",
    tagName: "input",
    cssPath: "table > tr > td > input",
    ...overrides,
  };
}

test("prefers role+accessible-name for a submit button (accessible name = value attribute)", () => {
  const spec = buildLocatorSpec(el({ role: "button", accessibleName: "Open Sub-Account", tagName: "input" }));
  assert.deepEqual(spec.candidates[0], { strategy: "role", role: "button", name: "Open Sub-Account" });
});

test("falls back to the form field's name attribute when there is no matching accessible-name role", () => {
  const spec = buildLocatorSpec(el({ role: "textbox", accessibleName: "Member ID", attrName: "memberId" }));
  assert.deepEqual(spec.candidates[0], { strategy: "attribute", attribute: "name", value: "memberId" });
});

test("falls back to element id when there is no name attribute", () => {
  const spec = buildLocatorSpec(el({ role: "textbox", accessibleName: "Member ID", attrId: "member-id-input" }));
  assert.deepEqual(spec.candidates[0], { strategy: "attribute", attribute: "id", value: "member-id-input" });
});

test("always keeps the structural CSS path as the last, most-brittle fallback", () => {
  const spec = buildLocatorSpec(el({ role: "textbox", accessibleName: "Member ID", attrName: "memberId" }));
  assert.deepEqual(spec.candidates.at(-1), { strategy: "css", selector: "table > tr > td > input" });
});

test("read-only text cells with no name/id still get a text-content fallback before the CSS path", () => {
  const spec = buildLocatorSpec(el({ role: "text", accessibleName: "$4382.10", tagName: "td" }));
  assert.deepEqual(spec.candidates[0], { strategy: "text", text: "$4382.10", exact: false });
  assert.equal(spec.candidates.at(-1)?.strategy, "css");
});
