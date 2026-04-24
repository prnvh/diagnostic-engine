const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegistry } = require("../core/registry/loader");
const { scoreCandidates } = require("../core/engine/scorer");
const { selectQuestions } = require("../core/engine/selector");
const { compileQuestionForm } = require("../core/engine/compiler");

const registry = loadRegistry();

test("selector chooses unresolved ACL-focused questions", () => {
  const symptomState = {
    injury_related_start: { value: true, status: "explicit" },
    sudden_onset: { value: true, status: "explicit" },
    knee_swelling: { value: 4, status: "explicit" },
    instability_giving_way: { value: 4, status: "explicit" },
    pop_at_injury: { value: true, status: "explicit" }
  };

  const { candidates } = scoreCandidates(registry, symptomState);
  const questions = selectQuestions({
    registry,
    symptomState,
    candidates,
    questionLog: [],
    round: 2,
    limit: 3
  });

  assert.ok(questions.some((question) => question.id === "knee_q_103_swelling_timing" || question.id === "knee_q_105_buckling_turning" || question.id === "knee_q_106_return_to_sport"));
});

test("selector can require explicit confirmation for inferred first-round evidence", () => {
  const symptomState = {
    injury_related_start: { value: true, status: "inferred" },
    sudden_onset: { value: true, status: "inferred" },
    pop_at_injury: { value: true, status: "inferred" },
    rapid_swelling_within_24h: { value: true, status: "inferred" },
    instability_giving_way: { value: 4, status: "inferred" }
  };

  const { candidates } = scoreCandidates(registry, symptomState);
  const questions = selectQuestions({
    registry,
    symptomState,
    candidates,
    questionLog: [],
    round: 1,
    limit: 3,
    requireExplicitConfirmation: true
  });

  assert.ok(
    questions.some((question) =>
      question.maps_to.some((symptomId) =>
        [
          "injury_related_start",
          "sudden_onset",
          "pop_at_injury",
          "rapid_swelling_within_24h",
          "instability_giving_way"
        ].includes(symptomId)
      )
    )
  );
});

test("compiler adds clarification note for low-confidence symptoms", () => {
  const questions = [registry.questionById.get("knee_q_007_instability")];
  const form = compileQuestionForm({
    questions,
    symptomState: {
      instability_giving_way: { value: 2, status: "low_confidence" }
    },
    registry
  });

  assert.equal(form.questions[0].clarification, true);
  assert.ok(form.clarificationNotes[0].includes("tentatively"));
});

test("compiler preserves full 0-5 scale labels for question forms", () => {
  const questions = [registry.questionById.get("knee_q_006_swelling")];
  const form = compileQuestionForm({
    questions,
    symptomState: {},
    registry
  });

  assert.deepEqual(form.questions[0].scaleLabels, ["none", "trace", "mild", "moderate", "marked", "severe"]);
  assert.ok(form.message.includes("0-5 scales"));
});
