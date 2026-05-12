# Implementation Plan

> Phase-by-phase roadmap to production-ready open source. Each phase ends with a review checkpoint and a commit. No phase starts until the previous one is reviewed and signed off.

---

## The Auth Problem (Read This First)

The most significant issue that was missed in the audit: **the entire auth login system is hardcoded for one specific application.**

Here is what is currently baked in:

**`toOpenApi.ts` — `buildLoginOperation`**
- The URL pattern `/local/{tenant}/login` is extracted via regex `/\/local\/([^/]+)\/login/` — this only matches the Privasapien auth URL shape. Any other app's login URL gets used as-is without parameterization, but the tenant parameter description still says `"privasapien"` as the example.
- The login request body is hardcoded as `multipart/form-data` with exactly `username` and `password` fields — regardless of what the actual login endpoint expects.
- The response schema hardcodes `access_token` as the token field name.
- The `bearerAuth` scheme description references `POST /local/{tenant}/login` by name.

**`toStepci.ts` — `buildLoginStep`**
- Login method is hardcoded `POST`.
- Body type is hardcoded as `form:` (x-www-form-urlencoded) with `username` and `password` field names.
- Token capture is hardcoded as `jsonpath: $.access_token` — won't work if the API returns `$.token`, `$.data.access_token`, `$.auth.jwt`, etc.
- Success status is hardcoded `200`.

**What this means for open source:** anyone whose login endpoint uses JSON body, different field names, a different token path, OAuth2 client credentials, or API key auth will get a broken login step with no way to configure it without editing source code.

---

## Phase 0 — Housekeeping & Commit Docs

**Goal:** Clean repo state before any feature work. Everything in this phase is non-functional.

### Tasks

1. **Commit the `docs/` folder** as-is. These are the audit findings and plan — they belong in version history.

2. **Remove internal planning files from tracking:**
   ```bash
   git rm PLAN_V2.md plan.md
   ```
   These are dev scratchpads, not user-facing docs. They reference abandoned approaches (e.g. `har-to-openapi` dependency that was never used).

3. **Track `ARCHITECTURE.md`** — it's currently untracked despite being a useful reference:
   ```bash
   git add ARCHITECTURE.md
   ```

4. **Expand `.gitignore`:**
   ```
   # macOS
   .DS_Store
   **/.DS_Store

   # Python virtualenv (for schemathesis)
   .venv/

   # TypeScript incremental build info
   *.tsbuildinfo

   # Editor
   .vscode/
   .idea/
   ```

5. **Commit** with message: `docs: add audit findings, implementation plan, and clean up repo`

### Review checkpoint
- All docs readable and accurate?
- Repo root clean — no planning files, no .DS_Store?
- `.gitignore` complete?

---

## Phase 1 — Bug Fixes

**Goal:** Fix the three correctness issues confirmed from real session output. These produce wrong output today on every run.

### Tasks

**Fix 1 — `toStepci.ts`: `user-agent`, `origin`, `referer` in SKIP_HEADERS**

Confirmed from `captures/nebula/stepci-workflow.yaml` — all 11 steps contain the full browser user-agent string and frontend origin/referer. These are machine-specific and environment-specific and have no place in a committed test workflow.

Add to `SKIP_HEADERS`:
```ts
'origin',
'referer',
'user-agent',
```

**Fix 2 — `toCurl.ts`: `--data-urlencode` misuse**

Current code concatenates all form params into one string then passes it to `--data-urlencode`. This is wrong — `--data-urlencode` treats its argument as a single value to URL-encode, not as `key=value` pairs. The result is a curl command that sends garbage.

Fix: one `--data-urlencode "key=value"` flag per param.

**Fix 3 — `toOpenApi.ts`: duplicate path parameter names**

Paths like `/api/v1/items/{itemId}/items/{itemId}` (same parent segment twice) produce duplicate parameter names which is invalid OpenAPI 3.0. Any spec validator or code generator rejects it.

Fix: append counter suffix on name collision. Also: skip version-prefix segments (`v1`, `v2`) when deriving the param name so `/api/v2/123` doesn't become `{v2Id}`.

### Commit
`fix: correct curl form encoding, skip browser headers in stepci, fix duplicate path param names`

### Review checkpoint
- Generate outputs from a real session and inspect the three changed files
- Confirm `user-agent` gone from stepci YAML
- Confirm curl form params are separate `--data-urlencode` flags
- Confirm no duplicate `{paramId}` in OpenAPI paths

---

## Phase 2 — Auth System Redesign

**Goal:** Replace the hardcoded Privasapien-specific login assumptions with a configurable auth system that works for any API.

### New env vars

