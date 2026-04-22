const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegistry } = require("../registry/loader");
const { scoreCandidates } = require("../engine/scorer");

const registry = loadRegistry();

test("scorer ranks ACL tear highest for a classic ACL pattern", () => {
  const symptomState = {
    twisting_or_pivoting_mechanism: { value: true, status: "explicit" },
    pop_at_injury: { value: true, status: "explicit" },
    rapid_swelling_within_24h: { value: true, status: "explicit" },
    instability_giving_way: { value: 4, status: "explicit" },
    difficulty_with_pivoting_or_cutting: { value: 4, status: "explicit" },
    timeline_lt_1_week: { value: true, status: "explicit" },
    unable_to_continue_activity_immediately: { value: true, status: "explicit" }
  };

  const { candidates } = scoreCandidates(registry, symptomState);

  assert.equal(candidates[0].diseaseId, "knee_acl_tear");
  assert.ok(candidates[0].score >= 80);
});

test("confirmed atraumatic gradual history hard-blocks ACL tear", () => {
  const symptomState = {
    atraumatic_start: { value: true, status: "explicit" },
    gradual_onset_over_weeks: { value: true, status: "explicit" },
    pain_location_front: { value: 4, status: "explicit" },
    pain_after_prolonged_sitting: { value: 4, status: "explicit" }
  };

  const { candidates } = scoreCandidates(registry, symptomState);
  const aclCandidate = candidates.find((candidate) => candidate.diseaseId === "knee_acl_tear");

  assert.equal(aclCandidate.hardBlocked, true);
  assert.equal(aclCandidate.band, "eliminated");
});
