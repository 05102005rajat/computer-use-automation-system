import "dotenv/config";
import express from "express";
import {
  getPage,
  getPending,
  listPending,
  performHumanAction,
  resumeSession,
} from "./session-manager.js";
import { takeSnapshot, findElement } from "../agent/perception.js";
import { buildLocatorSpec } from "../agent/build-locator.js";
import { resolveLocator, resolveFrame } from "../replay/locator.js";

// A deliberately minimal operator surface (per the brief's scope note: a full
// co-browsing console is out of scope). What matters is that it acts on the
// *same live session* automation was using, and that every action it takes
// is recorded against the intervention -- not that it looks polished.
//
// In this project it's driven both by a tiny HTML page (for a person) and by
// a scripted client (for reproducible /evidence generation) hitting the
// identical HTTP API -- see evidence/escalation-run and README.md.

const PORT = Number(process.env.OPERATOR_PORT ?? 4200);

export function createOperatorServer() {
  const app = express();
  app.use(express.json());

  app.get("/interventions", (_req, res) => {
    res.json(listPending());
  });

  app.get("/interventions/:id", async (req, res) => {
    const pending = [...listPending(), ...[]].find((p) => p.id === req.params.id);
    const req_ = pending ?? findResolved(req.params.id);
    if (!req_) return res.status(404).json({ error: "not found" });
    try {
      const page = getPage(req_.runId);
      const snapshot = await takeSnapshot(page);
      res.json({ intervention: req_, snapshot });
    } catch {
      res.json({ intervention: req_, snapshot: null });
    }
  });

  app.post("/interventions/:id/actions", async (req, res) => {
    const pending = getPendingById(req.params.id);
    if (!pending) return res.status(404).json({ error: "not found or already resolved" });
    const { type, refId, value } = req.body as { type: "click" | "type" | "select"; refId: string; value?: string };
    try {
      const page = getPage(pending.runId);
      const snapshot = await takeSnapshot(page);
      const el = findElement(snapshot, refId);
      if (!el) return res.status(400).json({ error: `unknown refId ${refId}` });
      const spec = buildLocatorSpec(el);
      const scope = await resolveFrame(page, el.frame, 5000);
      const { locator } = await resolveLocator(scope, spec, 5000);

      if (type === "click") await locator.click();
      else if (type === "type") await locator.fill(value ?? "");
      else if (type === "select") await locator.selectOption(value ?? "");

      await performHumanAction(pending.runId, { type, refId, value });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/interventions/:id/resume", (req, res) => {
    const pending = getPendingById(req.params.id);
    if (!pending) return res.status(404).json({ error: "not found or already resolved" });
    const resolution = (req.body?.resolution as string) ?? "manual_actions_completed";
    resumeSession(pending.runId, resolution as any);
    res.json({ ok: true });
  });

  app.get("/", (_req, res) => {
    res.send(OPERATOR_HTML);
  });

  return app;
}

function getPendingById(id: string) {
  return listPending().find((p) => p.id === id);
}

// Placeholder for symmetry; resolved interventions aren't retained beyond the
// session-manager's in-memory pending map in this minimal implementation.
function findResolved(_id: string) {
  return undefined;
}

const OPERATOR_HTML = `<!doctype html>
<html><head><title>Operator Console (mock)</title></head>
<body style="font-family: sans-serif; max-width: 720px; margin: 2rem auto;">
<h2>Pending interventions</h2>
<div id="list">Loading...</div>
<script>
async function refresh() {
  const res = await fetch('/interventions');
  const items = await res.json();
  document.getElementById('list').innerHTML = items.length
    ? items.map(i => \`<div style="border:1px solid #ccc;padding:1rem;margin-bottom:1rem;">
        <b>\${i.id}</b> (\${i.capability})<br>
        Reason: \${i.reason}<br>
        Step: \${i.stepDescription}<br>
        <a href="/interventions/\${i.id}" target="_blank">inspect live snapshot</a>
      </div>\`).join('')
    : '<i>None pending.</i>';
}
refresh();
setInterval(refresh, 3000);
</script>
</body></html>`;

if (process.argv[1] && process.argv[1].endsWith("operator-server.ts")) {
  const app = createOperatorServer();
  app.listen(PORT, () => {
    console.log(`[operator] listening on http://localhost:${PORT}`);
  });
}
