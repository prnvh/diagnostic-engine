# Diagnostic Engine

A symptom-based clinical reasoning engine for musculoskeletal conditions.

Hybrid architecture — LLM for natural language parsing only. Scoring, question selection, contradiction-driven elimination, and form compilation are all deterministic code against a validated disease node registry. No imaging required.

Currently scoped to the knee domain (ACL tear, meniscus tear, patellofemoral pain syndrome, osteoarthritis).

---

## How It Works

The user describes their symptoms in plain language. The system parses that into a structured evidence state, scores it against a registry of disease nodes, asks targeted follow-up questions across up to three rounds, and returns the conditions that best match — or falls back to a freeform LLM response with a disclaimer if the node library can't produce a confident answer.

```
POST /session/start   (user's natural language description)
        ↓
   [LLM Parser]       text → evidence state { symptomId: { value, status } }
        ↓
[Create/Upsert Doc]   evidence state persisted to MongoDB
        ↓
  [Node Scorer]       scores all disease nodes across all stages — pure code
        ↓
[Question Selector]   picks highest-value unresolved symptom keys — pure code
        ↓
 [Form Compiler]      question library lookup, compiles message — pure code
        ↓
   Return form

POST /session/answer  (user submits answers)
        ↓
[Upsert + Re-score]   confirmed answers update evidence state, scorer re-runs
        ↓
[Governance Gate]     ≥ 80% match → return candidates
                      round 3 done, no match → LLM fallback
        ↓
[Governance Ledger]   append-only audit trail
```

LLM is called exactly twice per session at most — once for the initial parse, once for the fallback if the node library exhausts without a confident match.

---

## Architecture Decisions

