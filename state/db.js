const fs = require("node:fs/promises");
const path = require("node:path");

async function ensureStore(dataDir) {
  const sessionsDir = path.join(dataDir, "sessions");
  const ledgersDir = path.join(dataDir, "ledgers");

  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(ledgersDir, { recursive: true });

  return {
    dataDir,
    sessionsDir,
    ledgersDir
  };
}

async function readJson(filePath, fallback = null) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2));
  await fs.rename(temporaryPath, filePath);
}

async function appendJsonLine(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`);
}

async function readJsonLines(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function listJsonFiles(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function sessionFilePath(store, sessionId) {
  return path.join(store.sessionsDir, `${sessionId}.json`);
}

function ledgerFilePath(store, sessionId) {
  return path.join(store.ledgersDir, `${sessionId}.jsonl`);
}

module.exports = {
  appendJsonLine,
  ensureStore,
  ledgerFilePath,
  listJsonFiles,
  readJson,
  readJsonLines,
  sessionFilePath,
  writeJsonAtomic
};
