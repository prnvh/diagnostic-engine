const DEMO_SAMPLES = {
  acl: "I twisted my knee playing football, felt a pop, it swelled that evening, and now it gives way.",
  meniscus: "My knee twisted while squatting, now the inner side hurts and it sometimes catches when I turn.",
  redflag: "My knee is hot and red, I have a fever, and it is getting hard to put weight on it."
};

const state = {
  currentQuestions: [],
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
  statusBanner: document.getElementById("status-banner")
};

function createPatientId() {
  const stamp = Date.now().toString(36).slice(-6);
  return `demo_${stamp}`;
}

function setBusy(isBusy) {
  elements.startButton.disabled = isBusy;
  elements.ledgerButton.disabled = isBusy || !state.sessionId;
  const submitButton = elements.questionForm.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = isBusy;
  }
}

function showStatus(message, tone = "neutral") {
  elements.statusBanner.hidden = !message;
  elements.statusBanner.textContent = message || "";
  elements.statusBanner.dataset.tone = tone;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json"
    },
    ...options
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return payload;
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

function renderQuestionInput(question) {
  if (question.type === "scale_0_5") {
    const options = Array.from({ length: 6 }, (_, value) => `<option value="${value}">${value}</option>`).join("");
    return `
      <label class="field compact">
        <span class="field-hint">${escapeHtml((question.scaleLabels || []).join(" / ")) || "0 means none, 5 means dominant or severe."}</span>
        <select name="${escapeHtml(question.id)}" required>
          ${options}
        </select>
      </label>
    `;
  }

  const controlType = question.type === "multi_select" ? "checkbox" : "radio";
  const required = question.type === "multi_select" ? "" : "required";

  return `
    <div class="choice-group ${question.type === "multi_select" ? "multi" : "single"}">
      ${(question.options || [])
        .map(
          (option) => `
            <label class="choice-chip">
              <input type="${controlType}" name="${escapeHtml(question.id)}" value="${escapeHtml(option.id)}" ${required} />
              <span>${escapeHtml(option.label)}</span>
            </label>
          `
        )
        .join("")}
    </div>
  `;
}

