# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.5.0] — 2026-07-30

### Added

- **Causal data flow graph** — after every session, Specothesis now traces which response values
  flow into subsequent requests and builds a dependency graph:
  - Numeric ID fields (keys matching `id`, `key`, `ref`, `token`, etc.) and string IDs (UUID,
    ObjectId, ULID, NanoID, or any ≥20-char alphanumeric segment) are extracted from each
    successful response body.
  - Each value is matched against subsequent request URLs (path segments, query params) and
    request bodies to detect causal links.
  - Results are written to **`causal-graph.json`** (`nodes` + `edges` with `sourceField` and
    `targetLocation`) and shown as a dependency table in `report.html`.
  - Terminal output lists unique source → target chains at a glance.

---

## [1.4.0] — 2026-07-30

### Added

- **Request timing waterfall** — `report.html` now opens with an SVG waterfall chart showing
  every API call as a method-colored bar, positioned by start offset from session start, with
  duration labels and a ms/s axis. Useful for spotting sequential-when-parallelizable patterns
  and slow legs at a glance.

- **Cache effectiveness audit** — two new anomaly rules:
  - `no-cache-headers`: GET endpoints called 2+ times with no `Cache-Control` or `ETag` in
    responses — flags repeated data transfer that caching could short-circuit.
  - `etag-unused`: server sends `ETag` in responses but the client never sends `If-None-Match`
    on subsequent requests — server supports conditional requests but the client ignores them.
  Both appear in `anomalies.json` and the HTML report's anomaly section.

- **Auth token lifecycle report** — new `auth-audit.json` output and dedicated section in
  `report.html` showing:
  - Call counts with vs. without auth, and auth coverage percentage.
  - Endpoints that received no `Authorization` header (potential unprotected surface).
  - Token-in-URL detection: flags any request whose query params contain a JWT or long opaque
    token value — a security issue as tokens in URLs appear in server logs and browser history.
  - Post-logout token reuse: if a logout endpoint is detected and any subsequent request still
    carries the auth header, that's flagged as a probable server-side session invalidation bug.

---

## [1.3.0] — 2026-07-28

### Added

- **Multi-example capture per endpoint** — when the same endpoint is called multiple times
  with different payloads or query params, all variations are now preserved in the generated
  outputs instead of the previous last-call-wins behaviour:
  - **Query params unioned** — all parameter names seen across every call to an endpoint are
    included in the OpenAPI spec. Previously only the last call's query string was used.
  - **Request body `examples` map** — when an endpoint receives different payloads across
    calls, the spec uses `examples:` (plural) with entries named `call_1`, `call_2`, etc.
    instead of a single `example:`. Single-call endpoints keep the existing `example:` field.
  - **All response status codes captured** — if the same endpoint returns `200` on some calls
    and `400` / `404` on others, every observed status code appears in the spec with its own
    response schema and examples. Previously only the last call's status was recorded.

### Fixed

- **`toCurl`: auth header was non-functional for all authenticated APIs** — the generated
  `Authorization` header used single quotes (`-H 'Authorization: $SCANNER_AUTH_TOKEN'`),
  which suppresses shell variable expansion in POSIX shells. The token was also emitted
  without its scheme prefix. Fixed: double quotes and the original scheme are now preserved
  (`-H "Authorization: Bearer $SCANNER_AUTH_TOKEN"`).
- **`formDataCapture`: `fetch(new Request(...))` pattern silently dropped** — the browser-side
  intercept only triggered when `body` was on the `init` argument. Modern apps increasingly
  pass a `Request` object as the first argument with no `init`. These FormData uploads are
  now captured correctly.
- **`interactive`: final recording window duplicated on `q`** — pressing `q` pushed the
  closing window then called `rl.close()`, which triggered the close handler while `status`
  was still `'recording'`, pushing a second identical window. A new `'stopping'` status
  prevents the close handler from firing after an intentional quit.
