const fs = require("node:fs");
const path = require("node:path");
const DEFAULT_OPENAI_MODEL = "gpt-5.2";

function loadEnvFile(filePath = path.join(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const env = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"|"$/g, "");
    env[key] = value;

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }

  return env;
}

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveStoreDriver(overrides = {}) {
  if (overrides.storeDriver) {
    return overrides.storeDriver;
  }

  if (process.env.STORAGE_DRIVER) {
    return process.env.STORAGE_DRIVER;
  }

  const supabaseUrl = overrides.supabaseUrl || process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = overrides.supabaseServiceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return supabaseUrl && supabaseServiceRoleKey ? "supabase" : "file";
}

function buildConfig(overrides = {}) {
  const cwd = overrides.cwd || process.cwd();
  const dataDir = overrides.dataDir || process.env.DIAGNOSTIC_ENGINE_DATA_DIR || ".diagnostic-engine-data";
  const webDir = overrides.webDir || process.env.DIAGNOSTIC_ENGINE_WEB_DIR || "web";

  return {
    cwd,
    port: toInteger(overrides.port || process.env.PORT, 3000),
    maxRounds: toInteger(overrides.maxRounds || process.env.MAX_ROUNDS, 5),
    minQuestionRoundsBeforeCandidates: toInteger(
      overrides.minQuestionRoundsBeforeCandidates || process.env.MIN_QUESTION_ROUNDS_BEFORE_CANDIDATES,
      3
    ),
    sessionDebounceMs: toInteger(overrides.sessionDebounceMs || process.env.SESSION_DEBOUNCE_MS, 120000),
    storeDriver: resolveStoreDriver(overrides),
    dataDir: path.resolve(cwd, dataDir),
    webDir: path.resolve(cwd, webDir),
    supabaseUrl: overrides.supabaseUrl || process.env.SUPABASE_URL || "",
    supabaseServiceRoleKey: overrides.supabaseServiceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    supabaseSchema: overrides.supabaseSchema || process.env.SUPABASE_SCHEMA || "public",
    supabaseSessionsTable: overrides.supabaseSessionsTable || process.env.SUPABASE_SESSIONS_TABLE || "diagnostic_sessions",
    supabaseLedgerTable:
      overrides.supabaseLedgerTable || process.env.SUPABASE_LEDGER_TABLE || "diagnostic_ledger_entries",
    openAiApiKey: overrides.openAiApiKey || process.env.OPENAI_API_KEY || "",
    openAiModel: overrides.openAiModel || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
  };
}

module.exports = {
  buildConfig,
  loadEnvFile
};
