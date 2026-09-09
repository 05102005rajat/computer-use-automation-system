import { test } from "node:test";
import assert from "node:assert/strict";
import { notFoundPage, confirmationPage, frozenMemberPage } from "./views.js";

const XSS_PAYLOAD = '<script>alert(1)</script>';

test("notFoundPage escapes a member ID containing HTML", () => {
  const html = notFoundPage(XSS_PAYLOAD);
  assert.ok(!html.includes("<script>alert(1)</script>"), "raw payload must not appear unescaped");
  assert.ok(html.includes("&lt;script&gt;"), "escaped form should be present");
});

test("frozenMemberPage escapes a member ID containing HTML", () => {
  const html = frozenMemberPage(XSS_PAYLOAD);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("confirmationPage escapes nickname and memberId containing HTML", () => {
  const html = confirmationPage(XSS_PAYLOAD, "SA-1", "share", XSS_PAYLOAD, 50);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.equal(html.split("&lt;script&gt;").length - 1, 2, "both memberId and nickname should be escaped");
});
