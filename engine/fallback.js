function buildFallbackResult({ session, candidates, reason = "uncertain_result" }) {
  const visibleCandidates = candidates.filter((candidate) => !candidate.hardBlocked).slice(0, 3);
  const candidateSummary = visibleCandidates.length
    ? visibleCandidates
        .map((candidate) => `${candidate.diseaseName} (${candidate.score}% fit, best stage: ${candidate.bestStage})`)
        .join("; ")
    : "No disease node cleared the meaningful-candidate band.";

  const missingEvidence = [...new Set(visibleCandidates.flatMap((candidate) => candidate.highValueUnknowns || []))].slice(0, 5);

  return {
    type: "fallback",
    reason,
    message: [
      "This engine could not reach a confident structured fit from the current symptom evidence.",
      "This is not a diagnosis.",
      `Closest structured fits so far: ${candidateSummary}.`,
      missingEvidence.length ? `Important missing evidence: ${missingEvidence.join(", ")}.` : "",
      "A clinician should review the full story, especially if symptoms are worsening or severe."
    ]
      .filter(Boolean)
      .join(" "),
    sessionId: session.sessionId
  };
}

module.exports = {
  buildFallbackResult
};
