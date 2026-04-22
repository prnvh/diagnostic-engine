# Diagnostic Engine

Registry-driven symptom reasoning engine for knee complaints, now packaged as a mini MVP demo that can be hosted on Vercel with Supabase-backed persistence.

The system does not diagnose. It produces ranked fit scores, highlights supporting and contradictory findings, asks a bounded follow-up interview, and escalates on red-flag patterns.

For a deeper walkthrough of the runtime and component boundaries, see [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md).

## What changed

The core reasoning model is still deterministic and registry-first, but the runtime is now deployment-oriented:

- `public/` contains a lightweight browser demo.
- `api/[...route].js` is a Vercel catch-all serverless handler.
- `server/routes.js` is the shared HTTP/router layer for both local Node and Vercel.
- `state/store.js` selects either local file storage or Supabase storage.
- `supabase/migrations/0001_diagnostic_mvp.sql` creates the hosted session and ledger tables.

## Repo layout

```text
registry/
  symptoms/knee.json
  questions/knee.json
  diseases/knee/*.json

engine/
  parser.js
  scorer.js
  selector.js
  compiler.js
  safety.js
  fallback.js

server/
  routes.js

api/
  [...route].js

state/
  db.js
  file-store.js
  supabase-store.js
  store.js
  session.js
  ledger.js

public/
  index.html
  app.js
  styles.css

supabase/
  migrations/0001_diagnostic_mvp.sql

benchmark/
tests/
```

## How it works

1. `engine/parser.js` converts free text into controlled symptom evidence only.
2. `engine/scorer.js` scores every disease/stage pair with support, anti-symptom, contradiction, and hard-block logic.
3. `engine/selector.js` chooses the highest-value unresolved questions.
4. `engine/compiler.js` turns those into a client-friendly question form.
5. `engine/safety.js` short-circuits red-flag cases.
6. `state/*` stores sessions and append-only ledgers either locally or in Supabase.
7. `public/app.js` drives the mini MVP demo against the API.

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
2. Run `supabase/migrations/0001_diagnostic_mvp.sql` in the Supabase SQL editor.
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
node registry-validator/validate.js
node benchmark/harness.js
```

Current checks cover registry validation, scorer behavior, selector/compiler behavior, session merging, an end-to-end ACL flow, and the 20-profile benchmark sweep.

## Design constraints retained from the planning docs

- Symptom keys are observation-level only.
- Disease nodes contain pattern logic, not question wording.
- Unknown evidence contributes zero rather than being treated as false.
- Hard-block contradictions only suppress a disease when the conflict is explicitly confirmed.
- Question selection is value-driven rather than exhaustive.
- Safety rules remain global instead of being buried inside disease nodes.
