# Architecture

> How Specothesis is structured, how data flows through it, and why the key design decisions were made.

---

## Pipeline overview

Every capture run passes through the same linear pipeline. Each stage operates on `HarEntry[]` and can be tested independently.

```
Browser (Playwright)
  └─ records raw.har
       └─ filterApiEntries()        URL glob + resource type (xhr/fetch)
            └─ filterByWindows()    exclude requests made while paused
                 └─ mergeFormDataIntoHar()   inject JS-captured multipart bodies
                      └─ enrichHarEntries()  boundary text → structured params
                           └─ deduplicateEntries()  method+url+body fingerprint
                                └─ filtered.har
                                     │
                         ┌───────────┼───────────┐
                         ▼           ▼           ▼
                    toOpenApi()  toStepci()  toCurl()
                     ↓ redact()   ↓ redact()  ↓ redact()   (SCANNER_ENABLE_REDACTION)
                    .yaml/.json  .yaml       curls/*.sh
                                     │
                         buildCoverageSummary()
                              │
                    ┌─────────┼──────────┐
                    ▼         ▼          ▼
               coverage.json  anomalies.json  drift.json
                    └──────────────────────────┘
                                  │
                           generateHtmlReport()
                                  │
                            report.html
```

After a schemathesis run against the generated spec:

```
openapi.yaml
  └─ schemathesis run → junit.xml
       └─ schemaManifestCli.ts
            └─ schemathesis-manifest.json
            └─ schemathesis-report.html
```

---

## Module map

| Module | Responsibility |
|---|---|
| `capture.ts` | CLI entry point. Owns browser lifecycle and pipeline sequencing. Delegates arg parsing to `args.ts` and config resolution to `config.ts`. No business logic. |
| `args.ts` | CLI argument parsing. `resolveOnlyFlag(str, baseFeatures)` resolves the `--only` flag into a `ScannerFeatures` object with implied dependencies (e.g. `anomalies` → `coverage`). |
| `config.ts` | Single source of truth for all configuration. `resolveConfig()` merges CLI flags > env vars > `.env` > defaults. Exports `AUTH_ENV_REFS` (header name → StepCI env var reference). |
| `session.ts` | Filesystem for profiles and sessions. `makeSessionDir` handles auto-increment (`checkout`, `checkout-2`, …). |
| `interactive.ts` | Readline-based `p` / `r` / `q` loop. Returns `RecordingWindow[]` — the active time intervals used downstream to filter HAR entries. |
| `utils/harFilter.ts` | Core HAR types (`HarEntry`, `Har`) and filtering: URL glob, resource type, window filter, deduplication. |
| `utils/harNormalize.ts` | Multipart boundary text parser. Playwright records multipart bodies as raw text; `enrichHarEntries()` converts them to structured `params[]` in-place. |
| `utils/formDataCapture.ts` | CDP multipart workaround. Chrome CDP omits multipart bodies entirely. An IIFE injected via `context.addInitScript` patches `window.fetch` and `XHR.send` to capture `FormData` fields into `window.__apiScannerFd[]`. After the session, `mergeFormDataIntoHar()` correlates them back by method + URL + timestamp. |
| `transform/toOpenApi.ts` | Generates OpenAPI 3.0.3. Groups entries by `method + normalised path`; last entry per group wins. Infers JSON Schema from bodies. Parameterises numeric/UUID path segments. Builds a login operation from `authUrl` if provided. |
| `transform/toStepci.ts` | Generates StepCI YAML. Skips noisy headers via `SKIP_HEADERS`. Replaces auth values with env-var references. When `authUrl` is set, prepends a login step and wires subsequent steps to `${{captures.token}}`. |
| `transform/toCurl.ts` | Generates shell scripts. One `.sh` per request + `requests.sh`. Keeps only `Authorization` (replaced by `$SCANNER_AUTH_TOKEN`). |
| `report/coverage.ts` | Aggregates `HarEntry[]` into `CoverageSummary` grouped by normalised path. Tracks: status codes, call count, auth presence, response times, body sizes. |
| `report/anomalies.ts` | Runs six `Rule` objects over the coverage summary + raw entries. Returns `Anomaly[]`. Rules: `client-error`, `server-error`, `missing-auth`, `slow-response`, `large-response`, `repeated-calls`. |
| `report/drift.ts` | Compares current `CoverageSummary` to the previous baseline session. Detects added/removed endpoints and status-code or auth-presence changes. |
| `report/htmlReport.ts` | Self-contained HTML report (inline CSS + JS). `generateHtmlReport()` for session report; `generateSchemaHtmlReport()` for schemathesis failures. |
| `report/schemaManifest.ts` | Regex-based JUnit XML parser tuned for schemathesis output. Extracts operation name, failure messages, status codes, reproduce-curl commands. |

