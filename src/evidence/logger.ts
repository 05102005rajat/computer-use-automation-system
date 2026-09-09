import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { redactValue, scrubKnownSecrets } from "../guardrails/redaction.js";

export interface RunLogger {
  runDir: string;
  event(type: string, data: Record<string, unknown>): void;
  screenshot(page: Page, label: string): Promise<string>;
  path(...parts: string[]): string;
  registerSecret(value: string): void;
}

export function createRunLogger(evidenceRoot: string, runId: string): RunLogger {
  const runDir = path.join(evidenceRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const logFile = path.join(runDir, "run.jsonl");

  // Literal secret values (e.g. the login password) registered up front so
  // they're scrubbed from every log line by value, not just by field name --
  // catches the case where a secret ends up inside an unrelated-looking key
  // like a generic "text"/"value" tool argument.
  const secrets: string[] = [];

  function registerSecret(value: string) {
    if (value) secrets.push(value);
  }

  function event(type: string, data: Record<string, unknown>) {
    const record = {
      ts: new Date().toISOString(),
      type,
      data: redactValue(data),
    };
    fs.appendFileSync(logFile, scrubKnownSecrets(JSON.stringify(record), secrets) + "\n");
  }

  async function screenshot(page: Page, label: string): Promise<string> {
    const file = path.join(runDir, `${label}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    return file;
  }

  return {
    runDir,
    event,
    screenshot,
    registerSecret,
    path: (...parts) => path.join(runDir, ...parts),
  };
}
