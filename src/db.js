const Datastore = require("nedb-promises");
const bcrypt = require("bcryptjs");
const { encrypt, decrypt } = require("./crypto");

const users = Datastore.create({ filename: "data/users.db", autoload: true });

async function ensureAdmin() {
  const username = process.env.ADMIN_USER || "admin";
  const password = process.env.ADMIN_PASS || "admin123!";
  const existing = await users.findOne({ username });
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 10);
    await users.insert({ username, passwordHash, settings: {} });
    console.log('Created admin user "' + username + '".');
  }
}

async function authenticate(username, password) {
  const u = await users.findOne({ username });
  if (!u) return null;
  const ok = await bcrypt.compare(password, u.passwordHash);
  return ok ? u : null;
}

async function setUserSettings(username, s) {
  const update = {};
  if ("openaiKey" in s) update["settings.openaiKey"] = s.openaiKey ? encrypt(s.openaiKey) : null;
  if ("openaiModel" in s) update["settings.openaiModel"] = s.openaiModel || null;

  if ("anthropicKey" in s) update["settings.anthropicKey"] = s.anthropicKey ? encrypt(s.anthropicKey) : null;
  if ("anthropicModel" in s) update["settings.anthropicModel"] = s.anthropicModel || null;

  if ("geminiKey" in s) update["settings.geminiKey"] = s.geminiKey ? encrypt(s.geminiKey) : null;
  if ("geminiModel" in s) update["settings.geminiModel"] = s.geminiModel || null;

  await users.update({ username }, { $set: update }, { multi: false });
}

async function getUserSettings(username) {
  const u = await users.findOne({ username });
  const s = (u && u.settings) || {};
  return {
    hasOpenAI: !!s.openaiKey || !!process.env.OPENAI_API_KEY_1,
    openaiModel: s.openaiModel || process.env.OPENAI_MODEL_1 || "gpt-4o-mini",
    hasAnthropic: !!s.anthropicKey || !!process.env.ANTHROPIC_API_KEY_1,
    anthropicModel: s.anthropicModel || process.env.ANTHROPIC_MODEL_1 || "claude-3-5-sonnet-latest",
    hasGemini: !!s.geminiKey || !!process.env.GEMINI_API_KEY_1,
    geminiModel: s.geminiModel || process.env.GEMINI_MODEL_1 || "gemini-1.5-pro-latest"
  };
}

async function getDecryptedKeys(username) {
  const u = await users.findOne({ username });
  const s = (u && u.settings) || {};
  return {
    openaiKey: s.openaiKey ? decrypt(s.openaiKey) : (process.env.OPENAI_API_KEY_1 || null),
    openaiModel: s.openaiModel || process.env.OPENAI_MODEL_1 || "gpt-4o-mini",
    anthropicKey: s.anthropicKey ? decrypt(s.anthropicKey) : (process.env.ANTHROPIC_API_KEY_1 || null),
    anthropicModel: s.anthropicModel || process.env.ANTHROPIC_MODEL_1 || "claude-3-5-sonnet-latest",
    geminiKey: s.geminiKey ? decrypt(s.geminiKey) : (process.env.GEMINI_API_KEY_1 || null),
    geminiModel: s.geminiModel || process.env.GEMINI_MODEL_1 || "gemini-1.5-pro-latest"
  };
}

module.exports = { users, ensureAdmin, authenticate, setUserSettings, getUserSettings, getDecryptedKeys };
