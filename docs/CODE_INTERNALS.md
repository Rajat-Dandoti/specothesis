# Code Internals Reference

> How the code actually works. For contributors, maintainers, and anyone curious about the implementation decisions.

---

## Pipeline Overview

Every capture run goes through the same stages in sequence. Each stage operates on `HarEntry[]` — the raw HAR log entry shape — so stages are independently testable.

```
Browser (Playwright)
  └─ records raw.har
       └─ filterApiEntries()       — URL glob + resource type filter
            └─ filterByWindows()   — exclude requests made while paused
                 └─ mergeFormDataIntoHar()  — inject JS-captured multipart bodies
                      └─ enrichHarEntries() — parse multipart boundary text → params
                           └─ deduplicateEntries()  — method+url+body fingerprint
                                └─ writes filtered.har
                                     ├─ toOpenApi()     → openapi.yaml + openapi.json
                                     ├─ toStepci()      → stepci-workflow.yaml
                                     ├─ toCurl()        → curls/*.sh + requests.sh
                                     └─ buildCoverageSummary()
                                          ├─ writeCoverageReport() → coverage.json
                                          ├─ detectAnomalies()    → anomalies.json
                                          ├─ detectDrift()        → drift.json
                                          └─ generateHtmlReport() → report.html
```

---

## Module Responsibilities

### `capture.ts`
Thin CLI dispatcher. Parses `process.argv`, builds config via `resolveConfig`, validates, then dispatches to the matching command module via dynamic `import()`. No business logic — all command logic lives in `src/commands/`.

### `args.ts`
CLI argument parsing and `--only` flag resolution. `resolveOnlyFlag(str, baseFeatures)` parses a comma-separated `--only` value into a `ScannerFeatures` object with implied dependencies wired up (e.g. `anomalies` implies `coverage`, `html` implies `coverage + anomalies + drift`). Extracted from `capture.ts` to be independently testable.

### `commands/start.ts`
Browser capture flow. Opens Playwright, injects the form-data capture script, runs the automation script or the interactive loop, then calls `runPipeline` with the captured entries.

### `commands/login.ts`
Login-only flow. Opens the browser, waits for the user's save signal, writes Playwright `storageState` to `profiles/<name>.json`.

### `commands/list.ts`
Reads `profiles/` and `captures/` from the filesystem and prints a formatted summary.

### `commands/replay.ts`
Reads an existing HAR file from disk and calls `runPipeline` — no browser lifecycle involved.

### `pipeline.ts`
`runPipeline(opts: PipelineOptions)` — the shared post-capture step sequence. Accepts `{ apiEntries, sessionName, runDir, config }`. Filters, deduplicates, writes `filtered.har`, then runs all enabled transforms (`toOpenApi`, `toStepci`, `toCurl`) and reports (`coverage`, `anomalies`, `drift`, `htmlReport`). Called by both `commands/start.ts` and `commands/replay.ts`.

### `config.ts`
Single source of truth for all configuration. Loads `.env`, reads environment variables, and merges CLI overrides. Exports `resolveConfig()` which CLI callers use to produce a fully-resolved `ScannerConfig`. Also exports `AUTH_ENV_REFS` — the mapping from lowercase header names to their StepCI env variable references (`authorization → ${{env.SCANNER_AUTH_TOKEN}}`). `redact` is a top-level field on `ScannerConfig` (not inside `ScannerFeatures`) since it's a behaviour modifier, not an output toggle.

**Priority order:** CLI flags > env vars > .env file > hardcoded defaults.

### `session.ts`
Filesystem operations for profiles and sessions. Profiles are Playwright `storageState` JSON files in `profiles/`. Sessions are output directories in `captures/`. `makeSessionDir` handles the auto-increment logic (`checkout/`, `checkout-2/`, etc.).

### `interactive.ts`
Terminal UX for manual capture sessions. Implements a readline-based command loop that handles `p` (pause), `r` (resume), `q` (stop). Returns an array of `RecordingWindow` objects representing the time intervals when recording was active — these are later used by `filterByWindows` to exclude requests made during paused gaps.

### `utils/harFilter.ts`
Core HAR types and filtering logic. Defines `HarEntry` and `Har`. Contains:
- `globToRegex()` — converts `**/api/**` glob syntax to a `RegExp`
- `filterApiEntries()` — applies URL filter and resource type check
- `filterByWindows()` — excludes entries outside recording windows
- `deduplicateEntries()` — exact dedup by method + URL + body fingerprint
- `writeFilteredHar()` — writes the filtered subset back to disk