**Why not use an LLM for scoring or question selection?**
The [LLM Code Graph Compiler](https://github.com/prnvh/llm-code-graph-compiler) this system is built alongside demonstrated that confining the LLM to a single structured role — and making everything downstream deterministic — produces dramatically more reliable output. The scorer is a weighted loop over JSON. The question selector is a priority sort over unresolved keys. Both are faster, cheaper, and fully auditable.

**What is a disease node?**
A node is a scoring template for one condition. It stores what findings support the condition, what findings argue against it, what changes by stage, and what triggers soft or hard penalties. It does not diagnose, infer red flags, or contain freeform text. Every symptom key in a node is observation-level — something the user can directly report.

**Why are nodes split into base symptoms and stage profiles?**
Some findings matter across the disease in general; others are stage-specific. Instability belongs in ACL's general picture. Pop-at-injury and rapid swelling are acute-phase findings. This separation lets the scorer pick the best-matching stage rather than penalising a node for symptoms that simply haven't appeared yet.

**Why is a score of 0 not a hard elimination?**
Three reasons: stage mismatch (a symptom absent at stage 1 may be cardinal at stage 3), user underreporting (patients describe a 3 as a 1), and symptom blindness (not noticed ≠ absent). Hard elimination only fires when an answer is `confirmed` — meaning the system directly asked and the user explicitly answered — and it hits a hard contradiction entry for that disease.

**What is a confirmed vs inferred score?**
`explicit` — came from a direct question answer, treated at 1.0× weight. `inferred` — extracted from the user's initial description, treated at 0.8×. `low_confidence_inferred` — weakly implied, treated at 0.6×. This separation is what makes soft zeros safe to handle without eliminating valid candidates.

---

## Scoring

### Evidence State

Every symptom key carries a value and a status:

```json
{
  "instability_giving_way": { "value": 4, "status": "explicit" },
  "pop_at_injury":          { "value": true, "status": "inferred" },
  "pain_after_prolonged_sitting": { "value": 0, "status": "explicit" }
}
```

### Symptom Values

| Score | Meaning |
|---|---|
| 0 | Absent / never |
| 1 | Very mild, barely noticeable |
| 2 | Mild |
| 3 | Moderate, affects activity |
| 4 | Significant, affects daily life |
| 5 | Severe, constant, or completely limiting |

Binary symptoms take `true` / `false`.

### Match Types

Each symptom entry in a node declares a `match_type` of either `binary` or `range`.

**Binary:**
```
if evidence == expected_value → weight × 10 × confidence_multiplier
else → 0
```

**Range** (uses distance-from-expected-range):
```
distance = 0              if value is inside expected_range
distance = a - value      if value < lower bound
distance = value - b      if value > upper bound

match_factor = max(0, 1 - distance / 2)
points = weight × 10 × match_factor × confidence_multiplier
```

Anti-symptoms use the same distance logic, inverted — penalty grows the further the user's value falls outside the disease-compatible range:
```
anti_match_factor = min(1, distance / 2)
penalty = weight × 8 × anti_match_factor × confidence_multiplier
```

Unknown values contribute zero — the system does not punish missing data.

### Stage Scoring

For each disease node, the scorer evaluates all three stages independently and picks the best:

```
score(disease, stage) =
    base_support
  − base_anti_penalty
  + stage_support(stage)
  − stage_anti_penalty(stage)
  + timeline_compatibility_bonus(stage)
  − soft_contradiction_penalties
  − hard_contradiction_penalties

final_score(disease) = max over stages
best_stage(disease)  = argmax over stages
```

Timeline is derived from the user's reported duration and nudges stage compatibility without overriding symptom evidence.

### Contradictions

**Soft contradictions** subtract a node-defined penalty when matched. Typically 10–25 points. Findings like `gradual_onset_over_weeks` for ACL, or `locking` which fits meniscal injury better.

**Hard contradictions** apply a large penalty (typically 100) and flag the node as hard-blocked. The node remains in debug output but is suppressed from UI results.

### Candidate Bands

| Band | Meaning |
|---|---|
| < 60% | Not a meaningful candidate |
| 60–79% | Possible — drives question selection |
| ≥ 80% | Confident match — returned to user |

---

## Question Selection

After each scoring pass, the selector identifies the highest-value unresolved keys by:

1. Finding high-weight symptom keys that are still unknown across top candidate diseases
2. Preferring keys where top candidates disagree (discriminators)
3. Preferring keys that help assign stage
4. Skipping any key already answered or confidently inferred

Questions are drawn from a structured bank with four phases: `routing`, `universal`, `discriminator`, `refinement`. Each question declares the symptom keys it fills, `ask_if` conditions, and `blocks_if` conditions. The selector evaluates these before including a question.

---

## Setup

```bash
git clone https://github.com/prnvh/diagnostic-engine
cd diagnostic-engine
npm install
cp .env.example .env
```

Edit `.env`:

```
ANTHROPIC_API_KEY=your_key_here
MONGODB_URI=mongodb://localhost:27017/diagnostic-engine
```

---

## Run

```bash
npm run dev     # development, with nodemon
npm start       # production
```

The registry is validated on boot. If any disease node references a symptom ID that doesn't exist in the symptom registry, or any symptom is missing a question, the server refuses to start.

---

## Test

```bash
npm test                                     # all tests
node --test tests/scorer.test.js             # scorer only
node --test tests/selector.test.js           # selector only
node --test tests/compiler.test.js           # compiler only
node --test tests/registry.test.js           # registry integrity
```

---

## Validate Registry

```bash
npm run validate-registry
```

Checks every disease node: all referenced symptom IDs exist, weights are in range, expected ranges are valid, no node contains non-observation-level keys. Runs automatically on boot.

---

## API

### `POST /session/start`

Begin a session with the user's initial description.

```json
{
  "patientId": "p_001",
  "text": "I was playing football and twisted my knee badly. Felt a pop and immediately couldn't put weight on it. It swelled up within an hour and feels really unstable."
}
```

**Returns:**
```json
{
  "sessionId": "...",
  "round": 1,
  "form": {
    "message": "Please answer each question with a number from 0 to 5...",
    "symptomIds": ["unable_to_continue_activity_immediately", "recurrent_buckling_with_turning", "locking"]
  },
  "debug": {
    "topCandidates": [
      { "disease": "knee_acl_tear", "score": 74, "bestStage": "acute",
        "highValueUnknowns": ["unable_to_continue_activity_immediately"] }
    ],
    "eliminated": 2
  }
}
```

---

### `POST /session/answer`

Submit answers from the form. Repeat up to 3 rounds.

```json
{
  "sessionId": "...",
  "answers": {
    "unable_to_continue_activity_immediately": true,
    "recurrent_buckling_with_turning": 3,
    "locking": 0
  }
}
```

**Returns (if more rounds remain):**
```json
{
  "sessionId": "...",
  "round": 2,
  "form": { "message": "...", "symptomIds": [...] }
}
```

**Returns (if confident match found):**
```json
{
  "sessionId": "...",
  "result": {
    "type": "candidates",
    "message": "Based on your described symptoms, the following conditions are possible...",
    "candidates": [
      { "disease": "ACL Tear (Anterior Cruciate Ligament)", "matchScore": "84%", "stage": "acute" }
    ]
  }
}
```

**Returns (if fallback triggered):**
```json
{
  "sessionId": "...",
  "result": {
    "type": "fallback",
    "message": "⚠️ IMPORTANT: The structured diagnostic engine was unable to identify a confident match..."
  }
}
```

---

### `GET /session/:id/ledger`

Full append-only audit trail for a session. Every decision event, score delta, contradiction match, and elimination logged in order.

---

## Adding a Disease Node

1. Create `registry/diseases/knee/your_disease.json`
2. Every symptom entry must have `key`, `weight`, `match_type`, and either `expected_value` (binary) or `expected_range` (range)
3. Every key must be observation-level — something the user can directly report
4. Every `key` must exist in `registry/symptoms/knee.json`
5. Keep `base_symptoms`, `base_anti_symptoms`, and `stage_profiles` (acute / subacute / chronic) separate
6. Red-flag findings (fever, deformity, fracture suspicion) belong in global safety logic, not in nodes
7. Run `npm run validate-registry`
8. Add at least one benchmark profile to `benchmark/profiles/`

---

## Benchmark

```bash
node benchmark/harness.js                          # all profiles
node benchmark/harness.js --profile=acl_clear      # single profile
```

Each profile runs N=3 times independently. A profile passes only if all 3 runs pass (same all-must-pass methodology as the compiler benchmarks). Metrics: band-60 recall, band-80 precision, round-of-first-match, false positive count.

---

## Project Structure

```
/registry
  /diseases/knee/     one JSON file per disease node
  /symptoms/          symptom IDs, labels, 0–5 scale labels
  /questions/         question bank — one entry per symptom ID, with ask_if / blocks_if
  loader.js           validates all cross-references on boot

/engine
  parser.js           LLM call — text → evidence state { key: { value, status } }
  scorer.js           pure code — evidence state → ranked candidates with stage
  selector.js         pure code — candidates + evidence → next symptom IDs
  compiler.js         pure code — symptom IDs → question form
  fallback.js         LLM call — freeform response when node library fails

/state
  session.js          create / upsert / read session documents
  ledger.js           append-only governance log
  db.js               MongoDB connection

/api
  routes.js           sole entry/exit point for all input and output

/tests                unit tests per engine module
/benchmark
  /profiles           synthetic patient profiles with ground truth
  harness.js          benchmark runner

index.js              boot — registry load, DB connect, server start
```

---

## Research Context

There are no existing symptom-based knee diagnosis benchmarks in the literature. All current knee AI benchmarks are image-based (Kellgren-Lawrence grading, MRI lesion detection). This system operates in a different problem space — conversational, symptom-described, stage-aware reasoning without imaging — and constructs its own benchmark as part of the contribution.

The methodology paper makes three architectural claims:

- Contradiction-driven elimination outperforms overlap-only scoring
- Stage-aware symptom weighting outperforms flat symptom lists
- Separated confidence levels (explicit vs inferred) materially affect soft-zero handling

The benchmark harness runs ablation studies designed to produce numbers that support or refute each claim independently.

This is a clinical decision support tool. It helps users understand their symptoms and ask better questions of healthcare professionals. It is not a diagnostic endpoint and should not be used as one.

---

## License

Apache 2.0 — see [LICENSE](LICENSE)

---

## Authors

**Pranav Harikumar** — Architect  
**Ava Li** — Clinical Data, Movement Science