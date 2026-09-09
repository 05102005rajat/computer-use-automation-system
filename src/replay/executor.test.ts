import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { resolveValue, MissingParamError, performAction, type ActionableStep } from "./executor.js";
import { PolicyViolationError, defaultPolicy } from "../guardrails/policy.js";

test("resolveValue returns a literal value unchanged", () => {
  assert.equal(resolveValue({ kind: "literal", value: "share" }, {}), "share");
});

test("resolveValue looks up a declared param by name", () => {
  assert.equal(resolveValue({ kind: "param", name: "memberId" }, { memberId: "10023" }), "10023");
});

test("resolveValue throws MissingParamError (not a generic Error) for a missing param", () => {
  // The dedicated error type is the actual fix: a missing username/password
  // (deliberately excluded from the artifact's public `inputs`, so the
  // up-front validation loop can't catch them) used to surface as an
  // unclassified hard failure. replayArtifact's outer catch recognizes this
  // specific type and reports errorType: "input_validation" instead.
  assert.throws(() => resolveValue({ kind: "param", name: "password" }, {}), MissingParamError);
});

test("MissingParamError message names the missing param", () => {
  try {
    resolveValue({ kind: "param", name: "password" }, {});
    assert.fail("expected resolveValue to throw");
  } catch (err) {
    assert.ok(err instanceof MissingParamError);
    assert.match(err.message, /password/);
  }
});

// The route allowlist previously only guarded explicit `navigate` steps; a
// click-triggered navigation (the dominant way this fully server-rendered
// app actually moves between pages) went completely unchecked. These tests
// exercise performAction's click branch directly against a real page to
// confirm the post-click assertNavigationAllowed call actually fires.
let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

after(async () => {
  await browser.close();
});

function clickStep(timeoutMs: number): ActionableStep {
  return {
    id: "step-test",
    description: "test click",
    frame: "main",
    timeoutMs,
    kind: "click",
    locator: { candidates: [{ strategy: "css", selector: "#btn" }], robustnessNote: "test fixture" },
    risky: false,
  };
}

test("performAction rejects a click whose resulting page is off the origin allowlist", async () => {
  await page.setContent(`<button id="btn">click me</button>`);
  const locator = page.locator("#btn");
  const restrictivePolicy = { ...defaultPolicy, allowedOrigins: [], allowedRoutePatterns: [] };

  await assert.rejects(
    () => performAction(clickStep(300), page, locator, {}, {}, restrictivePolicy),
    PolicyViolationError
  );
});

test("performAction allows a click whose resulting page matches the allowlist", async () => {
  await page.setContent(`<button id="btn">click me</button>`);
  const locator = page.locator("#btn");
  const permissivePolicy = {
    ...defaultPolicy,
    allowedOrigins: [new URL(page.url()).origin],
    allowedRoutePatterns: ["*"],
  };

  await assert.doesNotReject(() => performAction(clickStep(300), page, locator, {}, {}, permissivePolicy));
});
