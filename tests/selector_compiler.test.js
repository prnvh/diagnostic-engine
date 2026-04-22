const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegistry } = require("../registry/loader");
const { scoreCandidates } = require("../engine/scorer");
const { selectQuestions } = require("../engine/selector");
const { compileQuestionForm } = require("../engine/compiler");

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
