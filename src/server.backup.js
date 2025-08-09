const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const cookieSession = require("cookie-session");
const { ensureAdmin, authenticate, setUserSettings, getUserSettings, getDecryptedKeys } = require("./db");

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(cookieSession({
  name: "sess",
  secret: process.env.SESSION_SECRET || "dev-secret",
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000
}));

// Static site
app.use(express.static(path.join(__dirname, "..", "public")));

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: "unauthorized" });
  next();
}

// Auth
app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "username and password required" });
  const user = await authenticate(username, password);
  if (!user) return res.status(401).json({ error: "invalid credentials" });
  req.session.user = { username };
  res.json({ ok: true });
});

app.post("/auth/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "unauthorized" });
  res.json({ user: req.session.user });
});

// Settings
app.get("/api/settings", requireAuth, async (req, res) => {
  const s = await getUserSettings(req.session.user.username);
  res.json(s);
});

app.post("/api/settings", requireAuth, async (req, res) => {
  const { openaiKey, openaiModel, anthropicKey, anthropicModel } = req.body || {};
  await setUserSettings(req.session.user.username, { openaiKey, openaiModel, anthropicKey, anthropicModel });
  res.json({ ok: true });
});

// Accounts (which providers this user can use)
app.get("/api/accounts", requireAuth, async (req, res) => {
  const s = await getUserSettings(req.session.user.username);
  const accounts = [];
  if (s.hasOpenAI) accounts.push({ id: "openai-1", provider: "openai", displayName: "OpenAI", model: s.openaiModel });
  if (s.hasAnthropic) accounts.push({ id: "anthropic-1",`r`n            reasoning: { effort: "high" }, provider: "anthropic", displayName: "Anthropic", model: s.anthropicModel });
  res.json({ accounts });
});

// Prompt fan-out
app.post("/api/prompt",`r`n            reasoning: { effort: "high" }, requireAuth, async (req, res) => {
  const { prompt, accountIds } = req.body || {};
  if (!prompt || !Array.isArray(accountIds) || accountIds.length === 0) {
    return res.status(400).json({ error: "prompt and accountIds[] required" });
  }
  const keys = await getDecryptedKeys(req.session.user.username);

  const tasks = accountIds.map(async (id) => {
    const t0 = Date.now();
    try {
      if (id === "openai-1") {
        if (!keys.openaiKey) throw new Error("OpenAI key not set");
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${keys.openaiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: keys.openaiModel || "gpt-4o-mini",`r`n            reasoning: { effort: "high" },
            messages: [{ role: "user", content: prompt }]
          })
        });
        if (!r.ok) throw new Error("OpenAI HTTP " + r.status + ": " + (await r.text()));
        const j = await r.json();
        const text = j?.choices?.[0]?.message?.content || "[no content]";
        return { id, provider: "openai", ok: true, text, ms: Date.now() - t0 };
      }

      if (id === "anthropic-1") {
        if (!keys.anthropicKey) throw new Error("Anthropic key not set");
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": keys.anthropicKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: keys.anthropicModel || "claude-3-5-sonnet-latest",`r`n            reasoning: { effort: "high" },
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }]
          })
        });
        if (!r.ok) throw new Error("Anthropic HTTP " + r.status + ": " + (await r.text()));
        const j = await r.json();
        const text = j?.content?.[0]?.text || "[no content]";
        return { id, provider: "anthropic", ok: true, text, ms: Date.now() - t0 };
      }

      throw new Error("Unknown account: " + id);
    } catch (e) {
      return { id, ok: false, error: String(e.message || e), ms: Date.now() - t0 };
    }
  });

  const results = await Promise.all(tasks);
  res.json({ prompt, results, totalMs: Math.max(0, ...results.map(r => r.ms)) });
});

// Start
ensureAdmin().then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});

