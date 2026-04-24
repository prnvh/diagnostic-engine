const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable, Writable } = require("node:stream");
const { pathToFileURL } = require("node:url");
const { buildConfig } = require("../runtime/config");
const { createServices, createRequestHandler } = require("../http/routes");
const { loadRegistry } = require("../core/registry/loader");

class MockRequest extends Readable {
  constructor(method, url, body = "") {
    super();
    this.method = method;
    this.url = url;
    this.headers = {
      host: "localhost"
    };
    this.#body = body;
  }

  #body;
  #sent = false;

  _read() {
    if (this.#sent) {
      this.push(null);
      return;
    }

    this.#sent = true;
    if (this.#body) {
      this.push(Buffer.from(this.#body));
    }
    this.push(null);
  }
}

class MockResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.body = Buffer.alloc(0);
    this.headersSent = false;
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    this.headers = {
      ...this.headers,
      ...normalizeHeaders(headers)
    };
    this.headersSent = true;
  }

  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = value;
  }

  _write(chunk, encoding, callback) {
    this.body = Buffer.concat([this.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)]);
    callback();
  }

  end(chunk) {
    if (chunk) {
      this.body = Buffer.concat([this.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    }
    this.headersSent = true;
    super.end();
  }
}

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [String(name).toLowerCase(), value]));
}

async function issueRequest(handler, { method = "GET", url = "/", body = null } = {}) {
  const payload = body == null ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const request = new MockRequest(method, url, payload);
  const response = new MockResponse();

  await handler(request, response);

  const rawBody = response.body.toString("utf8");
  const contentType = String(response.headers["content-type"] || "");
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    rawBody,
    json: rawBody && contentType.includes("application/json") ? JSON.parse(rawBody) : null
  };
}

async function loadModule(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  return import(pathToFileURL(absolutePath).href);
}

