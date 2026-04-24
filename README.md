# Diagnostic Engine

Registry-driven symptom reasoning engine for knee complaints, now packaged as a mini MVP demo that can be hosted on Vercel with Supabase-backed persistence.

The system does not diagnose. It produces ranked fit scores, highlights supporting and contradictory findings, asks a bounded follow-up interview, and escalates on red-flag patterns.

For a deeper walkthrough of the runtime and component boundaries, see [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md) and [docs/CODEBASE_DIAGRAM.md](docs/CODEBASE_DIAGRAM.md).

## What changed

The core reasoning model is still deterministic and registry-first, but the runtime is now deployment-oriented:

- `web/` contains the browser demo and static assets.
- `diagnostic_engine/http/routes.js` is the shared HTTP/router layer for both local Node and Vercel.
- `diagnostic_engine/storage/store.js` selects either local file storage or Supabase storage.
- `api/*.mjs` contains thin Vercel entry shims, including the static web dispatcher.
- `diagnostic_engine/supabase/migrations/0001_diagnostic_mvp.sql` creates the hosted session and ledger tables.

## Repo layout

```text
diagnostic_engine/
  core/
    registry/
      symptoms/knee.json
      questions/knee.json
      diseases/knee/*.json
      loader.js
      validate.js
    engine/
      parser.js
      scorer.js
      selector.js
      compiler.js
      safety.js
      fallback.js
  http/
    routes.js
  runtime/
    index.js
    runtime.js
    config.js
    vercel-dispatch.js
  storage/
    db.js
    file-store.js
    supabase-store.js
    store.js
    session.js
    ledger.js
  benchmarks/
    harness.js
    profiles/
  tests/
  supabase/
    migrations/0001_diagnostic_mvp.sql

api/
  health.mjs
  web.mjs
  session/*.mjs

web/
  index.html
  home.js
  knee/index.html
  app.js
  styles.css

docs/
  CODEBASE_DIAGRAM.md
  SYSTEM_ARCHITECTURE.md
  CHANGELOG.md
```

## How it works

1. `diagnostic_engine/core/engine/parser.js` converts free text into controlled symptom evidence only.
2. `diagnostic_engine/core/engine/scorer.js` scores every disease/stage pair with support, anti-symptom, contradiction, and hard-block logic.
3. `diagnostic_engine/core/engine/selector.js` chooses the highest-value unresolved questions.
4. `diagnostic_engine/core/engine/compiler.js` turns those into a client-friendly question form.
5. `diagnostic_engine/core/engine/safety.js` short-circuits red-flag cases.
6. `diagnostic_engine/storage/*` stores sessions and append-only ledgers either locally or in Supabase.
7. `web/app.js` drives the knee workspace against the API.

## Current scope

The current registry covers:

- ACL tear
- Meniscal tear
- Patellofemoral pain syndrome
- Knee osteoarthritis

## Hosted API

Primary hosted paths:

- `POST /api/session/start`
- `POST /api/session/answer`
- `GET /api/session/get?sessionId=...`
- `GET /api/session/ledger?sessionId=...`
- `GET /api/health`

Compatibility rewrites also keep `/session/*` and `/health` working on Vercel.

Example start payload:

```json
{
  "patientId": "demo_acl",
  "text": "I twisted my knee playing football, felt a pop, it swelled that evening, and now it gives way."
}
```

## Local development

```bash
cp .env.example .env
npm install
npm run validate-registry
npm start
```

Local mode defaults to the file-backed store under `.diagnostic-engine-data/`.

Key environment values:

```bash
PORT=3000
STORAGE_DRIVER=file
DIAGNOSTIC_ENGINE_DATA_DIR=.diagnostic-engine-data
DIAGNOSTIC_ENGINE_WEB_DIR=web
SESSION_DEBOUNCE_MS=120000
MAX_ROUNDS=3
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_SCHEMA=public
SUPABASE_SESSIONS_TABLE=diagnostic_sessions
SUPABASE_LEDGER_TABLE=diagnostic_ledger_entries
```

## Vercel + Supabase deployment

1. Create a Supabase project.
2. Run `diagnostic_engine/supabase/migrations/0001_diagnostic_mvp.sql` in the Supabase SQL editor.
3. Add these environment variables in Vercel:

```bash
STORAGE_DRIVER=supabase
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SESSION_DEBOUNCE_MS=120000
MAX_ROUNDS=3
```

4. Deploy the repo to Vercel.

The browser demo talks only to the Vercel API. The Supabase service role key stays server-side in Vercel and is never exposed to the client.

## Verification

```bash
npm test
node diagnostic_engine/core/registry/validate.js
node diagnostic_engine/benchmarks/harness.js
```

Current automated checks cover registry validation, scorer behavior, selector/compiler behavior, session merging, the reorganized runtime wiring, and an end-to-end ACL flow.

The benchmark harness is still useful as a tuning baseline, but it is not fully green right now. The current baseline is 15/20 profiles passing across 60 runs.

## Design constraints retained from the planning docs

- Symptom keys are observation-level only.
- Disease nodes contain pattern logic, not question wording.
- Unknown evidence contributes zero rather than being treated as false.
- Hard-block contradictions only suppress a disease when the conflict is explicitly confirmed.
- Question selection is value-driven rather than exhaustive.
- Safety rules remain global instead of being buried inside disease nodes.