### `utils/harNormalize.ts`
Fixes Playwright's multipart body representation. Playwright records multipart bodies as raw boundary text in `postData.text` and leaves `postData.params` empty. `enrichHarEntries()` parses the boundary text into structured `HarPostDataParam[]` in-place. Downstream code only ever needs to read `postData.params`.

### `utils/formDataCapture.ts`
Solves the CDP multipart body capture problem. Chrome's CDP does not expose multipart request bodies in HAR files at all — `bodySize` is 0, `postData` is missing. The fix: inject a self-contained IIFE into the page before any requests fire that monkey-patches `window.fetch` and `XMLHttpRequest.send`. The patch serializes `FormData` fields into `window.__apiScannerFd[]`. Capture errors from the injected script are accumulated in `window.__apiScannerErrors[]` and surfaced back to Node as warnings. After the session ends, `collectCapturedFormData()` reads that array from the browser and `mergeFormDataIntoHar()` correlates the entries back to HAR entries by method + URL + timestamp proximity (15-second window, FIFO queue per endpoint).

### `utils/pathNormalise.ts`
Shared `ID_SEGMENT` regex used by both `coverage.ts` and `toOpenApi.ts` to agree on which path segments are dynamic (integers, UUIDs, 24-char MongoDB ObjectIds). Previously each module had its own diverging regex, causing edge cases where coverage keys and OpenAPI path templates disagreed on the same URL. Importing from a single source eliminates that class of mismatch.

### `utils/redact.ts`
Key-name-based secret redaction applied at the transform layer (not HAR layer). `isSensitiveKey(key)` uses segment-aware matching: splits on `-`/`_`/`.` separators and checks the last segment against `SENSITIVE_SUFFIXES` — preventing false positives like `tokenCount` or `apikeystatus` while still catching `access_token`, `client-secret`, `X-Api-Key`. `redactObject(obj)` walks an arbitrary JSON value and replaces matching leaf values with `[REDACTED]`. Called by all three transform modules when `redact=true` (default, controlled by `SCANNER_ENABLE_REDACTION`).

### `transform/toOpenApi.ts`
Generates OpenAPI 3.0.3 spec from `HarEntry[]`. Key behaviors:
- Groups entries by `method + normalised path template`. Last entry per group wins.
- `normalisePath()` — exported named export — replaces numeric and UUID path segments with `{name}Id` parameters, deriving the name from the preceding segment.
- `inferSchema()` — exported named export — infers JSON Schema from any JS value recursively.
- Builds a login operation from `authUrl` if provided, placing it first in `paths`.
- Emits per-operation `servers` override when an entry's host differs from the global base origin.
- Redacts sensitive field values in examples via `redactObject()` when `redact=true`.

### `transform/toStepci.ts`
Generates a StepCI workflow YAML. Key behaviors:
- Skips noisy/session-specific headers via `SKIP_HEADERS` set.
- Replaces auth header values with env-var references (`${{env.SCANNER_AUTH_TOKEN}}`).
- When `authUrl` is set, prepends a login step that captures the JWT via `captures.token`, and all subsequent `Authorization` headers reference `${{captures.token}}` instead.
- `buildRequestBody()` — exported named export — handles three body types: `json:`, `formData:`, and raw `body:`.
- Generates `jsonpath` checks from the top 5 keys of a JSON response (presence checks only).
- Redacts sensitive field values in request bodies via `redactObject()` when `redact=true`.

### `transform/toCurl.ts`
Generates shell scripts. Writes one `.sh` per request plus a combined `requests.sh`. Preserves all non-noisy headers (drops `host`, `connection`, `content-length`, `accept-encoding`). Replaces `Authorization` value with `$SCANNER_AUTH_TOKEN`. Handles multipart (`-F`), JSON (`--data-raw` + Content-Type header), and form-encoded bodies. JSON bodies are parsed and redacted via `redactObject()` when `redact=true`.

### `report/coverage.ts`
Aggregates `HarEntry[]` into a `CoverageSummary` structure grouped by `method + normalised path`. Records per-endpoint: status codes seen, call count, auth presence, average response time, request/response sizes. Also handles the coverage table terminal output (`printCoverageTable`).

Path normalization here: UUIDs → `{id}`, numeric strings → `{id}`, long hex strings → `{id}`.

### `report/anomalies.ts`
Runs a set of `Rule` objects over the coverage summary + raw entries. Each rule returns a message string or `null`. Currently six rules: `client-error`, `server-error`, `missing-auth`, `slow-response`, `large-response`, `repeated-calls`. The `missing-auth` rule suppresses false positives for known public endpoints via `PUBLIC_KEYWORDS` heuristic.

