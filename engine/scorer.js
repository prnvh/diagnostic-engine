const STAGES = ["acute", "subacute", "chronic"];
const CONFIDENCE_MULTIPLIER = {
  explicit: 1,
  inferred: 0.8,
  low_confidence: 0.6
};

function getEvidence(symptomState, key) {
  return symptomState[key];
}

function isKnown(entry) {
  return entry && entry.value != null;
}

function entryMatches(entry, definition) {
  if (!isKnown(entry)) {
    return false;
  }

  if (definition.match_type === "binary") {
    return entry.value === definition.expected_value;
  }

  return entry.value >= definition.expected_range[0] && entry.value <= definition.expected_range[1];
}

function scoreSupport(entry, definition, options) {
  if (!isKnown(entry)) {
    return 0;
  }

  if (options.binaryScoring) {
    return entryMatches(entry, definition) ? 1 : 0;
  }

  if (definition.match_type === "binary") {
    return entry.value === definition.expected_value ? 1 : 0;
  }

  const [minimum, maximum] = definition.expected_range;
  if (entry.value >= minimum && entry.value <= maximum) {
    return 1;
  }

  const distance = entry.value < minimum ? minimum - entry.value : entry.value - maximum;
  return Math.max(0, 1 - distance / 2);
}

function scorePenalty(entry, definition, options) {
  if (!isKnown(entry)) {
    return 0;
  }

  if (options.binaryScoring) {
    return entryMatches(entry, definition) ? 0 : 1;
  }

  if (definition.match_type === "binary") {
    return entry.value === definition.expected_value ? 0 : 1;
  }

  const [minimum, maximum] = definition.expected_range;
  if (entry.value >= minimum && entry.value <= maximum) {
    return 0;
  }

  const distance = entry.value < minimum ? minimum - entry.value : entry.value - maximum;
  return Math.min(1, distance / 2);
}

function computeMaxSupport(definitions) {
  return definitions.reduce((total, definition) => total + definition.weight * 10, 0);
}

function buildUnknownKeyList(disease, stage, symptomState) {
  const definitions = [
    ...disease.base_symptoms,
    ...disease.stage_profiles[stage].symptoms
  ];

  return [...new Set(definitions
    .filter((definition) => !isKnown(getEvidence(symptomState, definition.key)))
    .sort((left, right) => right.weight - left.weight)
    .map((definition) => definition.key))];
}

function collapseEntries(entries, typeField = null) {
  const entryMap = new Map();

  for (const entry of entries) {
    const existing = entryMap.get(entry.key);
    if (!existing) {
      entryMap.set(entry.key, { ...entry, types: entry[typeField] ? [entry[typeField]] : undefined });
      continue;
    }

    existing.points += entry.points;
    if (typeField && entry[typeField] && !existing.types.includes(entry[typeField])) {
      existing.types.push(entry[typeField]);
    }
  }

  return [...entryMap.values()]
    .sort((left, right) => right.points - left.points)
    .map((entry) => {
      if (!typeField) {
        return entry;
      }
      return {
        ...entry,
        type: entry.types.join("+")
      };
    });
}

