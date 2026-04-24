const test = require("node:test");
const assert = require("node:assert/strict");
const { parseInitialComplaint } = require("../core/engine/intake-parser");
const { loadRegistry } = require("../core/registry/loader");

const registry = loadRegistry();

test("intake parser falls back to the rule parser when no OpenAI key is configured", async () => {
  const result = await parseInitialComplaint({
    text: "My knee twisted while squatting, now the inner side hurts and it sometimes catches when I turn.",
    registry,
    config: {
      openAiApiKey: "",
      openAiModel: ""
    }
  });

  assert.equal(result.mode, "rule");
  assert.equal(result.evidence.pain_location_medial.value >= 4, true);
  assert.equal(result.evidence.catching.value >= 4, true);
  assert.ok(Array.isArray(result.evidencePreview));
  assert.ok(result.summary.length > 0);
});

test("intake parser accepts structured OpenAI output when configured", async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  summary: "The story points to an inner-side knee problem with catching after a twist.",
                  booleanEvidence: [
                    {
                      symptomId: "twisting_or_pivoting_mechanism",
                      value: true,
                      confidence: "inferred"
                    }
                  ],
                  scaleEvidence: [
                    {
                      symptomId: "pain_location_medial",
                      value: 5,
                      confidence: "inferred"
                    },
                    {
                      symptomId: "catching",
                      value: 4,
                      confidence: "low_confidence"
                    }
                  ],
                  unparsed: []
                })
              }
            ]
          }
        ]
      })
  });

  try {
    const result = await parseInitialComplaint({
      text: "My knee twisted while squatting, now the inner side hurts and it sometimes catches when I turn.",
      registry,
      config: {
        openAiApiKey: "test_key",
        openAiModel: "gpt-5.2"
      }
    });

    assert.equal(result.mode, "llm");
    assert.equal(result.evidence.twisting_or_pivoting_mechanism.value, true);
    assert.equal(result.evidence.pain_location_medial.value, 5);
    assert.equal(result.evidence.catching.status, "low_confidence");
    assert.match(result.summary, /inner-side knee problem/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("intake parser falls back cleanly when the OpenAI request fails", async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: false,
    text: async () =>
      JSON.stringify({
        error: {
          message: "Upstream parser unavailable"
        }
      })
  });

  try {
    const result = await parseInitialComplaint({
      text: "I twisted my knee and felt a pop while playing football.",
      registry,
      config: {
        openAiApiKey: "test_key",
        openAiModel: "gpt-5.2"
      }
    });

    assert.equal(result.mode, "rule_fallback");
    assert.ok(result.summary.length > 0);
    assert.match(result.warning || "", /rule-based registry parser/i);
    assert.match(result.warning || "", /Upstream parser unavailable/i);
  } finally {
    global.fetch = originalFetch;
  }
});
