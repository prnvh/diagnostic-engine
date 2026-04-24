const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadRegistry(baseDir = __dirname) {
  const symptomsPath = path.join(baseDir, "symptoms", "knee.json");
  const questionsPath = path.join(baseDir, "questions", "knee.json");
  const diseaseDir = path.join(baseDir, "diseases", "knee");

  const symptoms = readJson(symptomsPath);
  const questionBank = readJson(questionsPath);
  const diseases = fs
    .readdirSync(diseaseDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => readJson(path.join(diseaseDir, file)));

  const symptomById = new Map(symptoms.map((symptom) => [symptom.id, symptom]));
  const questionById = new Map(questionBank.questions.map((question) => [question.id, question]));
  const diseaseById = new Map(diseases.map((disease) => [disease.id, disease]));

  return {
    bodyPart: "knee",
    symptoms,
    symptomById,
    questionBank,
    questionById,
    diseases,
    diseaseById
  };
}

module.exports = {
  loadRegistry
};