function scoreDisease(disease, symptomState, options = {}) {
  const stageResults = [];
  let diseaseHardBlocked = false;

  for (const stage of STAGES) {
    const stageProfile = disease.stage_profiles[stage];
    const supportDefinitions = [...disease.base_symptoms, ...stageProfile.symptoms];
    const antiDefinitions = [...disease.base_anti_symptoms, ...stageProfile.anti_symptoms];

    let rawScore = 0;
    let knownSupportPotential = 0;
    const supports = [];
    const penalties = [];
    let hardBlocked = false;

    for (const definition of supportDefinitions) {
      const entry = getEvidence(symptomState, definition.key);
      if (!isKnown(entry)) {
        continue;
      }

      const multiplier = CONFIDENCE_MULTIPLIER[entry.status] || 1;
      knownSupportPotential += definition.weight * 10 * multiplier;
      const match = scoreSupport(entry, definition, options);
      const points = definition.weight * 10 * match * multiplier;
      rawScore += points;

      if (points > 0) {
        supports.push({ key: definition.key, points: Math.round(points), status: entry.status });
      }
    }

    for (const definition of antiDefinitions) {
      const entry = getEvidence(symptomState, definition.key);
      if (!isKnown(entry)) {
        continue;
      }

      const multiplier = CONFIDENCE_MULTIPLIER[entry.status] || 1;
      const penaltyFactor = scorePenalty(entry, definition, options);
      const points = definition.weight * 8 * penaltyFactor * multiplier;
      rawScore -= points;

      if (points > 0) {
        penalties.push({ key: definition.key, points: Math.round(points), type: "anti" });
      }

      if (definition.hard_block_on_confirmed && entry.status === "explicit" && penaltyFactor >= 1) {
        hardBlocked = true;
        diseaseHardBlocked = true;
      }
    }

    if (!options.disableContradictions) {
      for (const contradiction of disease.soft_contradictions) {
        const entry = getEvidence(symptomState, contradiction.key);
        if (!entryMatches(entry, contradiction)) {
          continue;
        }

        rawScore -= contradiction.penalty;
        penalties.push({ key: contradiction.key, points: contradiction.penalty, type: "soft_contradiction" });
      }

      for (const contradiction of disease.hard_contradictions) {
        const entry = getEvidence(symptomState, contradiction.key);
        if (!entryMatches(entry, contradiction)) {
          continue;
        }

        rawScore -= contradiction.penalty;
        penalties.push({ key: contradiction.key, points: contradiction.penalty, type: "hard_contradiction" });
        hardBlocked = true;
        diseaseHardBlocked = true;
      }
    }

    const maxSupport = computeMaxSupport(supportDefinitions);
    const coverageFactor = knownSupportPotential > 0 ? 0.7 + 0.3 * Math.min(1, knownSupportPotential / Math.max(maxSupport, 1)) : 0;
    const score =
      knownSupportPotential > 0
        ? Math.max(0, Math.min(100, Math.round((Math.max(rawScore, 0) / knownSupportPotential) * 100 * coverageFactor)))
        : 0;

    stageResults.push({
      stage,
      rawScore,
      maxSupport,
      score,
      hardBlocked,
      supports,
      penalties,
      highValueUnknowns: buildUnknownKeyList(disease, stage, symptomState)
    });
  }

  stageResults.sort((left, right) => right.score - left.score || right.rawScore - left.rawScore);
  return {
    ...stageResults[0],
    hardBlocked: diseaseHardBlocked || stageResults[0].hardBlocked
  };
}

function scoreCandidates(registry, symptomState, options = {}) {
  const candidates = registry.diseases.map((disease) => {
    const bestStage = scoreDisease(disease, symptomState, options);
    const band = bestStage.hardBlocked ? "eliminated" : bestStage.score >= 80 ? "confident" : bestStage.score >= 60 ? "possible" : "low";

    return {
      diseaseId: disease.id,
      diseaseName: disease.name,
      category: disease.category,
      score: bestStage.score,
      band,
      bestStage: bestStage.stage,
      hardBlocked: bestStage.hardBlocked,
      supports: collapseEntries(bestStage.supports).slice(0, 5),
      penalties: collapseEntries(bestStage.penalties, "type").slice(0, 5),
      highValueUnknowns: bestStage.highValueUnknowns.slice(0, 6)
    };
  });

  candidates.sort((left, right) => right.score - left.score || Number(left.hardBlocked) - Number(right.hardBlocked));

  return {
    candidates,
    eliminatedNodes: candidates.filter((candidate) => candidate.hardBlocked).map((candidate) => candidate.diseaseId)
  };
}

module.exports = {
  scoreCandidates
};
