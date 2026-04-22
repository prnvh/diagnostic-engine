const crypto = require("node:crypto");
const { listJsonFiles, readJson, sessionFilePath, writeJsonAtomic } = require("./db");

const STATUS_PRIORITY = {
  low_confidence: 1,
  inferred: 2,
  explicit: 3
};

function nowIso(now = new Date()) {
  return now.toISOString();
}

function createSymptomEntry(value, status = "explicit", source = "question") {
  return {
    value,
    status,
    source,
    updatedAt: nowIso()
  };
}

function mergeSymptomEntry(existingEntry, incomingEntry) {
  if (incomingEntry == null || incomingEntry.value == null) {
    return existingEntry;
  }

  if (!existingEntry) {
    return incomingEntry;
  }

  const existingPriority = STATUS_PRIORITY[existingEntry.status] || 0;
  const incomingPriority = STATUS_PRIORITY[incomingEntry.status] || 0;

  if (incomingPriority > existingPriority) {
    return incomingEntry;
  }

  if (incomingPriority < existingPriority) {
    return {
      ...existingEntry,
      updatedAt: incomingEntry.updatedAt || existingEntry.updatedAt
    };
  }

  return incomingEntry;
}

async function getSession(store, sessionId) {
  return readJson(sessionFilePath(store, sessionId));
}

async function writeSession(store, session) {
  await writeJsonAtomic(sessionFilePath(store, session.sessionId), session);
  return session;
}

async function createSession(store, { patientId, bodyRegion = "knee", rawText = "", now = new Date() }) {
  const createdAt = nowIso(now);
  const session = {
    sessionId: `sess_${crypto.randomUUID()}`,
    patientId,
    bodyRegion,
    symptomState: {},
    candidates: [],
    eliminatedNodes: [],
    questionLog: [],
    rawMessages: rawText ? [{ text: rawText, at: createdAt, source: "user" }] : [],
    parserOutput: { unparsed: [] },
    round: 0,
    status: "pending",
    debounceExpiresAt: new Date(now.getTime()).toISOString(),
    processing: false,
    createdAt,
    updatedAt: createdAt
  };

  await writeSession(store, session);
  return session;
}

async function updateSession(store, sessionId, updater) {
  const session = await getSession(store, sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const updated = await updater({ ...session });
  updated.updatedAt = nowIso();
  await writeSession(store, updated);
  return updated;
}

async function appendRawMessage(store, sessionId, message, source = "user") {
  return updateSession(store, sessionId, (session) => {
    session.rawMessages.push({
      text: message,
      at: nowIso(),
      source
    });
    return session;
  });
}

async function upsertSymptoms(store, sessionId, newSymptoms, { source = "question" } = {}) {
  return updateSession(store, sessionId, (session) => {
    for (const [symptomId, entry] of Object.entries(newSymptoms || {})) {
      const incomingEntry =
        entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, "value")
          ? {
              ...entry,
              source: entry.source || source,
              updatedAt: nowIso()
            }
          : createSymptomEntry(entry, "explicit", source);

      session.symptomState[symptomId] = mergeSymptomEntry(session.symptomState[symptomId], incomingEntry);
    }

    return session;
  });
}

async function saveEvaluationState(store, sessionId, patch) {
  return updateSession(store, sessionId, (session) => {
    Object.assign(session, patch);
    return session;
  });
}

async function recordQuestionBatch(store, sessionId, questions, round) {
  return updateSession(store, sessionId, (session) => {
    session.questionLog.push({
      round,
      askedAt: nowIso(),
      questionIds: questions.map((question) => question.id)
    });
    return session;
  });
}

async function listSessions(store) {
  const files = await listJsonFiles(store.sessionsDir);
  const sessions = await Promise.all(files.map((file) => readJson(file)));
  return sessions.filter(Boolean);
}

async function findReusableSession(store, { patientId, bodyRegion = "knee", now = new Date() }) {
  const sessions = await listSessions(store);
  return sessions.find((session) => {
    if (session.patientId !== patientId || session.bodyRegion !== bodyRegion) {
      return false;
    }

    if (!["pending", "questioning"].includes(session.status)) {
      return false;
    }

    const debounceExpiresAt = Date.parse(session.debounceExpiresAt || 0);
    return Number.isFinite(debounceExpiresAt) && debounceExpiresAt >= now.getTime();
  });
}

module.exports = {
  appendRawMessage,
  createSession,
  createSymptomEntry,
  findReusableSession,
  getSession,
  listSessions,
  mergeSymptomEntry,
  recordQuestionBatch,
  saveEvaluationState,
  updateSession,
  upsertSymptoms
};
