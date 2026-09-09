import { test } from "node:test";
import assert from "node:assert/strict";
import { redactText, redactValue, scrubKnownSecrets } from "./redaction.js";

test("redactText masks SSN-shaped values", () => {
  assert.equal(redactText("SSN 512-11-4477 on file"), "SSN [REDACTED-SSN] on file");
});

test("redactText masks bearer-token-shaped values", () => {
  assert.equal(redactText("Authorization: Bearer abcdef1234567890"), "Authorization: [REDACTED-SECRET]");
});

test("redactValue masks known-sensitive field names regardless of content", () => {
  const out = redactValue({ password: "hunter2", memberId: "10023" }) as Record<string, unknown>;
  assert.equal(out.password, "[REDACTED]");
  assert.equal(out.memberId, "10023");
});

test("redactValue recurses into nested objects and arrays", () => {
  const out = redactValue({ steps: [{ ssn: "not-a-field-name-match", note: "SSN 512-11-4477" }] }) as any;
  assert.equal(out.steps[0].note, "SSN [REDACTED-SSN]");
});

test("scrubKnownSecrets removes a literal secret value wherever it appears in text", () => {
  const text = 'type(m1 "Password" = "teller123")';
  assert.equal(scrubKnownSecrets(text, ["teller123"]), 'type(m1 "Password" = "[REDACTED]")');
});

test("scrubKnownSecrets is a no-op for empty/absent secrets", () => {
  assert.equal(scrubKnownSecrets("hello world", [""]), "hello world");
});
