const { appendJsonLine, ensureStore, ledgerFilePath, listJsonFiles, readJson, readJsonLines, sessionFilePath, writeJsonAtomic } = require("./db");

function isReusableSession(session, { patientId, bodyRegion = "knee", now = new Date() }) {
  if (!session || session.patientId !== patientId || session.bodyRegion !== bodyRegion) {
    return false;
  }

  if (!["pending", "questioning"].includes(session.status)) {
    return false;
  }

  const debounceExpiresAt = Date.parse(session.debounceExpiresAt || 0);
  return Number.isFinite(debounceExpiresAt) && debounceExpiresAt >= now.getTime();
}

async function createFileStore(dataDir) {
  const directories = await ensureStore(dataDir);

  return {
    kind: "file",
    dataDir: directories.dataDir,
    async getSession(sessionId) {
      return readJson(sessionFilePath(directories, sessionId));
    },
    async saveSession(session) {
      await writeJsonAtomic(sessionFilePath(directories, session.sessionId), session);
      return session;
    },
    async listSessions() {
      const files = await listJsonFiles(directories.sessionsDir);
      const sessions = await Promise.all(files.map((filePath) => readJson(filePath)));
      return sessions.filter(Boolean);
    },
    async findReusableSession(criteria) {
      const sessions = await this.listSessions();
      return sessions.find((session) => isReusableSession(session, criteria)) || null;
    },
    async appendLedgerEntry(sessionId, entry) {
      await appendJsonLine(ledgerFilePath(directories, sessionId), entry);
      return entry;
    },
    async getLedger(sessionId) {
      return readJsonLines(ledgerFilePath(directories, sessionId));
    }
  };
}

module.exports = {
  createFileStore,
  isReusableSession
};
