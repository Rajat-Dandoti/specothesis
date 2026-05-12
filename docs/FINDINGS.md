# API Scanner — Full Codebase Audit

> Thorough findings across all source files. Organized as: what works well, actual bugs, things that should be improved, and minute details that compound over time.

---

## What Works Well

### Architecture & Design

- **Clean linear pipeline.** `capture → filter → enrich → dedup → transform → report` flows without circular dependencies. Each stage is a pure function on `HarEntry[]`. Easy to follow, easy to test in isolation.

- **FormData CDP workaround is clever and correct.** Chrome's CDP doesn't capture multipart bodies in HAR files — this is a known browser-level limitation. The monkey-patch approach in `formDataCapture.ts` (injecting before page load via `context.addInitScript`) is the right fix. The FIFO queue + 15-second match window for correlating browser-captured entries back to HAR entries is practical and well-commented.

- **Feature flags for everything.** Every output and post-processing phase is independently toggleable via `SCANNER_ENABLE_*` env vars. This is excellent for CI use (disable HTML report) or minimal runs (openapi-only).

- **Interactive pause/resume is a real differentiator.** The recording window concept — where paused gaps are tracked as timestamps and used to filter HAR entries — means a user can navigate to the right place, start recording, pause, navigate elsewhere, resume, and get a clean HAR without noise. This is not obvious to implement and is done correctly.

- **Profile/session separation is well-designed.** Profiles (Playwright `storageState`) persist authentication across sessions. Sessions are separate named capture runs. The auto-increment logic (`checkout`, `checkout-2`, `checkout-3`) prevents accidental overwrite and enables drift comparison.

- **Multi-format output covers different user personas.** OpenAPI for API documentation / Swagger UI / schemathesis, StepCI for functional test replay, cURL for ad-hoc debugging. Three very different audiences served from one capture.

- **Drift detection is genuinely useful.** Comparing coverage summaries between sequential runs to detect added/removed/changed endpoints fills a gap that most API testing tools ignore.

- **Anomaly rules are practical.** Client errors, server errors, missing auth, slow responses, large payloads, repeated calls — all six rules catch real problems that show up in practice. The `PUBLIC_KEYWORDS` heuristic for suppressing false positives on login/health endpoints is sensible.

- **Login operation first in OpenAPI spec.** Placing the auth endpoint at the top of `paths` means Swagger UI shows it first, making the "authenticate then use the API" workflow natural for new users.

- **Shell quoting is correct in toCurl.** The `shellQuote` function properly handles single quotes within strings by ending the quote, adding an escaped single quote, and reopening. This is the correct POSIX approach and not something most tools get right.

- **`SCANNER_EXTRA_*` forwarding is a clean extension point.** Arbitrary key-value pairs forwarded to automation scripts without requiring config changes is a good API design pattern.

- **TypeScript strict mode.** `"strict": true` in `tsconfig.json` catches a real class of bugs at compile time.

- **`.env.example` is thorough.** Every variable is explained inline. This is the kind of documentation that actually gets read.

### Report Quality

- **HTML report is self-contained.** No external dependencies, no CDN calls — just inline CSS and JS. Works offline. The dark theme is readable.

- **Sortable coverage table with client-side JS.** The sort logic correctly handles both string and numeric columns via `data-sort` and `data-val` attributes. Works without a framework.

- **HAR filter comment in `harFilter.ts` explains a non-obvious design decision.** The note explaining why MIME type filtering is deliberately absent (API endpoints can return 201/no-body, text/plain, octet-stream, etc.) is exactly the kind of comment that prevents well-meaning future contributors from breaking things.

---

## Bugs

### `toCurl.ts` — `--data-urlencode` misuse

**File:** `src/transform/toCurl.ts`, `bodyFlags` function

The `application/x-www-form-urlencoded` case concatenates all parameters into a single `key1=val1&key2=val2` string and passes it to `--data-urlencode`. This is wrong — `--data-urlencode` URL-encodes its entire argument as a single value, so the resulting curl command would POST `key1%3Dval1%26key2%3Dval2` as a raw string rather than two separate form fields.

**Fix:** Each parameter should be its own `-d` flag or the approach should use separate `--data-urlencode "key=value"` calls per parameter.

```ts
// Wrong (current)
return [`--data-urlencode ${shellQuote(encoded)}`];

// Fix
return params.map((p) => `--data-urlencode ${shellQuote(`${p.name}=${p.value ?? ''}`)}`);
```

### `capture.ts` — `requestCount` counts unfiltered requests

**File:** `src/capture.ts`, `startCommand`

The `requestCount` counter is incremented on every `xhr`/`fetch` request, regardless of whether it matches `urlFilter`. The summary line then says "Captured N XHR/fetch requests total" — but N is frequently higher than the API entries extracted. This confuses users into thinking entries were dropped during processing when they weren't.

**Fix:** Count should reflect entries that passed the URL filter, or the message should distinguish "captured" from "matched filter".

### `capture.ts` — `response` event listener can throw on closed requests

**File:** `src/capture.ts`, `startCommand`

```ts
page.on('response', (res) => {
  if (['xhr', 'fetch'].includes(res.request().resourceType())) {
```

