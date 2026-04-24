const { loadRegistry } = require("./loader");

const STAGES = ["acute", "subacute", "chronic"];
const QUESTION_TYPES = new Set(["boolean", "single_select", "multi_select", "scale_0_5"]);
const VALUE_TYPES = new Set(["boolean", "scale_0_5"]);
const OPERATORS = new Set(["eq", "neq", "gte", "lte", "truthy", "falsy", "known", "unknown"]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateCondition(condition, context) {
  assert(condition && typeof condition === "object", `${context}: condition must be an object`);
  assert(typeof condition.key === "string", `${context}: condition.key must be a string`);
  assert(OPERATORS.has(condition.operator), `${context}: unsupported operator ${condition.operator}`);
}

function collectDiseaseEntries(disease) {
  const entries = [
    ...disease.base_symptoms,
    ...disease.base_anti_symptoms,
    ...disease.soft_contradictions,
    ...disease.hard_contradictions
  ];

  for (const stage of STAGES) {
    entries.push(...disease.stage_profiles[stage].symptoms);
    entries.push(...disease.stage_profiles[stage].anti_symptoms);
  }

  return entries;
}

function validateSymptomEntry(entry, context, { contradiction = false } = {}) {
  assert(typeof entry.key === "string", `${context}: key is required`);
  assert(typeof entry.match_type === "string", `${context}: match_type is required`);
  assert(entry.match_type === "binary" || entry.match_type === "range", `${context}: invalid match_type ${entry.match_type}`);

  if (contradiction) {
    assert(Number.isInteger(entry.penalty) && entry.penalty > 0, `${context}: penalty must be a positive integer`);
  } else {
    assert(Number.isInteger(entry.weight) && entry.weight >= 1 && entry.weight <= 5, `${context}: weight must be 1-5`);
  }

  if (entry.match_type === "binary") {
    assert(typeof entry.expected_value === "boolean", `${context}: binary entry requires expected_value`);
  }

  if (entry.match_type === "range") {
    assert(Array.isArray(entry.expected_range) && entry.expected_range.length === 2, `${context}: range entry requires expected_range`);
    assert(entry.expected_range.every((value) => Number.isInteger(value) && value >= 0 && value <= 5), `${context}: expected_range values must be 0-5 integers`);
    assert(entry.expected_range[0] <= entry.expected_range[1], `${context}: expected_range must be ordered`);
  }
}

function buildQuestionCoverage(questionBank) {
  const coverage = new Map();

  for (const question of questionBank.questions) {
    for (const symptomId of question.maps_to) {
      if (!coverage.has(symptomId)) {
        coverage.set(symptomId, new Set());
      }
      coverage.get(symptomId).add(question.id);
    }
  }

  return coverage;
}

function validateRegistry(registry) {
  const symptomIds = new Set();
  for (const symptom of registry.symptoms) {
    assert(typeof symptom.id === "string" && symptom.id.length > 0, "Symptom id is required");
    assert(!symptomIds.has(symptom.id), `Duplicate symptom id ${symptom.id}`);
    symptomIds.add(symptom.id);
    assert(typeof symptom.label === "string" && symptom.label.length > 0, `Symptom ${symptom.id} is missing label`);
    assert(VALUE_TYPES.has(symptom.value_type), `Symptom ${symptom.id} has invalid value_type ${symptom.value_type}`);
    if (symptom.value_type === "scale_0_5") {
      assert(Array.isArray(symptom.scale_labels) && symptom.scale_labels.length === 6, `Symptom ${symptom.id} needs six scale labels`);
    }
  }

  const questionIds = new Set();
  for (const question of registry.questionBank.questions) {
    assert(typeof question.id === "string" && question.id.length > 0, "Question id is required");
    assert(!questionIds.has(question.id), `Duplicate question id ${question.id}`);
    questionIds.add(question.id);
    assert(QUESTION_TYPES.has(question.type), `Question ${question.id} has invalid type ${question.type}`);
    assert(typeof question.text === "string" && question.text.length > 0, `Question ${question.id} is missing text`);
    assert(Number.isInteger(question.priority) && question.priority >= 1 && question.priority <= 10, `Question ${question.id} priority must be 1-10`);
    assert(Array.isArray(question.maps_to) && question.maps_to.length > 0, `Question ${question.id} must map to at least one symptom`);
    for (const symptomId of question.maps_to) {
      assert(symptomIds.has(symptomId), `Question ${question.id} references missing symptom ${symptomId}`);
    }
    for (const condition of question.requires || []) {
      validateCondition(condition, `Question ${question.id} requires`);
      assert(symptomIds.has(condition.key), `Question ${question.id} requires missing symptom ${condition.key}`);
    }
    for (const condition of question.ask_if || []) {
      validateCondition(condition, `Question ${question.id} ask_if`);
      assert(symptomIds.has(condition.key), `Question ${question.id} ask_if references missing symptom ${condition.key}`);
    }
    for (const condition of question.blocks_if || []) {
      validateCondition(condition, `Question ${question.id} blocks_if`);
      assert(symptomIds.has(condition.key), `Question ${question.id} blocks_if references missing symptom ${condition.key}`);
    }
    if (question.type === "single_select" || question.type === "multi_select" || question.type === "boolean") {
      assert(Array.isArray(question.options) && question.options.length > 0, `Question ${question.id} needs options`);
      assert(question.value_mapping && typeof question.value_mapping === "object", `Question ${question.id} needs value_mapping`);
      for (const option of question.options) {
        assert(typeof option.id === "string" && option.id.length > 0, `Question ${question.id} has invalid option id`);
      }
      for (const [optionId, mapping] of Object.entries(question.value_mapping)) {
        assert(question.options.some((option) => option.id === optionId), `Question ${question.id} value_mapping references unknown option ${optionId}`);
        for (const symptomId of Object.keys(mapping)) {
          assert(symptomIds.has(symptomId), `Question ${question.id} maps unknown symptom ${symptomId}`);
        }
      }
    }
  }

  const coverage = buildQuestionCoverage(registry.questionBank);
  const diseaseIds = new Set();

  for (const disease of registry.diseases) {
    assert(typeof disease.id === "string" && disease.id.length > 0, "Disease id is required");
    assert(!diseaseIds.has(disease.id), `Duplicate disease id ${disease.id}`);
    diseaseIds.add(disease.id);
    assert(Array.isArray(disease.base_symptoms), `${disease.id}: base_symptoms must be an array`);
    assert(Array.isArray(disease.base_anti_symptoms), `${disease.id}: base_anti_symptoms must be an array`);
    assert(Array.isArray(disease.soft_contradictions), `${disease.id}: soft_contradictions must be an array`);
    assert(Array.isArray(disease.hard_contradictions), `${disease.id}: hard_contradictions must be an array`);
    assert(disease.stage_profiles && typeof disease.stage_profiles === "object", `${disease.id}: stage_profiles are required`);

    const stageKeys = Object.keys(disease.stage_profiles);
    assert(STAGES.every((stage) => stageKeys.includes(stage)), `${disease.id}: stage_profiles must contain acute, subacute, chronic`);

    disease.base_symptoms.forEach((entry, index) => validateSymptomEntry(entry, `${disease.id} base_symptoms[${index}]`));
    disease.base_anti_symptoms.forEach((entry, index) => validateSymptomEntry(entry, `${disease.id} base_anti_symptoms[${index}]`));
    disease.soft_contradictions.forEach((entry, index) => validateSymptomEntry(entry, `${disease.id} soft_contradictions[${index}]`, { contradiction: true }));
    disease.hard_contradictions.forEach((entry, index) => validateSymptomEntry(entry, `${disease.id} hard_contradictions[${index}]`, { contradiction: true }));

    for (const stage of STAGES) {
      const stageProfile = disease.stage_profiles[stage];
      assert(Array.isArray(stageProfile.symptoms), `${disease.id}.${stage}: symptoms must be an array`);
      assert(Array.isArray(stageProfile.anti_symptoms), `${disease.id}.${stage}: anti_symptoms must be an array`);
      stageProfile.symptoms.forEach((entry, index) => validateSymptomEntry(entry, `${disease.id}.${stage}.symptoms[${index}]`));
      stageProfile.anti_symptoms.forEach((entry, index) => validateSymptomEntry(entry, `${disease.id}.${stage}.anti_symptoms[${index}]`));
    }

    const referencedSymptomIds = new Set(collectDiseaseEntries(disease).map((entry) => entry.key));
    for (const symptomId of referencedSymptomIds) {
      assert(symptomIds.has(symptomId), `${disease.id} references unknown symptom ${symptomId}`);
      assert(coverage.has(symptomId), `${disease.id} references symptom ${symptomId} that has no question coverage`);
    }
  }

  return {
    bodyPart: registry.bodyPart,
    symptomCount: registry.symptoms.length,
    questionCount: registry.questionBank.questions.length,
    diseaseCount: registry.diseases.length
  };
}

function loadAndValidateRegistry(registryDir = __dirname) {
  const registry = loadRegistry(registryDir);
  return validateRegistry(registry);
}

if (require.main === module) {
  const summary = loadAndValidateRegistry();
  console.log(JSON.stringify(summary, null, 2));
}

module.exports = {
  loadAndValidateRegistry,
  validateRegistry
};
