import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { resolveLocator, LocatorResolutionError } from "./locator.js";
import type { LocatorSpec } from "../artifact/schema.js";

// Self-contained: uses page.setContent() against a fixed HTML fixture, no
// target-app server required. Real Playwright, real DOM -- this is the
// regression for the "ambiguous match silently takes .first()" bug, which
// can't be exercised without an actual browser resolving actual locators.

let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

after(async () => {
  await browser.close();
});

test("an ambiguous candidate (matches >1 element) falls through to the next, unique candidate", async () => {
  await page.setContent(`
    <input name="member" value="a">
    <input name="memberId" value="b">
    <input id="the-unique-one" name="onlyThisOne" value="c">
  `);

  const spec: LocatorSpec = {
    candidates: [
      // Substring match on "member" hits both the first two inputs -- ambiguous.
      { strategy: "attribute", attribute: "name", value: "member" },
      { strategy: "css", selector: "#the-unique-one" },
    ],
    robustnessNote: "test fixture",
  };

  const { usedCandidate, candidateIndex } = await resolveLocator(page, spec, 3000);
  assert.equal(candidateIndex, 1, "must skip the ambiguous first candidate");
  assert.deepEqual(usedCandidate, { strategy: "css", selector: "#the-unique-one" });
});

test("if every candidate is ambiguous or absent, resolution fails loudly instead of guessing", async () => {
  await page.setContent(`
    <input name="member" value="a">
    <input name="memberId" value="b">
  `);

  const spec: LocatorSpec = {
    candidates: [{ strategy: "attribute", attribute: "name", value: "member" }],
    robustnessNote: "test fixture",
  };

  await assert.rejects(() => resolveLocator(page, spec, 1000), LocatorResolutionError);
});

test("a candidate matching exactly one element still resolves normally", async () => {
  await page.setContent(`<input name="uniqueField" value="x">`);
  const spec: LocatorSpec = {
    candidates: [{ strategy: "attribute", attribute: "name", value: "uniqueField" }],
    robustnessNote: "test fixture",
  };
  const { candidateIndex } = await resolveLocator(page, spec, 3000);
  assert.equal(candidateIndex, 0);
});