`res.request()` can throw if the request object has already been garbage-collected. This is a known Playwright edge case on navigation events. The event listener should be wrapped in `try/catch`.

### `anomalies.ts` — path normalization logic is duplicated from `coverage.ts`

**File:** `src/report/anomalies.ts`, `detectAnomalies`

The three-condition normalization (`^\d+$`, UUID regex, long hex) is copy-pasted from `coverage.ts:normaliseCoveragePath`. They are currently identical, but they can drift. If `coverage.ts` adds a new normalization rule (e.g. for slugs), `anomalies.ts` won't match correctly and endpoints will silently fail to be matched.

**Fix:** Export `normaliseCoveragePath` from `coverage.ts` and import it in `anomalies.ts`.

### `drift.ts` — previous session detection assumes unbroken naming chain

**File:** `src/report/drift.ts`, `loadPreviousCoverage`

The function strips a trailing `-N` suffix to find the "base" session. This means `checkout-5` compares against `checkout` (the base run), not `checkout-4`. If the intent is "compare against the immediately previous run", this is wrong — `checkout-5` should compare against `checkout-4`.

More practically: if a user manually renames or deletes sessions, the comparison target becomes unpredictable.

**Fix:** Document this behavior clearly, or change the comparison strategy to find the highest-numbered sibling that has a `coverage.json`.

### `config.ts` — `resolveConfig` silently drops `false` boolean overrides

**File:** `src/config.ts`, `resolveConfig`

```ts
Object.entries(cliOverrides).filter(([, v]) => v !== undefined && v !== '')
```

This correctly handles `false` (because `false !== undefined && false !== ''` is true), but `headless` CLI override has an additional problem in `capture.ts`:

```ts
headless: argv.headless || undefined,
```

`argv.headless` from minimist is `false` by default when the flag isn't passed. `false || undefined` evaluates to `undefined`. This means there's no way from the CLI to force `headless: false` if the env says `SCANNER_HEADLESS=true`. The flag only works one direction.

### `schemaManifest.ts` — XML parsing via regex is fragile

**File:** `src/report/schemaManifest.ts`

The `attr()` function and the JUnit parser use regex matching on raw XML strings. This works for schemathesis JUnit output because that format is predictable, but it will silently return wrong results or empty strings for:
- Multi-line attribute values
- CDATA sections
- Attributes with complex entities not listed in the decode list
- Namespace-qualified attribute names

**Fix:** This is acceptable scope-wise for v1, but should be documented as "schemathesis JUnit format only" and ideally replaced with a proper XML parser (`fast-xml-parser`) before being presented as a general tool.

---

## Should Be Improved

### Missing README.md (critical for open source)

There is no `README.md` at all. This is the single most important file for an open-source project. A first-time visitor to the repo has no idea what the tool does, how to install it, or how to use it.

Minimum viable README needs: what it is (one paragraph), install steps, quickstart (5 commands), full usage reference, and output format descriptions.

### Missing LICENSE file (required for open source)

No license means the project is technically "all rights reserved" by default in most jurisdictions. Pick one and add it before publishing. MIT is the standard choice for developer tools.

### No `bin` field in `package.json`

The tool is currently only usable by cloning the repo and running `npm run capture`. For open-source distribution via `npm install -g api-scanner`, a `bin` field is required:

```json
"bin": {
  "api-scanner": "./dist/capture.js"
}
```

This also requires adding a shebang (`#!/usr/bin/env node`) to the compiled output.

### No `engines` field

No Node.js version requirement is declared. The code uses `ES2022` target and `Node16` module resolution — it requires Node 18+. Users on older versions get cryptic errors.

```json
"engines": { "node": ">=18.0.0" }
```

### `toOpenApi.ts` — operations have no `operationId` or `tags`

OpenAPI `operationId` is required by most code generators (openapi-generator, fastAPI codegen, etc.) and many validators. Without it, generated clients use anonymous operation names. Tags are needed for grouping in Swagger UI — a spec with 40 endpoints and no tags becomes a flat unusable list.

Both can be derived automatically: `operationId` from `method + path segments`, tags from the first path segment after the version prefix.

### `toOpenApi.ts` — `last entry wins` is undocumented

When two captured requests match the same `method + URL template`, the second one silently overwrites the first in the OpenAPI spec. This means a `POST /api/items` called twice with different request bodies keeps only the last body schema. Users don't know this is happening.

Either document it clearly, or merge the entries (union of request body fields, union of response codes).

### No `--verbose` / `--quiet` flag

Every request is logged: `[req] GET https://api.example.com/api/items/123`. In a 200-request session this floods the terminal and obscures the useful summary. A `--quiet` mode that only prints the final summary would significantly improve usability.

### Feature flags not toggleable from CLI

Every feature flag is env-only (`SCANNER_ENABLE_HTML_REPORT=false`). CLI users doing one-off captures need to set env vars or edit `.env`. Simple `--no-html` / `--no-stepci` style flags would be more ergonomic.

### `anomalies.ts` — `PUBLIC_KEYWORDS` is hardcoded

