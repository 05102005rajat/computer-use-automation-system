import type { BusinessOutcome } from "./schema.js";

// Declared once by a human reviewer against the target application's known
// behavior -- NOT inferred from a single happy-path discovery transcript.
// A single successful run only ever observes the branch it took; it cannot
// discover branches it didn't take. Production capabilities are recorded
// once (the happy path) and then hardened with an outcome taxonomy authored
// by whoever reviews/approves the artifact, exactly the same way a human
// reviewer would read a runbook and add "what if X happens" notes. See
// REPORT.md, "Determinism & error handling".
export const MERIDIAN_KNOWN_OUTCOMES: BusinessOutcome[] = [
  {
    name: "member_not_found",
    description: "No member exists with the given ID.",
    category: "business_outcome",
    detector: { textPresent: "No member found with ID", frame: "main" },
  },
  {
    name: "member_frozen",
    description: "The member account is frozen; the action is not permitted.",
    category: "business_outcome",
    detector: { textPresent: "is FROZEN", frame: "main" },
  },
  {
    name: "validation_error_missing_nickname",
    description: "Sub-account nickname was left blank.",
    category: "business_outcome",
    detector: { textPresent: "Nickname is required.", frame: { iframeLocator: { candidates: [{ strategy: "css", selector: "iframe" }], robustnessNote: "single iframe on page" } } },
  },
  {
    name: "validation_error_deposit_non_positive",
    description: "Initial deposit was zero, negative, or not a number.",
    category: "business_outcome",
    detector: { textPresent: "Initial deposit must be a positive number.", frame: { iframeLocator: { candidates: [{ strategy: "css", selector: "iframe" }], robustnessNote: "single iframe on page" } } },
  },
  {
    name: "validation_error_deposit_over_limit",
    description: "Initial deposit exceeded the teller's $10,000 authorization limit.",
    category: "business_outcome",
    detector: { textPresent: "exceeds the $10,000 teller limit", frame: { iframeLocator: { candidates: [{ strategy: "css", selector: "iframe" }], robustnessNote: "single iframe on page" } } },
  },
  {
    name: "session_expired",
    description: "The application forced re-authentication mid-flow.",
    category: "recoverable",
    detector: { textPresent: "Your session has expired", frame: { iframeLocator: { candidates: [{ strategy: "css", selector: "iframe" }], robustnessNote: "single iframe on page" } } },
    recovery: {
      action: "click",
      locator: {
        candidates: [
          { strategy: "role", role: "button", name: "Re-authenticate" },
          { strategy: "css", selector: "input[type=submit]" },
        ],
        robustnessNote: "Re-authenticate is a submit button whose accessible name equals its value attribute.",
      },
    },
  },
];