test("reorganized runtime keeps web, API routes, and Vercel shims connected", async () => {
  const directDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "diagnostic-engine-wiring-direct-"));
  const directServices = await createServices({
    registry: loadRegistry(),
    config: buildConfig({ dataDir: directDataDir, storeDriver: "file" })
  });
  const directHandler = createRequestHandler(directServices);

  const homepage = await issueRequest(directHandler, { url: "/" });
  assert.equal(homepage.statusCode, 200);
  assert.equal(homepage.headers["content-type"], "text/html; charset=utf-8");
  assert.match(homepage.rawBody, /Diagnostic Engine/i);

  const workspace = await issueRequest(directHandler, { url: "/knee/" });
  assert.equal(workspace.statusCode, 200);
  assert.match(workspace.rawBody, /knee workspace/i);

  const stylesheet = await issueRequest(directHandler, { url: "/styles.css" });
  assert.equal(stylesheet.statusCode, 200);
  assert.equal(stylesheet.headers["content-type"], "text/css; charset=utf-8");

  const health = await issueRequest(directHandler, { url: "/api/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json.ok, true);
  assert.equal(health.json.scope, "knee");

  const directStart = await issueRequest(directHandler, {
    method: "POST",
    url: "/api/session/start",
    body: {
      patientId: "wiring_direct",
      text: "I twisted my knee playing football, felt a pop, it swelled that evening, and now it gives way."
    }
  });
  assert.equal(directStart.statusCode, 200);
  assert.equal(directStart.json.round, 1);
  assert.equal(directStart.json.form.questions.length, 1);
  assert.equal(directStart.json.session.completedQuestionRounds, 0);
  assert.equal(directStart.json.session.presentedQuestionRounds, 1);
  assert.ok(directStart.json.session.parserOutput.summary.length > 0);

  const directSessionId = directStart.json.session.sessionId;
  const directGetByQuery = await issueRequest(directHandler, {
    url: `/api/session/get?sessionId=${encodeURIComponent(directSessionId)}`
  });
  assert.equal(directGetByQuery.statusCode, 200);
  assert.equal(directGetByQuery.json.session.sessionId, directSessionId);

  const directGetByPath = await issueRequest(directHandler, {
    url: `/api/session/${encodeURIComponent(directSessionId)}`
  });
  assert.equal(directGetByPath.statusCode, 200);
  assert.equal(directGetByPath.json.session.sessionId, directSessionId);

  const directLedgerByQuery = await issueRequest(directHandler, {
    url: `/api/session/ledger?sessionId=${encodeURIComponent(directSessionId)}`
  });
  assert.equal(directLedgerByQuery.statusCode, 200);
  assert.ok(directLedgerByQuery.json.ledger.length >= 2);

  const directLedgerByPath = await issueRequest(directHandler, {
    url: `/api/session/${encodeURIComponent(directSessionId)}/ledger`
  });
  assert.equal(directLedgerByPath.statusCode, 200);
  assert.ok(directLedgerByPath.json.ledger.length >= 2);

  const previousDataDir = process.env.DIAGNOSTIC_ENGINE_DATA_DIR;
  const previousStoreDriver = process.env.STORAGE_DRIVER;
  const shimDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "diagnostic-engine-wiring-shim-"));
  process.env.DIAGNOSTIC_ENGINE_DATA_DIR = shimDataDir;
  process.env.STORAGE_DRIVER = "file";

  try {
    const [{ default: webHandler }, { default: healthHandler }, { default: startHandler }, { default: answerHandler }, { default: getHandler }, { default: ledgerHandler }] =
      await Promise.all([
        loadModule("api/web.mjs"),
        loadModule("api/health.mjs"),
        loadModule("api/session/start.mjs"),
        loadModule("api/session/answer.mjs"),
        loadModule("api/session/get.mjs"),
        loadModule("api/session/ledger.mjs")
      ]);

    const shimHomepage = await issueRequest(webHandler, {
      url: "/api/web?path=/"
    });
    assert.equal(shimHomepage.statusCode, 200);
    assert.match(shimHomepage.rawBody, /Diagnostic Engine/i);

    const shimWorkspace = await issueRequest(webHandler, {
      url: "/api/web?path=/knee/"
    });
    assert.equal(shimWorkspace.statusCode, 200);
    assert.match(shimWorkspace.rawBody, /knee workspace/i);

    const shimHealth = await issueRequest(healthHandler, {
      url: "/api/health"
    });
    assert.equal(shimHealth.statusCode, 200);
    assert.equal(shimHealth.json.ok, true);

    let shimResponse = await issueRequest(startHandler, {
      method: "POST",
      url: "/api/session/start",
      body: {
        patientId: "wiring_shim",
        text: "I twisted my knee playing football, felt a pop, it swelled that evening, and now it gives way."
      }
    });
    assert.equal(shimResponse.statusCode, 200);
    assert.equal(shimResponse.json.round, 1);
    assert.equal(shimResponse.json.form.questions.length, 1);
    assert.equal(shimResponse.json.session.completedQuestionRounds, 0);
    assert.equal(shimResponse.json.session.presentedQuestionRounds, 1);
    assert.ok(shimResponse.json.session.parserOutput.summary.length > 0);

    const aclAnswers = {
      twisting_or_pivoting_mechanism: true,
      pop_at_injury: true,
      rapid_swelling_within_24h: true,
      instability_giving_way: 4,
      difficulty_with_pivoting_or_cutting: 4,
      unable_to_continue_activity_immediately: true,
      reduced_trust_in_knee: 4,
      timeline_lt_1_week: true
    };

    for (let index = 1; index <= 2; index += 1) {
      shimResponse = await issueRequest(answerHandler, {
        method: "POST",
        url: "/api/session/answer",
        body: {
          sessionId: shimResponse.json.sessionId,
          answers: aclAnswers
        }
      });

      assert.equal(shimResponse.statusCode, 200);
      assert.ok(shimResponse.json.form);
      assert.equal(shimResponse.json.form.questions.length, 1);
      assert.equal(shimResponse.json.result, undefined);
      assert.equal(shimResponse.json.session.completedQuestionRounds, index);
      assert.ok(shimResponse.json.session.parserOutput.summary.length > 0);
    }

    let answeredRounds = 2;
    while (shimResponse.json.form) {
      answeredRounds += 1;
      shimResponse = await issueRequest(answerHandler, {
        method: "POST",
        url: "/api/session/answer",
        body: {
          sessionId: shimResponse.json.sessionId,
          answers: aclAnswers
        }
      });

      assert.ok(answeredRounds <= 5);
      if (shimResponse.json.form) {
        assert.equal(shimResponse.json.form.questions.length, 1);
        assert.equal(shimResponse.json.result, undefined);
      }
    }

    assert.ok(answeredRounds >= 3);
    assert.equal(shimResponse.json.result.type, "candidates");
    assert.equal(shimResponse.json.result.candidates[0].diseaseId, "knee_acl_tear");
    assert.equal(shimResponse.json.session.completedQuestionRounds, answeredRounds);
    assert.ok(shimResponse.json.session.parserOutput.summary.length > 0);

    const shimSessionId = shimResponse.json.sessionId;
    const shimGet = await issueRequest(getHandler, {
      url: `/api/session/get?sessionId=${encodeURIComponent(shimSessionId)}`
    });
    assert.equal(shimGet.statusCode, 200);
    assert.equal(shimGet.json.session.sessionId, shimSessionId);

    const shimLedger = await issueRequest(ledgerHandler, {
      url: `/api/session/ledger?sessionId=${encodeURIComponent(shimSessionId)}`
    });
    assert.equal(shimLedger.statusCode, 200);
    assert.ok(shimLedger.json.ledger.some((entry) => entry.type === "SESSION_CREATED"));
    assert.ok(shimLedger.json.ledger.some((entry) => entry.type === "CANDIDATE_FLAGGED"));
  } finally {
    if (previousDataDir == null) {
      delete process.env.DIAGNOSTIC_ENGINE_DATA_DIR;
    } else {
      process.env.DIAGNOSTIC_ENGINE_DATA_DIR = previousDataDir;
    }

    if (previousStoreDriver == null) {
      delete process.env.STORAGE_DRIVER;
    } else {
      process.env.STORAGE_DRIVER = previousStoreDriver;
    }
  }
});
