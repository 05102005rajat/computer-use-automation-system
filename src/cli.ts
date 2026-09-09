import "dotenv/config";
import fs from "node:fs";
import { runDiscovery } from "./agent/loop.js";
import { recordArtifact } from "./artifact/recorder.js";
import { saveArtifact, loadArtifact, latestArtifactFile } from "./artifact/store.js";
import { replayArtifact } from "./replay/executor.js";
import { createRunLogger } from "./evidence/logger.js";
import { defaultPolicy } from "./guardrails/policy.js";
import { scrubKnownSecrets } from "./guardrails/redaction.js";
import { MERIDIAN_KNOWN_OUTCOMES } from "./artifact/known-outcomes.meridian.js";
import * as OpenSubAccount from "./capabilities/open-sub-account.js";
import { createOperatorServer } from "./escalation/operator-server.js";
import {
  ARTIFACTS_ROOT,
  EVIDENCE_ROOT,
  OPERATOR_PORT,
  TARGET_APP_BASE_URL,
  TARGET_APP_PASSWORD,
  TARGET_APP_USERNAME,
} from "./config.js";

// The operator HTTP API is started in-process alongside any run that can
// escalate, so a real client (a person's browser, or the scripted operator
// used for /evidence generation -- see README.md) can inspect and act on the
// same live Playwright session via genuine HTTP calls, not an in-memory stub.
function startOperatorServer(): void {
  const app = createOperatorServer();
  app.listen(OPERATOR_PORT, () => {
    console.log(`[operator] listening on http://localhost:${OPERATOR_PORT}`);
  });
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function nextVersion(name: string): number {
  if (!fs.existsSync(ARTIFACTS_ROOT)) return 1;
  const versions = fs
    .readdirSync(ARTIFACTS_ROOT)
    .map((f) => f.match(new RegExp(`^${name}\\.v(\\d+)\\.json$`))?.[1])
    .filter((v): v is string => !!v)
    .map(Number);
  return versions.length ? Math.max(...versions) + 1 : 1;
}

async function cmdDiscover(args: Record<string, string>) {
  const params = {
    memberId: args.member ?? "10023",
    subAccountType: args.type ?? "share",
    nickname: args.nickname ?? "Holiday Fund",
    depositAmount: args.deposit ?? "50",
    username: TARGET_APP_USERNAME,
    password: TARGET_APP_PASSWORD,
  };
  const runId = `discovery-${Date.now()}`;
  const logger = createRunLogger(EVIDENCE_ROOT, runId);
  logger.registerSecret(params.password);

  const goal = OpenSubAccount.buildGoal(params);
  logger.event("run_started", { runId, goal, params: { ...params, password: "[REDACTED]" } });

  const result = await runDiscovery({
    runId,
    goal,
    params,
    entryUrl: `${TARGET_APP_BASE_URL}/login`,
    capabilityName: OpenSubAccount.CAPABILITY_NAME,
    policy: defaultPolicy,
    logger,
    autoApproveRisky: args["auto-approve-risky"] === "true",
  });

  console.log(`\nDiscovery run ${runId}: ${result.success ? "SUCCESS" : "FAILED"} (${result.reason})`);
  console.log(`Evidence: ${logger.runDir}`);

  if (!result.success) {
    process.exitCode = 1;
    return;
  }

  const version = nextVersion(OpenSubAccount.CAPABILITY_NAME);
  const artifact = recordArtifact({
    capabilityName: OpenSubAccount.CAPABILITY_NAME,
    description: "Look up a member, read their savings balance, and open a new sub-account for them.",
    version,
    sourceGoal: scrubKnownSecrets(goal, [params.password]),
    model: "claude-sonnet-4-5",
    transcriptRef: logger.runDir,
    entryUrl: `${TARGET_APP_BASE_URL}/login`,
    vendorProduct: "meridian-teller-console",
    params,
    paramSpecs: OpenSubAccount.PARAM_SPECS,
    outputSpecs: OpenSubAccount.OUTPUT_SPECS,
    transcript: result.transcript,
    finalUrl: result.finalUrl,
    knownOutcomes: MERIDIAN_KNOWN_OUTCOMES,
    riskLevel: "risky",
    successCheckpoint: OpenSubAccount.SUCCESS_CHECKPOINT,
    policy: defaultPolicy,
  });

  // --auto-approve-risky already means "trust this end-to-end without a
  // human in the loop"; recording that same trust onto the resulting
  // artifact removes a redundant manual approval step from the common case
  // while keeping the real default (draft, unapproved) for every other run.
  if (args["auto-approve-risky"] === "true") artifact.approval = "approved";

  const file = saveArtifact(ARTIFACTS_ROOT, artifact);
  console.log(`Saved capability artifact: ${file} (version ${version})`);
  console.log(`Outputs collected during discovery: ${JSON.stringify(result.outputsCollected, null, 2)}`);
}

async function cmdReplay(args: Record<string, string>) {
  const params = {
    memberId: args.member ?? "10023",
    subAccountType: args.type ?? "share",
    nickname: args.nickname ?? "Winter Fund",
    depositAmount: args.deposit ?? "75",
    username: TARGET_APP_USERNAME,
    password: TARGET_APP_PASSWORD,
  };
  const artifactFile = args.artifact ?? latestArtifactFile(ARTIFACTS_ROOT, OpenSubAccount.CAPABILITY_NAME);
  const artifact = loadArtifact(artifactFile);

  const runId = `replay-${Date.now()}`;
  const logger = createRunLogger(EVIDENCE_ROOT, runId);
  logger.registerSecret(params.password);
  logger.event("run_started", { runId, artifactFile, params: { ...params, password: "[REDACTED]" } });

  const result = await replayArtifact({
    runId,
    artifact,
    params,
    policy: defaultPolicy,
    logger,
    capabilityName: OpenSubAccount.CAPABILITY_NAME,
  });

  fs.writeFileSync(logger.path("result.json"), JSON.stringify(result, null, 2));
  console.log(`\nReplay run ${runId}:`);
  console.log(JSON.stringify(result, null, 2));
  console.log(`Evidence: ${logger.runDir}`);
  if (result.status === "error") process.exitCode = 1;
}

async function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);

  if (command === "discover" || command === "replay") startOperatorServer();

  if (command === "discover") await cmdDiscover(args);
  else if (command === "replay") await cmdReplay(args);
  else {
    console.log("Usage: tsx src/cli.ts <discover|replay> [--flags]");
    process.exitCode = 1;
  }

  // The operator HTTP server (discover/replay) would otherwise keep the
  // process alive indefinitely; exit explicitly once the run is done.
  process.exit(process.exitCode ?? 0);
}

main();
