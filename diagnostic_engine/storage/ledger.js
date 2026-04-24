async function appendEntry(store, sessionId, type, payload = {}) {
  const entry = {
    sessionId,
    type,
    payload,
    at: new Date().toISOString()
  };

  await store.appendLedgerEntry(sessionId, entry);
  return entry;
}

async function getLedger(store, sessionId) {
  return store.getLedger(sessionId);
}

module.exports = {
  appendEntry,
  getLedger
};
