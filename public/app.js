const DEMO_SAMPLES = {
  acl: "I twisted my knee playing football, felt a pop, it swelled that evening, and now it gives way.",
  meniscus: "My knee twisted while squatting, now the inner side hurts and it sometimes catches when I turn.",
  pfps: "The front of my knee has been hurting for weeks, worse with stairs and after sitting for a while.",
  oa: "My knee has been aching for months, stiff after rest, and it crackles when I go up stairs.",
  redflag: "My knee is hot and red, I have a fever, and it is getting hard to put weight on it.",
  trauma: "I had a major fall, the knee looks out of place, and I can barely stand on it."
};

const KNEE_LAUNCH_STORAGE_KEY = "diagnostic-engine:knee-launch";

const state = {
  currentQuestions: [],
  questionDrafts: {},
  questionIndex: 0,
  sessionId: null
};

const elements = {
  candidateDebug: document.getElementById("candidate-debug"),
  clarificationNotes: document.getElementById("clarification-notes"),
  complaintText: document.getElementById("complaint-text"),
  ledgerButton: document.getElementById("load-ledger"),
  ledgerOutput: document.getElementById("ledger-output"),
  metaRound: document.getElementById("meta-round"),
  metaSessionId: document.getElementById("meta-session-id"),
  metaStatus: document.getElementById("meta-status"),
  patientId: document.getElementById("patient-id"),
  questionForm: document.getElementById("question-form"),
  questionMessage: document.getElementById("question-message"),
  resetButton: document.getElementById("reset-demo"),
  resultBody: document.getElementById("result-body"),
  startButton: document.getElementById("start-button"),
  startForm: document.getElementById("start-form"),
  statusBanner: document.getElementById("status-banner"),
  workspaceSection: document.getElementById("workspace") || document.getElementById("demo")
};

