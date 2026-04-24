function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showStatus(message, tone = "neutral") {
  const banner = document.getElementById("status-banner");
  banner.hidden = !message;
  banner.textContent = message || "";
  banner.dataset.tone = tone;
}

function formatLedgerType(type) {
  return String(type || "")
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
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

function summarizeLedgerEntry(entry) {
  switch (entry.type) {
    case "SESSION_CREATED":
      return "Started a new session.";
    case "SESSION_REUSED":
      return "Reused an existing in-progress session.";
    case "PARSE_MERGED":
      return `Mapped ${entry.payload?.parsedKeys?.length || 0} signals from intake text.`;
    case "ROUND_COMPLETE":
      return "Completed a scoring round.";
    case "ANSWERS_RECORDED":
      return `Saved ${entry.payload?.keys?.length || 0} answer updates.`;
    case "CANDIDATE_FLAGGED":
      return "Reached candidate shortlist threshold.";
    case "FALLBACK_TRIGGERED":
      return "Stopped with fallback path.";
    case "SAFETY_ESCALATED":
      return "Safety escalation was triggered.";
    default:
      return "Recorded session event.";
  }
}

function renderLedger(entries = []) {
  const output = document.getElementById("ledger-output");
  if (!entries.length) {
    output.className = "ledger-list empty-state";
    output.textContent = "No ledger events found.";
    return;
  }

  output.className = "ledger-list";
  output.innerHTML = entries
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

async function requestJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with ${response.status}`);
  }
  return payload;
}

async function loadLedger(sessionId) {
  showStatus("Loading ledger...", "neutral");
  try {
    const payload = await requestJson(`/api/session/ledger?sessionId=${encodeURIComponent(sessionId)}`);
    renderLedger(payload.ledger || []);
    showStatus(`Loaded ${payload.ledger?.length || 0} events`, "success");
  } catch (error) {
    showStatus(error.message, "danger");
  }
}

function init() {
  const form = document.getElementById("ledger-form");
  const input = document.getElementById("session-id-input");
  const sessionIdFromQuery = new URLSearchParams(window.location.search).get("sessionId") || "";
  input.value = sessionIdFromQuery;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const sessionId = input.value.trim();
    if (!sessionId) {
      showStatus("Session ID is required", "warning");
      return;
    }
    void loadLedger(sessionId);
  });

  if (sessionIdFromQuery) {
    void loadLedger(sessionIdFromQuery);
  }
}

init();
