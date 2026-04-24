const { parseInitialText } = require("./parser");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 15000;
const DEFAULT_OPENAI_MODEL = "gpt-4.1";

function buildSymptomCatalog(registry) {
  return registry.symptoms.map((symptom) => ({
    id: symptom.id,
    label: symptom.label,
    category: symptom.category,
    valueType: symptom.value_type,
    scaleLabels: symptom.scale_labels || undefined
  }));
}

function formatScaleValue(symptom, value) {
  const scaleLabels = symptom.scale_labels || [];
  const label = scaleLabels[value];
  return label ? `${symptom.label} (${label})` : `${symptom.label} (${value}/5)`;
}

function buildEvidencePreview(evidence, registry) {
  return Object.entries(evidence || {})
    .filter(([, entry]) => {
      if (!entry || entry.value == null) {
        return false;
      }

      if (typeof entry.value === "boolean") {
        return entry.value === true;
      }

      return Number(entry.value) > 0;
    })
    .map(([symptomId, entry]) => {
      const symptom = registry.symptomById.get(symptomId);
      if (!symptom) {
        return null;
      }

      return {
        label: typeof entry.value === "boolean" ? symptom.label : formatScaleValue(symptom, Number(entry.value)),
        score: typeof entry.value === "boolean" ? 4 : Number(entry.value),
        status: entry.status
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)
    .map((entry) => entry.label);
}

function buildFallbackSummary(evidencePreview) {
  if (evidencePreview.length === 0) {
    return "The opening story did not confidently map enough registry signals yet, so the form will clarify the highest-value details.";
  }

  if (evidencePreview.length === 1) {
    return `The opening story most strongly suggests ${evidencePreview[0]}. The form will now confirm the highest-value details one at a time.`;
  }

  const head = evidencePreview.slice(0, 3);
  const listText =
    head.length === 2 ? `${head[0]} and ${head[1]}` : `${head[0]}, ${head[1]}, and ${head[2]}`;
  return `The opening story most strongly suggests ${listText}. The form will now confirm the highest-value details one at a time.`;
}

function normalizeStatus(value) {
  return value === "low_confidence" ? "low_confidence" : "inferred";
}

function createEvidenceEntry(value, status) {
  return {
    value,
    status,
    source: "parser",
    updatedAt: new Date().toISOString()
  };
}

function mergeNormalizedEvidence(target, symptomId, nextEntry) {
  const existing = target[symptomId];
  if (!existing) {
    target[symptomId] = nextEntry;
    return;
  }

  if (nextEntry.status === "inferred" && existing.status === "low_confidence") {
    target[symptomId] = nextEntry;
    return;
  }

  if (nextEntry.status === existing.status && typeof nextEntry.value === "number" && nextEntry.value > existing.value) {
    target[symptomId] = nextEntry;
  }
}

function normalizeLlmEvidence(parsedResponse, registry) {
  const evidence = {};

  for (const entry of parsedResponse.booleanEvidence || []) {
    const symptom = registry.symptomById.get(entry.symptomId);
    if (!symptom || symptom.value_type !== "boolean" || typeof entry.value !== "boolean") {
      continue;
    }

    mergeNormalizedEvidence(evidence, entry.symptomId, createEvidenceEntry(entry.value, normalizeStatus(entry.confidence)));
  }

  for (const entry of parsedResponse.scaleEvidence || []) {
    const symptom = registry.symptomById.get(entry.symptomId);
    if (!symptom || symptom.value_type !== "scale_0_5") {
      continue;
    }

    const numericValue = Number(entry.value);
    if (!Number.isInteger(numericValue)) {
      continue;
    }

    mergeNormalizedEvidence(
      evidence,
      entry.symptomId,
      createEvidenceEntry(Math.max(0, Math.min(5, numericValue)), normalizeStatus(entry.confidence))
    );
  }

  return evidence;
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const chunks = [];
  for (const item of payload?.output || []) {
    if (!Array.isArray(item.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      if (typeof contentItem?.text === "string" && contentItem.text.trim()) {
        chunks.push(contentItem.text.trim());
      } else if (typeof contentItem?.text?.value === "string" && contentItem.text.value.trim()) {
        chunks.push(contentItem.text.value.trim());
      } else if (typeof contentItem?.refusal === "string" && contentItem.refusal.trim()) {
        throw new Error(`OpenAI intake parser refusal: ${contentItem.refusal.trim()}`);
      }
    }
  }

  return chunks.join("\n").trim();
}

function parseJsonPayload(rawPayload) {
  if (!rawPayload) {
    return {};
  }

  try {
    return JSON.parse(rawPayload);
  } catch (error) {
    throw new Error("OpenAI intake parser returned a non-JSON response.");
  }
}

async function requestStructuredIntakeParse(text, registry, config) {
  const booleanSymptomIds = registry.symptoms.filter((symptom) => symptom.value_type === "boolean").map((symptom) => symptom.id);
  const scaleSymptomIds = registry.symptoms.filter((symptom) => symptom.value_type === "scale_0_5").map((symptom) => symptom.id);
  const symptomCatalog = buildSymptomCatalog(registry);

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "booleanEvidence", "scaleEvidence", "unparsed"],
    properties: {
      summary: {
        type: "string",
        description: "A short intake summary grounded only in the complaint text."
      },
      booleanEvidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["symptomId", "value", "confidence"],
          properties: {
            symptomId: {
              type: "string",
              enum: booleanSymptomIds
            },
            value: {
              type: "boolean"
            },
            confidence: {
              type: "string",
              enum: ["inferred", "low_confidence"]
            }
          }
        }
      },
      scaleEvidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["symptomId", "value", "confidence"],
          properties: {
            symptomId: {
              type: "string",
              enum: scaleSymptomIds
            },
            value: {
              type: "integer",
              minimum: 0,
              maximum: 5
            },
            confidence: {
              type: "string",
              enum: ["inferred", "low_confidence"]
            }
          }
        }
      },
      unparsed: {
        type: "array",
        items: {
          type: "string"
        }
      }
    }
  };

  const systemPrompt = [
    "You extract symptom evidence for a knee-triage engine.",
    "Use only the symptom registry provided by the user.",
    "Only assign symptoms that are directly stated or strongly supported by the complaint.",
    "Do not invent evidence. If something is unknown, omit it instead of guessing.",
    "For booleans, use false only for explicit denials.",
    "For 0-5 scales, use 0 only for explicit denials or clear absence. Otherwise omit unknown scales.",
    "Use low_confidence only when the language is tentative or ambiguous.",
    "Return a concise summary plus structured evidence."
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      complaint: text,
      symptomRegistry: symptomCatalog
    },
    null,
    2
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openAiApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: config.openAiModel || DEFAULT_OPENAI_MODEL,
        store: false,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: systemPrompt
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: userPrompt
              }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "knee_intake_parse",
            strict: true,
            schema
          }
        }
      }),
      signal: controller.signal
    });

    const rawPayload = await response.text();
    const payload = parseJsonPayload(rawPayload);

    if (!response.ok) {
      const apiError = payload?.error?.message || payload?.error || rawPayload.slice(0, 240);
      throw new Error(apiError || `OpenAI intake parser failed with ${response.status}`);
    }

    const outputText = extractResponseText(payload);
    if (!outputText) {
      throw new Error("OpenAI intake parser returned no structured output.");
    }

    return JSON.parse(outputText);
  } finally {
    clearTimeout(timeout);
  }
}

