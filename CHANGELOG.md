# Changelog

## 2026-04-23

### Rebuilt the public site visual system again

- Replaced the previous font pairing with the serif-led stack used on the personal site reference: Cormorant Garamond, Source Serif 4, and IBM Plex Mono.
- Removed the failed body-map hero and rebuilt the landing page around a cleaner knee reasoning atlas with lighter linework and clearer step labeling.
- Reduced the cramped card-heavy feel by opening spacing, simplifying panel treatments, and rebalancing the landing layout around fewer, larger surfaces.
- Rewrote the public-facing copy so it explains the actual product more directly: what complaint shapes fit the demo, what the engine loop does, and what each ending means.
- Split the website into a homepage handoff plus a dedicated `/knee/` workspace page so the actual interview, shortlist, and ledger no longer crowd the main landing page.
- Added homepage handoff behavior that carries typed complaint text into the knee page and automatically starts the session there.
- Updated the local static server to serve directory index routes like `/knee/` instead of only direct file paths.
- Reworked heading copy across the homepage and knee page so section titles describe the real product behavior more accurately and use more readable measures.
- Shortened the homepage hero and atlas headings, removed extra hero support copy, and rewrote several section titles into plainer language.
- Compressed the homepage knee-workspace handoff section so it fits more naturally on a standard viewport while keeping the dedicated-page preview card visually closer to the previous version.
- Matched the heights of the two “What the engine does” cards while keeping their asymmetric widths.
- Updated the homepage-to-knee-page handoff so “Continue to knee workspace” always navigates to the dedicated page, and if a complaint was already entered it is carried into the knee page and used immediately for session start.
- Tuned the dedicated knee page separately from the homepage: fixed the top hero card grid proportions, shortened the visible hero copy, removed the visible session-label field from the live workspace form, and compressed the workspace section so it fits more naturally on a standard viewport.

- Changed the live workspace flow so follow-up questions advance one at a time instead of rendering the whole batch at once, and made the two top workspace cards stretch to matching height.
- Recentered the dedicated knee-page hero, widened the hero title and subtitle measure, and strengthened the live workspace heading so it reads as a clear title with full-width supporting copy.
- Replaced the Vercel catch-all API entry with explicit serverless route files, switched ledger fetching to a stable query-based endpoint, and hardened the frontend JSON handling so broken deployments show a clear API error instead of a raw parser failure.
- Converted the Vercel API entry files to `.mjs` default exports and explicitly bundled the registry files into the serverless functions so deployed session-start requests can initialize the engine without invocation crashes.

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
- Rebuilt the public site into a real landing page plus live workspace, inspired by editorial AI product pages and clean medical visual systems while keeping the product claims accurate to the actual engine.

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
