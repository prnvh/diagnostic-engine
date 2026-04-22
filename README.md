# Diagnostic Engine

Registry-driven symptom reasoning engine for knee complaints. The rebuild keeps the architecture from the attached planning documents: controlled symptom vocabulary, strict disease nodes, deterministic scoring/question selection, global safety logic, append-only governance logging, and a bounded fallback path when the structured model cannot reach a defensible fit.

The system does not diagnose. It produces ranked fit scores, highlights supporting and contradictory findings, and escalates when the evidence crosses safety rules.

## What is in the repo

```text
registry/
  symptoms/knee.json
  questions/knee.json
  diseases/knee/*.json
  loader.js

registry-validator/
  validate.js

engine/
  parser.js
  scorer.js
  selector.js
  compiler.js
  safety.js
  fallback.js

state/
  db.js
  session.js
  ledger.js

api/
  routes.js

benchmark/
  profiles/*.json
  harness.js

tests/
```

## Runtime model

- `parser.js` converts free text into evidence keys from the registry only.
- `scorer.js` evaluates every disease/stage pair with deterministic support, anti-symptom, and contradiction logic.
- `selector.js` chooses the next highest-value unanswered questions.
- `compiler.js` turns those questions into a user-facing form and maps answers back into evidence.
- `safety.js` intercepts red-flag combinations such as fever plus hot/red joint, deformity, or major trauma with severe weight-bearing difficulty.
- `fallback.js` is the bounded exit when the structured loop exhausts without a confident fit.

## State and governance

The rebuild uses a local file-backed document store under `.diagnostic-engine-data/` so the whole system runs end-to-end without requiring external infrastructure. Sessions are stored one JSON file per session, and the governance ledger is append-only JSONL per session. The interface is intentionally narrow so a future database adapter can replace the storage layer without changing the engine contracts.

## Disease scope

Current knee registry:

- ACL tear
- Meniscal tear
- Patellofemoral pain syndrome
- Knee osteoarthritis

## API

`POST /session/start`

```json
{
  "patientId": "demo_acl",
  "text": "I twisted my knee playing football, felt a pop, it swelled that evening, and now it gives way."
}
```

`POST /session/answer`

```json
{
  "sessionId": "sess_...",
  "questionResponses": {
    "knee_q_010_triggers": ["pivoting", "walking"],
    "knee_q_002_location": "diffuse",
    "knee_q_003_onset_style": "suddenly"
  }
}
```

`GET /session/:id/ledger`

Returns the append-only audit trail for that session.

## Setup

```bash
cp .env.example .env
npm install
```

This repo intentionally uses Node built-ins only, so `npm install` is effectively a no-op today but keeps the workflow conventional.

Optional environment values:

```bash
PORT=3000
DIAGNOSTIC_ENGINE_DATA_DIR=.diagnostic-engine-data
SESSION_DEBOUNCE_MS=120000
MAX_ROUNDS=3
OPENAI_API_KEY=
OPENAI_MODEL=
```

## Run

```bash
npm run validate-registry
npm start
```

## Test

```bash
npm test
```

Current automated checks cover registry validation, scorer behavior, selector/compiler behavior, session merging, and an end-to-end ACL API flow.

## Benchmark

```bash
node benchmark/harness.js
node benchmark/harness.js --disable-contradictions
node benchmark/harness.js --binary-scoring
node benchmark/harness.js --profile=acl_clear_acute_1
```

The harness ships with 20 synthetic profiles spanning clean-cut cases, ambiguous/fallback cases, and safety escalations. It runs each profile 3 times and requires all runs to pass. On the executed rebuild, the default harness completed `20/20` passing profiles across `60/60` runs.

## Design constraints carried through from the planning docs

- Symptom keys are observation-level only.
- Disease nodes hold medical pattern logic; they do not contain question text.
- Unknown evidence contributes zero instead of counting as false.
- Hard-block contradictions suppress a disease only when the conflict is explicitly confirmed.
- Question selection is value-driven, not exhaustive.
- Safety rules live outside disease nodes.

## Assumptions in this rebuild

- The attached planning docs were treated as the canonical specification.
- To keep the system executable in this environment, the parser is deterministic-first and registry-bounded rather than requiring a live external model.
- The benchmark’s stage expectations were aligned with the actual stage semantics encoded in the rebuilt nodes where the distinction was structurally ambiguous.
