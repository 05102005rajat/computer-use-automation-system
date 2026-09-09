import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesUrlPattern } from "./errors.js";

test("matchesUrlPattern matches a literal path with no wildcards", () => {
  assert.ok(matchesUrlPattern("http://localhost:4100/members/search", "/members/search"));
});

test("matchesUrlPattern wildcards a single path segment", () => {
  assert.ok(matchesUrlPattern("http://localhost:4100/members/10023", "/members/*"));
});

test("matchesUrlPattern wildcards two independent segments (member id, sub-account id)", () => {
  assert.ok(
    matchesUrlPattern(
      "http://localhost:4100/members/10023/sub-accounts/SA-1009/confirmation",
      "/members/*/sub-accounts/*/confirmation"
    )
  );
});

test("matchesUrlPattern does not match a different path shape", () => {
  assert.equal(matchesUrlPattern("http://localhost:4100/members/10023", "/members/*/sub-accounts/*/confirmation"), false);
});

test("matchesUrlPattern ignores query string differences", () => {
  assert.ok(matchesUrlPattern("http://localhost:4100/members/10023?tab=details", "/members/*"));
});
