import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStableIframeSuffix } from "./perception.js";

test("computeStableIframeSuffix strips the member-id segment, keeping a real substring", () => {
  assert.equal(computeStableIframeSuffix("/members/10023/sub-accounts/new"), "/sub-accounts/new");
  assert.equal(computeStableIframeSuffix("/members/40040/sub-accounts/new"), "/sub-accounts/new");
});

test("computeStableIframeSuffix output never contains a literal wildcard character", () => {
  // This is the actual regression: an earlier version embedded a literal "*"
  // in the value passed to a CSS `[attr*=value]` substring selector, which
  // has no glob semantics -- that candidate could never match anything.
  const suffix = computeStableIframeSuffix("/members/10023/sub-accounts/new");
  assert.ok(!suffix.includes("*"), "must be a real substring, not a fake wildcard");
});

test("a real member id, embedded via CSS attribute substring match, actually contains the computed suffix", () => {
  // Reproduces the CSS `[src*=value]` semantics resolveLocator relies on:
  // the fix only matters if `stableSuffix` is genuinely a substring of every
  // member's real src, which this asserts directly rather than trusting the
  // string transform in isolation.
  const suffix = computeStableIframeSuffix("/members/10023/sub-accounts/new");
  for (const memberId of ["10023", "40040", "99999"]) {
    const realSrc = `/members/${memberId}/sub-accounts/new`;
    assert.ok(realSrc.includes(suffix), `${realSrc} should contain ${suffix}`);
  }
});
