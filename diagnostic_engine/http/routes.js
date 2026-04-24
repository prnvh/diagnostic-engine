const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { appendEntry, getLedger } = require("../storage/ledger");
const {
  appendRawMessage,
  createSession,
  findReusableSession,
  getSession,
  recordQuestionBatch,
  saveEvaluationState,
  upsertSymptoms
} = require("../storage/session");
const { createStore } = require("../storage/store");
const { compileQuestionForm, mapQuestionResponsesToSymptoms } = require("../core/engine/compiler");
const { buildFallbackResult } = require("../core/engine/fallback");
const { parseInitialComplaint } = require("../core/engine/intake-parser");
const { scoreCandidates } = require("../core/engine/scorer");
const { selectQuestions } = require("../core/engine/selector");
const { evaluateSafety } = require("../core/engine/safety");

const STATIC_CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function buildJsonHeaders(extraHeaders = {}) {
  return {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders
  };
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    body: JSON.stringify(payload, null, 2),
    headers: buildJsonHeaders()
  };
}

function emptyResponse(statusCode = 204) {
  return {
    statusCode,
    body: "",
    headers: buildJsonHeaders()
  };
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error("Request body must be valid JSON");
  }
}

function getRequestUrl(request) {
  return new URL(request.url, `http://${request.headers.host || "localhost"}`);
}

function getPathname(request) {
  return getRequestUrl(request).pathname;
}

function normalizeApiPath(pathname) {
  if (!pathname.startsWith("/api")) {
    return pathname;
  }

  const normalized = pathname.slice(4);
  return normalized || "/";
}

