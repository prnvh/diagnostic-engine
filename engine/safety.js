function getSymptomValue(symptomState, key) {
  return symptomState[key]?.value;
}

function evaluateSafety(symptomState) {
  const reasons = [];

  const fever = getSymptomValue(symptomState, "fever") === true;
  const warmth = getSymptomValue(symptomState, "joint_warmth") === true;
  const redness = getSymptomValue(symptomState, "redness") === true;
  const deformity = getSymptomValue(symptomState, "deformity") === true;
  const majorTrauma = getSymptomValue(symptomState, "major_trauma") === true;
  const difficultyWeightBearing = Number(getSymptomValue(symptomState, "difficulty_weight_bearing") ?? 0);

  if (deformity) {
    reasons.push("The knee looks deformed or out of place.");
  }

  if (fever && (warmth || redness)) {
    reasons.push("Fever together with a hot or red knee needs urgent in-person review.");
  }

  if (majorTrauma && difficultyWeightBearing >= 4) {
    reasons.push("Major trauma with marked trouble bearing weight can indicate a serious structural injury.");
  }

  if (!reasons.length) {
    return {
      escalated: false,
      reasons: []
    };
  }

  return {
    escalated: true,
    reasons,
    message: [
      "This pattern has safety signals that should not stay inside a normal symptom-ranking loop.",
      ...reasons,
      "Please seek urgent in-person medical assessment."
    ].join(" ")
  };
}

module.exports = {
  evaluateSafety
};
