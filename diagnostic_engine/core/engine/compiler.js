function compileQuestionForm({ questions, symptomState, registry }) {
  const clarificationNotes = [];

  for (const question of questions) {
    const lowConfidenceSymptoms = question.maps_to.filter((symptomId) => symptomState[symptomId]?.status === "low_confidence");
    if (lowConfidenceSymptoms.length > 0) {
      clarificationNotes.push(
        `${question.text} You mentioned ${lowConfidenceSymptoms
          .map((symptomId) => registry.symptomById.get(symptomId)?.label || symptomId)
          .join(", ")} tentatively earlier, so please answer as directly as you can.`
      );
    }
  }

  const messageLines = [
    "The opening story has been mapped into the symptom registry. Answer the next form question as directly as you can.",
    "For 0-5 scales: 0 means none and 5 means the symptom is dominant or severe."
  ];

  if (clarificationNotes.length > 0) {
    messageLines.push("This question is also checking any signals that were only tentative in the original story.");
  }

  const compiledQuestions = questions.map((question) => ({
    id: question.id,
    text: question.text,
    type: question.type,
    phase: question.phase,
    mapsTo: question.maps_to,
    options: question.options || [],
    scaleLabels:
      question.type === "scale_0_5"
        ? registry.symptomById.get(question.maps_to[0])?.scale_labels || ["0", "1", "2", "3", "4", "5"]
        : undefined,
    clarification:
      question.maps_to.some((symptomId) => symptomState[symptomId]?.status === "low_confidence") || undefined
  }));

  return {
    message: messageLines.join(" "),
    questions: compiledQuestions,
    symptomIds: [...new Set(questions.flatMap((question) => question.maps_to))],
    clarificationNotes
  };
}

function buildDefaultValue(symptomMeta) {
  return symptomMeta?.value_type === "boolean" ? false : 0;
}

function mapQuestionResponsesToSymptoms({ responses, questions, registry }) {
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const symptomUpdates = {};

  for (const [questionId, responseValue] of Object.entries(responses || {})) {
    const question = questionById.get(questionId) || registry.questionById.get(questionId);
    if (!question) {
      continue;
    }

    if (question.type === "scale_0_5") {
      const numericValue = Number(responseValue);
      for (const symptomId of question.maps_to) {
        symptomUpdates[symptomId] = {
          value: Number.isFinite(numericValue) ? Math.max(0, Math.min(5, numericValue)) : 0,
          status: "explicit",
          source: "question"
        };
      }
      continue;
    }

    if (question.type === "multi_select") {
      for (const symptomId of question.maps_to) {
        symptomUpdates[symptomId] = {
          value: buildDefaultValue(registry.symptomById.get(symptomId)),
          status: "explicit",
          source: "question"
        };
      }

      for (const optionId of Array.isArray(responseValue) ? responseValue : []) {
        const mapping = question.value_mapping?.[optionId];
        if (!mapping) {
          continue;
        }
        for (const [symptomId, value] of Object.entries(mapping)) {
          symptomUpdates[symptomId] = {
            value,
            status: "explicit",
            source: "question"
          };
        }
      }
      continue;
    }

    const normalizedValue = typeof responseValue === "boolean" ? String(responseValue) : String(responseValue);
    const mapping = question.value_mapping?.[normalizedValue];
    if (!mapping) {
      continue;
    }

    for (const [symptomId, value] of Object.entries(mapping)) {
      if (value == null) {
        continue;
      }
      symptomUpdates[symptomId] = {
        value,
        status: "explicit",
        source: "question"
      };
    }
  }

  return symptomUpdates;
}

module.exports = {
  compileQuestionForm,
  mapQuestionResponsesToSymptoms
};
