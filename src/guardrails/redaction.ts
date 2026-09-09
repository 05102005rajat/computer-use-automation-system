// Redaction applied to everything written to disk: artifacts, logs, evidence.
// This is a mock target app, but the SSN-shaped field and password fields are
// treated exactly as regulated PII/secrets would be in production: never
// persisted in the clear.

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const BEARER_RE = /\b(sk-ant-[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{10,})\b/g;

const SENSITIVE_FIELD_NAMES = new Set(["password", "ssn", "token", "apiKey", "api_key"]);

export function redactText(input: string): string {
  return input.replace(SSN_RE, "[REDACTED-SSN]").replace(BEARER_RE, "[REDACTED-SECRET]");
}

/** Scrubs specific known-secret literal values (e.g. a login password) out of
 * free text by value, not just by field name or shape -- needed anywhere a
 * secret might be echoed back inside a larger string, like an LLM goal
 * prompt that had to tell the agent the literal credential to type. */
export function scrubKnownSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s) out = out.split(s).join("[REDACTED]");
  }
  return out;
}

/** Deep-redacts an object for logging/persistence: masks known-sensitive
 * field names outright, and regex-scrubs every string value for stray
 * SSN/secret-shaped content that wasn't caught by field name alone. */
export function redactValue(value: unknown, keyHint?: string): unknown {
  if (keyHint && SENSITIVE_FIELD_NAMES.has(keyHint)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, k);
    }
    return out;
  }
  return value;
}