- **`harNormalize`: multipart bodies with LF-only line endings produced empty params** — the
  multipart parser required `\r\n\r\n` as the header–body separator. Any server or reverse
  proxy that normalises to `\n` caused all fields to be silently dropped, resulting in no
  request body in the OpenAPI spec and a broken curl script. Line endings are now normalised
  before parsing.
- **`pathNormalise`: modern ID formats created one path per unique ID call** — the ID regex
  only recognised plain integers, UUID v4, and MongoDB ObjectId. APIs using ULID, CUID,
  NanoID, Snowflake IDs, Firebase UIDs, or other ≥20-char alphanumeric identifiers caused
  the OpenAPI spec to explode with one operation per unique ID instead of a single
  parameterised path. The regex now covers ULID, NanoID (21-char base64url), and a catch-all
  for any segment ≥20 alphanumeric characters.
- **`start`: automation script execution error leaked Chromium process** — if an automation
  script loaded successfully but threw during execution, the error propagated without closing
  the browser or context, leaving a zombie Chromium process running until the OS killed it.
  The script call is now wrapped in try/catch with `browser.close()` in the error path.
- **`drift`: baseline detection broken for session names ending in a digit** — session names
  like `sprint-3` or `v2` were parsed with a lazy regex that split the numeric suffix
  incorrectly, causing drift to always return null for these common naming patterns. The
  regex is replaced with an explicit `-(\d+)$` suffix split.

### Changed (breaking default)

- **Default URL filter changed from `**/api/**` to `**`** — Specothesis now captures all
  XHR/fetch requests by default instead of only those whose URL contains `/api/`. Use
  `--filter "**/api/**"` or `SCANNER_URL_FILTER=**/api/**` in `.env` to restore the old
  behaviour. The new default works out of the box for any API path convention.

### Fixed

- **Resource-type filter was silently disabled** — Playwright 1.x does not write `_resourceType`
  into HAR files. The previous guard used a falsy check (`if (resourceType && ...)`) which caused
  `undefined` to skip filtering entirely, passing page navigations, images, scripts, stylesheets,
  and fonts through into all generated outputs. `start` now collects resource types from live
  Playwright request events and back-fills `_resourceType` before filtering, so only `xhr`,
  `fetch`, and `other` entries are captured by default. `replay` auto-detects HAR files without
  `_resourceType` and skips the resource-type filter with a warning rather than excluding every entry.

### Added

- **`--all-resource-types` flag** and `SCANNER_ALL_RESOURCE_TYPES` env var — opt-in to capture
  every resource type (page navigations, images, scripts, stylesheets, fonts, etc.) instead of
  the default XHR/fetch-only filter. Useful when replaying a HAR exported from Chrome DevTools
  that already contains only the requests you care about, or when debugging what the full HAR
  contains.

- **`specint profile` subcommand** — manage saved auth profiles from the CLI without
  touching the filesystem directly:
  - `specint profile list` — tabular list of all saved profiles with creation date
  - `specint profile show <name>` — shows origins, cookie names, and localStorage key names
    (no secret values ever printed)
  - `specint profile delete <name>` — deletes a profile with an interactive confirmation
    prompt (`y/N`). Non-TTY/CI contexts treat the prompt as `N` (no accidental deletes).
- **Per-subcommand help** — `specint <command> --help` now shows options specific to that
  command instead of the global wall-of-text. Works for `start`, `replay`, `login`, `list`,
  and `profile`. `specint --help` (no explicit command) still shows the full global help.
- **`USAGE.md` and `ARCHITECTURE.md` included in npm package** — now shipped in the `files`
  array so `npm install -g specothesis` also installs the full reference docs.

### Changed

- **Interactive loop** — typing an unrecognised command now prints a specific acknowledgment
  (`Unknown command 'foo'. Valid: p (pause), q (stop)`) instead of silently re-printing the
  status line. Empty Enter re-prompts without noise.
- **Playwright version pin** tightened from `^1.44.0` to `~1.59.0` to prevent silent
  breakage from Playwright minor releases.
