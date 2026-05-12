# Roadmap

> Potential improvements and features, organized by impact and effort. These are possibilities, not commitments.

---

## Near-Term (Quick wins, high value)

### ✓ Fix: curl `--data-urlencode` bug — Done
Each param now emits its own `--data-urlencode "key=value"` flag in `toCurl.ts`.

### ✓ Fix: StepCI leaking `user-agent`, `origin`, `referer` — Done
All three added to `SKIP_HEADERS` in `toStepci.ts`.

### ✓ Fix: duplicate path parameter names in OpenAPI — Done
`normalisePath` in `toOpenApi.ts` now appends a counter suffix on collision (`itemId`, `itemId2`). Also skips version-prefix segments (`v1`, `v2`) when deriving the parameter name.

### Fix: export `normaliseCoveragePath` from `coverage.ts`
The path normalization logic is duplicated in `anomalies.ts`. Export the function once, import everywhere. Prevents future drift between the two implementations.

### Feature: `--quiet` flag
Suppress per-request `[req]`/`[res]` log lines. Print only the final summary. Makes the tool usable in CI without scrollback noise.

### Feature: `--version` flag
One line. Reads from `package.json`. Expected by every CLI user.

### Feature: auto `operationId` and `tags` in OpenAPI output
Derive `operationId` from `METHOD_path_segments` (e.g. `GET_api_users_userId`). Derive tag from the first meaningful path segment. Required for code generators; makes Swagger UI usable for large specs.

### Fix: toCurl — preserve custom request headers
Currently only `Authorization` is kept. APIs requiring `X-Tenant-ID`, `Accept: application/vnd.api+json`, or other non-standard headers produce curl commands that fail silently. Preserve all headers except the known-noisy skip list (same approach as `toStepci.ts`).

### Fix: `curl -s` → `curl -sS`
Silent mode (`-s`) hides error messages too. `-sS` is silent but still prints errors. One character change.

---

## Medium-Term (Meaningful additions, moderate effort)

### HAR replay mode
```sh
api-scanner replay --har path/to/export.har --session my-session
```
Process an existing HAR file through the full pipeline (filter → enrich → transform → report) without launching a browser. Unlocks use cases for:
- Users with HAR exports from Chrome DevTools
- Postman collection conversions
- mitmproxy captures
- CI pipelines where the browser session happened separately

The pipeline from `filterApiEntries` onward already handles `HarEntry[]` — this is mostly plumbing to load the HAR and skip the Playwright step.

### Configurable anomaly thresholds via env vars
Allow tuning without code changes:
```
SCANNER_ANOMALY_SLOW_MS=2000         # default: 2000ms threshold for slow-response rule
SCANNER_ANOMALY_LARGE_KB=500         # default: 500kb for large-response rule
SCANNER_ANOMALY_REPEATED_N=5         # default: 5 for repeated-calls rule
SCANNER_PUBLIC_PATTERNS=login,webhook # extend the public-path keyword list
```

### OpenAPI spec customization flags
```
SCANNER_API_TITLE=My API
SCANNER_API_VERSION=2.1.0
SCANNER_API_DESCRIPTION=Captured from production traffic
```
Users currently have to manually edit the generated spec before using it anywhere. These env vars would produce immediately publishable output.

### Merge mode for OpenAPI (union of all entries per operation)
Currently, when the same `METHOD + path template` appears twice, the last entry wins. A `--merge-strategy=union` mode would:
- Collect all response status codes seen (not just from the last entry)
- Union request body fields across all entries for the same operation
- Produce a richer, more accurate spec from multi-call sessions

### `--output-dir` flag
Custom output directory instead of always writing to `captures/<session>/`. Useful for integration with external CI artifact systems.

### Session comparison across arbitrary runs (not just consecutive)
Current drift detection only compares against the base run (`checkout-4` compares against `checkout`, not `checkout-3`). An explicit `--compare-session <name>` flag would let users compare any two sessions:
```sh
api-scanner start --session checkout-v2 --compare-session checkout-v1
```

### Non-TTY / CI detection
When stdin is not a TTY (no interactive terminal), automatically stop recording after the automation script completes, suppress status-line output, and never prompt for input.

---

## Longer-Term (Bigger features, higher effort)

### Test suite
Property-based and unit tests for the pure functions:
- `globToRegex` — glob matching edge cases (empty strings, double wildcards, query strings)
- `normalisePath` / `normaliseCoveragePath` — ID detection edge cases (short UUIDs, numeric slugs that are NOT IDs)
- `parseMultipartText` — boundary parsing with nested boundaries, unusual content types
- `deduplicateEntries` — dedup edge cases across methods and bodies
- `detectDrift` / `detectAnomalies` — with fixture HAR data

Hypothesis examples already exist (`.hypothesis/`) suggesting property-based testing was explored. Formalizing these as `vitest` or `jest` tests would enable CI quality gates.

### `npx`-installable package
Publish to npm so `npx api-scanner start --url https://example.com` works without cloning. Requires:
- `bin` field in `package.json`
- Shebang on compiled entry point
- Deciding whether Playwright is bundled or a peer dependency
- Browser download strategy (auto-download on first run, similar to how Playwright handles it)

### Docker image
Playwright + Chromium in a container. Lets QA teams use the tool without Node.js installed:
```sh
docker run --rm -v $(pwd)/captures:/app/captures \
  ghcr.io/<org>/api-scanner start \
  --url https://staging.example.com \
  --session my-session
```

### Plugin system for custom output formats
A `--plugin <path>` flag that loads a module exporting a `transform(entries, outDir, config)` function. Let users generate Insomnia collections, Postman collections, Pact contracts, k6 scripts, or any other format without forking.

### Automatic secret redaction
Before writing OpenAPI examples, StepCI workflows, or curl commands, run captured values through a pattern matcher for common secret shapes (JWT tokens, API keys, passwords in JSON bodies, bearer tokens). Replace detected secrets with `<REDACTED>` rather than real values. This is important for safe open-source usage — users accidentally committing outputs with real creds is a real risk.

Patterns to detect: `Authorization: Bearer eyJ...`, `"password": "..."`, `"token": "..."`, `"api_key": "..."`.

### Web UI for session management
A local `api-scanner ui` command that starts a small Express/Fastify server serving a browser UI to:
- Browse past sessions
- View and compare HTML reports side-by-side
- Manage profiles
- Trigger new captures

Niche, but would make the tool more approachable to non-CLI users.

---

## Won't Do (For Now)

These are natural extensions but are out of scope for a focused tool:

- **Traffic proxying** (mitmproxy, Charles-style): different architecture entirely, heavier
- **Automated login via credentials** (script-free login flow): too fragile across login page varieties, adds code complexity
- **API mocking from captured traffic**: well-served by existing tools (msw, Prism)
- **Performance benchmarking**: different domain, better handled by k6 / Gatling