### `report/drift.ts`
Compares the current `CoverageSummary` against a previous one to detect endpoint additions, removals, and changes. Change detection covers: status codes set equality, auth presence flip. `loadPreviousCoverage` finds the base session (first run without a numeric suffix) in the same `captures/` directory. The pure comparison logic is exported as `computeDrift(baseline, current)` — `detectDrift` delegates to it after loading files.

### `report/htmlReport.ts`
Generates two HTML reports:
1. `generateHtmlReport()` — session report combining coverage, anomalies, and drift into a single dark-theme HTML file with a sortable table.
2. `generateSchemaHtmlReport()` — schemathesis report showing per-operation test failures with reproduce-curl commands.

All CSS and JS is inline. No external dependencies. The sort JS attaches click handlers to `th[data-sort]` elements and sorts `tr` rows by `data-val` (for numeric) or `textContent` (for string).

### `report/schemaManifest.ts`
Parses schemathesis JUnit XML output into a structured `SchemaManifest`. Uses regex-based XML parsing (not a full XML parser) tuned for schemathesis's specific JUnit format. Extracts: test case name (operation), failure messages, received status codes, reproduce-curl commands. CLI entry point is `schemaManifestCli.ts`.

---

## Key Design Decisions

### Why HAR instead of a proxy?

Playwright's built-in HAR recorder (`recordHar`) captures traffic at the browser level without requiring a system-level proxy configuration. Users don't need to install certificates, configure network settings, or deal with HTTPS interception. It just works for any browser traffic from any app.

The trade-off: HAR recording goes through Chrome's CDP, which has the multipart body limitation described in `formDataCapture.ts`. The JS injection workaround handles this.

### Why `context.addInitScript` for FormData capture?

`addInitScript` runs before any page JavaScript, including any page-level `fetch` patches the app may have. This guarantees the capture script sees FormData before the app can modify it. Using `page.evaluate()` after page load would be too late.

### Why `last entry wins` for OpenAPI grouping?

The alternative — merging schemas across all entries for the same operation — requires schema union logic that is significantly more complex and can produce overly permissive schemas. The current approach prioritizes the most recent example, which is typically the most fully-populated body from a complete user flow. This is a pragmatic trade-off documented in FINDINGS.md as a known limitation.

### Why not filter by MIME type?

HAR entries for API responses frequently have:
- No body (201 Created, 204 No Content)
- `text/plain` (some legacy APIs)
- `application/octet-stream` (file downloads via API)
- Missing or incorrect `Content-Type` headers

Filtering on MIME type would silently drop these real API endpoints. URL pattern + resource type (xhr/fetch) is the correct scope.

### Why duplicate path normalization in `anomalies.ts`?

This is a known bug (see FINDINGS.md). The normalization was written twice during the v2 development phase. It should be consolidated into a shared export from `coverage.ts`. The implementations are currently identical but can drift.

### Why inline CSS/JS in the HTML report?

The report is designed to be a self-contained artifact that can be:
- Emailed as an attachment
- Opened offline
- Checked into git as documentation
- Served from any static file host without an associated CSS file

Zero external dependencies is a deliberate choice over cleanliness.

### Why `SCANNER_EXTRA_*` for script forwarding?

Automation scripts need environment-specific values (tenant IDs, feature flags, test data identifiers) that aren't generic enough to deserve a first-class config field. The `SCANNER_EXTRA_*` pattern lets users add arbitrary named values without requiring code changes. The `extras` map is passed as part of `ScannerConfig` to automation scripts.

---

## Adding a New Output Format

1. Create `src/transform/toMyFormat.ts` with a function: `export function toMyFormat(entries: HarEntry[], outDir: string, config: ScannerConfig): void`
2. Add a feature flag to `ScannerFeatures` in `config.ts`: `myFormat: boolean`
3. Add the env var to `defaultConfig`: `myFormat: envBool('SCANNER_ENABLE_MY_FORMAT', true)`
4. Import and call in `capture.ts` under the feature flag check
5. Add `SCANNER_ENABLE_MY_FORMAT=true` to `.env.example` with a comment

## Adding a New Anomaly Rule

All anomaly rules live in the `RULES` array in `src/report/anomalies.ts`. Add a new object:

```ts
{
  id: 'my-rule',
  severity: 'warn', // or 'info'
  check(ep: EndpointCoverage, epEntries: HarEntry[]): string | null {
    // return a message string if the rule fires, null if it doesn't
    if (someCondition) return 'Description of the problem';
    return null;
  },
}
```

The rule receives both the aggregated `EndpointCoverage` (stats) and the raw `HarEntry[]` for that endpoint (for response body inspection, header checks, etc.).
