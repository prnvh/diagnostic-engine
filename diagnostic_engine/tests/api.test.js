const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { answerDiagnosticSession, createServices, startDiagnosticSession } = require("../http/routes");
const { buildConfig } = require("../runtime/config");
const { loadRegistry } = require("../core/registry/loader");

test("end-to-end ACL flow stays in single-question rounds before returning a confident candidate", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "diagnostic-engine-api-"));
  const services = await createServices({
    registry: loadRegistry(),
    config: buildConfig({ dataDir, storeDriver: "file" })
  });

  let response = await startDiagnosticSession(services, {
    patientId: "acl_flow",
    text: "I twisted my knee playing football, felt a pop, it swelled that evening, and now it gives way."
  });

  assert.equal(response.round, 1);
  assert.equal(response.form.questions.length, 1);
  assert.equal(response.result, undefined);
  assert.equal(response.session.completedQuestionRounds, 0);
  assert.equal(response.session.presentedQuestionRounds, 1);
  assert.equal(response.session.minimumQuestionRoundsBeforeCandidates, 3);
  assert.ok(response.session.parserOutput.summary.length > 0);

  const aclAnswers = {
    twisting_or_pivoting_mechanism: true,
    pop_at_injury: true,
    rapid_swelling_within_24h: true,
    instability_giving_way: 4,
    difficulty_with_pivoting_or_cutting: 4,
    unable_to_continue_activity_immediately: true,
    reduced_trust_in_knee: 4,
    timeline_lt_1_week: true
  };

  for (let index = 1; index <= 2; index += 1) {
    response = await answerDiagnosticSession(services, {
      sessionId: response.sessionId,
      answers: aclAnswers
    });

    assert.ok(response.form);
    assert.equal(response.form.questions.length, 1);
    assert.equal(response.result, undefined);
    assert.equal(response.session.completedQuestionRounds, index);
    assert.equal(response.session.remainingQuestionRoundsBeforeCandidates, 3 - index);
    assert.ok(response.session.parserOutput.summary.length > 0);
  }

  let answeredRounds = 2;
  while (response.form) {
    answeredRounds += 1;
    response = await answerDiagnosticSession(services, {
      sessionId: response.sessionId,
      answers: aclAnswers
    });

    assert.ok(answeredRounds <= 5);
    if (response.form) {
      assert.equal(response.form.questions.length, 1);
      assert.equal(response.result, undefined);
    }
  }

  assert.ok(answeredRounds >= 3);
  assert.equal(response.result.type, "candidates");
  assert.equal(response.result.candidates[0].diseaseId, "knee_acl_tear");
  assert.equal(response.session.completedQuestionRounds, answeredRounds);
  assert.ok(response.session.parserOutput.summary.length > 0);
});

test("questioning continues past the minimum rounds when the shortlist is still tight", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "diagnostic-engine-api-"));
  const services = await createServices({
    registry: loadRegistry(),
    config: buildConfig({ dataDir, storeDriver: "file" })
  });

  let response = await startDiagnosticSession(services, {
    patientId: "tight_shortlist_flow",
    text: "My knee has been painful and stiff."
  });

  const tightlyContestedAnswers = {
    injury_related_start: true,
    sudden_onset: true,
    gradual_onset_over_weeks: true,
    gradual_onset_over_months: true,
    pain_location_front: 0,
    pain_location_medial: 5,
    catching: 4,
    locking: 3,
    instability_giving_way: 0,
    pain_with_squatting: 4,
    pain_after_prolonged_sitting: 0,
    pain_with_stairs: 0,
    twisting_or_pivoting_mechanism: false,
    pop_at_injury: false,
    rapid_swelling_within_24h: false,
    timeline_lt_1_week: true,
    timeline_1_to_6_weeks: true,
    timeline_gt_3_months: true,
    prominent_morning_stiffness: 4,
    symptoms_worse_after_rest: 4,
    crepitus_grinding: 4
  };

  for (let index = 1; index <= 3; index += 1) {
    response = await answerDiagnosticSession(services, {
      sessionId: response.sessionId,
      answers: tightlyContestedAnswers
    });

    assert.equal(response.result, undefined);
    assert.ok(response.form);
    assert.equal(response.form.questions.length, 1);
    assert.equal(response.session.completedQuestionRounds, index);
  }

  const topCandidates = response.debug.topCandidates.slice(0, 2);
  assert.equal(topCandidates.length, 2);
  assert.ok(topCandidates[0].score >= 80);
  assert.ok(topCandidates[0].score - topCandidates[1].score < 15);

  let answeredRounds = 3;
  while (response.form) {
    answeredRounds += 1;
    response = await answerDiagnosticSession(services, {
      sessionId: response.sessionId,
      answers: tightlyContestedAnswers
    });

    assert.ok(answeredRounds <= 5);
  }

  assert.ok(answeredRounds > 3);
  assert.ok(response.result);
});
