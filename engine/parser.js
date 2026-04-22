const SOFT_LANGUAGE_REGEX = /\b(maybe|perhaps|a bit|kind of|sort of|sometimes|occasionally|not sure|might be|possibly)\b/i;

const RULES = [
  { regex: /\bleft knee\b|\bleft side\b/i, updates: { laterality_left: true, laterality_right: false, laterality_bilateral: false } },
  { regex: /\bright knee\b|\bright side\b/i, updates: { laterality_left: false, laterality_right: true, laterality_bilateral: false } },
  { regex: /\bboth knees\b|\bbilateral\b/i, updates: { laterality_left: false, laterality_right: false, laterality_bilateral: true } },
  { regex: /\b(front|kneecap|behind the kneecap|around the kneecap|anterior)\b/i, updates: { pain_location_front: 4 } },
  { regex: /\b(inner|inside|medial)\b/i, updates: { pain_location_medial: 4 } },
  { regex: /\b(outer|outside|lateral)\b/i, updates: { pain_location_lateral: 4 } },
  { regex: /\b(back of (the )?knee|posterior)\b/i, updates: { pain_location_back: 4 } },
  { regex: /\b(all over|hard to pinpoint|diffuse)\b/i, updates: { pain_location_diffuse: 4 } },
  { regex: /\b(suddenly|all of a sudden|immediately)\b/i, updates: { sudden_onset: true, gradual_onset_over_weeks: false, gradual_onset_over_months: false } },
  { regex: /\b(over (a few )?weeks|for weeks|gradually)\b/i, updates: { sudden_onset: false, gradual_onset_over_weeks: true, gradual_onset_over_months: false } },
  { regex: /\b(over months|for months|for a long time|several months|long-standing|long standing)\b/i, updates: { sudden_onset: false, gradual_onset_over_weeks: false, gradual_onset_over_months: true, timeline_gt_3_months: true } },
  { regex: /\b(no injury|without injury|nothing happened|atraumatic)\b/i, updates: { injury_related_start: false, atraumatic_start: true } },
  { regex: /\b(twisted|pivoted|turned awkwardly|landed awkwardly|injured|playing football|playing soccer|sports incident)\b/i, updates: { injury_related_start: true, atraumatic_start: false } },
  { regex: /\b(swollen|swelling|puffy)\b/i, updates: { knee_swelling: 3 } },
  { regex: /\b(within an hour|within hours|that day|same day|same evening|that evening|within 24 hours)\b/i, updates: { rapid_swelling_within_24h: true, knee_swelling: 4 } },
  { regex: /\b(give(s)? way|unstable|wobbly|buckl(es|ing))\b/i, updates: { instability_giving_way: 4 } },
  { regex: /\b(lock(s|ed|ing)?|stuck)\b/i, updates: { locking: 4 } },
  { regex: /\b(catch(es|ing)?)\b/i, updates: { catching: 4 } },
  { regex: /\b(click(s|ing)?)\b/i, updates: { clicking: 3 } },
  { regex: /\b(stairs|stairs down|stairs up)\b/i, updates: { pain_with_stairs: 4 } },
  { regex: /\b(squat|squatting|deep bend)\b/i, updates: { pain_with_squatting: 4 } },
  { regex: /\b(run|running|jog|jogging)\b/i, updates: { pain_with_running: 4 } },
  { regex: /\b(jump|jumping)\b/i, updates: { pain_with_jumping: 4 } },
  { regex: /\b(twist|twisted|twisting|pivot|cutting|change of direction|turning|turned awkwardly)\b/i, updates: { difficulty_with_pivoting_or_cutting: 4, twisting_or_pivoting_mechanism: true } },
  { regex: /\b(sitting|sitting for a while|after sitting|desk)\b/i, updates: { pain_after_prolonged_sitting: 4 } },
  { regex: /\b(get up from sitting|getting up from sitting|after rest|first get moving|loosens up once moving)\b/i, updates: { symptoms_worse_after_rest: 4, prominent_morning_stiffness: 3 } },
  { regex: /\b(walk|walking)\b/i, updates: { discomfort_while_walking: 3 } },
  { regex: /\b(morning stiffness|stiff in the morning|after rest|first steps|stiff)\b/i, updates: { prominent_morning_stiffness: 4, symptoms_worse_after_rest: 4 } },
  { regex: /\b(pop|popped)\b/i, updates: { pop_at_injury: true } },
  { regex: /\b(couldn't continue|had to stop|stopped immediately|could not continue)\b/i, updates: { unable_to_continue_activity_immediately: true } },
  { regex: /\b(hard to trust|don't trust|do not trust|can't trust|cannot trust|no confidence)\b/i, updates: { reduced_trust_in_knee: 4, reduced_confidence_in_knee: 4 } },
  { regex: /\b(return to sport|back to sport|play again)\b/i, updates: { difficulty_returning_to_sport: 4 } },
  { regex: /\b(can't straighten|can't bend|cannot straighten|cannot bend|cannot fully straighten|can't fully straighten|stiff to bend)\b/i, updates: { loss_of_range_of_motion: 4 } },
  { regex: /\b(joint line|inner line tenderness|outer line tenderness|tender on the side|tender on the inside|tender on the outside)\b/i, updates: { joint_line_tenderness: 4 } },
  { regex: /\btender on the inside\b/i, updates: { pain_location_medial: 4 } },
  { regex: /\btender on the outside\b/i, updates: { pain_location_lateral: 4 } },
  { regex: /\b(limp|limping)\b/i, updates: { limping_after_injury: 3 } },
  { regex: /\b(weight on it|bear weight|walk on it|weight-bearing|weight bearing)\b/i, updates: { difficulty_weight_bearing: 3 } },
  { regex: /\b(can't bear weight|cannot bear weight|unable to walk)\b/i, updates: { difficulty_weight_bearing: 5 } },
  { regex: /\b(grinding|crunching|creaking|creaks|creaky|crepitus)\b/i, updates: { crepitus_grinding: 4 } },
  { regex: /\b(hot|warm)\b/i, updates: { joint_warmth: true } },
  { regex: /\bred\b/i, updates: { redness: true } },
  { regex: /\bfever\b/i, updates: { fever: true } },
  { regex: /\b(car crash|collision|fell hard|major fall|major trauma)\b/i, updates: { major_trauma: true } },
  { regex: /\b(deformed|out of place|looked crooked)\b/i, updates: { deformity: true } },
  { regex: /\b(keeps giving way|kept giving way|gives way again|gives way repeatedly)\b/i, updates: { recurrent_giving_way: 5 } },
  { regex: /\b(sticks|gets stuck)\b/i, updates: { locking: 4 } }
];

const NEGATIVE_RULES = [
  { regex: /\bno swelling|not swollen\b/i, updates: { knee_swelling: 0, rapid_swelling_within_24h: false } },
  { regex: /\bdoesn't give way|does not give way|not unstable\b/i, updates: { instability_giving_way: 0, recurrent_giving_way: 0 } },
  { regex: /\bno locking\b/i, updates: { locking: 0 } },
  { regex: /\bno catching\b/i, updates: { catching: 0 } },
  { regex: /\bno clicking\b/i, updates: { clicking: 0 } },
  { regex: /\bno fever\b/i, updates: { fever: false } },
  { regex: /\bnot hot\b|\bnot warm\b/i, updates: { joint_warmth: false } },
  { regex: /\bnot red\b/i, updates: { redness: false } },
  { regex: /\bno deformity\b/i, updates: { deformity: false } }
];

function createEntry(value, status) {
  return {
    value,
    status,
    source: "parser",
    updatedAt: new Date().toISOString()
  };
}

function inferSeverity(text) {
  if (/\b(excruciating|agonizing|unbearable|severe)\b/i.test(text)) {
    return 5;
  }
  if (/\b(bad|sharp|significant|marked)\b/i.test(text)) {
    return 4;
  }
  if (/\b(pain|painful|hurts|ache)\b/i.test(text)) {
    return 3;
  }
  if (/\b(sore|mild)\b/i.test(text)) {
    return 2;
  }
  return null;
}

function inferTimeline(text) {
  const durationMatch = text.match(/\b(\d+)\s*(day|days|week|weeks|month|months)\b/i);
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();

    if (unit.startsWith("day")) {
      return { timeline_lt_1_week: true };
    }
    if (unit.startsWith("week")) {
      if (amount <= 6) {
        return { timeline_1_to_6_weeks: true };
      }
      return { timeline_6_weeks_to_3_months: true };
    }
    if (unit.startsWith("month")) {
      if (amount <= 3) {
        return { timeline_6_weeks_to_3_months: true };
      }
      return { timeline_gt_3_months: true };
    }
  }

  if (/\b(today|yesterday|hour|hours|day|days)\b/i.test(text)) {
    return { timeline_lt_1_week: true };
  }
  if (/\bweek|weeks\b/i.test(text)) {
    return { timeline_1_to_6_weeks: true };
  }
  if (/\bmonth|months|long-standing|long standing\b/i.test(text)) {
    return { timeline_gt_3_months: true };
  }
  return null;
}

function splitClauses(text) {
  return text
    .split(/[,.!?;]+|\band\b/gi)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseInitialText(text, registry) {
  const normalized = String(text || "").trim();
  const parsed = {};
  const matchedClauses = new Set();
  const clauseList = splitClauses(normalized);

  const addUpdates = (updates, status, ruleRegex) => {
    for (const [symptomId, value] of Object.entries(updates)) {
      if (!registry.symptomById.has(symptomId)) {
        continue;
      }

      const existing = parsed[symptomId];
      const nextEntry = createEntry(value, status);

      if (!existing || (status === "inferred" && existing.status === "low_confidence") || (status === existing.status && typeof value === "number" && value > existing.value)) {
        parsed[symptomId] = nextEntry;
      }
    }

    for (const clause of clauseList) {
      if (ruleRegex.test(clause)) {
        matchedClauses.add(clause);
      }
    }
  };

  for (const rule of NEGATIVE_RULES) {
    if (rule.regex.test(normalized)) {
      addUpdates(rule.updates, "inferred", rule.regex);
    }
  }

  for (const rule of RULES) {
    if (rule.regex.test(normalized)) {
      const status = SOFT_LANGUAGE_REGEX.test(normalized) ? "low_confidence" : "inferred";
      addUpdates(rule.updates, status, rule.regex);
    }
  }

  const painSeverity = inferSeverity(normalized);
  if (painSeverity != null) {
    parsed.pain_severity = createEntry(painSeverity, SOFT_LANGUAGE_REGEX.test(normalized) ? "low_confidence" : "inferred");
  }

  const timeline = inferTimeline(normalized);
  if (timeline) {
    addUpdates(timeline, "inferred", /\b(today|yesterday|hour|hours|day|days|week|weeks|month|months)\b/i);
  }

  if (/\bunstable|gives way|buckl/i.test(normalized) && !parsed.recurrent_giving_way) {
    parsed.recurrent_giving_way = createEntry(3, SOFT_LANGUAGE_REGEX.test(normalized) ? "low_confidence" : "inferred");
  }

  if (/swelling.*(better|settled|down)/i.test(normalized)) {
    parsed.swelling_now_reduced = createEntry(4, "inferred");
  }

  const unparsed = clauseList.filter((clause) => !matchedClauses.has(clause) && clause.split(/\s+/).length >= 3);

  return {
    evidence: parsed,
    unparsed
  };
}

module.exports = {
  parseInitialText
};
