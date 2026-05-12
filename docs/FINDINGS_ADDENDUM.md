# Findings Addendum — Second-Pass Audit

> Items missed or skimped on in the first scan. Includes findings from reading real session output (`captures/nebula/`), tracing actual data flow, and testing edge cases with Node.

---

## Bugs (New)

### `toStepci.ts` — `user-agent`, `origin`, `referer` are not in SKIP_HEADERS

**Evidence from `captures/nebula/stepci-workflow.yaml`:** every single step (11 of them) contains:

```yaml
headers:
  accept: application/json, text/plain, */*
  origin: https://privagalaxy.dev-v5.privasapien.com
  referer: https://privagalaxy.dev-v5.privasapien.com/
  user-agent: >-
    Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...
  x-portal-context: platform
```

Three of these headers are actively harmful in a committed StepCI workflow:

- **`user-agent`**: A machine-specific browser fingerprint. Will differ between developer machines, CI containers, and OSes. StepCI replays the literal string — it won't match server-side UA checks on a different machine. Should never appear in test files.
- **`origin`**: Frontend-specific. If the frontend domain changes (staging → production, hostname refactor), every test step breaks. The API server shouldn't rely on Origin for business logic anyway.
- **`referer`**: Same issue as origin — captures the exact page URL at capture time. Meaningless in a replay context and will cause test noise.

**Fix:** Add to `SKIP_HEADERS` in `src/transform/toStepci.ts`:
```ts
'origin',
'referer',
'user-agent',
```

**Note on `x-portal-context: platform`:** This is an app-specific header. It's correct to keep it (it's not browser noise — it's intentional API context). But it'll need to be parameterized when the workflow is shared across environments.

---

### `toOpenApi.ts` — duplicate path parameter names produce invalid spec

**Reproduced:**
```
/api/v1/items/123/items/456
→ /api/v1/items/{itemId}/items/{itemId}
paramNames: ['itemId', 'itemId']
```

