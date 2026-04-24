const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { answerDiagnosticSession, createServices, startDiagnosticSession } = require("../http/routes");
const { buildConfig } = require("../runtime/config");
const { loadRegistry } = require("../core/registry/loader");
const { getSession } = require("../storage/session");

function parseArgs(argv) {
  const options = {
    runs: 3,
    profileId: null,
    scorerOptions: {
      disableContradictions: false,
      binaryScoring: false
    }
  };

  for (const argument of argv) {
    if (argument.startsWith("--profile=")) {
      options.profileId = argument.split("=")[1];
    }
    if (argument === "--disable-contradictions") {
      options.scorerOptions.disableContradictions = true;
    }
    if (argument === "--binary-scoring") {
      options.scorerOptions.binaryScoring = true;
    }
  }

  return options;
}

async function loadProfiles(profileId) {
  const profileDirectory = path.join(__dirname, "profiles");
  const files = (await fs.readdir(profileDirectory)).filter((file) => file.endsWith(".json")).sort();
  const profiles = await Promise.all(
    files.map(async (file) => JSON.parse(await fs.readFile(path.join(profileDirectory, file), "utf8")))
  );

  return profileId ? profiles.filter((profile) => profile.id === profileId) : profiles;
}

function defaultValueForSymptom(symptom) {
  return symptom.value_type === "boolean" ? false : 0;
}

function getGroundTruthValue(registry, profile, symptomId) {
  if (Object.prototype.hasOwnProperty.call(profile.groundTruth || {}, symptomId)) {
    return profile.groundTruth[symptomId];
  }
  return defaultValueForSymptom(registry.symptomById.get(symptomId));
}

function scoreOptionMapping(registry, profile, mapping) {
  let score = 0;

  for (const [symptomId, expectedValue] of Object.entries(mapping)) {
    const actualValue = getGroundTruthValue(registry, profile, symptomId);

    if (expectedValue === actualValue) {
      score += 4;
      continue;
    }

    if (typeof expectedValue === "number" && typeof actualValue === "number") {
      score += Math.max(0, 3 - Math.abs(expectedValue - actualValue));
      continue;
    }

    if (Boolean(expectedValue) === Boolean(actualValue)) {
      score += 2;
      continue;
    }

    score -= 2;
  }

  return score;
}

function selectOptionResponse(question, registry, profile) {
  if (question.type === "scale_0_5") {
    const values = question.maps_to.map((symptomId) => Number(getGroundTruthValue(registry, profile, symptomId) || 0));
    return Math.max(...values, 0);
  }

  if (question.type === "multi_select") {
    return (question.options || [])
      .filter((option) => {
        const mapping = question.value_mapping?.[option.id] || {};
        return Object.entries(mapping).some(([symptomId, expectedValue]) => {
          const actualValue = getGroundTruthValue(registry, profile, symptomId);
          if (typeof expectedValue === "number") {
            return actualValue >= expectedValue && expectedValue > 0;
          }
          return expectedValue === true && actualValue === true;
        });
      })
      .map((option) => option.id);
  }

  const scoredOptions = (question.options || []).map((option) => ({
    optionId: option.id,
    score: scoreOptionMapping(registry, profile, question.value_mapping?.[option.id] || {})
  }));

  scoredOptions.sort((left, right) => right.score - left.score);
  return scoredOptions[0]?.optionId;
}

