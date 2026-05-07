# API Scanner v2 — Implementation Plan

## Guiding rules
- One phase at a time; confirm before starting the next
- No regressions to existing outputs (`openapi.yaml`, `stepci-workflow.yaml`, `curls/`)
- No new npm packages unless unavoidable (Phases 2–5: zero new deps)
- Read every file before touching it

---

## Phase 0 — Feature Flags

**Files:** `src/config.ts`, `.env.example`  
**No other files touched in this phase.**

### Goal
Every toggleable behaviour — both existing v1 features and all new v2 phases — is controlled by a `SCANNER_ENABLE_*` env var. Default for all flags is `true` so existing behaviour is unchanged out of the box. Users opt out by setting a flag to `false` in `.env`.

### Flags to add

**Existing v1 features:**
| Env var | Controls | Default |
|---|---|---|
| `SCANNER_ENABLE_DEDUP` | Exact-match deduplication of repeated requests | `true` |
| `SCANNER_ENABLE_OPENAPI` | Generate `openapi.yaml` / `openapi.json` | `true` |
| `SCANNER_ENABLE_STEPCI` | Generate `stepci-workflow.yaml` | `true` |
| `SCANNER_ENABLE_CURL` | Generate `curls/` directory | `true` |

**New v2 phases:**
| Env var | Controls | Default |
|---|---|---|
| `SCANNER_ENABLE_EXAMPLES` | Phase 1 — embed real example values in OpenAPI spec | `true` |
| `SCANNER_ENABLE_COVERAGE` | Phase 2 — write `coverage.json` and print coverage table | `true` |
| `SCANNER_ENABLE_ANOMALIES` | Phase 3 — write `anomalies.json` and print anomaly section | `true` |
| `SCANNER_ENABLE_DRIFT` | Phase 4 — write `drift.json` and print drift section | `true` |
| `SCANNER_ENABLE_HTML_REPORT` | Phase 5 — write `report.html` | `true` |

> Phase 6 (`schema-manifest`) is a standalone CLI command, not part of the capture flow — no flag needed.

### Config changes (`src/config.ts`)
Add a `features` sub-object to `ScannerConfig`:
```ts
features: {
  dedup: boolean
  openapi: boolean
  stepci: boolean
  curl: boolean
  examples: boolean   // Phase 1
  coverage: boolean   // Phase 2
  anomalies: boolean  // Phase 3
  drift: boolean      // Phase 4
  htmlReport: boolean // Phase 5
}
```
Each field reads from its `SCANNER_ENABLE_*` env var, defaulting to `true`.

### `.env.example` addition
A new `# --- Feature flags ---` section listing all flags with their defaults and a one-line comment.

### How flags are used in `capture.ts`
Simple inline guards — no abstraction needed:
```ts
if (config.features.openapi)  toOpenApi(...)
if (config.features.stepci)   toStepci(...)
if (config.features.curl)     toCurl(...)

// dedup already happens before transforms — guard it there
const apiEntries = config.features.dedup ? deduplicateEntries(...) : beforeDedup

// v2 phases
if (config.features.coverage) { ... }
if (config.features.anomalies && summary) { ... }
// etc.
```

### Done when
- All flags present in `ScannerConfig` and read from env
- `.env.example` documents all flags
- `capture.ts` respects each flag (gates the relevant block)
- Setting `SCANNER_ENABLE_OPENAPI=false` suppresses openapi output; all other outputs unaffected

---

## Current data flow (v1)

```
HAR
 └─ filterApiEntries
 └─ filterByWindows
 └─ mergeFormDataIntoHar
 └─ enrichHarEntries
 └─ deduplicateEntries
 └─ writeFilteredHar
 └─ toOpenApi    → openapi.yaml / openapi.json
 └─ toStepci     → stepci-workflow.yaml
 └─ toCurl       → curls/
```

---

## Phase 1 — Real Example Payloads in OpenAPI Spec

**File:** `src/transform/toOpenApi.ts` only

**What changes:**
1. `inferSchema(value)` — add `example: value` alongside every inferred `type`
2. `buildRequestBodySpec()` — add top-level `example` on the schema object (full parsed JSON for `application/json`; `{ name: value }` map for multipart and urlencoded params)
3. `buildResponseSchema()` — attach the full parsed response object as `example` on the schema
4. Multipart file fields: use actual `p.fileName` in the placeholder (`"<path/to/avatar.png>"`) rather than the generic `"<path/to/file>"`
5. Response bodies: embed full JSON as-is; no size cap

**Done when:** `openapi.yaml` shows real captured values in `example` fields at property level and schema level.

---

## Phase 2 — Coverage Map

**New file:** `src/report/coverage.ts`

**Exports:**
```ts
buildCoverageSummary(entries: HarEntry[], sessionName: string): CoverageSummary
writeCoverageReport(summary: CoverageSummary, outDir: string): void
printCoverageTable(summary: CoverageSummary): void
```

**Path normalization (coverage only, not OpenAPI):**
Replace with `{id}`:
- Pure numeric segments (`123`)
- UUID format (`550e8400-e29b-41d4-a716-446655440000`)
- Hex strings longer than 8 chars (`a3f9c2b1d4e5`)

**Wire-up in `capture.ts`** (after existing transforms):
```ts
const summary = buildCoverageSummary(apiEntries, sessionName)
writeCoverageReport(summary, runDir)     // writes coverage.json
printCoverageTable(summary)              // prints table to terminal
```

