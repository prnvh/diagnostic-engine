const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createFileStore } = require("../storage/file-store");
const { createSession, getSession, upsertSymptoms } = require("../storage/session");

test("session symptom upsert strengthens and replaces weaker evidence", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "diagnostic-engine-session-"));
  const store = await createFileStore(dataDir);
  const session = await createSession(store, {
    patientId: "patient_1",
    bodyRegion: "knee",
    rawText: "test"
  });

  await upsertSymptoms(store, session.sessionId, {
    instability_giving_way: { value: 2, status: "low_confidence", source: "parser" }
  });

  await upsertSymptoms(store, session.sessionId, {
    instability_giving_way: { value: 4, status: "explicit", source: "question" },
    pop_at_injury: { value: true, status: "explicit", source: "question" }
  });

  const updated = await getSession(store, session.sessionId);
  assert.equal(updated.symptomState.instability_giving_way.value, 4);
  assert.equal(updated.symptomState.instability_giving_way.status, "explicit");
  assert.equal(updated.symptomState.pop_at_injury.value, true);
});
