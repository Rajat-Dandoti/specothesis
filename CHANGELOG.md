# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [0.3.0] — 2026-05-12 — Phase 1: Bug Fixes

### Fixed

- **`toStepci.ts`** — `origin`, `referer`, and `user-agent` headers are now excluded from generated
  StepCI workflow steps. These headers are machine/environment-specific and were leaking browser
  fingerprint strings (full User-Agent, frontend origin) into every step.

- **`toCurl.ts`** — `application/x-www-form-urlencoded` form params are now emitted as one
  `--data-urlencode "key=value"` flag per parameter. Previously all params were concatenated into
  a single string and passed to `--data-urlencode`, which treated the whole thing as a value to
  encode rather than a set of key=value pairs — producing malformed request bodies.

- **`toOpenApi.ts`** — Path parameterisation no longer emits duplicate parameter names.
  Paths like `/items/{itemId}/sub/{itemId}` now produce `{itemId}` and `{itemId_2}` instead of
  two identical `{itemId}` names (which is invalid OpenAPI 3.0). Version segments (`v1`, `v2`)
  are also skipped when deriving the parameter name from the preceding path segment, so
  `/api/v2/123` becomes `{apiId}` not `{v2Id}`.

---

## [0.2.0] — 2026-05-12 — Phase 0: Repo Housekeeping

### Added

- `docs/` folder with full audit findings, OSS readiness checklist, roadmap, security notes,
  code internals reference, and phased implementation plan.
- `ARCHITECTURE.md` — system architecture with pipeline diagram and module breakdown.
- `.gitignore` entries: `.DS_Store`, `**/.DS_Store`, `.venv/`, `*.tsbuildinfo`, `.vscode/`,
  `.idea/`, `PLAN_V2.md`, `plan.md`.

---

## [0.1.0] — 2026-05-07 — v2 Reporting Pipeline

### Added

- Coverage summary (`coverage.json`) — per-endpoint stats: status codes, call count, auth
  presence, response time, request/response sizes.
- Anomaly detection (`anomalies.json`) — six rules: client errors, server errors, missing auth,
  slow responses, large responses, repeated calls.
- Drift detection (`drift.json`) — compares current session against the baseline (first run)
  to detect added/removed endpoints and changed status codes or auth requirements.
- HTML session report (`report.html`) — self-contained dark-theme report combining coverage,
  anomalies, and drift with a sortable table.
- Schemathesis manifest — parses JUnit XML from a schemathesis run into structured JSON
  (`schemathesis-manifest.json`) and an HTML report (`schemathesis-report.html`).
- `SCANNER_ENABLE_*` feature flags for all nine pipeline outputs.
- `SCANNER_API_URL` / `SCANNER_AUTH_URL` separation — API base URL distinct from auth URL.
- `SCANNER_ENABLE_EXAMPLES` — controls whether captured values appear as examples in the spec.
- `SCANNER_ENABLE_DEDUP` — controls request deduplication before transforms run.
- Per-operation `servers` override in OpenAPI when an entry's host differs from the base origin.
- Login operation prepended to generated OpenAPI spec when `SCANNER_AUTH_URL` is set.
- Login step prepended to StepCI workflow with JWT capture via `${{captures.token}}`.

---

## [0.0.1] — 2026-04-25 — Initial Release

### Added

- Playwright-based HAR recording via `recordHar`.
- `login` command — saves auth state (cookies + localStorage) as a named profile JSON.
- `start` command — captures a named session with interactive pause/resume/stop.
- `list` command — shows saved profiles and recent sessions.
- URL filter glob to scope captured requests to API calls only.
- Recording window filtering — requests made during paused intervals are excluded from outputs.
- `toOpenApi.ts` — generates OpenAPI 3.0.3 spec from captured HAR entries.
- `toStepci.ts` — generates StepCI YAML regression workflow.
- `toCurl.ts` — generates individual and combined curl shell scripts.
- Multipart form body capture via JS `fetch`/XHR monkey-patch (`formDataCapture.ts`).
- Multipart boundary text parser to extract structured params (`harNormalize.ts`).
- Session auto-increment naming (`checkout`, `checkout-2`, `checkout-3`).
- `SCANNER_EXTRA_*` env vars forwarded to automation scripts as `config.extras`.