function renderQuestions(form) {
  state.currentQuestions = form?.questions || [];
  elements.questionMessage.textContent = form?.message || "No further questions queued.";
  renderClarificationNotes(form?.clarificationNotes || []);

  if (!state.currentQuestions.length) {
    elements.questionForm.innerHTML = '<div class="empty-state">No question form is active.</div>';
    return;
  }

  const questionMarkup = state.currentQuestions
    .map(
      (question) => `
        <section class="question-block">
          <div class="question-head">
            <strong>${escapeHtml(question.text)}</strong>
            <span>${escapeHtml(question.phase)}</span>
          </div>
          ${question.clarification ? '<p class="question-note">This is being asked to clarify something the parser only inferred tentatively.</p>' : ""}
          ${renderQuestionInput(question)}
        </section>
      `
    )
    .join("");

  elements.questionForm.innerHTML = `${questionMarkup}<button class="primary-button" type="submit">Submit answers</button>`;
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
            <strong>${escapeHtml(candidate.diseaseName || candidate.diseaseId)}</strong>
            <span>${escapeHtml(String(candidate.score ?? candidate.matchScore ?? ""))}${typeof candidate.score === "number" ? "%" : ""}</span>
          </div>
          <p>Stage: ${escapeHtml(candidate.stage || "n/a")} · Band: ${escapeHtml(candidate.band || "n/a")}</p>
          <p>Supports: ${escapeHtml((candidate.strongestSupports || []).join(", ") || "none")}</p>
          <p>Penalties: ${escapeHtml((candidate.strongestPenalties || []).join(", ") || "none")}</p>
        </article>
      `
    )
    .join("");
}

function renderResult(result) {
  if (!result) {
    elements.resultBody.className = "result-body empty-state";
    elements.resultBody.textContent = "No result yet.";
    return;
  }

  if (result.type === "candidates") {
    elements.resultBody.className = "result-body";
    elements.resultBody.innerHTML = `
      <p class="result-summary">${escapeHtml(result.message)}</p>
      <div class="candidate-list">
        ${result.candidates
          .map(
            (candidate) => `
              <article class="candidate-card emphasis">
                <div class="candidate-head">
                  <strong>${escapeHtml(candidate.diseaseName)}</strong>
                  <span>${escapeHtml(candidate.matchScore)}</span>
                </div>
                <p>Stage: ${escapeHtml(candidate.stage)}</p>
                <p>Supports: ${escapeHtml(candidate.strongestSupports.join(", ") || "none")}</p>
                <p>Penalties: ${escapeHtml(candidate.strongestPenalties.join(", ") || "none")}</p>
              </article>
            `
          )
          .join("")}
      </div>
    `;
    return;
  }

  if (result.type === "fallback") {
    elements.resultBody.className = "result-body result-warning";
    elements.resultBody.innerHTML = `<p>${escapeHtml(result.message || "The engine could not confidently narrow this case.")}</p>`;
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
  elements.resultBody.textContent = JSON.stringify(result, null, 2);
}

function collectQuestionResponses() {
  const responses = {};

  for (const question of state.currentQuestions) {
    if (question.type === "scale_0_5") {
      const select = elements.questionForm.querySelector(`[name="${CSS.escape(question.id)}"]`);
      responses[question.id] = Number(select?.value || 0);
      continue;
    }

    if (question.type === "multi_select") {
      const checked = [...elements.questionForm.querySelectorAll(`[name="${CSS.escape(question.id)}"]:checked`)].map((input) => input.value);
      responses[question.id] = checked;
      continue;
    }

    const selected = elements.questionForm.querySelector(`[name="${CSS.escape(question.id)}"]:checked`);
    responses[question.id] = selected?.value || "";
  }

  return responses;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function handleEngineResponse(payload) {
  renderMeta(payload.session);
  renderQuestions(payload.form || payload.session?.latestForm || null);
  renderResult(payload.result || null);
  renderCandidateDebug(payload.debug?.topCandidates || payload.session?.topCandidates || []);

  if (payload.result?.type === "candidates") {
    showStatus("Candidate shortlist generated. You can inspect the ledger or reset to start a new demo.", "success");
  } else if (payload.result?.type === "fallback") {
    showStatus("The engine hit its bounded fallback path instead of over-claiming confidence.", "warning");
  } else if (payload.result?.type === "escalation") {
    showStatus("Safety escalation triggered. This is the intended behavior for red-flag patterns.", "danger");
  } else if (payload.form) {
    showStatus("Session updated. Answer the next question batch to continue.", "neutral");
  }
}

async function startSession(event) {
  event.preventDefault();
  setBusy(true);
  showStatus("Starting session...", "neutral");

  try {
    const payload = await requestJson("/api/session/start", {
      method: "POST",
      body: JSON.stringify({
        bodyRegion: "knee",
        patientId: elements.patientId.value.trim() || createPatientId(),
        text: elements.complaintText.value.trim()
      })
    });

    elements.patientId.value = payload.session?.patientId || elements.patientId.value.trim() || createPatientId();
    await handleEngineResponse(payload);
  } catch (error) {
    showStatus(error.message, "danger");
  } finally {
    setBusy(false);
  }
}

async function answerQuestions(event) {
  event.preventDefault();
  if (!state.sessionId || !state.currentQuestions.length) {
    return;
  }

  setBusy(true);
  showStatus("Submitting answers...", "neutral");

  try {
    const payload = await requestJson("/api/session/answer", {
      method: "POST",
      body: JSON.stringify({
        sessionId: state.sessionId,
        questionResponses: collectQuestionResponses()
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
  showStatus("Loading ledger...", "neutral");

  try {
    const payload = await requestJson(`/api/session/${encodeURIComponent(state.sessionId)}/ledger`);
    elements.ledgerOutput.className = "ledger-output";
    elements.ledgerOutput.textContent = JSON.stringify(payload.ledger, null, 2);
    showStatus("Ledger loaded.", "success");
  } catch (error) {
    showStatus(error.message, "danger");
  } finally {
    setBusy(false);
  }
}

function resetDemo() {
  state.currentQuestions = [];
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
  elements.ledgerOutput.className = "ledger-output empty-state";
  elements.ledgerOutput.textContent = "Ledger not loaded.";
  renderMeta(null);
  showStatus("", "neutral");
}

function bindSamples() {
  document.querySelectorAll("[data-sample]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.complaintText.value = DEMO_SAMPLES[button.dataset.sample] || "";
      if (!elements.patientId.value.trim()) {
        elements.patientId.value = createPatientId();
      }
    });
  });
}

function init() {
  elements.patientId.value = createPatientId();
  elements.startForm.addEventListener("submit", startSession);
  elements.questionForm.addEventListener("submit", answerQuestions);
  elements.ledgerButton.addEventListener("click", loadLedger);
  elements.resetButton.addEventListener("click", resetDemo);
  bindSamples();
}

init();
