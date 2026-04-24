function getSymptomValue(symptomState, key) {
  return symptomState[key]?.value;
}

function getSymptomStatus(symptomState, key) {
  return symptomState[key]?.status;
}

function evaluateCondition(condition, symptomState) {
  const entry = symptomState[condition.key];
  const value = entry?.value;

  switch (condition.operator) {
    case "eq":
      return value === condition.value;
    case "neq":
      return value !== condition.value;
    case "gte":
      return Number(value ?? -Infinity) >= condition.value;
    case "lte":
      return Number(value ?? Infinity) <= condition.value;
    case "truthy":
      return Boolean(value);
    case "falsy":
      return !value;
    case "known":
      return value != null;
    case "unknown":
      return value == null;
    default:
      return false;
  }
}

function allMappedKnown(question, symptomState, { requireExplicitConfirmation = false } = {}) {
  return question.maps_to.every((key) => {
    const entry = symptomState[key];
    return (
      entry &&
      entry.value != null &&
      entry.status !== "low_confidence" &&
      (!requireExplicitConfirmation || entry.status === "explicit")
    );
  });
}

function buildWeightIndex(registry) {
  const weightIndex = new Map();

  for (const disease of registry.diseases) {
    const add = (key, weight) => {
      if (!weightIndex.has(key)) {
        weightIndex.set(key, new Map());
      }
      weightIndex.get(key).set(disease.id, Math.max(weightIndex.get(key).get(disease.id) || 0, weight));
    };

    for (const definition of disease.base_symptoms) {
      add(definition.key, definition.weight);
    }
    for (const definition of disease.base_anti_symptoms) {
      add(definition.key, definition.weight);
    }
    for (const stage of Object.values(disease.stage_profiles)) {
      for (const definition of stage.symptoms) {
        add(definition.key, definition.weight);
      }
      for (const definition of stage.anti_symptoms) {
        add(definition.key, definition.weight);
      }
    }
  }

  return weightIndex;
}

function scoreQuestion(question, topCandidates, symptomState, round, weightIndex, { requireExplicitConfirmation = false } = {}) {
  let score = question.priority * 4;

  if (round === 1) {
    if (question.phase === "routing") score += 12;
    if (question.phase === "universal") score += 8;
    if (question.phase === "discriminator") score += 3;
  } else if (round === 2) {
    if (question.phase === "discriminator") score += 10;
    if (question.phase === "refinement") score += 5;
  } else {
    if (question.phase === "discriminator") score += 12;
    if (question.phase === "refinement") score += 7;
  }

  const candidateIds = new Set(topCandidates.map((candidate) => candidate.diseaseId));

  for (const symptomId of question.maps_to) {
    const value = getSymptomValue(symptomState, symptomId);
    const status = getSymptomStatus(symptomState, symptomId);
    const weights = weightIndex.get(symptomId);
    const relevantWeights = topCandidates.map((candidate) => weights?.get(candidate.diseaseId) || 0);
    const maxWeight = Math.max(...relevantWeights, 0);
    const minWeight = Math.min(...relevantWeights, 0);

    if (value == null) {
      score += maxWeight * 5;
    } else if (status === "low_confidence") {
      score += maxWeight * 3 + 10;
    } else if (requireExplicitConfirmation && status === "inferred") {
      score += maxWeight * 4 + 8;
    }

    score += (maxWeight - minWeight) * 4;
  }

  for (const diseaseId of question.helps_discriminate || []) {
    if (candidateIds.has(diseaseId)) {
      score += 6;
    }
  }

  if (
    question.maps_to.some((key) => ["fever", "joint_warmth", "redness", "major_trauma", "deformity"].includes(key)) &&
    (getSymptomValue(symptomState, "knee_swelling") >= 2 || getSymptomValue(symptomState, "difficulty_weight_bearing") >= 3)
  ) {
    score += 12;
  }

  return score;
}

function selectQuestions({
  registry,
  symptomState,
  candidates,
  questionLog,
  round,
  limit = 3,
  requireExplicitConfirmation = false
}) {
  const askedQuestionIds = new Set(questionLog.flatMap((entry) => entry.questionIds));
  const topCandidates = candidates.filter((candidate) => !candidate.hardBlocked && candidate.score >= 60).slice(0, 3);
  const candidatePool = topCandidates.length ? topCandidates : candidates.filter((candidate) => !candidate.hardBlocked).slice(0, 3);
  const weightIndex = buildWeightIndex(registry);

  const scoredQuestions = registry.questionBank.questions
    .filter((question) => !askedQuestionIds.has(question.id))
    .filter((question) => !allMappedKnown(question, symptomState, { requireExplicitConfirmation }))
    .filter((question) => (question.requires || []).every((condition) => evaluateCondition(condition, symptomState)))
    .filter((question) => (question.blocks_if || []).every((condition) => !evaluateCondition(condition, symptomState)))
    .filter((question) => {
      if (!question.ask_if || question.ask_if.length === 0) {
        return true;
      }
      return question.ask_if.some((condition) => evaluateCondition(condition, symptomState));
    })
    .map((question) => ({
      question,
      score: scoreQuestion(question, candidatePool, symptomState, round, weightIndex, { requireExplicitConfirmation })
    }))
    .sort((left, right) => right.score - left.score);

  return scoredQuestions.slice(0, limit).map((entry) => entry.question);
}

module.exports = {
  selectQuestions
};