The list `['login', 'signup', 'register', 'health', 'ping', 'status', 'public']` is hardcoded. Users with endpoints like `/api/webhook`, `/api/open`, or `/public-api/` that should be considered public have no way to suppress the "No Authorization header" warning.

Add `SCANNER_PUBLIC_PATTERNS=login,signup,/webhook` env var support.

### `toCurl.ts` — non-Authorization headers are stripped

The cURL generator only preserves the `Authorization` header, dropping everything else. APIs that require `X-Tenant-ID`, `X-API-Version`, `Accept: application/vnd.api+json`, or other custom headers produce curl commands that fail when replayed.

The existing SKIP list in `toStepci.ts` is a better model — preserve all headers except the known noisy ones.

### `interactive.ts` — CI environments get mangled output

The interactive loop always prints status lines with `\n  ● RECORDING  |  session: "..."`. In a CI pipeline where stdin is `/dev/null` or a pipe, this looks like noise. The loop should detect non-TTY stdin and either suppress status output or auto-stop immediately.

### No `--version` flag

Standard expectation for any CLI tool. One line change in `capture.ts` plus importing the version from `package.json`.

### `capture.ts` — no HAR replay mode

Some users already have HAR files from Chrome DevTools, Postman, or mitmproxy. A `npm run capture -- replay --har existing.har` mode that skips the browser entirely and runs only the processing pipeline would be a low-effort, high-value addition.

### `session.ts:listSessions` — sorts alphabetically, not by time

Sessions are returned sorted alphabetically, which means `checkout-10` comes before `checkout-2`. The sort should be by directory modification time (mtime) to show most recent first.

### `toCurl.ts` — `curl -s` silences errors

`-s` (silent) suppresses all output including error messages. Users who get a 401 see nothing. `-sS` (silent but show errors) is the standard recommendation.

### `toOpenApi.ts` — `info` is always generic

```yaml
info:
  title: Captured API
  version: 1.0.0
```

`--title` and `--version` CLI flags (or `SCANNER_API_TITLE`, `SCANNER_API_VERSION` env vars) would let users produce specs that are immediately usable without manual editing.

---

## Minute Things

### `.hypothesis/` directory is committed

The `.hypothesis/` directory contains property-based test examples (binary blobs). It should be in `.gitignore`. It has no value to contributors cloning the repo.

```
.hypothesis/
```

### `src/.DS_Store` is in the repository

macOS metadata file checked in. Add `**/.DS_Store` to `.gitignore`.

### `package.json` description is outdated

> "Capture API calls from Playwright journeys and export to OpenAPI + StepCI formats"

Doesn't mention drift detection, anomaly detection, coverage reporting, HTML reports, or schemathesis integration. Should be updated for v2 feature set.

### `ARCHITECTURE.md` at repo root but no `README.md`

Someone exploring the repo finds architecture diagrams but no explanation of what the tool is. The architecture doc is good content but wrong placement — it should be linked from a README.

### `coverage.ts` — auth column header/value mismatch

The auth column shows `✓` (/) and `✗` (x) but the value is based on whether any request in the group had an auth header — not whether all of them did. An endpoint called 10 times, 9 without auth and 1 with auth, would show as authenticated. This is slightly misleading and worth a comment.

### `anomalies.ts` — rule errors are silently swallowed

```ts
try {
  const message = rule.check(ep, epEntries);
} catch {
  // Malformed entry — skip and continue per spec
}
```

An empty `catch` block means a bug in a rule (e.g., a null pointer) produces no output. At minimum, this should log to stderr so rule failures are visible during development.

### `interactive.ts` — login only accepts `q` to save, no cancel

A user who opens the login command by mistake and wants to exit without saving a profile must Ctrl+C. There's no clean "abort" path. Adding `x` or `cancel` as a recognized command that exits without saving would improve the UX.

### `capture.ts` — `new URL(baseUrl).hostname` for auto session name

If `baseUrl` is `http://localhost:3000`, the session name becomes `localhost`. Multiple different local projects then share the same session directory name and increment into `localhost-2`, `localhost-3`, etc., making it hard to identify what's what.

### `printCoverageTable` — fixed column widths

`methodW = 6` is hardcoded. If someone adds `CONNECT` (7 chars) or `PROPFIND` (8 chars) to an anomaly rule, the table breaks alignment. Should be dynamic like `pathW` and `statusW` already are.

### `toStepci.ts` — `@ts-expect-error` comment on `captures` field

```ts
// @ts-expect-error — StepCI captures is valid at runtime but not in our local type
captures: {
  token: { jsonpath: '$.access_token' },
},
```

The `StepciStep` type doesn't model the `captures` field. This is a known gap but the workaround suppresses the type error globally. Better to extend the type with `captures?: Record<string, { jsonpath: string }>`.

### `config.ts` — `SCANNER_SESSION` env var has no CLI alias

Every other config value has a CLI flag alias. `session` only has `--session` and `--out`. The env var `SCANNER_SESSION` exists but isn't documented in the help text's "Credential env vars" section.

### Missing `CHANGELOG.md`

For open source, a changelog is a signal that the project is actively maintained and that breaking changes are communicated. Even a minimal "v1 → v2" entry would help.
