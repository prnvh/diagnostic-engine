const http = require("node:http");
const { ensureStore } = require("../state/db");
const { appendEntry, getLedger } = require("../state/ledger");
const { appendRawMessage, createSession, findReusableSession, getSession, recordQuestionBatch, saveEvaluationState, upsertSymptoms } = require("../state/session");
const { compileQuestionForm, mapQuestionResponsesToSymptoms } = require("../engine/compiler");
const { buildFallbackResult } = require("../engine/fallback");
const { parseInitialText } = require("../engine/parser");
const { scoreCandidates } = require("../engine/scorer");
const { selectQuestions } = require("../engine/selector");
const { evaluateSafety } = require("../engine/safety");

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    body: JSON.stringify(payload, null, 2),
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  };
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function buildDirectSymptomUpdates(answers) {
  const updates = {};
  for (const [symptomId, value] of Object.entries(answers || {})) {
    updates[symptomId] = {
      value,
      status: "explicit",
      source: "question"
    };
  }
  return updates;
}

function buildCandidateResult(session, candidates) {
  const visibleCandidates = candidates.filter((candidate) => !candidate.hardBlocked && candidate.score >= 80);
  return {
    type: "candidates",
    sessionId: session.sessionId,
    message: "These conditions fit the current evidence most strongly. This is a fit score, not a diagnosis.",
    candidates: visibleCandidates.map((candidate) => ({
      diseaseId: candidate.diseaseId,
      diseaseName: candidate.diseaseName,
      matchScore: `${candidate.score}%`,
      stage: candidate.bestStage,
      strongestSupports: candidate.supports.slice(0, 3).map((support) => support.key),
      strongestPenalties: candidate.penalties.slice(0, 2).map((penalty) => penalty.key)
    }))
  };
}

async function evaluateSession(services, sessionId, { parsedUnparsed = null, scorerOptions = {} } = {}) {
  let session = await getSession(services.store, sessionId);
  const nextRound = session.round + 1;

  const safety = evaluateSafety(session.symptomState);
  if (safety.escalated) {
    session = await saveEvaluationState(services.store, sessionId, {
      status: "escalated",
      round: nextRound,
      debounceExpiresAt: new Date(Date.now() + services.config.sessionDebounceMs).toISOString()
    });
    await appendEntry(services.store, sessionId, "SAFETY_ESCALATED", { reasons: safety.reasons });
    return {
      sessionId,
      round: session.round,
      result: {
        type: "escalation",
        message: safety.message,
        reasons: safety.reasons
      }
    };
  }

  const { candidates, eliminatedNodes } = scoreCandidates(services.registry, session.symptomState, scorerOptions);
  await appendEntry(services.store, sessionId, "ROUND_COMPLETE", {
    round: nextRound,
    topCandidates: candidates.slice(0, 3).map((candidate) => ({
      diseaseId: candidate.diseaseId,
      score: candidate.score,
      stage: candidate.bestStage
    }))
  });

  const confidentCandidates = candidates.filter((candidate) => !candidate.hardBlocked && candidate.score >= 80);
  if (confidentCandidates.length > 0) {
    session = await saveEvaluationState(services.store, sessionId, {
      candidates,
      eliminatedNodes,
      round: nextRound,
      status: "complete",
      debounceExpiresAt: new Date(Date.now() + services.config.sessionDebounceMs).toISOString(),
      parserOutput: {
        unparsed: parsedUnparsed ?? session.parserOutput?.unparsed ?? []
      }
    });
    await appendEntry(services.store, sessionId, "CANDIDATE_FLAGGED", {
      round: nextRound,
      candidates: confidentCandidates.map((candidate) => candidate.diseaseId)
    });
    return {
      sessionId,
      round: session.round,
      result: buildCandidateResult(session, confidentCandidates),
      debug: {
        topCandidates: candidates.slice(0, 3),
        eliminatedNodes
      }
    };
  }

  if (nextRound >= services.config.maxRounds) {
    session = await saveEvaluationState(services.store, sessionId, {
      candidates,
      eliminatedNodes,
      round: nextRound,
      status: "fallback",
      debounceExpiresAt: new Date(Date.now() + services.config.sessionDebounceMs).toISOString(),
      parserOutput: {
        unparsed: parsedUnparsed ?? session.parserOutput?.unparsed ?? []
      }
    });
    await appendEntry(services.store, sessionId, "FALLBACK_TRIGGERED", {
      round: nextRound,
      reason: "max_rounds_without_confident_candidate"
    });
    return {
      sessionId,
      round: session.round,
      result: buildFallbackResult({
        session,
        candidates,
        reason: "max_rounds_without_confident_candidate"
      }),
      debug: {
        topCandidates: candidates.slice(0, 3),
        eliminatedNodes
      }
    };
  }

  const selectedQuestions = selectQuestions({
    registry: services.registry,
    symptomState: session.symptomState,
    candidates,
    questionLog: session.questionLog,
    round: nextRound,
    limit: 3
  });

  const form = compileQuestionForm({
    questions: selectedQuestions,
    symptomState: session.symptomState,
    registry: services.registry
  });

  if (selectedQuestions.length === 0) {
    session = await saveEvaluationState(services.store, sessionId, {
      candidates,
      eliminatedNodes,
      round: nextRound,
      status: "fallback",
      debounceExpiresAt: new Date(Date.now() + services.config.sessionDebounceMs).toISOString(),
      parserOutput: {
        unparsed: parsedUnparsed ?? session.parserOutput?.unparsed ?? []
      }
    });
    await appendEntry(services.store, sessionId, "FALLBACK_TRIGGERED", {
      round: nextRound,
      reason: "no_useful_questions_remaining"
    });
    return {
      sessionId,
      round: session.round,
      result: buildFallbackResult({
        session,
        candidates,
        reason: "no_useful_questions_remaining"
      }),
      debug: {
        topCandidates: candidates.slice(0, 3),
        eliminatedNodes
      }
    };
  }

  session = await saveEvaluationState(services.store, sessionId, {
    candidates,
    eliminatedNodes,
    round: nextRound,
    status: "questioning",
    latestForm: form,
    debounceExpiresAt: new Date(Date.now() + services.config.sessionDebounceMs).toISOString(),
    parserOutput: {
      unparsed: parsedUnparsed ?? session.parserOutput?.unparsed ?? []
    }
  });
  await recordQuestionBatch(services.store, sessionId, selectedQuestions, nextRound);

  return {
    sessionId,
    round: session.round,
    form,
    debug: {
      topCandidates: candidates.slice(0, 3),
      eliminatedNodes
    }
  };
}

