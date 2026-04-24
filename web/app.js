const DEMO_SAMPLES = {
  acl: "I twisted my knee playing football, felt a pop, it swelled that evening, and now it gives way.",
  meniscus: "My knee twisted while squatting, now the inner side hurts and it sometimes catches when I turn.",
  pfps: "The front of my knee has been hurting for weeks, worse with stairs and after sitting for a while.",
  oa: "My knee has been aching for months, stiff after rest, and it crackles when I go up stairs.",
  redflag: "My knee is hot and red, I have a fever, and it is getting hard to put weight on it.",
  trauma: "I had a major fall, the knee looks out of place, and I can barely stand on it."
};

const KNEE_LAUNCH_STORAGE_KEY = "diagnostic-engine:knee-launch";
const STAGE_ORDER = ["intake", "forms", "outcome"];

const state = {
  currentForm: null,
  currentQuestion: null,
  latestCandidateResult: null,
  latestCandidateSession: null,
  sessionId: null
};

const elements = {
  candidateDebug: document.getElementById("candidate-debug"),
  candidateModal: document.getElementById("candidate-modal"),
  candidateModalClose: document.getElementById("candidate-modal-close"),
  candidateModalList: document.getElementById("candidate-modal-list"),
  candidateModalMessage: document.getElementById("candidate-modal-message"),
  candidateModalMeta: document.getElementById("candidate-modal-meta"),
  candidatePreviewCard: document.getElementById("candidate-preview-card"),
  candidatePreviewMessage: document.getElementById("candidate-preview-message"),
  complaintText: document.getElementById("complaint-text"),
  intakeParserMode: document.getElementById("intake-parser-mode"),
  intakeSignals: document.getElementById("intake-signals"),
  intakeStage: document.getElementById("intake-stage"),
  intakeSummary: document.getElementById("intake-summary"),
  intakeWarning: document.getElementById("intake-warning"),
  interviewStage: document.getElementById("interview-stage"),
  metaAnswered: document.getElementById("meta-answered"),
  metaRound: document.getElementById("meta-round"),
  metaSessionId: document.getElementById("meta-session-id"),
  metaStatus: document.getElementById("meta-status"),
  patientId: document.getElementById("patient-id"),
  questionForm: document.getElementById("question-form"),
  questionMessage: document.getElementById("question-message"),
  questionNote: document.getElementById("question-note"),
  questionNoteCard: document.getElementById("question-note-card"),
  questionProgress: document.getElementById("question-progress"),
  openLedgerPage: document.getElementById("open-ledger-page"),
  reopenShortlist: document.getElementById("reopen-shortlist"),
  resetButton: document.getElementById("reset-demo"),
  resultBody: document.getElementById("result-body"),
  resultChip: document.getElementById("result-chip"),
  resultStage: document.getElementById("result-stage"),
  stageMarkers: [...document.querySelectorAll("[data-stage-marker]")],
  startButton: document.getElementById("start-button"),
  startForm: document.getElementById("start-form"),
  statusBanner: document.getElementById("status-banner"),
  workspaceSection: document.getElementById("workspace")
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

function formatTitleCase(value) {
  return String(value || "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatParserMode(mode) {
  switch (mode) {
    case "llm":
      return "LLM assisted";
    case "rule":
      return "Rule based";
    case "rule_fallback":
      return "Rule fallback";
    default:
      return "Waiting";
  }
}

function showStatus(message, tone = "neutral") {
  elements.statusBanner.hidden = !message;
  elements.statusBanner.textContent = message || "";
  elements.statusBanner.dataset.tone = tone;
}

function setStage(stage) {
  const activeIndex = STAGE_ORDER.indexOf(stage);

  elements.intakeStage.hidden = stage !== "intake";
  elements.interviewStage.hidden = stage !== "forms";
  elements.resultStage.hidden = stage !== "outcome";

  for (const marker of elements.stageMarkers) {
    const markerIndex = STAGE_ORDER.indexOf(marker.dataset.stageMarker);
    let markerState = "upcoming";

    if (markerIndex < activeIndex) {
      markerState = "complete";
    } else if (markerIndex === activeIndex) {
      markerState = "active";
    }

    marker.dataset.state = markerState;
  }
}

function openCandidateModal() {
  if (!state.latestCandidateResult) {
    return;
  }

  elements.candidateModal.hidden = false;
  elements.candidateModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  elements.candidateModalClose.focus();
}

function closeCandidateModal() {
  elements.candidateModal.hidden = true;
  elements.candidateModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function clearCandidateModal() {
  state.latestCandidateResult = null;
  state.latestCandidateSession = null;
  elements.candidateModalMessage.textContent = "";
  elements.candidateModalMeta.innerHTML = "";
  elements.candidateModalList.innerHTML = "";
  closeCandidateModal();
}

function setBusy(isBusy) {
  elements.startForm.querySelectorAll("button, textarea, select").forEach((control) => {
    control.disabled = isBusy;
  });

  elements.questionForm.querySelectorAll("button, input, select, textarea").forEach((control) => {
    control.disabled = isBusy;
  });

  elements.resetButton.disabled = isBusy;
  elements.reopenShortlist.disabled = isBusy || !state.latestCandidateResult;
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
  state.sessionId = session?.sessionId || null;
  elements.metaSessionId.textContent = session?.sessionId || "Not started";
  elements.metaStatus.textContent = formatTitleCase(session?.status || "idle");
  elements.metaRound.textContent = String(session?.round ?? 0);

  const answered = session?.completedQuestionRounds ?? 0;
  const minimum = session?.minimumQuestionRoundsBeforeCandidates ?? 3;
  elements.metaAnswered.textContent = `${answered} of ${minimum}`;

  if (elements.openLedgerPage) {
    if (state.sessionId) {
      elements.openLedgerPage.href = `/knee/ledger/?sessionId=${encodeURIComponent(state.sessionId)}`;
      elements.openLedgerPage.removeAttribute("aria-disabled");
      elements.openLedgerPage.style.pointerEvents = "auto";
      elements.openLedgerPage.style.opacity = "1";
    } else {
      elements.openLedgerPage.href = "/knee/ledger/";
      elements.openLedgerPage.setAttribute("aria-disabled", "true");
      elements.openLedgerPage.style.pointerEvents = "none";
      elements.openLedgerPage.style.opacity = "0.58";
    }
  }
}

function renderParserOutput(parserOutput) {
  const mode = parserOutput?.mode || "";
  const summary =
    parserOutput?.summary?.trim() ||
    "Describe the knee problem in natural language. The intake parser will map the story into registry signals before the guided form begins.";
  const evidencePreview = Array.isArray(parserOutput?.evidencePreview) ? parserOutput.evidencePreview : [];

  elements.intakeParserMode.textContent = formatParserMode(mode);
  elements.intakeParserMode.dataset.mode = mode || "idle";
  elements.intakeSummary.textContent = summary;

  if (evidencePreview.length > 0) {
    elements.intakeSignals.className = "signal-cloud";
    elements.intakeSignals.innerHTML = evidencePreview
      .map((item) => `<span class="signal-pill">${escapeHtml(item)}</span>`)
      .join("");
  } else {
    elements.intakeSignals.className = "signal-cloud empty-state";
    elements.intakeSignals.textContent = "No mapped signals yet.";
  }

  if (parserOutput?.warning) {
    elements.intakeWarning.hidden = false;
    elements.intakeWarning.textContent = parserOutput.warning;
  } else {
    elements.intakeWarning.hidden = true;
    elements.intakeWarning.textContent = "";
  }
}

function formatSymptomKey(symptomId) {
  return String(symptomId || "")
    .split("_")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function buildSymptomPrompt(question) {
  const mappedSymptoms = Array.isArray(question?.mapsTo) ? question.mapsTo : [];
  const primary = mappedSymptoms[0] || question?.id || "symptom";

  if (question.type === "scale_0_5") {
    return `Score ${formatSymptomKey(primary)} (0-5)`;
  }
  if (question.type === "multi_select") {
    return `Select present signals for ${formatSymptomKey(primary)}`;
  }
  if (question.type === "boolean") {
    return `Set ${formatSymptomKey(primary)} (true/false)`;
  }
  return `Set value for ${formatSymptomKey(primary)}`;
}

function renderQuestionChoices(question) {
  if (question.type === "scale_0_5") {
    const scaleLabels = Array.isArray(question.scaleLabels) ? question.scaleLabels : [];
    return `
      <div class="scale-choice-grid">
        ${Array.from({ length: 5 }, (_, index) => {
          const value = index + 1;
          const label = scaleLabels[index] || "";
          return `
            <label class="choice-chip scale-chip">
              <input type="radio" name="${escapeHtml(question.id)}" value="${value}" required />
              <span>
                <strong>${value}</strong>
                <small>${escapeHtml(label)}</small>
              </span>
            </label>
          `;
        }).join("")}
      </div>
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
              <input type="${inputType}" name="${escapeHtml(question.id)}" value="${escapeHtml(option.id)}" ${required} />
              <span>${escapeHtml(option.label)}</span>
            </label>
          `
        )
        .join("")}
    </div>
  `;
}

function buildSubmitLabel(session) {
  const remainingRounds = session?.remainingQuestionRoundsBeforeCandidates ?? 0;
  if (remainingRounds > 1) {
    return "Next question";
  }
  if (remainingRounds === 1) {
    return "Complete this round";
  }
  return "Submit answer";
}

function renderQuestionForm(form, session) {
  state.currentForm = form || null;
  state.currentQuestion = form?.questions?.[0] || null;
  elements.questionMessage.textContent = "Answer the active symptom prompt.";

  if (!state.currentQuestion) {
    elements.questionProgress.textContent = "Waiting for the first form prompt.";
    elements.questionNoteCard.hidden = true;
    elements.questionNote.textContent = "";
    elements.questionForm.innerHTML = '<div class="empty-state">The guided form appears after the opening story is parsed.</div>';
    return;
  }

  const clarificationNote =
    form?.clarificationNotes?.[0] ||
    (state.currentQuestion.clarification
      ? "This question is verifying a signal that was only tentative in the original story."
      : "");

  elements.questionNoteCard.hidden = !clarificationNote;
  elements.questionNote.textContent = clarificationNote;

  const answeredRounds = session?.completedQuestionRounds ?? 0;
  const minimumRounds = session?.minimumQuestionRoundsBeforeCandidates ?? 3;
  elements.questionProgress.textContent = `Form round ${answeredRounds + 1} of at least ${minimumRounds}`;

  elements.questionForm.innerHTML = `
    <section class="question-panel">
      <div class="question-panel-head">
        <span class="question-phase-pill">${escapeHtml(formatTitleCase(state.currentQuestion.phase || "form"))}</span>
        <h4 class="question-title">${escapeHtml(buildSymptomPrompt(state.currentQuestion))}</h4>
        <p class="question-caption">Original: ${escapeHtml(state.currentQuestion.text)}</p>
      </div>

      ${renderQuestionChoices(state.currentQuestion)}

      <div class="question-actions">
        <button class="button primary" type="submit">${escapeHtml(buildSubmitLabel(session))}</button>
      </div>
    </section>
  `;
}

function renderCandidateModal(result, session) {
  state.latestCandidateResult = result;
  state.latestCandidateSession = session || null;
  elements.candidateModalMessage.textContent = result.message;
  elements.candidateModalMeta.innerHTML = `
    <article class="candidate-modal-meta-item">
      <span>Session</span>
      <strong>${escapeHtml(session?.sessionId || result.sessionId || "n/a")}</strong>
    </article>
    <article class="candidate-modal-meta-item">
      <span>Status</span>
      <strong>${escapeHtml(formatTitleCase(session?.status || "complete"))}</strong>
    </article>
    <article class="candidate-modal-meta-item">
      <span>Answered rounds</span>
      <strong>${escapeHtml(String(session?.completedQuestionRounds ?? 0))}</strong>
    </article>
  `;
  elements.candidateModalList.innerHTML = result.candidates
    .map(
      (candidate, index) => `
        <article class="candidate-modal-card">
          <div class="candidate-modal-card-head">
            <div class="candidate-rank">${escapeHtml(String(index + 1).padStart(2, "0"))}</div>
            <div class="candidate-modal-card-copy">
              <strong>${escapeHtml(candidate.diseaseName)}</strong>
              <p>Stage: ${escapeHtml(candidate.stage)} | Band: ${escapeHtml(candidate.band || "confident")}</p>
            </div>
            <span class="candidate-score">${escapeHtml(candidate.matchScore)}</span>
          </div>

          <div class="candidate-modal-detail-grid">
            <section class="candidate-modal-detail">
              <span>Strongest supports</span>
              <p>${escapeHtml(candidate.strongestSupports.join(", ") || "none")}</p>
            </section>

            <section class="candidate-modal-detail">
              <span>Strongest penalties</span>
              <p>${escapeHtml(candidate.strongestPenalties.join(", ") || "none")}</p>
            </section>
          </div>
        </article>
      `
    )
    .join("");
}

function renderCandidatePreview(result, session) {
  if (!result || result.type !== "candidates") {
    elements.candidatePreviewCard.hidden = true;
    elements.candidatePreviewMessage.textContent =
      "The structured shortlist is ready. Open the focused popup to inspect the final candidate set.";
    return;
  }

  const answeredRounds = session?.completedQuestionRounds ?? 0;
  const candidateCount = result.candidates.length;
  elements.candidatePreviewCard.hidden = false;
  elements.candidatePreviewMessage.textContent = `${candidateCount} candidate${candidateCount === 1 ? "" : "s"} ready after ${answeredRounds} answered form round${answeredRounds === 1 ? "" : "s"}.`;
}

function renderCandidateState(result) {
  if (!result) {
    elements.candidateDebug.className = "candidate-state-panel empty-state";
    elements.candidateDebug.textContent = "The shortlist stays hidden until the guided form rounds are complete.";
    return;
  }

  if (result.type === "candidates") {
    elements.candidateDebug.className = "candidate-state-panel";
    elements.candidateDebug.innerHTML = `
      <div class="candidate-state-list">
        ${result.candidates
          .map(
            (candidate, index) => `
              <article class="candidate-state-card">
                <div class="candidate-state-head">
                  <div>
                    <span class="candidate-state-rank">${escapeHtml(String(index + 1).padStart(2, "0"))}</span>
                    <strong>${escapeHtml(candidate.diseaseName)}</strong>
                  </div>
                  <span class="candidate-score">${escapeHtml(candidate.matchScore)}</span>
                </div>
                <p>Stage: ${escapeHtml(candidate.stage)} | Band: ${escapeHtml(candidate.band || "confident")}</p>
              </article>
            `
          )
          .join("")}
      </div>
    `;
    return;
  }

  if (result.type === "fallback") {
    elements.candidateDebug.className = "candidate-state-panel candidate-state-panel-warning";
    elements.candidateDebug.innerHTML = `
      <article class="candidate-state-note">
        <strong>Fallback reached</strong>
        <p>${escapeHtml(result.message || "The engine did not earn a confident shortlist.")}</p>
      </article>
    `;
    return;
  }

  if (result.type === "escalation") {
    elements.candidateDebug.className = "candidate-state-panel candidate-state-panel-danger";
    elements.candidateDebug.innerHTML = `
      <article class="candidate-state-note">
        <strong>Safety escalation</strong>
        <p>${escapeHtml(result.message || "The safety path overrides the normal shortlist.")}</p>
      </article>
    `;
    return;
  }

  elements.candidateDebug.className = "candidate-state-panel empty-state";
  elements.candidateDebug.textContent = "The shortlist stays hidden until the guided form rounds are complete.";
}

function renderCandidateResult(result, session) {
  const answeredRounds = session?.completedQuestionRounds ?? 0;
  const parserMode = formatParserMode(session?.parserOutput?.mode || "");

  return `
    <article class="outcome-summary-card outcome-success">
      <span class="result-kicker">Shortlist ready</span>
      <h4>The structured candidate view is ready.</h4>
      <p class="result-summary">${escapeHtml(result.message)}</p>

      <div class="outcome-meta-grid">
        <article class="outcome-meta-item">
          <span>Answered rounds</span>
          <strong>${escapeHtml(String(answeredRounds))}</strong>
        </article>
        <article class="outcome-meta-item">
          <span>Intake parser</span>
          <strong>${escapeHtml(parserMode)}</strong>
        </article>
      </div>

      <div class="result-summary-actions">
        <button class="button primary" type="button" data-open-candidate-modal="true">Open structured shortlist</button>
        <p class="result-summary-note">
          Candidates stay hidden until the free-text intake and the guided form rounds are complete.
        </p>
      </div>
    </article>
  `;
}

function renderFallbackResult(result) {
  return `
    <article class="outcome-summary-card outcome-warning">
      <span class="result-kicker">Fallback</span>
      <h4>The engine stopped without over-claiming certainty.</h4>
      <p>${escapeHtml(result.message || "The engine could not reach a confident shortlist.")}</p>
    </article>
  `;
}

function renderEscalationResult(result) {
  return `
    <article class="outcome-summary-card outcome-danger">
      <span class="result-kicker">Safety escalation</span>
      <h4>Urgent or unsafe features override the normal shortlist.</h4>
      <p>${escapeHtml(result.message)}</p>
      <p>${escapeHtml((result.reasons || []).join(", "))}</p>
    </article>
  `;
}

function renderResult(result, session) {
  if (!result) {
    clearCandidateModal();
    renderCandidatePreview(null, null);
    elements.resultChip.textContent = "Waiting";
    elements.resultChip.dataset.tone = "neutral";
    elements.resultBody.className = "result-body empty-state";
    elements.resultBody.textContent = "No result yet.";
    return;
  }

  if (result.type === "candidates") {
    renderCandidateModal(result, session);
    renderCandidatePreview(result, session);
    elements.resultChip.textContent = "Shortlist";
    elements.resultChip.dataset.tone = "success";
    elements.resultBody.className = "result-body";
    elements.resultBody.innerHTML = renderCandidateResult(result, session);
    openCandidateModal();
    return;
  }

  clearCandidateModal();
  renderCandidatePreview(null, null);

  if (result.type === "fallback") {
    elements.resultChip.textContent = "Fallback";
    elements.resultChip.dataset.tone = "warning";
    elements.resultBody.className = "result-body";
    elements.resultBody.innerHTML = renderFallbackResult(result);
    return;
  }

  if (result.type === "escalation") {
    elements.resultChip.textContent = "Escalation";
    elements.resultChip.dataset.tone = "danger";
    elements.resultBody.className = "result-body";
    elements.resultBody.innerHTML = renderEscalationResult(result);
    return;
  }

  elements.resultChip.textContent = "Result";
  elements.resultChip.dataset.tone = "neutral";
  elements.resultBody.className = "result-body";
  elements.resultBody.innerHTML = `<pre class="ledger-payload">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
}

function readQuestionResponse(question) {
  if (question.type === "multi_select") {
    return [...elements.questionForm.querySelectorAll(`[name="${CSS.escape(question.id)}"]:checked`)].map((input) => input.value);
  }

  const selected = elements.questionForm.querySelector(`[name="${CSS.escape(question.id)}"]:checked`);
  if (question.type === "scale_0_5") {
    return selected ? Number(selected.value) : Number.NaN;
  }

  return selected?.value || "";
}

function isMissingQuestionResponse(question, response) {
  if (question.type === "multi_select") {
    return false;
  }

  if (question.type === "scale_0_5") {
    return Number.isNaN(response);
  }

  return response === "" || response == null;
}

async function handleEngineResponse(payload, { scroll = false } = {}) {
  const session = payload.session || null;
  const form = payload.form || session?.latestForm || null;
  const result = payload.result || null;

  renderMeta(session);
  renderParserOutput(session?.parserOutput || null);
  renderQuestionForm(form, session);
  renderResult(result, session);
  renderCandidateState(result);

  if (result) {
    setStage("outcome");
  } else if (form) {
    setStage("forms");
  } else {
    setStage("intake");
  }

  if (scroll) {
    scrollWorkspaceIntoView();
  }

  if (result?.type === "candidates") {
    showStatus("The shortlist is ready. The structured candidate popup is open now, and you can reopen it from the rail anytime.", "success");
    return;
  }

  if (result?.type === "fallback") {
    showStatus("The engine stopped in fallback instead of pretending a confident shortlist it did not earn.", "warning");
    return;
  }

  if (result?.type === "escalation") {
    showStatus("Safety escalation triggered. This is the intended behavior for urgent or unsafe patterns.", "danger");
    return;
  }

  if (form) {
    const remainingRounds = session?.remainingQuestionRoundsBeforeCandidates ?? 0;
    if ((session?.completedQuestionRounds ?? 0) === 0) {
      showStatus("The opening story has been parsed. Continue through the guided form one question at a time.", "neutral");
      return;
    }

    if (remainingRounds > 0) {
      showStatus(`${remainingRounds} more answered form round${remainingRounds === 1 ? "" : "s"} before the shortlist can appear.`, "neutral");
      return;
    }

    showStatus("The engine is in its final narrowing stage. Answer the next single question to keep moving toward the shortlist.", "neutral");
  }
}

async function submitSessionStart({ patientId, text, scroll = true } = {}) {
  if (!text) {
    showStatus("Enter a knee complaint to start the guided check.", "warning");
    return;
  }

  setBusy(true);
  showStatus("Parsing intake and starting form...", "neutral");

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

async function answerQuestion(event) {
  event.preventDefault();
  if (!state.sessionId || !state.currentQuestion) {
    return;
  }

  const responseValue = readQuestionResponse(state.currentQuestion);
  if (isMissingQuestionResponse(state.currentQuestion, responseValue)) {
    showStatus("Answer the current form question before continuing.", "warning");
    return;
  }

  setBusy(true);
  showStatus("Submitting answer...", "neutral");

  try {
    const payload = await requestJson("/api/session/answer", {
      method: "POST",
      body: JSON.stringify({
        sessionId: state.sessionId,
        questionResponses: {
          [state.currentQuestion.id]: responseValue
        }
      })
    });

    await handleEngineResponse(payload);
  } catch (error) {
    showStatus(error.message, "danger");
  } finally {
    setBusy(false);
  }
}

function resetDemo() {
  state.currentForm = null;
  state.currentQuestion = null;
  state.latestCandidateResult = null;
  state.latestCandidateSession = null;
  state.sessionId = null;

  elements.startForm.reset();
  elements.patientId.value = createPatientId();
  elements.questionMessage.textContent =
    "Waiting for first prompt.";
  elements.questionNoteCard.hidden = true;
  elements.questionNote.textContent = "";
  elements.questionProgress.textContent = "Waiting for the first form prompt.";
  elements.questionForm.innerHTML = '<div class="empty-state">The guided form appears after the opening story is parsed.</div>';
  elements.resultBody.className = "result-body empty-state";
  elements.resultBody.textContent = "No result yet.";
  elements.resultChip.textContent = "Waiting";
  elements.resultChip.dataset.tone = "neutral";
  renderCandidatePreview(null, null);
  renderCandidateState(null);
  clearCandidateModal();
  renderMeta(null);
  renderParserOutput(null);
  showStatus("", "neutral");
  setStage("intake");
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
  resetDemo();
  elements.startForm.addEventListener("submit", startSession);
  elements.questionForm.addEventListener("submit", answerQuestion);
  elements.resetButton.addEventListener("click", resetDemo);
  elements.reopenShortlist.addEventListener("click", openCandidateModal);
  elements.resultBody.addEventListener("click", (event) => {
    if (event.target.closest("[data-open-candidate-modal='true']")) {
      openCandidateModal();
    }
  });
  elements.candidateModal.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-candidate-modal='true']")) {
      closeCandidateModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.candidateModal.hidden) {
      closeCandidateModal();
    }
  });
  bindSamples();
  void applyLaunchPayload();
}

init();