- **README auth section** — replaced prose with a quick-reference auth method matrix table
  and promoted the USAGE.md link to appear directly after the quickstart section.
- **README install section** — added a callout warning about `SCANNER_URL_FILTER` being the
  most common cause of empty output on first use.

### Fixed

- **OpenAPI security scheme matches `authMethod`** — the generated spec now declares the
  correct security scheme for each auth strategy:
  - `bearer-login` / `bearer-static` → `bearerAuth` (HTTP Bearer)
  - `api-key` → `apiKeyAuth` (`in: header, name: X-Api-Key`)
  - `basic` → `basicAuth` (HTTP Basic)
  - `none` → no `securitySchemes` block and no `security` on any operation
  Previously every spec always declared `bearerAuth` regardless of the configured auth method.
- **Per-endpoint `security` derived from captured traffic** — each operation now sets
  `security: [<scheme>]` only if the captured request contained an auth header; public
  endpoints (no auth header observed) get `security: [{}]` (OpenAPI "no auth required"
  override). Previously every operation was unconditionally marked as requiring Bearer auth.
- **Login operation only added for `bearer-login`** — the `POST /login` path is no longer
  prepended to the spec for `bearer-static`, `api-key`, `basic`, or `none` auth methods.
  Previously it appeared whenever `SCANNER_AUTH_URL` was set, regardless of auth method.
- **`hasAuth` recognises cookie and custom auth headers** — the coverage and anomaly pipeline
  now treats `cookie`, `x-auth-token`, `x-api-key`, `x-access-token`, and `x-authorization`
  as authenticated traffic, not just `authorization`. This eliminates false-positive
  `missing-auth` anomaly warnings for cookie-session and API-key based APIs.

### Tests

- **`tests/unit/schemaManifest.test.ts`** — 12 new unit tests for the schemathesis JUnit XML
  parser, using a real v4.16.1 fixture (`tests/fixtures/schemathesis-junit.xml`). Covers
  metadata, operation counts, endpoint parsing, failure/skip counting, test case ID and
  reason extraction, and the missing-file error path.

---

## [1.2.0] — 2026-05-16 — Architecture & test coverage

### Added (internal — no user-facing behaviour change)

- **`src/pipeline.ts`** — `runPipeline(opts)` extracted from `capture.ts` as a shared module
  used by both `start` and `replay` commands.
- **`src/commands/`** — `capture.ts` split into four command modules: `start.ts`, `login.ts`,
  `list.ts`, `replay.ts`. `capture.ts` is now a thin dispatcher.
- **`src/utils/pathNormalise.ts`** — shared `ID_SEGMENT` regex imported by both `coverage.ts`
  and `toOpenApi.ts` so path normalisation is consistent across the pipeline.
- **Test coverage: 12 test files, 135 tests** (up from 6 files, 49 tests). New files:
  `redact.test.ts`, `drift.test.ts`, `toOpenApi.test.ts`, `toStepci.test.ts`, `args.test.ts`,
  `config.test.ts`. Zero expected-fail tests.

### Fixed (internal)

- **`isSensitiveKey` false positives** — segment-aware matching now correctly skips
  `tokenCount`, `apikeystatus`, `secretaria` while still catching `access_token`,
  `client-secret`, `X-Api-Key`.
- **`redactKnownSecrets` minimum length** — lowered from 9 to 4 characters.
- **Duplicate login step in StepCI output** — when `authUrl` is set, the login endpoint is
  no longer duplicated as both a generated login step and a regular captured step.
- **Duplicate OpenAPI endpoint warning** — when two captured requests map to the same
  `method + path`, a warning is now logged instead of silently overwriting.
- **Deterministic `operationId` ordering** — groups are sorted before ID assignment so
  `operationId` values are stable across runs regardless of HAR entry order.
- **URL validation in `filterApiEntries`** — malformed URLs are now skipped gracefully
  instead of crashing downstream with `TypeError: Invalid URL`.