---

## Key design decisions

### HAR recording over proxy

Playwright's `recordHar` captures traffic at the browser level without system-level proxy setup or certificate installation. The trade-off is the CDP multipart limitation — worked around by the JS injection in `formDataCapture.ts`.

### `context.addInitScript` for FormData capture

The intercept script must run before any page JavaScript (including any app-level `fetch` patches). `addInitScript` guarantees this. `page.evaluate()` after load would be too late.

### Last-entry-wins for OpenAPI grouping

Merging schemas across all captures of the same endpoint requires schema union logic that is both complex and produces overly permissive schemas. Using the most recent entry keeps the generator simple and captures the most recently observed body shape, which is typically the most complete.

### Inline CSS/JS in HTML reports

Reports are designed as portable, self-contained artifacts: safe to email, commit to git, or serve statically. Zero external dependencies is intentional.

### `SCANNER_EXTRA_*` for script forwarding

Automation scripts need app-specific values (tenant IDs, feature flags, test data) that are too narrow for first-class config fields. The `SCANNER_EXTRA_*` pattern lets users add arbitrary named values without code changes.

---

## Feature flag wiring

All nine pipeline outputs are individually toggleable via `SCANNER_ENABLE_*` environment variables. All default to `true`.

```
SCANNER_ENABLE_DEDUP          → deduplicateEntries()
SCANNER_ENABLE_OPENAPI        → toOpenApi()
SCANNER_ENABLE_STEPCI         → toStepci()
SCANNER_ENABLE_CURL           → toCurl()
SCANNER_ENABLE_EXAMPLES       → includeExamples param in toOpenApi()
SCANNER_ENABLE_COVERAGE       → buildCoverageSummary() + printCoverageTable()
SCANNER_ENABLE_ANOMALIES      → detectAnomalies()
SCANNER_ENABLE_DRIFT          → detectDrift()
SCANNER_ENABLE_HTML_REPORT    → generateHtmlReport()
```

---

## Extending the tool

### Adding a new output format

1. Create `src/transform/toMyFormat.ts` — export `function toMyFormat(entries: HarEntry[], outDir: string, config: ScannerConfig): void`
2. Add `myFormat: boolean` to `ScannerFeatures` in `config.ts`
3. Add `myFormat: envBool('SCANNER_ENABLE_MY_FORMAT', true)` to `defaultConfig`
4. Import and call in `capture.ts` under the feature flag guard
5. Add `SCANNER_ENABLE_MY_FORMAT=true` to `.env.example`

### Adding a new anomaly rule

All rules live in the `RULES` array in `src/report/anomalies.ts`:

```ts
{
  id: 'my-rule',
  severity: 'warn',  // or 'info'
  check(ep: EndpointCoverage, epEntries: HarEntry[]): string | null {
    if (someCondition) return 'Description of the problem';
    return null;
  },
}
```

The rule receives both the aggregated `EndpointCoverage` stats and the raw `HarEntry[]` for that endpoint.
