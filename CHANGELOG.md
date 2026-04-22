# Changelog

## 2026-04-22

### Rebuilt from first principles

- Replaced the placeholder scaffold with a complete registry-driven runtime aligned to the attached design documents.
- Rewrote the symptom registry, question bank, and knee disease nodes from scratch.
- Added strict cross-registry validation with schema, reference, and coverage checks.
- Implemented deterministic parsing, scoring, question selection, compilation, safety escalation, and fallback behavior.
- Added persistent session storage plus append-only governance ledger files.
- Rebuilt the HTTP API orchestration for `/session/start`, `/session/answer`, and `/session/:id/ledger`.

### Added verification and research tooling

- Added a benchmark harness with 20 synthetic profiles and support for contradiction and binary-scoring ablations.
- Added automated tests for registry integrity, scorer behavior, selector/compiler behavior, session merging, and end-to-end API flow.
- Executed the validator, full test suite, and full benchmark sweep.

### Execution results

- `npm test`: passed
- `node benchmark/harness.js`: passed all 20 profiles across 60 runs
- `node registry-validator/validate.js`: passed

### Practical implementation notes

- Chose a file-backed document store for sessions and ledgers so the rebuild runs end-to-end without external services.
- Kept the architecture modular so a future database adapter or remote parser can be swapped in without rewriting engine logic.
