import "dotenv/config";
import express from "express";
import {
  assertHumanControl,
  getPage,
  getPending,
  listPending,
  performHumanAction,
  resumeSession,
  RESOLUTIONS,
} from "./session-manager.js";
import { takeSnapshot, findElement } from "../agent/perception.js";
import { buildLocatorSpec } from "../agent/build-locator.js";
import { resolveLocator, resolveFrame, performLocatorAction } from "../replay/locator.js";
import { assertActionTypeAllowed, assertNavigationAllowed, defaultPolicy } from "../guardrails/policy.js";

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

      // Checked as late as possible, immediately before the mutation --
      // checking only afterward (as this used to) would still let a stale
      // or duplicate request act on a session automation has since resumed.
      assertHumanControl(pending.runId);
      assertActionTypeAllowed(defaultPolicy, type);

      // The same click/type/select dispatch discovery and replay use --
      // not a raw locator.click(), which doesn't reliably wait for a
      // same-origin iframe's own navigation in this app (see
      // replay/locator.ts's clickAndSettle doc comment; a manual operator
      // click on the sub-account form hit exactly this before).
      if (type === "click") {
        await performLocatorAction(scope, locator, { kind: "click" }, 5000);
        assertNavigationAllowed(defaultPolicy, scope.url());
      } else if (type === "type") {
        await performLocatorAction(scope, locator, { kind: "type", value: value ?? "" }, 5000);
      } else if (type === "select") {
        await performLocatorAction(scope, locator, { kind: "select", value: value ?? "" }, 5000);
      }

      await performHumanAction(pending.runId, { type, refId, value });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/interventions/:id/resume", (req, res) => {
    const pending = getPendingById(req.params.id);
    if (!pending) return res.status(404).json({ error: "not found or already resolved" });
    const resolution = req.body?.resolution ?? "manual_actions_completed";
    if (!RESOLUTIONS.includes(resolution)) {
      return res.status(400).json({ error: `resolution must be one of: ${RESOLUTIONS.join(", ")}` });
    }
    resumeSession(pending.runId, resolution);
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