| Variable | Purpose | Default |
|---|---|---|
| `SCANNER_AUTH_METHOD` | Auth strategy | `bearer-login` if `SCANNER_AUTH_URL` is set, else `none` |
| `SCANNER_AUTH_BODY_FORMAT` | Login request body format | `form` |
| `SCANNER_AUTH_USERNAME_FIELD` | Field name for username in login body | `username` |
| `SCANNER_AUTH_PASSWORD_FIELD` | Field name for password in login body | `password` |
| `SCANNER_AUTH_TOKEN_PATH` | JSONPath to extract token from login response | `$.access_token` |
| `SCANNER_AUTH_SCHEME` | Prefix applied before the token value in the Authorization header | `Bearer ` |

### Supported auth methods (`SCANNER_AUTH_METHOD`)

| Value | Behaviour |
|---|---|
| `bearer-login` | POST credentials to `SCANNER_AUTH_URL`, capture token, inject `Authorization: Bearer <token>` into all steps |
| `bearer-static` | Use `SCANNER_AUTH_TOKEN` directly — no login step, no capture |
| `api-key` | Use `SCANNER_API_KEY` in `X-Api-Key` header — no login step |
| `basic` | Base64-encode `SCANNER_USERNAME:SCANNER_PASSWORD` into `Authorization: Basic <b64>` — no login step |
| `none` | No auth injected — all headers pass through as captured |

### Changes required

**`config.ts`**
- Add `authMethod`, `authBodyFormat`, `authUsernameField`, `authPasswordField`, `authTokenPath`, `authScheme` to `ScannerConfig`
- Read from env vars with the defaults above
- Auto-set `authMethod` to `bearer-login` when `SCANNER_AUTH_URL` is set and method is not explicitly specified

**`toStepci.ts` — `buildLoginStep`**
- Use `SCANNER_AUTH_BODY_FORMAT` to decide between `form:`, `json:`, or `formData:`
- Use `SCANNER_AUTH_USERNAME_FIELD` / `SCANNER_AUTH_PASSWORD_FIELD` for the actual field names
- Use `SCANNER_AUTH_TOKEN_PATH` for the captures jsonpath
- Pass method through as configurable (default POST)

**`toOpenApi.ts` — `buildLoginOperation`**
- Remove the `/local/{tenant}/login` regex entirely — it's application-specific
- Use the `authUrl` path as-is, no tenant extraction
- Use `SCANNER_AUTH_BODY_FORMAT` to decide the request body content type
- Use `SCANNER_AUTH_USERNAME_FIELD` / `SCANNER_AUTH_PASSWORD_FIELD` for property names
- Remove "privasapien" from example text
- Remove the hardcoded `access_token` from the response schema — use `SCANNER_AUTH_TOKEN_PATH` to derive the field name

**`toStepci.ts` — `buildHeaders`**
- Respect `SCANNER_AUTH_SCHEME` prefix when constructing `Authorization` header reference
- Support `bearer-static`, `basic`, `api-key` methods (currently only `bearer` is handled)

**`.env.example`**
- Document all new auth vars with examples for each auth method

### Commit
`feat: configurable auth system — method, body format, field names, token path`

### Review checkpoint
- Test with `bearer-login` + form body (existing Privasapien setup — must not regress)
- Test with `bearer-login` + JSON body
- Test with `bearer-static` (no login step generated)
- Test with `api-key` (X-Api-Key header passed through)
- Confirm `/local/{tenant}/login` pattern is gone from generated specs
- Confirm `.env.example` covers all cases

---

## Phase 3 — OpenAPI Quality

**Goal:** Make the generated spec immediately usable without manual editing.

### Tasks

1. **`operationId`** — auto-derive from `METHOD_path_segments`:
   - `GET /api/v1/users/{userId}` → `getUserId`
   - `POST /api/v1/products` → `postProducts`
   - Deduplicate if the same operationId would appear twice (append `_2`)

2. **`tags`** — auto-derive from first meaningful path segment (after `/api/vN/`):
   - `/api/v1/users/...` → tag: `users`
   - `/api/v1/consent-manager/...` → tag: `consent-manager`
   - Login operation keeps its explicit `Authentication` tag

3. **Fix `SCANNER_API_URL` path stripping** — currently `https://api.example.com/v2` silently becomes `https://api.example.com`. Use the full URL as the server value, or emit a warning when a base path is detected.

4. **`--no-examples` env var alias** — `SCANNER_ENABLE_EXAMPLES` already exists but isn't obvious that it controls whether captured values appear in the spec. Improve the `.env.example` comment.

### Commit
`feat: add operationId and tags to OpenAPI output, fix API URL base path handling`

### Review checkpoint
- Open generated spec in Swagger UI — operations grouped by tag, each has a unique ID
- Run `openapi-generator-cli validate` against generated spec — no errors
- Confirm `SCANNER_API_URL=https://api.example.com/v2` produces correct server URL

---

## Phase 4 — Feature Flags (CLI Access)

**Goal:** Make all `SCANNER_ENABLE_*` flags accessible from the CLI for one-off runs without editing `.env`.

