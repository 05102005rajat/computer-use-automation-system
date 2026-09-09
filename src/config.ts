import "dotenv/config";

export const TARGET_APP_PORT = Number(process.env.TARGET_APP_PORT ?? 4100);
export const TARGET_APP_BASE_URL = `http://localhost:${TARGET_APP_PORT}`;
export const OPERATOR_PORT = Number(process.env.OPERATOR_PORT ?? 4200);
export const EVIDENCE_ROOT = "evidence";
export const ARTIFACTS_ROOT = "artifacts";

// Fixed application credentials for the mock target app. Not real secrets,
// but handled exactly as real ones would be: sourced from the environment,
// never accepted as an agent-supplied invocation parameter, and redacted
// wherever they might otherwise land in a log or artifact.
export const TARGET_APP_USERNAME = process.env.TARGET_APP_USERNAME ?? "teller";
export const TARGET_APP_PASSWORD = process.env.TARGET_APP_PASSWORD ?? "teller123";