- **Glob regex compiled once** per `filterApiEntries` call (was compiled per entry).
- **`page.evaluate` result guarded** with `Array.isArray` before casting in `formDataCapture.ts`.
- **`SCANNER_API_URL` validated** as a proper URL in `validateConfig`.
- **`redact` moved to top-level `ScannerConfig`** — was incorrectly nested inside
  `ScannerFeatures` (output toggles). It is now `config.redact` at the top level.
- **`SCANNER_EXTRA_*` undefined values filtered** before forwarding to scripts.
- **`schemaManifest.ts`** — `attr()` now handles hex (`&#xNNNN;`) and decimal (`&#NNN;`)
  XML character entities.

### Refactored (internal)

- `drift.ts` — `computeDrift(baseline, current)` exported as a pure function; `detectDrift` delegates to it.
- `toOpenApi.ts` — `inferSchema` and `normalisePath` exported as named exports.
- `toStepci.ts` — `buildRequestBody` exported as a named export.
- `runPipeline` — now takes a single `PipelineOptions` object instead of positional args.
- Variable renames: `g` → `group` in `coverage.ts`; `re` → `filterRegex` in `harFilter.ts`.

---

## [1.1.2] — 2026-05-16 — Secret redaction & hardening

### Added

- **Secret redaction** (`SCANNER_ENABLE_REDACTION`, default `true`) — sensitive field values
  (passwords, tokens, API keys, secrets, credentials) are replaced with `[REDACTED]` in every
  generated output: OpenAPI examples, StepCI request bodies, curl commands (including JSON bodies),
  and query parameter values. The raw HAR file is never redacted so replay always works.
- **`src/utils/redact.ts`** — `isSensitiveKey()`, `redactObject()`, `redactKnownSecrets()` utilities
  with normalised key matching (case-insensitive, strips `-`/`_`/`.`).

### Improved

- **Actionable error on missing automation script** — dynamic import failures now throw a clear
  message with the resolved path and a hint to check for syntax errors.
- **Actionable error on missing HAR** — replay mode now prints the HAR path, the underlying OS
  error, and a hint to run `specint start` or export from Chrome DevTools.
- **Actionable error in schema manifest** — `buildManifest` now throws a descriptive error if
  the JUnit XML file is not found, instead of crashing with a raw `ENOENT`.
- **Browser-side FormData errors surfaced** — capture errors from the injected form-data monkey-patch
  are now collected in `window.__apiScannerErrors` and printed as warnings in Node rather than
  silently swallowed.
- **Filter tip on default filter** — when the default `**/api/**` filter is active, a tip is printed
  at capture start reminding users how to widen the filter.
- **Actionable "no entries matched" hint** — both the live-capture and replay code paths now print
  concrete filter examples when zero requests match, instead of a bare warning.
- **Username masked in non-TTY output** — `config.username` is shown as `***` in CI/pipe contexts.
- **`requests.sh` header** — generated combined curl file now explains the single-quoting convention
  and file placeholder format.
- **`SCANNER_EXTRA_*` warning in `.env.example`** — documents that EXTRA variables must not contain
  secrets.

---

## [1.1.1] — 2026-05-16 — Docs & install clarity

### Fixed

- **README** — added explicit `npx playwright install chromium` step after global install;
  added URL filter callout explaining that `**/api/**` is the default and requests that don't
  match the glob are silently skipped (the most common cause of empty output on first use).
- **README** — clarified that `npm install -g` is required for the bare `specint` command;
  local installs work via `npx specint` but do not put `specint` in PATH.

---

## [1.1.0] — 2026-05-15 — Quality uplift

### Added

- **`--version` / `-v` flag** — prints the installed npm version and exits.
- **`--quiet` / `-q` flag** and `SCANNER_QUIET` env var — suppresses per-request `[req]`/`[res]`
  log lines during capture. The final summary is always printed.