**Terminal output:**
```
--------------------------------------------------------------
  SESSION: product-listing   14 requests   8 endpoints
--------------------------------------------------------------
  METHOD  PATH                          STATUS   AUTH   AVG
  POST    /api/auth/login               200      x      143ms
  GET     /api/products                 200      /      89ms
--------------------------------------------------------------
```
(plain ASCII dashes; `✓`/`✗` if terminal supports unicode, else `/`/`x`)

**Done when:** every session writes `coverage.json` and prints the table.

---

## Phase 3 — Anomaly Detection

**New file:** `src/report/anomalies.ts`

**Exports:**
```ts
detectAnomalies(summary: CoverageSummary, entries: HarEntry[]): Anomaly[]
writeAnomalyReport(anomalies: Anomaly[], outDir: string): void
printAnomalies(anomalies: Anomaly[]): void
```

**Rules (array of rule objects, not scattered if-statements):**

| ID | Severity | Condition |
|---|---|---|
| `client-error` | warn | any 4xx status captured |
| `server-error` | warn | any 5xx status captured |
| `missing-auth` | warn | no Authorization header on non-public endpoint |
| `slow-response` | info | avg response > 2000ms |
| `large-response` | info | any response body > 500kb |
| `repeated-calls` | info | same endpoint called > 5 times |

**"Public" path heuristic:** path contains `login`, `signup`, `register`, `health`, `ping`, `status`, or `public`.

**Terminal output:**
- warn anomalies → full list with endpoint + rule + message
- info only → `  ℹ  N informational findings — see anomalies.json`
- none → `  ✓  No anomalies detected`

**Done when:** `anomalies.json` written; terminal shows anomaly section after coverage table.

---

## Phase 4 — Drift Detection

**New file:** `src/report/drift.ts`

**Exports:**
```ts
detectDrift(current: CoverageSummary, previous: CoverageSummary): DriftReport
loadPreviousCoverage(currentDir: string): CoverageSummary | null
writeDriftReport(drift: DriftReport, outDir: string): void
printDrift(drift: DriftReport): void
```

**Auto-detect previous session:**
- Current dir: `captures/checkout-2/`
- Strip trailing `-N` → base `checkout`
- Load `captures/checkout/coverage.json`
- If not found: skip silently (no output, no file)

**"Changed" criteria:** status codes set differs OR auth presence flipped.

**Done when:** second run of same session shows drift output; `drift.json` written.

---

## Phase 5 — HTML Report

**New file:** `src/report/htmlReport.ts`

**Exports:**
```ts
generateHtmlReport(
  summary: CoverageSummary,
  anomalies: Anomaly[],
  drift: DriftReport | null,
  outDir: string
): void
```

**Requirements:**
- Single self-contained file — all CSS/JS inlined, no CDN, no external deps
- No frameworks; plain HTML/CSS/JS only
- Target < 200kb for 50+ endpoints
- Sections: Header → Anomalies → Drift → Coverage table (sortable by clicking column header) → Footer
- Design: dark background, monospace font for paths/methods, color only for signal (red = error, amber = warning, green = ok, grey = info)
- Table sort: plain JS, click column header to toggle asc/desc

**Wire-up in `capture.ts`** (after Phase 4):
```ts
generateHtmlReport(summary, anomalies, drift ?? null, runDir)
console.log(`  Report: ${runDir}/report.html`)
```

**Done when:** `report.html` opens in browser with working sort.

---

## Phase 6 — Schemathesis Test Execution Manifest

**New files:**
- `src/report/schemaManifest.ts` — parser/manifest builder
- `src/report/schemaManifestCli.ts` — CLI entry point

**Pre-work (before any code):**
```bash
schemathesis run --help | grep -iE "report|junit|output"
schemathesis --version
```
If JUnit flag exists → use it. If not → write `src/report/NOTE.md` documenting this, implement parser anyway so it's ready.

**New package.json script (only addition — no changes to existing scripts):**
```json
"schema-manifest": "node --loader ts-node/esm src/report/schemaManifestCli.ts"
```

**Usage:**
```bash
schemathesis run ./captures/checkout-2/openapi.yaml --url https://... --checks all --report junit.xml
npm run schema-manifest -- --junit junit.xml --session checkout-2
```

**XML parsing:** start with Node's built-in `fs` + regex/string; add `fast-xml-parser` only if structure requires it.

**Expected JUnit structure:**
```xml
<testsuites>
  <testsuite name="POST /api/orders" tests="47" failures="3" errors="0">
    <testcase name="...">
      <failure>failure message</failure>
    </testcase>
  </testsuite>
</testsuites>
```

**HTML report addendum (Phase 5):** if `schemathesis-manifest.json` exists in the session dir when generating `report.html`, include a Schemathesis section. If absent, skip silently.

**Done when:** `npm run schema-manifest` produces correct `schemathesis-manifest.json`; HTML includes schemathesis section when manifest exists.

---

## Final wire-up in capture.ts

```ts
// existing
toOpenApi(apiEntries, runDir, config.apiUrl, config.authUrl)   // Phase 1: now has examples
toStepci(apiEntries, sessionName, runDir, config.authUrl)
toCurl(apiEntries, runDir)

// Phase 2
const summary = buildCoverageSummary(apiEntries, sessionName)
writeCoverageReport(summary, runDir)
printCoverageTable(summary)

// Phase 3
const anomalies = detectAnomalies(summary, apiEntries)
writeAnomalyReport(anomalies, runDir)
printAnomalies(anomalies)

// Phase 4
const prev = loadPreviousCoverage(runDir)
const drift = prev ? detectDrift(summary, prev) : null
if (drift) { writeDriftReport(drift, runDir); printDrift(drift) }

// Phase 5
generateHtmlReport(summary, anomalies, drift, runDir)
console.log(`  Report: ${path.join(runDir, 'report.html')}`)
```
