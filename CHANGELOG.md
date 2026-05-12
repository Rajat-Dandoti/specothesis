# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [1.0.0] — 2026-05-13 — Phase 5: OSS Preparation

### Added

- **`README.md`** — public-facing homepage: quickstart, output file table, auth configuration
  guide, feature flags, CI example, links to USAGE.md and ARCHITECTURE.md.
- **`LICENSE`** — MIT license.
- **`CONTRIBUTING.md`** — dev setup, test capture walkthrough, how to add output formats and
  anomaly rules, PR conventions.
- **`package.json` — `bin` field**: `api-scanner` → `./dist/capture.js` for `npx` and global
  install (`npm install -g api-scanner`).
- **`package.json` — `engines`**: `node >= 18.0.0`.
- **`package.json` — `files`**: `dist/`, `README.md`, `LICENSE`, `.env.example` — only these
  are included in the published package.
- **`package.json` — `keywords`**: api, openapi, swagger, playwright, har, stepci, testing,
  api-testing, schemathesis, coverage, rest.
- **`scripts/postbuild.mjs`**: wired as `postbuild` step — injects `#!/usr/bin/env node`
  shebang into `dist/capture.js` and sets `chmod 755` so the binary is directly executable.

---

## [0.6.0] — 2026-05-13 — Phase 4: --only flag

### Added

- **`--only <outputs>`** CLI flag — comma-separated list of outputs to generate for a single
  run, overriding all `SCANNER_ENABLE_*` env vars. All nine output flags are zeroed first,
  then only the listed ones (plus their implied dependencies) are enabled.

  Valid values: `openapi`, `stepci`, `curl`, `coverage`, `anomalies`, `drift`, `html`

  Dependency resolution (automatic):
  - `anomalies` → also enables `coverage`
  - `drift`     → also enables `coverage`
  - `html`      → also enables `coverage`, `anomalies`, `drift`

  `dedup` and `examples` are not selectable via `--only` — they are preserved from env config.

  Unknown values produce a clear error listing all valid options.

  Examples:
  ```sh
  # OpenAPI spec only
  api-scanner start --url https://app.com --only openapi

  # Spec + StepCI workflow
  api-scanner start --url https://app.com --only openapi,stepci

  # Full HTML report suite
  api-scanner start --url https://app.com --only html
  ```

  Without `--only`, existing `SCANNER_ENABLE_*` env var behaviour is unchanged.

---

## [0.5.0] — 2026-05-13 — Phase 3: OpenAPI Quality

### Added

- **`operationId`** — every operation now has a unique, auto-derived `operationId`.
  Derived from `METHOD` + last path segment (param braces stripped, kebab converted to
  camelCase). Collisions are resolved by appending `_2`, `_3`, etc.
  Examples: `GET /api/v1/users/{userId}` → `getUserId`, `POST /api/v1/products` → `postProducts`.

- **`tags`** — every operation is tagged with the first meaningful path segment, skipping
  `api`, version prefixes (`v1`, `v2`, …), and path parameters.
  Examples: `/api/v1/users/…` → `users`, `/api/v1/consent-manager/…` → `consent-manager`.
  The login operation retains its explicit `Authentication` tag.

### Fixed

- **`SCANNER_API_URL` base path now preserved** — setting `SCANNER_API_URL=https://api.example.com/v2`
  previously silently stripped the path, emitting `https://api.example.com` as the server URL.
  The full URL (minus trailing slash) is now used. Per-operation server overrides still compare
  on host only, so a different-host entry triggers an override as before.

---

## [0.4.0] — 2026-05-13 — Phase 2: Configurable Auth System

### Added

- `SCANNER_AUTH_METHOD` — explicit auth strategy (`bearer-login`, `bearer-static`, `api-key`,
  `basic`, `none`). Auto-detected as `bearer-login` when `SCANNER_AUTH_URL` is set.
- `SCANNER_AUTH_BODY_FORMAT` — login request body format (`form` default, `json`, `formData`).
- `SCANNER_AUTH_USERNAME_FIELD` — field name for the username in the login body (default: `username`).
- `SCANNER_AUTH_PASSWORD_FIELD` — field name for the password in the login body (default: `password`).
- `SCANNER_AUTH_TOKEN_PATH` — JSONPath to extract the token from the login response
  (default: `$.access_token`). Supports any path: `$.token`, `$.data.access_token`, `$.auth.jwt`, etc.
- `SCANNER_AUTH_SCHEME` — value prepended before the token in the Authorization header
  (default: `Bearer`). Set to empty string for a bare token.

### Changed

- **`toOpenApi.ts`** — `buildLoginOperation` no longer applies the `/local/{tenant}/login`
  Privasapien-specific regex. The auth URL path is used as-is. Request body content type, field
  names, and response token field are all derived from the new config vars. The `bearerAuth`
  scheme description is now generic (no hardcoded endpoint path).
- **`toStepci.ts`** — `buildLoginStep` uses `SCANNER_AUTH_BODY_FORMAT`, field names, and token
  path from config. `buildHeaders` uses `SCANNER_AUTH_SCHEME` when constructing the captured
  token reference, instead of hardcoding `Bearer`.
- **`.env.example`** — full auth section documenting all six new variables with examples for
  each supported auth method.

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