function createPatientId() {
  return `demo_${Date.now().toString(36).slice(-6)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showStatus(message, tone = "neutral") {
  elements.statusBanner.hidden = !message;
  elements.statusBanner.textContent = message || "";
  elements.statusBanner.dataset.tone = tone;
}

function setBusy(isBusy) {
  elements.startButton.disabled = isBusy;
  elements.ledgerButton.disabled = isBusy || !state.sessionId;

  elements.questionForm.querySelectorAll("button, input, select, textarea").forEach((control) => {
    control.disabled = isBusy || control.dataset.defaultDisabled === "true";
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json"
    },
    ...options
  });

  const contentType = response.headers.get("content-type") || "";
  const rawPayload = await response.text();

  let payload = null;
  if (rawPayload) {
    try {
      payload = JSON.parse(rawPayload);
    } catch (error) {
      payload = null;
    }
  }

  if (!response.ok) {
    const fallbackMessage = contentType.includes("text/html")
      ? "The deployed API route returned an HTML page instead of JSON. The Vercel API endpoint is likely missing or not deployed yet."
      : rawPayload.slice(0, 160) || `Request failed with ${response.status}`;
    throw new Error(payload?.error || fallbackMessage);
  }

  if (!payload) {
    throw new Error("The API returned a non-JSON response.");
  }

  return payload;
}

function scrollWorkspaceIntoView() {
  elements.workspaceSection.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function renderMeta(session) {
  elements.metaSessionId.textContent = session?.sessionId || "Not started";
  elements.metaStatus.textContent = session?.status || "Idle";
  elements.metaRound.textContent = String(session?.round ?? 0);
  state.sessionId = session?.sessionId || null;
  elements.ledgerButton.disabled = !state.sessionId;
}

function renderClarificationNotes(notes = []) {
  if (!notes.length) {
    elements.clarificationNotes.innerHTML = "";
    return;
  }

  elements.clarificationNotes.innerHTML = notes
    .map((note) => `<div class="note-item">${escapeHtml(note)}</div>`)
    .join("");
}

function renderQuestionInput(question, value) {
  if (question.type === "scale_0_5") {
    const options = Array.from(
      { length: 6 },
      (_, optionValue) => `<option value="${optionValue}" ${Number(value) === optionValue ? "selected" : ""}>${optionValue}</option>`
    ).join("");
    const labels = (question.scaleLabels || []).join(" / ");

    return `
      <label class="field field-compact">
        <span class="field-hint">${escapeHtml(labels || "0 means none and 5 means dominant or severe.")}</span>
        <select name="${escapeHtml(question.id)}" required>
          ${options}
        </select>
      </label>
    `;
  }

  const inputType = question.type === "multi_select" ? "checkbox" : "radio";
  const required = question.type === "multi_select" ? "" : "required";

  return `
    <div class="choice-group">
      ${(question.options || [])
        .map(
          (option) => `
            <label class="choice-chip">
              <input
                type="${inputType}"
                name="${escapeHtml(question.id)}"
                value="${escapeHtml(option.id)}"
                ${required}
                ${Array.isArray(value) ? (value.includes(option.id) ? "checked" : "") : value === option.id ? "checked" : ""}
              />
              <span>${escapeHtml(option.label)}</span>
            </label>
          `
        )
        .join("")}
    </div>
  `;
}

function renderQuestionStep() {
  const question = state.currentQuestions[state.questionIndex];
  if (!question) {
    elements.questionForm.innerHTML = '<div class="empty-state">No active question batch yet.</div>';
    return;
  }

  const savedValue = state.questionDrafts[question.id];
  const isLastQuestion = state.questionIndex === state.currentQuestions.length - 1;
  const progressLabel = `Question ${state.questionIndex + 1} of ${state.currentQuestions.length}`;

  elements.questionForm.innerHTML = `
    <section class="question-block question-block-active">
      <div class="question-head">
        <div class="question-head-copy">
          <span class="step-index">${escapeHtml(progressLabel)}</span>
          <strong>${escapeHtml(question.text)}</strong>
        </div>
        <span>${escapeHtml(question.phase)}</span>
      </div>
      ${question.clarification ? '<p class="question-note">This question is clarifying something the parser marked as tentative.</p>' : ""}
      ${renderQuestionInput(question, savedValue)}
    </section>
    <div class="question-nav">
      <button
        class="button secondary"
        type="button"
        data-question-nav="prev"
        data-default-disabled="${state.questionIndex === 0 ? "true" : "false"}"
        ${state.questionIndex === 0 ? "disabled" : ""}
      >Previous</button>
      <button class="button primary" type="submit" data-default-disabled="false">${isLastQuestion ? "Submit answers" : "Next question"}</button>
    </div>
  `;
}

function renderQuestions(form) {
  state.currentQuestions = form?.questions || [];
  state.questionDrafts = {};
  state.questionIndex = 0;
  elements.questionMessage.textContent = form?.message || "Start a session to see the interview prompt.";
  renderClarificationNotes(form?.clarificationNotes || []);

  if (!state.currentQuestions.length) {
    elements.questionForm.innerHTML = '<div class="empty-state">No active question batch yet.</div>';
    return;
  }

  renderQuestionStep();
}

function renderCandidateDebug(candidates = []) {
  if (!candidates.length) {
    elements.candidateDebug.className = "candidate-list empty-state";
    elements.candidateDebug.textContent = "No candidate state yet.";
    return;
  }

  elements.candidateDebug.className = "candidate-list";
  elements.candidateDebug.innerHTML = candidates
    .map(
      (candidate) => `
        <article class="candidate-card">
          <div class="candidate-head">
            <div>
              <strong>${escapeHtml(candidate.diseaseName || candidate.diseaseId)}</strong>
              <p>Stage: ${escapeHtml(candidate.stage || "n/a")} | Band: ${escapeHtml(candidate.band || "n/a")}</p>
            </div>
            <span class="candidate-score">${escapeHtml(String(candidate.score ?? candidate.matchScore ?? ""))}${typeof candidate.score === "number" ? "%" : ""}</span>
          </div>
          <p>Supports: ${escapeHtml((candidate.strongestSupports || []).join(", ") || "none")}</p>
          <p>Penalties: ${escapeHtml((candidate.strongestPenalties || []).join(", ") || "none")}</p>
        </article>
      `
    )
    .join("");
}

function renderCandidateResult(result) {
  return `
    <p class="result-summary">${escapeHtml(result.message)}</p>
    <div class="candidate-list">
      ${result.candidates
        .map(
          (candidate) => `
            <article class="candidate-card emphasis">
              <div class="candidate-head">
                <div>
                  <strong>${escapeHtml(candidate.diseaseName)}</strong>
                  <p>Stage: ${escapeHtml(candidate.stage)} | Fit score, not diagnosis.</p>
                </div>
                <span class="candidate-score">${escapeHtml(candidate.matchScore)}</span>
              </div>
              <p>Strongest supports: ${escapeHtml(candidate.strongestSupports.join(", ") || "none")}</p>
              <p>Strongest penalties: ${escapeHtml(candidate.strongestPenalties.join(", ") || "none")}</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderResult(result) {
  if (!result) {
    elements.resultBody.className = "result-body empty-state";
    elements.resultBody.textContent = "No result yet.";
    return;
  }

  if (result.type === "candidates") {
    elements.resultBody.className = "result-body";
    elements.resultBody.innerHTML = renderCandidateResult(result);
    return;
  }

  if (result.type === "fallback") {
    elements.resultBody.className = "result-body result-warning";
    elements.resultBody.innerHTML = `<p>${escapeHtml(result.message || "The engine could not reach a confident structured fit.")}</p>`;
    return;
  }

  if (result.type === "escalation") {
    elements.resultBody.className = "result-body result-danger";
    elements.resultBody.innerHTML = `
      <p>${escapeHtml(result.message)}</p>
      <p>Reasons: ${escapeHtml((result.reasons || []).join(", "))}</p>
    `;
    return;
  }

  elements.resultBody.className = "result-body";
  elements.resultBody.innerHTML = `<pre class="ledger-payload">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
}

function readQuestionResponse(question) {
  if (question.type === "scale_0_5") {
    const select = elements.questionForm.querySelector(`[name="${CSS.escape(question.id)}"]`);
    return Number(select?.value || 0);
  }

  if (question.type === "multi_select") {
    return [...elements.questionForm.querySelectorAll(`[name="${CSS.escape(question.id)}"]:checked`)].map((input) => input.value);
  }

  const selected = elements.questionForm.querySelector(`[name="${CSS.escape(question.id)}"]:checked`);
  return selected?.value || "";
}

function persistCurrentQuestionResponse({ requireValue = false } = {}) {
  const question = state.currentQuestions[state.questionIndex];
  if (!question) {
    return true;
  }

  const response = readQuestionResponse(question);
  const isEmptyArray = Array.isArray(response) && response.length === 0;
  const isMissing = response === "" || response == null || isEmptyArray;

  if (requireValue && question.type !== "multi_select" && isMissing) {
    showStatus("Answer the current follow-up question before continuing.", "warning");
    return false;
  }

  if (!isMissing || question.type === "multi_select") {
    state.questionDrafts[question.id] = response;
  }

  return true;
}

function goToPreviousQuestion() {
  persistCurrentQuestionResponse();
  if (state.questionIndex === 0) {
    return;
  }

  state.questionIndex -= 1;
  renderQuestionStep();
}

function formatLedgerType(type) {
  return String(type || "")
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function summarizeLedgerEntry(entry) {
  switch (entry.type) {
    case "SESSION_CREATED":
      return "Started a new session and initialized the interview state.";
    case "SESSION_REUSED":
      return "Reused an in-progress session within the debounce window.";
    case "PARSE_MERGED":
      return `Merged ${entry.payload?.parsedKeys?.length || 0} parsed evidence keys from the free-text complaint.`;
    case "ROUND_COMPLETE":
      return "Scored the live shortlist and updated the current round.";
    case "ANSWERS_RECORDED":
      return `Merged ${entry.payload?.keys?.length || 0} explicit answer updates into the session state.`;
    case "CANDIDATE_FLAGGED":
      return "A confident candidate band was reached.";
    case "FALLBACK_TRIGGERED":
      return "The engine stopped with a bounded fallback instead of over-claiming certainty.";
    case "SAFETY_ESCALATED":
      return "Safety logic interrupted the ranking loop and escalated the result.";
    default:
      return "Recorded a session event.";
  }
}

function formatTimestamp(value) {
  if (!value) {
    return "";
  }

  try {
    return new Date(value).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short"
    });
  } catch (error) {
    return value;
  }
}

function renderLedger(entries = []) {
  if (!entries.length) {
    elements.ledgerOutput.className = "ledger-list empty-state";
    elements.ledgerOutput.textContent = "Ledger not loaded.";
    return;
  }

  elements.ledgerOutput.className = "ledger-list";
  elements.ledgerOutput.innerHTML = entries
    .map(
      (entry) => `
        <article class="ledger-entry">
          <div class="ledger-head">
            <div>
              <strong>${escapeHtml(formatLedgerType(entry.type))}</strong>
              <p>${escapeHtml(summarizeLedgerEntry(entry))}</p>
            </div>
            <span class="micro-label">${escapeHtml(formatTimestamp(entry.at))}</span>
          </div>
          <details>
            <summary>Inspect payload</summary>
            <pre class="ledger-payload">${escapeHtml(JSON.stringify(entry.payload || {}, null, 2))}</pre>
          </details>
        </article>
      `
    )
    .join("");
}

async function handleEngineResponse(payload, { scroll = false } = {}) {
  renderMeta(payload.session);
  renderQuestions(payload.form || payload.session?.latestForm || null);
  renderResult(payload.result || null);
  renderCandidateDebug(payload.debug?.topCandidates || payload.session?.topCandidates || []);

  if (scroll) {
    scrollWorkspaceIntoView();
  }

  if (payload.result?.type === "candidates") {
    showStatus("The engine reached a shortlist. You can inspect the live candidate state or refresh the ledger.", "success");
  } else if (payload.result?.type === "fallback") {
    showStatus("The engine stopped in its fallback path instead of pretending confidence it did not have.", "warning");
  } else if (payload.result?.type === "escalation") {
    showStatus("Safety escalation triggered. This is the intended behavior for urgent or unsafe patterns.", "danger");
  } else if (payload.form) {
    showStatus("The next follow-up question is ready. Continue through the prompts one at a time.", "neutral");
  }
}

async function submitSessionStart({ patientId, text, scroll = true } = {}) {
  if (!text) {
    showStatus("Enter a knee complaint to start the guided check.", "warning");
    return;
  }

  setBusy(true);
  showStatus("Starting guided check...", "neutral");
  renderLedger([]);

  try {
    const payload = await requestJson("/api/session/start", {
      method: "POST",
      body: JSON.stringify({
        bodyRegion: "knee",
        patientId: patientId?.trim() || createPatientId(),
        text
      })
    });

    elements.patientId.value = payload.session?.patientId || patientId?.trim() || createPatientId();
    elements.complaintText.value = text;
    await handleEngineResponse(payload, { scroll });
  } catch (error) {
    showStatus(error.message, "danger");
  } finally {
    setBusy(false);
  }
}

async function startSession(event) {
  event.preventDefault();
  await submitSessionStart({
    patientId: elements.patientId.value.trim(),
    text: elements.complaintText.value.trim(),
    scroll: true
  });
}

async function answerQuestions(event) {
  event.preventDefault();
  if (!state.sessionId || !state.currentQuestions.length) {
    return;
  }

  if (!persistCurrentQuestionResponse({ requireValue: true })) {
    return;
  }

  if (state.questionIndex < state.currentQuestions.length - 1) {
    state.questionIndex += 1;
    renderQuestionStep();
    showStatus(`Continue with question ${state.questionIndex + 1} of ${state.currentQuestions.length}.`, "neutral");
    return;
  }

  setBusy(true);
  showStatus("Submitting answers...", "neutral");

  try {
    const payload = await requestJson("/api/session/answer", {
      method: "POST",
      body: JSON.stringify({
        sessionId: state.sessionId,
        questionResponses: state.questionDrafts
      })
    });

    await handleEngineResponse(payload);
  } catch (error) {
    showStatus(error.message, "danger");
  } finally {
    setBusy(false);
  }
}

async function loadLedger() {
  if (!state.sessionId) {
    return;
  }

  setBusy(true);
  showStatus("Refreshing ledger...", "neutral");

  try {
    const payload = await requestJson(`/api/session/ledger?sessionId=${encodeURIComponent(state.sessionId)}`);
    renderLedger(payload.ledger || []);
    showStatus("Ledger refreshed.", "success");
  } catch (error) {
    showStatus(error.message, "danger");
  } finally {
    setBusy(false);
  }
}

function resetDemo() {
  state.currentQuestions = [];
  state.questionDrafts = {};
  state.questionIndex = 0;
  state.sessionId = null;
  elements.startForm.reset();
  elements.patientId.value = createPatientId();
  elements.questionForm.innerHTML = "";
  elements.questionMessage.textContent = "Start a session to see the interview prompt.";
  elements.clarificationNotes.innerHTML = "";
  elements.resultBody.className = "result-body empty-state";
  elements.resultBody.textContent = "No result yet.";
  elements.candidateDebug.className = "candidate-list empty-state";
  elements.candidateDebug.textContent = "No candidate state yet.";
  renderLedger([]);
  renderMeta(null);
  showStatus("", "neutral");
}

function fillSample(sampleId, { scroll = true } = {}) {
  const sample = DEMO_SAMPLES[sampleId];
  if (!sample) {
    return;
  }

  elements.complaintText.value = sample;
  if (!elements.patientId.value.trim()) {
    elements.patientId.value = createPatientId();
  }

  if (scroll) {
    scrollWorkspaceIntoView();
  }
}

function bindSamples() {
  document.querySelectorAll("[data-sample]").forEach((button) => {
    button.addEventListener("click", () => {
      fillSample(button.dataset.sample);
    });
  });
}

function consumeLaunchPayload() {
  const rawPayload = sessionStorage.getItem(KNEE_LAUNCH_STORAGE_KEY);
  if (!rawPayload) {
    return null;
  }

  sessionStorage.removeItem(KNEE_LAUNCH_STORAGE_KEY);

  try {
    return JSON.parse(rawPayload);
  } catch (error) {
    return null;
  }
}

async function applyLaunchPayload() {
  const payload = consumeLaunchPayload();
  if (!payload) {
    return;
  }

  const patientId = payload.patientId?.trim() || createPatientId();
  const text = payload.text?.trim() || "";

  elements.patientId.value = patientId;
  elements.complaintText.value = text;

  if (!payload.autoStart || !text) {
    return;
  }

  await submitSessionStart({
    patientId,
    text,
    scroll: false
  });
}

function init() {
  elements.patientId.value = createPatientId();
  elements.startForm.addEventListener("submit", startSession);
  elements.questionForm.addEventListener("submit", answerQuestions);
  elements.questionForm.addEventListener("click", (event) => {
    const target = event.target.closest("[data-question-nav='prev']");
    if (!target) {
      return;
    }

    goToPreviousQuestion();
  });
  elements.ledgerButton.addEventListener("click", loadLedger);
  elements.resetButton.addEventListener("click", resetDemo);
  bindSamples();
  renderLedger([]);
  void applyLaunchPayload();
}

init();