OpenAPI 3.0 requires that path parameter names within a single path template are unique. A spec with `{itemId}` appearing twice in the same path will fail validation against any strict validator (`spectral`, schemathesis's own spec parser, openapi-generator). The generated spec becomes unusable with these tools.

**Root cause:** `normalisePath` in `toOpenApi.ts` always uses `${prev.replace(/s$/, '')}Id` as the parameter name. If the same parent segment appears twice in a path (a common pattern in hierarchical REST APIs), the same name is emitted twice.

**Fix:** Append a numeric suffix when a name collision is detected:
```ts
let name = `${prev.replace(/s$/, '')}Id`;
let suffix = 2;
while (paramNames.includes(name)) {
  name = `${prev.replace(/s$/, '')}Id${suffix++}`;
}
```

---

### `toOpenApi.ts` — `SCANNER_API_URL` with a base path silently loses the path

**Reproduced:**
```
SCANNER_API_URL=https://api.example.com/v2

→ spec server URL becomes: https://api.example.com
   (path /v2 is silently dropped)
```

The code does `new URL(apiUrl)` then uses only `.protocol + '//' + .host`, discarding `.pathname`. If a user's API lives under a base path (common with hosted API gateways, versioned APIs, or AWS API Gateway with a stage prefix), every generated path in the spec is wrong — schemathesis will fire against `https://api.example.com/users` instead of `https://api.example.com/v2/users`.

No warning is emitted. The user won't notice until they run schemathesis and get 404s on everything.

**Fix:** Use the full URL including pathname as the server URL, or emit a warning if `apiUrl` has a non-root pathname:
```ts
const u = new URL(apiUrl);
if (u.pathname && u.pathname !== '/') {
  console.warn(`  [openapi] SCANNER_API_URL has a base path "${u.pathname}" — using full URL as server. Paths in the spec will NOT repeat this prefix.`);
}
return apiUrl.replace(/\/$/, ''); // use full URL, strip trailing slash
```

---

### `toOpenApi.ts` — same normalized path on two different hosts creates silent collision

**Scenario:** A microservices architecture where both `auth.example.com` and `api.example.com` have a `GET /api/v1/users` endpoint (different implementations, same path shape).

The grouping key includes the host: `GET:auth.example.com:/api/v1/users` and `GET:api.example.com:/api/v1/users` are two distinct groups. But when building `paths{}`, both write to `paths['/api/v1/users']`. Since the same HTTP method (GET) is written twice to the same path item, the second write overwrites the first — one endpoint is silently lost.

This is unlikely for fully-deduped well-structured APIs, but is real in the real `nebula` session (auth server serves some user APIs, the API server serves others) and would silently drop entries.

**Fix:** Incorporate the host into the path key when multiple hosts share the same normalized path. Options:
- Use per-path `servers` at the path item level (already done for the login path)
- Use `x-<host>-path` key in paths to keep them separate
- At minimum, emit a warning when a path collision is detected

---

### `toOpenApi.ts` — `normalisePath` treats API version numbers as path IDs in some patterns

**Reproduced:**
```
/api/v2/123    → /api/{v2Id}   (correct-ish but confusing)
/v1/users/123  → /v1/users/{userId}  (works fine — v1 is not numeric)
/api/1/users   → /api/{apiId}/users  (wrong — the "1" is a version, not an ID)
```

The `ID_SEGMENT` regex matches any purely numeric string. Paths like `/api/1/resource` (some APIs use `/1/` as a version prefix instead of `/v1/`) will have the version number replaced with `{apiId}`, producing an incorrect path template.

This is an inherent ambiguity — it's impossible to tell `1` (a version) from `123` (a resource ID) without context. But a minimum improvement: add a check for single-digit numbers that appear immediately after `api` or at the root:

```ts
const isLikelyVersion = seg.length === 1 && ['1','2','3'].includes(seg);
```

Or document this clearly as a known limitation.

---

## OSS Issues (New)

### `PLAN_V2.md` and `plan.md` are committed to repo root

These are internal development planning documents — not user documentation.

- **`plan.md`** (v1 plan): Documents the original design, including `har-to-openapi` as a planned dependency that was ultimately not used. The implementation diverged significantly from this plan. Outdated and misleading for contributors.
- **`PLAN_V2.md`** (v2 plan): 314 lines of phased implementation notes, acceptance criteria, and intermediate designs. Internal scaffolding that describes the work being done, not the work as it exists.

For open source, neither of these should be in the tracked repository. A contributor reading `plan.md` would think `har-to-openapi` is a dependency when it isn't.

**Action:** Remove both from tracking:
```bash
git rm PLAN_V2.md plan.md
```
Add implementation context to `CONTRIBUTING.md` or `docs/` instead.

---

### `USAGE.md` is the only real documentation but is severely outdated

`USAGE.md` is the closest thing to user documentation in the repo (314 lines, well-written). But it covers v1 only and is missing everything from v2:

| Feature | In USAGE.md? |
|---|---|
| `login` / `start` / `list` commands | ✓ |
| Interactive pause/resume | ✓ |
| Profiles and sessions | ✓ |
| OpenAPI, StepCI, curl outputs | ✓ |
| Automation scripts | ✓ |
| **Feature flags (`SCANNER_ENABLE_*`)** | ✗ |
| **Coverage report (`coverage.json`)** | ✗ |
| **Anomaly detection (`anomalies.json`)** | ✗ |
| **Drift detection (`drift.json`)** | ✗ |
| **HTML report (`report.html`)** | ✗ |
| **Schema manifest CLI** | ✗ |
| **`SCANNER_API_URL` vs `SCANNER_BASE_URL` distinction** | ✗ |
| **`SCANNER_AUTH_URL` for StepCI auto-login** | ✗ |
| Updated output file listing | ✗ |

The output file list in section 8 shows 5 files; the real output is now 10 files (+ `curls/` directory).

The document also lists `plan.md` in the project structure section — an internal file that shouldn't be there.

**This needs a complete v2 update before open-source publishing.** Or replace it entirely with a proper `README.md`.

---

### `scripts/demo-multipart.ts` depends on `httpbin.org`

The multipart demo script fires requests to `https://httpbin.org/post`. `httpbin.org` is a public service that:
- Has had outages
- Rate-limits requests
- Is maintained by a third party with no SLA

Anyone running the demo in CI or at a time when httpbin is down will get failures without understanding why. Since this is the example script for a key differentiating feature (multipart capture), it should use a reliable target.

**Options:**
- Use `jsonplaceholder.typicode.com` (more stable, already used in the other demo)
- Use a local server started inside the script (`http.createServer`)
- Use Playwright's built-in `page.route` to mock responses

---

### `.gitignore` missing several entries

The `.gitignore` only has 5 entries. Missing:

```gitignore
# macOS metadata
.DS_Store
**/.DS_Store

# Python virtual environment (for schemathesis)
.venv/

# Internal planning documents (should be removed from tracking, not just ignored)
# PLAN_V2.md  ← better to git rm these
# plan.md

# Hypothesis test artifacts
.hypothesis/

# TypeScript build info
*.tsbuildinfo

# npm debug log
npm-debug.log*

# Editor
.vscode/
.idea/
*.swp
```

The `.venv/` and `.hypothesis/` are currently handled by system-level gitignore (hence not showing as untracked), but a project `.gitignore` should be self-contained — contributors who don't have these in their global gitignore will see them as untracked.

---

## Minute Things (New)

### `toStepci.ts` — query string parameters are hardcoded literals in step URLs

From the real output: `url: https://auth.dev-v5.privasapien.com/api/v1/users?search=`

The empty `?search=` is baked in. Users replaying the workflow are testing only this specific query string value. Contrast with the OpenAPI generator, which correctly extracts query parameters as proper `parameters` objects. The StepCI workflow should either:
- Strip known-empty query params (`?search=`, `?page=1` type values that are capture artifacts)
- Or parameterize them as StepCI variables for easy override

Currently there's no way to run the StepCI workflow with a different `search` value without editing the YAML by hand.

---

### `toStepci.ts` — all steps in real output use the full captured URL including host

Each StepCI step uses the exact URL from the HAR entry, including the host. This is correct behavior but means:
- Switching environments (staging → production) requires find-replacing all URLs
- There's no base URL concept in the generated workflow

A nice improvement would be to introduce a StepCI `env` block at the top of the workflow:
```yaml
env:
  API_HOST: https://auth.dev-v5.privasapien.com
```
And then use `${{env.API_HOST}}/api/v1/users` in each step URL. This would make environment switching trivial.

---

### `normalisePath` produces `{v2Id}` for `/api/v2/123` pattern

The path `/api/v2/123` → `/api/{v2Id}`. The `v2` becomes the "previous segment" when `123` is ID-replaced, producing `{v2Id}` as the parameter name. Technically valid but confusing — a developer reading the spec would expect `{resourceId}` or `{itemId}`, not `{v2Id}`. The issue is that `v2` is a version prefix, not a resource name.

This is a cosmetic issue but creates noise in generated specs. Filtering out `v1`/`v2`/`v3`-pattern segments from the "previous segment" name derivation would help:

```ts
const prev = segments[idx - 1] ?? 'item';
const safePrev = /^v\d+$/i.test(prev) ? (segments[idx - 2] ?? 'item') : prev;
const name = `${safePrev.replace(/s$/, '')}Id`;
```

---

### `captures/` directory contains real session data from dev usage

The `captures/` folder has two real sessions: `nebula/` and `consentium/`. These aren't tracked in git (correct), but they contain:
- `captures/nebula/raw.har` — 4.8MB, full browser traffic from a real product session
- `captures/nebula/filtered.har` — 2.4MB filtered API traffic  
- `captures/nebula/junit.xml` — real schemathesis test results

These exist locally only and are gitignored, which is correct. However, the `captures/nebula/report.html` shows `0 endpoints, 0 requests` — evidence of a regeneration run that produced an empty report, likely from a manual test during v2 development. Not a code issue, just a data artifact, but worth cleaning up before any public demo.

---

### `scripts/` directory is tracked but `ARCHITECTURE.md` is not

`scripts/demo-journey.ts` and `scripts/demo-multipart.ts` are tracked in git. But `ARCHITECTURE.md` (the diagram file at the root) is NOT tracked — it shows up as untracked in `git status`. 

For open source:
- The demo scripts should be tracked (they're the getting-started examples)
- `ARCHITECTURE.md` should also be tracked (it's valuable documentation)

Run `git add ARCHITECTURE.md` to track it.

---

### `package.json` has no `repository`, `homepage`, or `keywords` fields

When published to npm, these fields populate the npm package page. Without them:
- The package won't appear in searches for `openapi`, `playwright`, `api-testing`
- There's no link from npm back to the GitHub repo
- Tools like `npm audit`, `renovate`, and `dependabot` can't find the source

```json
"repository": { "type": "git", "url": "https://github.com/<org>/api-scanner" },
"keywords": ["api", "openapi", "playwright", "har", "testing", "stepci", "schemathesis", "coverage"],
"homepage": "https://github.com/<org>/api-scanner#readme",
"bugs": { "url": "https://github.com/<org>/api-scanner/issues" }
```

---

### `schemaManifestCli.ts` uses a dynamic `import('path')` inside a try block

```ts
import('path').then(({ default: path }) => {
  const outDir = path.dirname(manifestPath);
  generateSchemaHtmlReport(manifest, outDir);
});
```

This is a dynamic import of a built-in Node module (`path`) inside a `.then()` after a `try/catch` block. The `path` module is always available — this should be a static import at the top of the file. The dynamic import was presumably written to avoid a top-level `await` issue during refactoring, but it means if `generateSchemaHtmlReport` throws, the error is swallowed by the unhandled promise (no `.catch()`).

**Fix:** Static import of `path` (already imported elsewhere in the file if it were a module), and move the HTML generation inside the existing `try/catch`.

---

### `capture.ts` next steps hint is hardcoded to a specific OpenAPI file path

After each session:
```
schemathesis run /Users/.../captures/nebula/openapi.yaml --url https://... --checks all
stepci run /Users/.../captures/nebula/stepci-workflow.yaml
```

The paths are absolute. They work on the machine they were generated on, but if anyone copies the output directory to another machine or CI, the hint is wrong. Using relative paths (`captures/<session>/openapi.yaml`) would be more portable.