- **`--include-failed` flag** and `SCANNER_CAPTURE_FAILED` env var — opt-in to include requests
  that never received an HTTP response (network errors, CORS preflight failures, cancellations).
  Playwright records these as status `-1`; by default they are filtered out to prevent invalid
  OpenAPI status codes.
- **`specint replay` command** — runs the full post-processing pipeline on an existing HAR file
  without opening a browser. Useful for re-generating outputs after config changes or for
  importing DevTools exports.
  ```sh
  specint replay --har captures/checkout/raw.har --session checkout
  specint replay --har ~/Downloads/export.har --filter "**" --session full-import
  ```
- **StepCI `API_HOST` env block** — generated `stepci-workflow.yaml` now includes an `env`
  block with `API_HOST` extracted from the first captured request. Step URLs use
  `${{env.API_HOST}}/path` so the workflow can be retargeted to staging/prod without editing.
- **Configurable anomaly thresholds** via env vars:
  - `SCANNER_ANOMALY_SLOW_MS` — avg response time threshold (default: 2000 ms)
  - `SCANNER_ANOMALY_LARGE_KB` — response body size threshold (default: 500 KB)
  - `SCANNER_ANOMALY_REPEATED_N` — call count threshold (default: 5)
  - `SCANNER_PUBLIC_PATTERNS` — comma-separated extra path keywords treated as public
    (suppresses missing-auth warning; extends built-in list: login, signup, register, health,
    ping, status, public)
- **OpenAPI spec info overrides** via env vars: `SCANNER_API_TITLE`, `SCANNER_API_VERSION`,
  `SCANNER_API_DESCRIPTION` — customise the `info` block in generated specs.
- **CI / non-TTY detection** in `interactive.ts` — when stdin is not a TTY (e.g. piped input
  in CI), the interactive loop auto-stops when stdin closes instead of hanging.
- **`x + Enter` to cancel** the `login` profile save prompt without writing a profile file.
- **GitHub issue and PR templates** (`.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`).

### Fixed

- **Login profile not saved**: `rl.close()` fired the `'close'` event synchronously before
  `resolve({ saved: true })` could run, causing the profile to be silently discarded. Fixed with
  a `resolved` guard flag so only the first resolution wins.
- **Swagger `-1` status code errors**: Playwright records status `-1` for failed/cancelled
  requests. These are now filtered out by default (`SCANNER_CAPTURE_FAILED=false`), preventing
  invalid OpenAPI status codes that cause Swagger UI import errors.
- **`curl -s` → `curl -sS`** — silent mode now also shows errors (`-S`) so curl failures are
  not swallowed silently.
- **`toCurl` dropping custom headers** — `Authorization` and other captured headers are now
  correctly emitted. Previously only a hardcoded set of headers was included.
- **Session list sort order** — `specint list` now sorts sessions by modification time
  (newest first) instead of alphabetically.
- **Next-steps hint paths** — post-session hints now use relative paths from `cwd` instead of
  absolute paths, making output cleaner across machines.

### Changed

- **`normaliseCoveragePath`** exported from `coverage.ts` and reused in `anomalies.ts`,
  removing the duplicate inline implementation.

---

## [1.0.0] — 2026-05-13 — Phase 5: OSS Preparation

### Added

- **`README.md`** — public-facing homepage: quickstart, output file table, auth configuration
  guide, feature flags, CI example, links to USAGE.md and ARCHITECTURE.md.
- **`LICENSE`** — MIT license.
- **`CONTRIBUTING.md`** — dev setup, test capture walkthrough, how to add output formats and
  anomaly rules, PR conventions.
- **`package.json` — `bin` field**: `api-scanner` → `./dist/capture.js` for `npx` and global
  install (`npm install -g specothesis`).
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
  specint start --url https://app.com --only openapi

  # Spec + StepCI workflow
  specint start --url https://app.com --only openapi,stepci

  # Full HTML report suite
  specint start --url https://app.com --only html
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
