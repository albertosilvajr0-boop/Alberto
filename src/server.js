const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const cookieSession = require("cookie-session");
const { ensureAdmin, authenticate, setUserSettings, getUserSettings, getDecryptedKeys } = require("./db");

dotenv.config();
const app = express();
app.set("trust proxy", 1);
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

app.use(express.static(path.join(__dirname, "..", "public")));

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.status(401).json({ error: "unauthorized" });
  next();
}

// Auth
app.post("/auth/login", async (req, res) => {
  const username = req.body && req.body.username;
  const password = req.body && req.body.password;
  if (!username || !password) return res.status(400).json({ error: "username and password required" });
  const user = await authenticate(username, password);
  if (!user) return res.status(401).json({ error: "invalid credentials" });
  req.session.user = { username: username };
  res.json({ ok: true });
});

app.post("/auth/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ error: "unauthorized" });
  res.json({ user: req.session.user });
});

// Settings
app.get("/api/settings", requireAuth, async (req, res) => {
  const s = await getUserSettings(req.session.user.username);
  res.json(s);
});

app.post("/api/settings", requireAuth, async (req, res) => {
  const body = req.body || {};
  await setUserSettings(req.session.user.username, body);
  res.json({ ok: true });
});

// Accounts
app.get("/api/accounts", requireAuth, async (req, res) => {
  const s = await getUserSettings(req.session.user.username);
  const accounts = [];
  if (s.hasOpenAI) accounts.push({ id: "openai-1", provider: "openai", displayName: "OpenAI", model: s.openaiModel });
  if (s.hasAnthropic) accounts.push({ id: "anthropic-1", provider: "anthropic", displayName: "Anthropic", model: s.anthropicModel });
  if (s.hasGemini) accounts.push({ id: "gemini-1", provider: "gemini", displayName: "Gemini", model: s.geminiModel });
  res.json({ accounts });
});

// Prompt fan-out
app.post("/api/prompt", requireAuth, async (req, res) => {
  const prompt = req.body && req.body.prompt;
  const accountIds = (req.body && req.body.accountIds) || [];
  if (!prompt || !Array.isArray(accountIds) || accountIds.length === 0) {
    return res.status(400).json({ error: "prompt and accountIds[] required" });
  }
  const keys = await getDecryptedKeys(req.session.user.username);

  const tasks = accountIds.map(async function (id) {
    const t0 = Date.now();
    try {
      if (id === "openai-1") {
        if (!keys.openaiKey) throw new Error("OpenAI key not set");
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": "Bearer " + keys.openaiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: keys.openaiModel || "gpt-4o-mini",
            // reasoning: { effort: "high" }, // optional
            messages: [{ role: "user", content: prompt }]
          })
        });
        if (!r.ok) throw new Error("OpenAI HTTP " + r.status + ": " + (await r.text()));
        const j = await r.json();
        const text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "[no content]";
        return { id: id, provider: "openai", ok: true, text: text, ms: Date.now() - t0 };
      }

      if (id === "anthropic-1") {
        if (!keys.anthropicKey) throw new Error("Anthropic key not set");
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": keys.anthropicKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify({
            model: keys.anthropicModel || "claude-3-5-sonnet-latest",
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }]
          })
        });
        if (!r.ok) throw new Error("Anthropic HTTP " + r.status + ": " + (await r.text()));
        const j = await r.json();
        const text = (j && j.content && j.content[0] && j.content[0].text) || "[no content]";
        return { id: id, provider: "anthropic", ok: true, text: text, ms: Date.now() - t0 };
      }

      if (id === "gemini-1") {
        if (!keys.geminiKey) throw new Error("Gemini key not set");
        const model = encodeURIComponent(keys.geminiModel || "gemini-1.5-pro-latest");
        const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
        const r = await fetch(endpoint, {
          method: "POST",
          headers: { "x-goog-api-key": keys.geminiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }]
          })
        });
        if (!r.ok) throw new Error("Gemini HTTP " + r.status + ": " + (await r.text()));
        const j = await r.json();
        const parts = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
        const text = parts.map(function(p){ return p.text || ""; }).join("") || "[no content]";
        return { id: id, provider: "gemini", ok: true, text: text, ms: Date.now() - t0 };
      }

      throw new Error("Unknown account: " + id);
    } catch (e) {
      return { id: id, ok: false, error: String(e && e.message ? e.message : e), ms: Date.now() - t0 };
    }
  });

  const results = await Promise.all(tasks);
  const totalMs = results.reduce(function (max, r) { return r.ms > max ? r.ms : max; }, 0);
  res.json({ prompt: prompt, results: results, totalMs: totalMs });
});

ensureAdmin().then(function () {
  app.listen(PORT, function () {
    console.log("Server running on http://localhost:" + PORT);
  });
});