function isWithinDirectory(rootDirectory, filePath) {
  const relativePath = path.relative(rootDirectory, filePath);
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
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

function buildCandidateSummary(candidate) {
  return {
    diseaseId: candidate.diseaseId,
    diseaseName: candidate.diseaseName,
    matchScore: `${candidate.score}%`,
    score: candidate.score,
    stage: candidate.bestStage,
    band: candidate.band,
    hardBlocked: candidate.hardBlocked,
    strongestSupports: candidate.supports.slice(0, 3).map((support) => support.key),
    strongestPenalties: candidate.penalties.slice(0, 2).map((penalty) => penalty.key)
  };
}

function buildParserOutput(parserOutput = {}, overrides = {}) {
  const merged = {
    ...parserOutput,
    ...overrides
  };

  return {
    unparsed: Array.isArray(merged.unparsed) ? merged.unparsed : [],
    mode: typeof merged.mode === "string" && merged.mode ? merged.mode : null,
    summary: typeof merged.summary === "string" ? merged.summary : "",
    evidencePreview: Array.isArray(merged.evidencePreview) ? merged.evidencePreview : [],
    warning: typeof merged.warning === "string" && merged.warning.trim() ? merged.warning.trim() : null
  };
}

function getPresentedQuestionRounds(session) {
  if (!session || !Array.isArray(session.questionLog)) {
    return 0;
  }

  return session.questionLog.length;
}

function getAnsweredQuestionRounds(session) {
  const presentedQuestionRounds = getPresentedQuestionRounds(session);
  if (session?.latestForm) {
    return Math.max(presentedQuestionRounds - 1, 0);
  }

  return presentedQuestionRounds;
}

function buildSessionSnapshot(session, config = {}) {
  const presentedQuestionRounds = getPresentedQuestionRounds(session);
  const answeredQuestionRounds = getAnsweredQuestionRounds(session);
  const minimumQuestionRoundsBeforeCandidates = Math.max(config.minQuestionRoundsBeforeCandidates || 1, 1);

  return {
    sessionId: session.sessionId,
    patientId: session.patientId,
    bodyRegion: session.bodyRegion,
    status: session.status,
    round: session.round,
    completedQuestionRounds: answeredQuestionRounds,
    answeredQuestionRounds,
    presentedQuestionRounds,
    minimumQuestionRoundsBeforeCandidates,
    remainingQuestionRoundsBeforeCandidates: Math.max(minimumQuestionRoundsBeforeCandidates - answeredQuestionRounds, 0),
    latestForm: session.latestForm || null,
    parserOutput: buildParserOutput(session.parserOutput),
    questionLog: session.questionLog || [],
    topCandidates: (session.candidates || []).slice(0, 3).map(buildCandidateSummary),
    ledgerPath: `/api/session/ledger?sessionId=${encodeURIComponent(session.sessionId)}`,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function buildCandidateResult(session, candidates) {
  const visibleCandidates = candidates.filter((candidate) => !candidate.hardBlocked);
  return {
    type: "candidates",
    sessionId: session.sessionId,
    message:
      "After the intake story and guided form rounds, these conditions fit the current evidence most strongly. This is a fit score, not a diagnosis.",
    candidates: visibleCandidates.map(buildCandidateSummary)
  };
}

async function evaluateSession(services, sessionId, { parsedUnparsed = null, scorerOptions = {} } = {}) {
  let session = await getSession(services.store, sessionId);
  const nextRound = session.round + 1;
  const parserOutput = buildParserOutput(session.parserOutput, {
    unparsed: parsedUnparsed ?? session.parserOutput?.unparsed ?? []
  });

  const safety = evaluateSafety(session.symptomState);
  if (safety.escalated) {
    session = await saveEvaluationState(services.store, sessionId, {
      status: "escalated",
      latestForm: null,
      round: nextRound,
      debounceExpiresAt: new Date(Date.now() + services.config.sessionDebounceMs).toISOString(),
      parserOutput
    });
    await appendEntry(services.store, sessionId, "SAFETY_ESCALATED", { reasons: safety.reasons });
    return {
      sessionId,
      round: session.round,
      session: buildSessionSnapshot(session, services.config),
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

  const completedQuestionRounds = getPresentedQuestionRounds(session);
  const minQuestionRoundsBeforeCandidates = Math.max(services.config.minQuestionRoundsBeforeCandidates || 1, 1);
  const enoughQuestionRoundsCompleted = completedQuestionRounds >= minQuestionRoundsBeforeCandidates;
  const effectiveMaxRounds = Math.max(services.config.maxRounds, minQuestionRoundsBeforeCandidates, 1) + 1;
  const confidentCandidates = candidates.filter((candidate) => !candidate.hardBlocked && candidate.score >= 80);
  const carryForwardCandidates = (session.candidates || [])
    .filter((candidate) => !candidate.hardBlocked && candidate.score >= 80)
    .map((candidate) => candidates.find((currentCandidate) => currentCandidate.diseaseId === candidate.diseaseId))
    .filter((candidate) => candidate && !candidate.hardBlocked && candidate.score >= 60);
  const presentableCandidates = enoughQuestionRoundsCompleted
    ? confidentCandidates.length > 0
      ? confidentCandidates
      : carryForwardCandidates
    : [];

  if (presentableCandidates.length > 0) {
    session = await saveEvaluationState(services.store, sessionId, {
      candidates,
      eliminatedNodes,
      latestForm: null,
      round: nextRound,
      status: "complete",
      debounceExpiresAt: new Date(Date.now() + services.config.sessionDebounceMs).toISOString(),
      parserOutput
    });
    await appendEntry(services.store, sessionId, "CANDIDATE_FLAGGED", {
      round: nextRound,
      candidates: presentableCandidates.map((candidate) => candidate.diseaseId),
      source: confidentCandidates.length > 0 ? "current_round_confident" : "validated_initial_shortlist"
    });
    return {
      sessionId,
      round: session.round,
      session: buildSessionSnapshot(session, services.config),
      result: buildCandidateResult(session, presentableCandidates),
      debug: {
        topCandidates: candidates.slice(0, 3),
        eliminatedNodes
      }
    };
  }

  if (nextRound >= effectiveMaxRounds) {
    session = await saveEvaluationState(services.store, sessionId, {
      candidates,
      eliminatedNodes,
      latestForm: null,
      round: nextRound,
      status: "fallback",
      debounceExpiresAt: new Date(Date.now() + services.config.sessionDebounceMs).toISOString(),
      parserOutput
    });
    await appendEntry(services.store, sessionId, "FALLBACK_TRIGGERED", {
      round: nextRound,
      reason: "max_rounds_without_confident_candidate"
    });
    return {
      sessionId,
      round: session.round,
      session: buildSessionSnapshot(session, services.config),
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
    limit: 1,
    requireExplicitConfirmation: completedQuestionRounds < 2
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
      latestForm: null,
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
      session: buildSessionSnapshot(session),
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
    parserOutput
  });
  await recordQuestionBatch(services.store, sessionId, selectedQuestions, nextRound);

  session = await getSession(services.store, sessionId);
  return {
    sessionId,
    round: session.round,
    session: buildSessionSnapshot(session, services.config),
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

  const parseResult = await parseInitialComplaint({
    text: payload.text,
    registry: services.registry,
    config: services.config
  });
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
    parsedKeys: Object.keys(parseResult.evidence),
    mode: parseResult.mode,
    summary: parseResult.summary,
    warning: parseResult.warning || null
  });

  await saveEvaluationState(services.store, session.sessionId, {
    parserOutput: buildParserOutput(parseResult)
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
  const store = await createStore(config);
  return {
    config,
    registry,
    store
  };
}

async function tryServeStaticAsset(services, pathname, response) {
  if (pathname.startsWith("/api") || pathname.startsWith("/session") || pathname === "/health") {
    return false;
  }

  const webRoot = services.config.webDir;
  const assetPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidatePaths = [path.resolve(webRoot, assetPath)];

  if (!path.extname(assetPath)) {
    candidatePaths.push(path.resolve(webRoot, assetPath, "index.html"));
  }

  for (const filePath of candidatePaths) {
    if (!isWithinDirectory(webRoot, filePath) && filePath !== path.join(webRoot, "index.html")) {
      return false;
    }

    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }

      const contentType = STATIC_CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        "cache-control": contentType.includes("text/html") ? "no-store" : "public, max-age=600",
        "content-type": contentType
      });
      response.end(content);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return false;
}

function createRequestHandler(services) {
  return async function handleRequest(request, response) {
    const requestUrl = getRequestUrl(request);
    const pathname = requestUrl.pathname;
    const apiPath = normalizeApiPath(pathname);

    if (request.method === "OPTIONS") {
      const payload = emptyResponse();
      response.writeHead(payload.statusCode, payload.headers);
      response.end(payload.body);
      return;
    }

    if (await tryServeStaticAsset(services, pathname, response)) {
      return;
    }

    try {
      let result;
      const ledgerMatch = apiPath.match(/^\/session\/([^/]+)\/ledger$/);
      const sessionMatch = apiPath.match(/^\/session\/([^/]+)$/);
      const querySessionId = requestUrl.searchParams.get("sessionId");

      if (request.method === "GET" && (apiPath === "/health" || pathname === "/health")) {
        result = {
          ok: true,
          store: services.store.kind,
          scope: services.registry.bodyPart,
          diseaseCount: services.registry.diseases.length,
          questionCount: services.registry.questionBank.questions.length
        };
      } else if (request.method === "POST" && apiPath === "/session/start") {
        result = await startDiagnosticSession(services, await readRequestBody(request));
      } else if (request.method === "POST" && apiPath === "/session/answer") {
        result = await answerDiagnosticSession(services, await readRequestBody(request));
      } else if (request.method === "GET" && apiPath === "/session/ledger") {
        if (!querySessionId) {
          throw new Error("sessionId query parameter is required");
        }
        result = { sessionId: querySessionId, ledger: await getLedger(services.store, querySessionId) };
      } else if (request.method === "GET" && apiPath === "/session/get") {
        if (!querySessionId) {
          throw new Error("sessionId query parameter is required");
        }
        const session = await getSession(services.store, querySessionId);
        if (!session) {
          throw new Error(`Session ${querySessionId} not found`);
        }
        result = { session: buildSessionSnapshot(session, services.config) };
      } else if (request.method === "GET" && ledgerMatch) {
        const sessionId = decodeURIComponent(ledgerMatch[1]);
        result = { sessionId, ledger: await getLedger(services.store, sessionId) };
      } else if (request.method === "GET" && sessionMatch) {
        const sessionId = decodeURIComponent(sessionMatch[1]);
        const session = await getSession(services.store, sessionId);
        if (!session) {
          throw new Error(`Session ${sessionId} not found`);
        }
        result = { session: buildSessionSnapshot(session, services.config) };
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
