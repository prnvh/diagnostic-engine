# Changelog

## 2026-04-22

### Rebuilt from first principles

- Replaced the placeholder scaffold with a complete registry-driven runtime aligned to the attached design documents.
- Rewrote the symptom registry, question bank, and knee disease nodes from scratch.
- Added strict cross-registry validation with schema, reference, and coverage checks.
- Implemented deterministic parsing, scoring, question selection, compilation, safety escalation, and fallback behavior.
- Added persistent session storage plus append-only governance ledger files.
- Rebuilt the HTTP API orchestration for `/session/start`, `/session/answer`, and `/session/:id/ledger`.

### Tailored for Vercel + Supabase MVP hosting

- Replaced the hardwired filesystem assumption with a storage adapter boundary.
- Added a Supabase-backed store for sessions and append-only ledger entries.
- Kept the file-backed store for local development, tests, and the benchmark harness.
- Moved shared HTTP logic into `server/routes.js` and added `api/[...route].js` for Vercel serverless deployment.
- Added a hosted demo UI in `public/` so the project can be shown directly as a mini MVP instead of only exposing raw API routes.
- Added `vercel.json` rewrites plus a Supabase SQL migration under `supabase/migrations/`.
- Added `GET /api/health` and `GET /api/session/:id` to make deployment and session inspection easier.
- Added `SYSTEM_ARCHITECTURE.md` to document the current design, data flow, module boundaries, and deployment shape.

### Added verification and research tooling

- Added a benchmark harness with 20 synthetic profiles and support for contradiction and binary-scoring ablations.
- Added automated tests for registry integrity, scorer behavior, selector/compiler behavior, session merging, and end-to-end API flow.
- Executed the validator, full test suite, and full benchmark sweep.

### Execution results

- `npm test`: passed
- `node benchmark/harness.js`: passed all 20 profiles across 60 runs
- `node registry-validator/validate.js`: passed
- Local HTTP smoke test: passed for `/`, `/api/health`, and `/api/session/start`

### Practical implementation notes

- The hosted path is now Vercel API plus Supabase storage, while local work still defaults to the file-backed store.
- The deterministic engine contracts were left intact so deployment changes did not alter registry semantics or benchmark behavior.
