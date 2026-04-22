const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { answerDiagnosticSession, createServices, startDiagnosticSession } = require("../api/routes");
const { buildConfig } = require("../lib/config");
const { loadRegistry } = require("../registry/loader");

test("end-to-end ACL flow returns a confident candidate", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "diagnostic-engine-api-"));
  const services = await createServices({
    registry: loadRegistry(),
    config: buildConfig({ dataDir })
  });

  let response = await startDiagnosticSession(services, {
    patientId: "acl_flow",
    text: "I twisted my knee playing football, felt a pop, it swelled that evening, and now it gives way."
  });

  assert.equal(response.round, 1);
  if (response.result) {
    assert.equal(response.result.type, "candidates");
    assert.equal(response.result.candidates[0].diseaseId, "knee_acl_tear");
    return;
  }

  assert.ok(response.form.questions.length > 0);

  response = await answerDiagnosticSession(services, {
    sessionId: response.sessionId,
    questionResponses: {
      knee_q_010_triggers: ["pivoting", "walking"],
      knee_q_002_location: "diffuse",
      knee_q_003_onset_style: "suddenly"
    }
  });

  if (response.form) {
    const secondRoundResponses = {};
    for (const question of response.form.questions) {
      if (question.id === "knee_q_008_mechanical") secondRoundResponses[question.id] = "none";
      if (question.id === "knee_q_005_timeline") secondRoundResponses[question.id] = "lt_1_week";
      if (question.id === "knee_q_106_return_to_sport") secondRoundResponses[question.id] = 4;
      if (question.id === "knee_q_104_continue_activity") secondRoundResponses[question.id] = "no";
      if (question.id === "knee_q_105_buckling_turning") secondRoundResponses[question.id] = 4;
      if (question.id === "knee_q_107_motion_limit") secondRoundResponses[question.id] = 3;
      if (question.id === "knee_q_109_limp") secondRoundResponses[question.id] = 4;
      if (question.id === "knee_q_110_activity_limit") secondRoundResponses[question.id] = 4;
      if (question.id === "knee_q_011_weight_bearing") secondRoundResponses[question.id] = 4;
    }

    response = await answerDiagnosticSession(services, {
      sessionId: response.sessionId,
      questionResponses: secondRoundResponses
    });
  }

  assert.equal(response.result.type, "candidates");
  assert.equal(response.result.candidates[0].diseaseId, "knee_acl_tear");
});
