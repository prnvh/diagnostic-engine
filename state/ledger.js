const { appendJsonLine, ledgerFilePath, readJsonLines } = require("./db");

async function appendEntry(store, sessionId, type, payload = {}) {
  const entry = {
    sessionId,
    type,
    payload,
    at: new Date().toISOString()
  };

  await appendJsonLine(ledgerFilePath(store, sessionId), entry);
  return entry;
}

async function getLedger(store, sessionId) {
  return readJsonLines(ledgerFilePath(store, sessionId));
}

module.exports = {
  appendEntry,
  getLedger
};