### Current state
All 9 feature flags exist as env vars and work correctly. The gap: no CLI equivalent. A user who wants `openapi` only for a CI run must set `SCANNER_ENABLE_STEPCI=false SCANNER_ENABLE_CURL=false ...` — verbose and easy to forget one.

### Approach: `--only` flag

```sh
specint start --url https://app.com --only openapi,stepci
specint start --url https://app.com --only html
specint start --url https://app.com --only curl
```

Comma-separated list of output names. Disables everything not listed. Implied deps wired (e.g. `anomalies` auto-enables `coverage` since it depends on it; `html` enables the full v2 suite).

Valid values: `openapi`, `stepci`, `curl`, `coverage`, `anomalies`, `drift`, `html`

`dedup` is intentionally excluded — it's a preprocessing step, not an output, and should stay controlled by `SCANNER_ENABLE_DEDUP` only.

### Implementation
- Add `only` to minimist `string` array
- Add `applyOnlyFlag(config, only)` function after `resolveConfig` in `capture.ts`
- Function zeroes all output feature flags, then enables requested ones with dep resolution
- Unknown values produce a clear error listing valid options
- Update help text with examples

### Commit
`feat: --only flag for per-run output control`

### Review checkpoint
- `--only openapi` → only `openapi.yaml` + `openapi.json` generated, no other files
- `--only html` → full v2 suite: coverage, anomalies, drift, report.html
- `--only openapi,stepci` → both spec files and workflow, nothing else
- `--only bad` → clear error message with valid options listed
- No `--only` → existing env var behaviour unchanged

---

## Phase 5 — OSS Preparation

**Goal:** Everything needed to publish publicly and have a stranger understand and use the tool.

### Tasks

1. **`README.md`** at repo root — the product homepage. Draws from `USAGE.md` (which covers v1 well) and extends it with v2 features. Sections: what it is, install, quickstart (5 commands), full CLI reference, output file descriptions, examples, contributing pointer.

2. **`LICENSE`** — MIT. Two minutes.

3. **`package.json` updates:**
   - `"bin": { "specint": "./dist/capture.js" }` for `npx` / global install
   - `"engines": { "node": ">=18.0.0" }`
   - `"files": ["dist/", "README.md", "LICENSE", ".env.example"]`
   - `"repository"`, `"keywords"`, `"homepage"`, `"bugs"` fields

4. **Shebang** on `dist/capture.js` — add `#!/usr/bin/env node` as first line, either via a `prepare` script or a small postbuild script.

5. **`CONTRIBUTING.md`** — dev setup, how to run a test capture, how to add an anomaly rule, how to add an output format, PR conventions.

6. **Update `USAGE.md`** — add v2 feature documentation (coverage, anomalies, drift, HTML report, feature flags, schema manifest CLI). Or retire it in favour of `README.md` and keep `README.md` as the single source of truth.

7. **`.env.example`** — add auth method examples for each supported method after Phase 2.

### Commit
`docs: README, LICENSE, CONTRIBUTING, package.json OSS fields`

### Review checkpoint
- `npx .` from a fresh directory runs the tool
- `npm pack --dry-run` shows only the right files in the package
- README renders correctly on GitHub
- A person with no context can go from clone to first capture in under 5 minutes following the README

---

## Phase 6 — Nice-to-Haves (Post-launch)

Lower priority. Do after the tool is published and initial feedback comes in.

- **`--version` flag** — reads from `package.json`
- **`--quiet` flag** — suppress per-request log lines
- **`curl -s` → `curl -sS`** — show errors even in silent mode
- **Export `normaliseCoveragePath`** — eliminate the duplicated normalization logic between `coverage.ts` and `anomalies.ts`
- **Configurable anomaly thresholds** — `SCANNER_ANOMALY_SLOW_MS`, `SCANNER_ANOMALY_LARGE_KB`, `SCANNER_PUBLIC_PATTERNS`
- **HAR replay mode** — `specint replay --har existing.har --session name`
- **StepCI base URL variable** — introduce `${{env.API_HOST}}` in generated workflows so environment switching doesn't require find-replace
- **GitHub Actions CI** — typecheck on push

---

## Commit Cadence Summary

| Phase | Commit message |
|---|---|
| 0 | `docs: add audit findings, implementation plan, and clean up repo` |
| 1 | `fix: correct curl form encoding, skip browser headers in stepci, fix duplicate path param names` |
| 2 | `feat: configurable auth system — method, body format, field names, token path` |
| 3 | `feat: add operationId and tags to OpenAPI output, fix API URL base path handling` |
| 4 | `feat: --only flag for per-run output control` |
| 5 | `docs: README, LICENSE, CONTRIBUTING, package.json OSS fields` |

Each phase gets a review before the next one starts. No combining phases into one commit.