async function startDiagnosticSession(services, payload, options = {}) {
  if (!payload.patientId || !payload.text) {
    throw new Error("patientId and text are required");
  }

  const reusableSession = await findReusableSession(services.store, {
    patientId: payload.patientId,
    bodyRegion: payload.bodyRegion || "knee"
  });

  const parseResult = parseInitialText(payload.text, services.registry);
  let session;

  if (reusableSession) {
    session = reusableSession;
    await appendRawMessage(services.store, session.sessionId, payload.text);
    await upsertSymptoms(services.store, session.sessionId, parseResult.evidence, { source: "parser" });
    await appendEntry(services.store, session.sessionId, "SESSION_REUSED", { patientId: payload.patientId });
  } else {
    session = await createSession(services.store, {
      patientId: payload.patientId,
      bodyRegion: payload.bodyRegion || "knee",
      rawText: payload.text
    });
    await upsertSymptoms(services.store, session.sessionId, parseResult.evidence, { source: "parser" });
    await appendEntry(services.store, session.sessionId, "SESSION_CREATED", {
      patientId: payload.patientId,
      bodyRegion: payload.bodyRegion || "knee"
    });
  }

  await appendEntry(services.store, session.sessionId, "PARSE_MERGED", {
    unparsed: parseResult.unparsed,
    parsedKeys: Object.keys(parseResult.evidence)
  });

  return evaluateSession(services, session.sessionId, {
    parsedUnparsed: parseResult.unparsed,
    scorerOptions: options.scorerOptions || {}
  });
}

async function answerDiagnosticSession(services, payload, options = {}) {
  const session = await getSession(services.store, payload.sessionId);
  if (!session) {
    throw new Error(`Session ${payload.sessionId} not found`);
  }

  const questionResponses = payload.questionResponses
    ? mapQuestionResponsesToSymptoms({
        responses: payload.questionResponses,
        questions: services.registry.questionBank.questions,
        registry: services.registry
      })
    : {};
  const directAnswers = buildDirectSymptomUpdates(payload.answers);
  const mergedUpdates = {
    ...questionResponses,
    ...directAnswers
  };

  await upsertSymptoms(services.store, payload.sessionId, mergedUpdates, { source: "question" });
  await appendEntry(services.store, payload.sessionId, "ANSWERS_RECORDED", {
    keys: Object.keys(mergedUpdates)
  });

  return evaluateSession(services, payload.sessionId, {
    scorerOptions: options.scorerOptions || {}
  });
}

async function createServices({ registry, config }) {
  const store = await ensureStore(config.dataDir);
  return {
    config,
    registry,
    store
  };
}

function createRequestHandler(services) {
  return async function handleRequest(request, response) {
    try {
      let result;

      if (request.method === "POST" && request.url === "/session/start") {
        result = await startDiagnosticSession(services, await readRequestBody(request));
      } else if (request.method === "POST" && request.url === "/session/answer") {
        result = await answerDiagnosticSession(services, await readRequestBody(request));
      } else if (request.method === "GET" && request.url.startsWith("/session/") && request.url.endsWith("/ledger")) {
        const sessionId = request.url.split("/")[2];
        result = { sessionId, ledger: await getLedger(services.store, sessionId) };
      } else {
        const payload = jsonResponse(404, { error: "Not found" });
        response.writeHead(payload.statusCode, payload.headers);
        response.end(payload.body);
        return;
      }

      const payload = jsonResponse(200, result);
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
    } catch (error) {
      const payload = jsonResponse(400, {
        error: error.message
      });
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
    }
  };
}

function createServer(services) {
  return http.createServer(createRequestHandler(services));
}

module.exports = {
  answerDiagnosticSession,
  createRequestHandler,
  createServer,
  createServices,
  startDiagnosticSession
};
