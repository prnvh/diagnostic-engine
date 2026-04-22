const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRegistry } = require("../registry/loader");
const { validateRegistry } = require("../registry-validator/validate");

test("registry validates successfully", () => {
  const registry = loadRegistry();
  const summary = validateRegistry(registry);

  assert.equal(summary.bodyPart, "knee");
  assert.equal(summary.diseaseCount, 4);
  assert.ok(summary.symptomCount > 40);
});

test("registry validator rejects missing symptom references", () => {
  const registry = loadRegistry();
  const brokenRegistry = {
    ...registry,
    diseases: [
      {
        ...registry.diseases[0],
        base_symptoms: [...registry.diseases[0].base_symptoms, { key: "missing_symptom", weight: 3, match_type: "binary", expected_value: true }]
      },
      ...registry.diseases.slice(1)
    ]
  };

  assert.throws(() => validateRegistry(brokenRegistry), /missing_symptom/);
});