async function runProfile(profile, runIndex, options) {
  const temporaryDataDir = await fs.mkdtemp(path.join(os.tmpdir(), `diagnostic-engine-${profile.id}-${runIndex}-`));
  const registry = loadRegistry();
  const config = buildConfig({ dataDir: temporaryDataDir, storeDriver: "file" });
  const services = await createServices({ registry, config });

  let response = await startDiagnosticSession(
    services,
    {
      patientId: `${profile.id}_${runIndex}`,
      text: profile.initialText,
      bodyRegion: "knee"
    },
    { scorerOptions: options.scorerOptions }
  );

  while (response.form) {
    const questionResponses = {};
    for (const question of response.form.questions) {
      questionResponses[question.id] = selectOptionResponse(registry.questionById.get(question.id), registry, profile);
    }

    response = await answerDiagnosticSession(
      services,
      {
        sessionId: response.sessionId,
        questionResponses
      },
      { scorerOptions: options.scorerOptions }
    );
  }

  const session = await getSession(services.store, response.sessionId);
  const confidentCandidates = (session.candidates || []).filter((candidate) => !candidate.hardBlocked && candidate.score >= 80);
  const possibleCandidates = (session.candidates || []).filter((candidate) => !candidate.hardBlocked && candidate.score >= 60);
  const presentedCandidates = response.result?.type === "candidates" ? response.result.candidates || [] : [];

  const outcomeType = response.result?.type;
  let passed = false;

  if (profile.expectedOutcome === "candidate") {
    const winningCandidate = confidentCandidates.find((candidate) => candidate.diseaseId === profile.expectedDisease);
    const presentedCandidate = presentedCandidates.find((candidate) => candidate.diseaseId === profile.expectedDisease);
    passed = Boolean(winningCandidate || presentedCandidate);
    if (passed && profile.expectedStage) {
      const resolvedStage = winningCandidate?.bestStage || presentedCandidate?.stage;
      passed = resolvedStage === profile.expectedStage;
    }
  } else if (profile.expectedOutcome === "fallback") {
    passed = outcomeType === "fallback";
  } else if (profile.expectedOutcome === "escalation") {
    passed = outcomeType === "escalation";
  }

  return {
    profileId: profile.id,
    runIndex,
    passed,
    outcomeType,
    finalRound: response.round,
    possibleBandHit: possibleCandidates.some((candidate) => candidate.diseaseId === profile.expectedDisease),
    confidentBandHit: confidentCandidates.some((candidate) => candidate.diseaseId === profile.expectedDisease),
    presentedCandidateHit: presentedCandidates.some((candidate) => candidate.diseaseId === profile.expectedDisease),
    falsePositiveConfidentCount:
      profile.expectedOutcome === "candidate"
        ? confidentCandidates.filter((candidate) => candidate.diseaseId !== profile.expectedDisease).length
        : confidentCandidates.length,
    topCandidates: session.candidates.slice(0, 3)
  };
}

async function runBenchmark(options) {
  const profiles = await loadProfiles(options.profileId);
  const runResults = [];

  for (const profile of profiles) {
    for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
      runResults.push(await runProfile(profile, runIndex, options));
    }
  }

  const grouped = new Map();
  for (const result of runResults) {
    if (!grouped.has(result.profileId)) {
      grouped.set(result.profileId, []);
    }
    grouped.get(result.profileId).push(result);
  }

  const profileSummaries = [...grouped.entries()].map(([profileId, results]) => ({
    profileId,
    allRunsPassed: results.every((result) => result.passed),
    presentedCandidateHit: results.some((result) => result.presentedCandidateHit),
    confidentBandHit: results.some((result) => result.confidentBandHit),
    possibleBandHit: results.some((result) => result.possibleBandHit),
    falsePositiveConfidentCount: Math.max(...results.map((result) => result.falsePositiveConfidentCount)),
    sampleOutcome: results[0].outcomeType,
    sampleTopCandidates: results[0].topCandidates
  }));

  const summary = {
    options,
    profileCount: profiles.length,
    runCount: runResults.length,
    passedProfiles: profileSummaries.filter((profile) => profile.allRunsPassed).length,
    profileSummaries
  };

  const resultsDirectory = path.join(process.cwd(), "diagnostic_engine", "benchmarks", "results");
  await fs.mkdir(resultsDirectory, { recursive: true });
  const resultPath = path.join(resultsDirectory, `benchmark-${Date.now()}.json`);
  await fs.writeFile(resultPath, JSON.stringify(summary, null, 2));

  return {
    summary,
    resultPath
  };
}

if (require.main === module) {
  runBenchmark(parseArgs(process.argv.slice(2)))
    .then(({ summary, resultPath }) => {
      console.log(JSON.stringify({ ...summary, resultPath }, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  runBenchmark
};