async function parseInitialComplaint({ text, registry, config }) {
  const fallbackResult = parseInitialText(text, registry);
  const fallbackEvidencePreview = buildEvidencePreview(fallbackResult.evidence, registry);
  const fallbackParse = {
    ...fallbackResult,
    mode: config.openAiApiKey ? "rule_fallback" : "rule",
    summary: buildFallbackSummary(fallbackEvidencePreview),
    evidencePreview: fallbackEvidencePreview,
    warning: config.openAiApiKey ? "The intake parser fell back to the rule-based registry parser." : null
  };

  if (!config.openAiApiKey) {
    return fallbackParse;
  }

  try {
    const llmResponse = await requestStructuredIntakeParse(text, registry, config);
    const evidence = normalizeLlmEvidence(llmResponse, registry);
    const evidencePreview = buildEvidencePreview(evidence, registry);

    return {
      evidence,
      unparsed: Array.isArray(llmResponse.unparsed) ? llmResponse.unparsed.filter(Boolean) : fallbackResult.unparsed,
      mode: "llm",
      summary:
        typeof llmResponse.summary === "string" && llmResponse.summary.trim()
          ? llmResponse.summary.trim()
          : buildFallbackSummary(evidencePreview),
      evidencePreview,
      warning: null
    };
  } catch (error) {
    return {
      ...fallbackParse,
      warning: `${fallbackParse.warning} ${error.message}`.trim()
    };
  }
}

module.exports = {
  parseInitialComplaint
};
