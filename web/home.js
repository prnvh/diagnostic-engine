const DEMO_SAMPLES = {
  acl: "I twisted my knee playing football, felt a pop, it swelled that evening, and now it gives way.",
  meniscus: "My knee twisted while squatting, now the inner side hurts and it sometimes catches when I turn.",
  pfps: "The front of my knee has been hurting for weeks, worse with stairs and after sitting for a while.",
  oa: "My knee has been aching for months, stiff after rest, and it crackles when I go up stairs.",
  redflag: "My knee is hot and red, I have a fever, and it is getting hard to put weight on it.",
  trauma: "I had a major fall, the knee looks out of place, and I can barely stand on it."
};

const KNEE_LAUNCH_STORAGE_KEY = "diagnostic-engine:knee-launch";

const elements = {
  complaintText: document.getElementById("handoff-complaint-text"),
  form: document.getElementById("handoff-form"),
  patientId: document.getElementById("handoff-patient-id"),
  startButton: document.getElementById("handoff-button"),
  status: document.getElementById("handoff-status")
};

function createPatientId() {
  return `demo_${Date.now().toString(36).slice(-6)}`;
}

function showStatus(message, tone = "neutral") {
  elements.status.hidden = !message;
  elements.status.textContent = message || "";
  elements.status.dataset.tone = tone;
}

function persistLaunchPayload(payload) {
  sessionStorage.setItem(
    KNEE_LAUNCH_STORAGE_KEY,
    JSON.stringify({
      ...payload,
      createdAt: Date.now()
    })
  );
}

function fillSample(sampleId) {
  const sample = DEMO_SAMPLES[sampleId];
  if (!sample) {
    return;
  }

  elements.complaintText.value = sample;
  if (!elements.patientId.value.trim()) {
    elements.patientId.value = createPatientId();
  }
}

function bindSamples() {
  document.querySelectorAll("[data-sample]").forEach((button) => {
    button.addEventListener("click", () => {
      fillSample(button.dataset.sample);
    });
  });
}

function handleSubmit(event) {
  event.preventDefault();

  const text = elements.complaintText.value.trim();
  elements.startButton.disabled = true;
  showStatus("Opening the knee workspace...", "neutral");
  persistLaunchPayload({
    autoStart: Boolean(text),
    bodyRegion: "knee",
    patientId: elements.patientId.value.trim() || createPatientId(),
    text
  });
  window.location.href = "/knee/";
}

function init() {
  elements.patientId.value = createPatientId();
  elements.form.addEventListener("submit", handleSubmit);
  bindSamples();
}

init();
