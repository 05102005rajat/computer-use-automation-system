import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import {
  members,
  sessions,
  sessionExpiryTriggered,
  nextSubAccountId,
} from "./data.js";
import * as views from "./views.js";

const PORT = Number(process.env.TARGET_APP_PORT ?? 4100);

const app = express();
app.use(express.urlencoded({ extended: true }));

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies["sid"];
  if (sid && sessions.has(sid)) {
    (req as any).sid = sid;
    return next();
  }
  res.redirect("/login");
}

app.get("/login", (_req, res) => {
  res.send(views.loginPage());
});

app.post("/login", (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (username === "teller" && password === "teller123") {
    const sid = crypto.randomBytes(16).toString("hex");
    sessions.set(sid, { username });
    res.setHeader("Set-Cookie", `sid=${sid}; HttpOnly; Path=/`);
    return res.redirect("/members/search");
  }
  res.send(views.loginPage("Invalid credentials."));
});

app.post("/reauthenticate", requireAuth, (req, res) => {
  const returnTo = (req.body.returnTo as string) || "/members/search";
  res.redirect(returnTo);
});

app.get("/members/search", requireAuth, (_req, res) => {
  res.send(views.searchPage());
});

app.post("/members/search", requireAuth, (req, res) => {
  const memberId = String(req.body.memberId ?? "").trim();
  if (!members[memberId]) {
    return res.send(views.notFoundPage(memberId));
  }
  res.redirect(`/members/${memberId}`);
});

app.get("/members/:id", requireAuth, (req, res) => {
  const member = members[req.params.id];
  if (!member) return res.send(views.notFoundPage(req.params.id));
  if (member.status === "frozen") return res.send(views.frozenMemberPage(member.id));
  res.send(views.memberDetailPage(member));
});

// Rendered inside an <iframe> on the member detail page -- a separate frame,
// on purpose, to force frame-aware perception and locating.
app.get("/members/:id/sub-accounts/new", requireAuth, (req, res) => {
  const sid = (req as any).sid as string;
  const member = members[req.params.id];
  if (!member) return res.status(404).send("unknown member");

  // Member 40040 forces a one-time session-expired interstitial the first
  // time this frame is loaded in a given session, to exercise a recoverable
  // runtime condition during replay.
  const key = `${sid}:${member.id}`;
  if (member.id === "40040" && !sessionExpiryTriggered.has(key)) {
    sessionExpiryTriggered.add(key);
    return res.send(views.sessionExpiredInterstitial(member.id));
  }

  res.send(views.subAccountFormFrame(member.id));
});

app.post("/members/:id/sub-accounts", requireAuth, (req, res) => {
  const member = members[req.params.id];
  if (!member) return res.status(404).send("unknown member");

  const { type, nickname, deposit } = req.body as {
    type?: string;
    nickname?: string;
    deposit?: string;
  };
  const amount = Number(deposit);
  if (!nickname || !nickname.trim()) {
    return res.send(views.subAccountFormFrame(member.id, "Nickname is required."));
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.send(
      views.subAccountFormFrame(member.id, "Initial deposit must be a positive number.")
    );
  }
  if (amount > 10000) {
    return res.send(
      views.subAccountFormFrame(member.id, "Initial deposit exceeds the $10,000 teller limit.")
    );
  }

  const subId = nextSubAccountId();
  member.subAccounts.push({ id: subId, type: type ?? "share", nickname, balance: amount });
  res.redirect(
    `/members/${member.id}/sub-accounts/${subId}/confirmation?type=${encodeURIComponent(
      type ?? "share"
    )}&nickname=${encodeURIComponent(nickname)}&deposit=${amount}`
  );
});

app.get("/members/:id/sub-accounts/:subId/confirmation", requireAuth, (req, res) => {
  const { type, nickname, deposit } = req.query as Record<string, string>;
  res.send(
    views.confirmationPage(
      req.params.id,
      req.params.subId,
      type ?? "share",
      nickname ?? "",
      Number(deposit ?? 0)
    )
  );
});

app.get("/", (_req, res) => res.redirect("/login"));

app.listen(PORT, () => {
  console.log(`[target-app] Meridian Credit Union mock console listening on http://localhost:${PORT}`);
});
