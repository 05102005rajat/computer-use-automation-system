import fs from "node:fs";
import path from "node:path";
import { CapabilityArtifactSchema, type CapabilityArtifact } from "./schema.js";
import { redactValue } from "../guardrails/redaction.js";

export function artifactPath(root: string, name: string, version: number): string {
  return path.join(root, `${name}.v${version}.json`);
}

export function saveArtifact(root: string, artifact: CapabilityArtifact): string {
  fs.mkdirSync(root, { recursive: true });
  const validated = CapabilityArtifactSchema.parse(artifact);
  const file = artifactPath(root, validated.name, validated.version);
  fs.writeFileSync(file, JSON.stringify(redactValue(validated), null, 2));
  return file;
}

export function loadArtifact(file: string): CapabilityArtifact {
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  return CapabilityArtifactSchema.parse(raw);
}

export function latestArtifactFile(root: string, name: string): string {
  const files = fs
    .readdirSync(root)
    .filter((f) => f.startsWith(`${name}.v`) && f.endsWith(".json"))
    .sort((a, b) => {
      const va = Number(a.match(/\.v(\d+)\.json$/)?.[1] ?? 0);
      const vb = Number(b.match(/\.v(\d+)\.json$/)?.[1] ?? 0);
      return vb - va;
    });
  if (files.length === 0) throw new Error(`No artifact found for capability "${name}" in ${root}`);
  return path.join(root, files[0]);
}
