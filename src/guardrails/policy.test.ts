import { test } from "node:test";
import assert from "node:assert/strict";
import { assertNavigationAllowed, PolicyViolationError, defaultPolicy } from "./policy.js";

const base = { ...defaultPolicy, allowedOrigins: ["http://localhost:4100"] };

test("assertNavigationAllowed accepts a URL matching an allowed route pattern", () => {
  assert.doesNotThrow(() => assertNavigationAllowed(base, "http://localhost:4100/members/10023"));
});

test("assertNavigationAllowed rejects a disallowed origin even if the path would match", () => {
  assert.throws(
    () => assertNavigationAllowed(base, "http://evil.example.com/members/10023"),
    PolicyViolationError
  );
});

test("assertNavigationAllowed rejects a route with no matching pattern on an otherwise-allowed origin", () => {
  // Origin allowed, but this app has no /admin route in the allowlist -- the
  // origin check alone must not be enough to let the agent wander there.
  assert.throws(
    () => assertNavigationAllowed(base, "http://localhost:4100/admin/danger"),
    PolicyViolationError
  );
});

test("assertNavigationAllowed matches wildcarded multi-segment routes", () => {
  assert.doesNotThrow(() =>
    assertNavigationAllowed(base, "http://localhost:4100/members/10023/sub-accounts/new")
  );
});
