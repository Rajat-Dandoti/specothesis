# Specothesis — Implementation Plan V2

> Post-launch quality and feature roadmap. Covers all open bugs, quality infrastructure,
> improvements, and post-v1 features. Each task maps to a numbered task in the session task list.
> Source material: FINDINGS.md, FINDINGS_ADDENDUM.md, QUALITY_PLAN.md, ROADMAP.md.

---

## Overview

The tool is published and working. This plan addresses three layers:

1. **Quality infrastructure** — tests, linting, CI. Makes future changes safe and the project credible.
2. **Open bugs** — correctness issues present in every run today.
3. **Improvements and features** — things that would make the tool significantly more useful.

Phases are ordered by dependency and impact. Do not start Phase B until Phase A is green.

---

## Phase A — Test Infrastructure

*No tests exist. This is the single biggest signal that a project is vibe-coded. Even a small
suite changes how the codebase reads — every function becomes something that can be verified.*

### Task 1 — Set up vitest

**Source:** QUALITY_PLAN.md §A1

Install:
```bash
npm i -D vitest
```

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

Create directory structure:
```
tests/
  fixtures/
  unit/
  integration/
```

**Commit:** `test: add vitest infrastructure`

---

### Task 2 — Create fixture HAR file

**Source:** QUALITY_PLAN.md §A2

Create `tests/fixtures/sample.har`. Must contain:

| Entry | Purpose |
|---|---|
| POST `/api/auth/login` with JSON body `{"email":"...", "password":"..."}`, response `{"access_token":"eyJ..."}` | Tests login detection, auth config |
| GET `/api/v1/users/123` with Authorization header | Tests numeric ID → `{userId}` normalisation |
| GET `/api/v1/users?search=test&page=1` | Tests query param handling |
| POST `/api/v1/items` with `application/x-www-form-urlencoded` body `name=foo&qty=3` | Tests `--data-urlencode` fix |
| GET `/api/v1/orders/456` responding 404 | Tests client error anomaly rule |
| GET `/api/v1/reports/export` responding 200 with 600KB body | Tests large payload rule |
| GET `/api/v1/products` with no Authorization header | Tests missing auth rule |
| GET `/api/v1/users/abc123def456...` (32-char hex) | Tests hex ID → `{userId}` normalisation |
| GET `/api/v1/items/uuid-format-id` | Tests UUID → `{id}` normalisation |

Keep the HAR minimal — real values but short bodies. No actual credentials.

**Blocked by:** Task 1

---

### Task 3 — Unit tests for pure transforms

**Source:** QUALITY_PLAN.md §A3

**`tests/unit/normalisePath.test.ts`**
- `'/api/users/123'` → `'/api/users/{userId}'`
- `'/api/users/550e8400-e29b-41d4-a716-446655440000'` → `'/api/users/{userId}'`
- `'/api/users/abc123def456abc123def456abc123de'` → `'/api/users/{userId}'`
- `'/api/v2/items/123'` → `'/api/v2/items/{itemId}'` (not `{v2Id}`)
- `'/api/items/123/sub/456'` → `'/api/items/{itemId}/sub/{itemId2}'` (unique names)
- `'/api/users'` unchanged

**`tests/unit/toCurl.test.ts`**
- `application/x-www-form-urlencoded` with `name=foo&qty=3` → two separate `--data-urlencode` flags
- JSON body → `--data '{"key":"value"}'`
- Authorization header is included in output
- Custom header `X-Tenant-ID` is included in output (post Task 15 fix)
- Generated command starts with `curl -sS` not `curl -s` (post Task 14 fix)

**`tests/unit/toOpenApi.test.ts`**
- Login operation appears first in `paths`
- `GET /api/v1/users/123` → operationId `getUserId`, tag `users`
- `POST /api/v1/products` → operationId `postProducts`, tag `products`
- Duplicate param names get counter suffix
- `SCANNER_API_URL=https://api.example.com/v2` → server URL is `https://api.example.com/v2`

**`tests/unit/anomalies.test.ts`**
- Client error rule fires for 4xx entries
- Server error rule fires for 5xx entries
- Missing auth rule fires when no Authorization header
- Missing auth rule does NOT fire for path containing `login`
- Slow response rule fires above 2000ms threshold
- Large payload rule fires above 500KB threshold
- Rule error is logged to stderr, not silently swallowed (post Task 8 fix)

**`tests/unit/coverage.test.ts`**
- Auth column is `false` when 0 of N requests have Authorization header
- Auth column is `true` when at least 1 of N requests has Authorization header
- Status codes aggregate correctly across multiple entries for the same endpoint

**`tests/unit/harFilter.test.ts`**
- Entries outside recording windows are excluded
- Entries not matching urlFilter glob are excluded
- `resourceType` filtering keeps only `xhr` and `fetch`

**`tests/unit/config.test.ts`**
- `authMethod` auto-derives to `bearer-login` when `SCANNER_AUTH_URL` is set
- `authMethod` is `none` when `SCANNER_AUTH_URL` is not set
- `--only openapi` disables all outputs except openapi
- `--only html` enables coverage + anomalies + drift + html
- Unknown `--only` value produces a clear error

**Blocked by:** Task 2

---

### Task 4 — Integration test

**Source:** QUALITY_PLAN.md §A4

Create `tests/integration/pipeline.test.ts`:

```ts
import { test, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string;

beforeAll(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specothesis-')); });
afterAll(() => { fs.rmSync(tmpDir, { recursive: true }); });

test('full pipeline produces all output files', async () => {
  // load sample.har, run pipeline with all features enabled, assert outputs
});
```

Assert:
- `openapi.yaml` exists and is valid YAML with at least one path
- `openapi.json` exists and is valid JSON
- `stepci-workflow.yaml` exists and has a `tests` array
- `curls/requests.sh` exists and starts with `#!/usr/bin/env bash`
- `coverage.json` exists and is a non-empty array
- `anomalies.json` exists and is an array
- `report.html` exists and contains `<html`

Run in a temp directory. Clean up with `afterAll`.

**Blocked by:** Task 2

---

## Phase B — Linting and Formatting

*Inconsistent style is a vibe-code tell. ESLint + Prettier takes 30 minutes and changes
how the codebase reads permanently.*

### Task 5 — Add ESLint and Prettier

**Source:** QUALITY_PLAN.md §B1, §B2

Install:
```bash
npm i -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier
```

Create `.eslintrc.cjs`:
```js
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
  },
};
```

Create `.prettierrc`:
```json
{ "singleQuote": true, "trailingComma": "es5", "printWidth": 100 }
```

Add to `package.json` scripts:
```json
"lint": "eslint src/ tests/",
"format": "prettier --write src/ tests/ scripts/"
```

Steps:
1. Run `npm run format` — commit as `chore: format codebase (prettier)`
2. Run `npm run lint` — fix all errors, commit as `chore: fix lint errors`

**Commit:** `chore: add eslint and prettier`

---

## Phase C — CI Pipeline

*A green checkmark on every PR is what enterprise looks like. No tests + no CI = every
merge is a gamble.*

### Task 6 — GitHub Actions CI and publish workflow

**Source:** QUALITY_PLAN.md §C1, §C2; OSS_READINESS.md §11

**Blocked by:** Tasks 1 and 5 (CI runs both)

Create `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run build
      - run: npm test
```

Create `.github/workflows/publish.yml`:
```yaml
name: Publish to npm

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org/
      - run: npm ci
      - run: npm run build
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Add to `CONTRIBUTING.md`: instruction to add `NPM_TOKEN` automation token as a GitHub Actions secret for automated publish.

**Commit:** `ci: add GitHub Actions CI and publish workflows`

---

## Phase D — Bug Fixes

*These produce wrong or misleading output on every run today. Fix before shipping any new features.*

### Task 7 — Typed errors and fail-fast config validation

**Source:** QUALITY_PLAN.md §D1, §D2, §D4; FINDINGS.md §config.ts

Create `src/errors.ts`:
```ts
export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'ConfigError'; }
}
export class CaptureError extends Error {
  constructor(message: string) { super(message); this.name = 'CaptureError'; }
}
export class TransformError extends Error {
  constructor(message: string) { super(message); this.name = 'TransformError'; }
}
```

Add `validateConfig(config: ScannerConfig): void` to `src/config.ts`:
- `SCANNER_BASE_URL` must be a parseable URL
- `SCANNER_AUTH_URL` must be a parseable URL when set
- `SCANNER_AUTH_METHOD` must be one of the valid `AuthMethod` enum values when set
- `SCANNER_AUTH_TOKEN_PATH` must start with `$.` when set
- Throw `ConfigError` with a clear human-readable message

Call `validateConfig(config)` at the top of `startCommand()` before anything else.

Add top-level error handler in `capture.ts`:
```ts
main().catch((err) => {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
```

**Commit:** `fix: typed errors, fail-fast config validation, process exit codes`

---

### Task 8 — Fix silent catch blocks

**Source:** QUALITY_PLAN.md §D3; FINDINGS.md §anomalies.ts, FINDINGS_ADDENDUM.md §schemaManifestCli.ts

**`src/report/anomalies.ts`** — rule errors silently swallowed:
```ts
// Before
} catch { /* empty */ }

// After
} catch (err) {
  console.error(`[anomalies] rule "${rule.id}" threw on ${ep.path}:`, err);
}
```

**`src/capture.ts`** — `response` event listener can throw when request is GC'd:
```ts
page.on('response', (res) => {
  try {
    if (['xhr', 'fetch'].includes(res.request().resourceType())) { ... }
  } catch {
    // res.request() can throw if the request was GC'd during navigation — safe to ignore
  }
});
```

**`src/report/schemaManifestCli.ts`** — dynamic import promise has no `.catch()`:
```ts
// Before
import('path').then(({ default: path }) => {
  generateSchemaHtmlReport(manifest, outDir);
});

// After — static import at top of file, move into existing try/catch
import path from 'path';
// ... inside try block:
generateSchemaHtmlReport(manifest, path.dirname(manifestPath));
```

**Commit:** `fix: log anomaly rule errors to stderr, wrap response listener, fix schemaManifest promise`

---

### Task 9 — Fix type safety issues

**Source:** QUALITY_PLAN.md §E1, §E2, §E3; FINDINGS.md §toStepci.ts, §config.ts

**Fix `@ts-expect-error` in `toStepci.ts`:**
```ts
// Extend StepciStep type
interface StepciStep {
  name: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: StepciBody;
  check?: StepciCheck;
  captures?: Record<string, { jsonpath: string }>;  // add this
}
```
Remove the `@ts-expect-error` comment.

**Fix `headless` CLI flag bug in `capture.ts`:**
```ts
// Before — can't force headless:false from CLI if env says SCANNER_HEADLESS=true
headless: argv.headless || undefined,

// After
headless: 'headless' in argv ? Boolean(argv.headless) : undefined,
```

**Replace loose `any` types:** Audit `src/` for explicit `any`. Common case: `JSON.parse()` returns `any` — type the parsed result. Replace with `unknown` and narrow, or use a specific interface.

**Commit:** `refactor: fix @ts-expect-error, headless flag bug, loose any types`

---

### Task 10 — Fix requestCount counting unfiltered requests

**Source:** FINDINGS.md §capture.ts requestCount

In `src/capture.ts`, the `requestCount` counter increments on every `xhr`/`fetch` event regardless of `urlFilter`. The summary prints "Captured N XHR/fetch requests total" but N is higher than the entries that made it through the filter.

**Fix options (pick one):**
- Count entries that pass `urlFilter` — most accurate
- Keep both counts and print: `Captured 47 total XHR/fetch requests (23 matched filter)`

The second option is more informative for debugging why entries aren't appearing.

**Commit:** `fix: show matched-filter count in session summary`

---

### Task 11 — Fix drift comparing against base run

**Source:** FINDINGS.md §drift.ts

`loadPreviousCoverage` in `drift.ts` strips the trailing `-N` suffix to find the comparison target. So `checkout-5` compares against `checkout`, not `checkout-4`.

**Fix:** Find the highest-numbered sibling directory that has a `coverage.json`:

```ts
function findPreviousSession(sessionName: string): string | null {
  // parse current session name and number
  const match = sessionName.match(/^(.+?)(-(\d+))?$/);
  if (!match) return null;
  const base = match[1];
  const num = match[3] ? parseInt(match[3]) : 1;

  // find all siblings with same base
  const siblings = fs.readdirSync(CAPTURES_DIR)
    .filter(d => {
      const m = d.match(/^(.+?)(-(\d+))?$/);
      return m && m[1] === base && d !== sessionName;
    })
    .filter(d => fs.existsSync(path.join(CAPTURES_DIR, d, 'coverage.json')));

  // find highest numbered one below current
  // ...
}
```

If no sibling with `coverage.json` exists, skip drift silently (current behavior).

**Commit:** `fix: drift compares against previous run not base run`

---

### Task 14 — Fix curl -s → curl -sS

**Source:** FINDINGS.md §toCurl.ts curl -s; ROADMAP.md near-term

In `src/transform/toCurl.ts`, change `-s` to `-sS` in the curl command prefix.

`-s` (silent) suppresses error messages. A user who gets a 401 sees nothing.
`-sS` keeps the silent progress bar suppression but still shows errors.

One character change.

**Commit:** `fix: use curl -sS to show errors in silent mode`

---

### Task 15 — Fix toCurl dropping custom headers

**Source:** FINDINGS.md §toCurl.ts non-Authorization headers; ROADMAP.md near-term

Currently `toCurl.ts` only preserves the `Authorization` header. APIs that require
`X-Tenant-ID`, `X-API-Version`, `Accept: application/vnd.api+json`, etc. produce
curl commands that fail silently when replayed.

**Fix:** Use the same SKIP_HEADERS approach as `toStepci.ts`. Preserve all headers
except the known-noisy browser headers:

```ts
const CURL_SKIP_HEADERS = new Set([
  'host', 'connection', 'content-length',
  'accept-encoding', 'accept-language',
  'origin', 'referer', 'user-agent',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
  'cookie',  // handled separately if needed
]);
```

**Commit:** `fix: preserve custom headers in curl output`

---

### Task 16 — Export normaliseCoveragePath and remove duplication

**Source:** FINDINGS.md §anomalies.ts duplication; ROADMAP.md near-term

The three-condition normalisation (numeric, UUID, long hex) is copy-pasted between
`coverage.ts:normaliseCoveragePath` and `anomalies.ts:detectAnomalies`.

If `coverage.ts` adds a new rule (e.g. for slugs), `anomalies.ts` won't match and
endpoints will silently fail to correlate.

**Fix:**
```ts
// coverage.ts
export function normaliseCoveragePath(p: string): string { ... }

// anomalies.ts
import { normaliseCoveragePath } from './coverage.js';
```

**Commit:** `refactor: export normaliseCoveragePath, remove duplication in anomalies`

---

### Task 17 — Fix session sort order

**Source:** FINDINGS.md §session.ts; QUALITY_PLAN.md §F2

`listSessions` sorts alphabetically. `checkout-10` appears before `checkout-2`.

**Fix:** Sort by directory mtime descending (most recent first):
```ts
return sessions.sort((a, b) => {
  const aStat = fs.statSync(path.join(CAPTURES_DIR, a));
  const bStat = fs.statSync(path.join(CAPTURES_DIR, b));
  return bStat.mtimeMs - aStat.mtimeMs;
});
```

**Commit:** `fix: sort sessions by mtime not alphabetically`

---

### Task 19 — Fix next-steps hint using absolute paths

**Source:** FINDINGS_ADDENDUM.md §capture.ts absolute paths

After a session, specint prints:
```
schemathesis run /Users/rajat/myproject/captures/nebula/openapi.yaml ...
```

Absolute paths break when output is copied to CI or another machine.

**Fix:** Use paths relative to the current working directory:
```ts
const relDir = path.relative(process.cwd(), runDir);
console.log(`  schemathesis run ${relDir}/openapi.yaml --url ${config.baseUrl} --checks all`);
console.log(`  stepci run ${relDir}/stepci-workflow.yaml`);
```

**Commit:** `fix: use relative paths in post-session hints`

---

## Phase E — Improvements

*Things that would make the tool significantly more usable. Each is self-contained.*

### Task 12 — Add --version flag

**Source:** FINDINGS.md §No --version flag; QUALITY_PLAN.md §F1; ROADMAP.md near-term

In `capture.ts`, before command dispatch:
```ts
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

if (argv.version || argv.v) {
  const { version } = require('../package.json') as { version: string };
  console.log(`specint v${version}`);
  process.exit(0);
}
```

Add `-v, --version` to help text.

**Commit:** `feat: add --version flag`

---

### Task 13 — Add --quiet flag

**Source:** FINDINGS.md §No --verbose/--quiet flag; QUALITY_PLAN.md §F5; ROADMAP.md near-term

In a 200-request session, per-request log lines flood the terminal and obscure the summary.

**Implementation:**
- Add `quiet` to `ScannerConfig` (read from `--quiet` CLI flag or `SCANNER_QUIET=true`)
- Thread `config.quiet` to the request/response event handlers in `capture.ts`
- When `quiet` is true, skip `[req]` and `[res]` log lines
- Always print the final summary regardless of quiet mode
- Add `--quiet` to help text and `USAGE.md`

**Commit:** `feat: add --quiet flag to suppress per-request logging`

---

### Task 18 — Add SCANNER_PUBLIC_PATTERNS env var

**Source:** FINDINGS.md §anomalies.ts PUBLIC_KEYWORDS hardcoded; ROADMAP.md near-term

`PUBLIC_KEYWORDS` in `anomalies.ts` is hardcoded:
```ts
const PUBLIC_KEYWORDS = ['login', 'signup', 'register', 'health', 'ping', 'status', 'public'];
```

Users with `/api/webhook`, `/api/open`, or `/public-api/` can't suppress false "No Authorization header" warnings.

**Fix:** Add `SCANNER_PUBLIC_PATTERNS` env var (comma-separated) that extends the list:
```ts
const extraPatterns = (env('SCANNER_PUBLIC_PATTERNS') ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);
const PUBLIC_KEYWORDS = ['login', 'signup', 'register', 'health', 'ping', 'status', 'public', ...extraPatterns];
```

Document in `.env.example` and `USAGE.md`.

**Commit:** `feat: add SCANNER_PUBLIC_PATTERNS to extend public endpoint list`

---

### Task 20 — Add CI/TTY detection and login cancel

**Source:** FINDINGS.md §interactive.ts CI environments, login no cancel; ROADMAP.md medium-term

Two related improvements to `interactive.ts`:

**1. Non-TTY detection:**
```ts
const isTTY = process.stdin.isTTY;
if (!isTTY) {
  // CI mode: suppress status lines, auto-stop after script completes
}
```
When non-TTY: don't print `● RECORDING | session: "..."` status lines, and auto-stop
when the automation script completes rather than waiting for `q + Enter`.

**2. Login cancel:**
In the `login` command interactive loop, currently only `q` is accepted to save and exit.
A user who opens login by mistake must Ctrl+C.

Add `x` as a recognized command:
```
x + Enter   Cancel — exit without saving profile
```

**Commit:** `feat: detect non-TTY for CI mode, add cancel to login command`

---

### Task 21 — Add StepCI base URL variable

**Source:** FINDINGS_ADDENDUM.md §toStepci base URL; ROADMAP.md medium-term

Currently every StepCI step contains the full hardcoded URL:
```yaml
url: https://api.example.com/api/v1/users
```

Switching environments (staging → production) requires find-replacing all URLs.

**Fix:** Add an `env` block at the top of the generated workflow:
```yaml
version: "1.1"
env:
  API_HOST: https://api.example.com
tests:
  regression:
    steps:
      - name: GET users
        url: ${{env.API_HOST}}/api/v1/users
```

Extract the host from the first captured entry's URL and use it as `API_HOST`.
Entries from different hosts use their own host (preserve per-step server override logic).

Update `USAGE.md` to explain how to override `API_HOST` when running:
```bash
API_HOST=https://staging.example.com stepci run stepci-workflow.yaml
```

**Commit:** `feat: add API_HOST env variable to generated StepCI workflows`

---

### Task 23 — Configurable anomaly thresholds

**Source:** FINDINGS.md §anomalies.ts; ROADMAP.md medium-term

Hardcoded thresholds in `anomalies.ts`:
- Slow response: 2000ms
- Large payload: 500KB
- Repeated calls: 5

**Fix:** Read from env vars with existing values as defaults:
```ts
const SLOW_MS = parseInt(env('SCANNER_ANOMALY_SLOW_MS') ?? '2000');
const LARGE_KB = parseInt(env('SCANNER_ANOMALY_LARGE_KB') ?? '500');
const REPEATED_N = parseInt(env('SCANNER_ANOMALY_REPEATED_N') ?? '5');
```

Add to `config.ts`, `.env.example`, and `USAGE.md`.

**Commit:** `feat: configurable anomaly thresholds via env vars`

---

### Task 24 — OpenAPI spec customization flags

**Source:** FINDINGS.md §toOpenApi.ts info is generic; ROADMAP.md medium-term

The generated spec always has:
```yaml
info:
  title: Captured API
  version: 1.0.0
```

Users have to manually edit before importing into Swagger UI or publishing.

**Fix:** Add `SCANNER_API_TITLE` and `SCANNER_API_VERSION` env vars:
```ts
info:
  title: config.apiTitle ?? 'Captured API',
  version: config.apiVersion ?? '1.0.0',
  description: config.apiDescription ?? 'Generated by Specothesis',
```

Optionally expose as `--title` and `--api-version` CLI flags.
Add to `config.ts`, `.env.example`, and `USAGE.md`.

**Commit:** `feat: add SCANNER_API_TITLE and SCANNER_API_VERSION env vars`

---

## Phase F — Post-v1 Features

*Higher effort. Do after the quality and bug fix phases are complete.*

### Task 22 — HAR replay mode

**Source:** FINDINGS.md §no HAR replay; ROADMAP.md medium-term; OSS_READINESS.md §22

Some users already have HAR files from Chrome DevTools, Postman, or mitmproxy.

```bash
specint replay --har path/to/export.har --session my-session
```

**Implementation:**
The pipeline from `filterApiEntries(entries, config)` onward already handles `HarEntry[]`.
This is mostly plumbing:

1. Add `replay` command to `capture.ts` command dispatch
2. `replayCommand(argv, config)`:
   - Read and parse the HAR file from `--har` path
   - Extract `entries` from `har.log.entries`
   - Call `filterApiEntries(entries, config)` — respects `urlFilter`
   - Run full pipeline: dedup → transform → report
   - Write to `captures/<session>/` as normal
3. No browser launch, no Playwright, no recording windows
4. The `--session` flag names the output directory; auto-increment applies

Add to `README.md`, `USAGE.md`, and help text.

**Commit:** `feat: add specint replay command for existing HAR files`

---

### Task 25 — GitHub issue and PR templates

**Source:** OSS_READINESS.md §16

Create `.github/ISSUE_TEMPLATE/bug_report.md`:
```markdown
---
name: Bug report
about: Something isn't working
---

**specint version:** (run `specint --version`)
**Node version:** (run `node --version`)
**OS:**

**Command run:**
```

**Expected behavior:**

**Actual behavior:**

**Relevant output / error message:**
```

Create `.github/ISSUE_TEMPLATE/feature_request.md` and `.github/PULL_REQUEST_TEMPLATE.md`.

**Commit:** `docs: add GitHub issue and PR templates`

---

### Task 26 — Docker image

**Source:** ROADMAP.md longer-term; OSS_READINESS.md §21

Create `Dockerfile`:
```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
  libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 libasound2 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci

RUN npx playwright install chromium

COPY . .
RUN npm run build

ENTRYPOINT ["node", "dist/capture.js"]
```

Add `.dockerignore`:
```
node_modules/
dist/
captures/
profiles/
.env
*.tsbuildinfo
```

Add Docker usage example to `README.md`:
```bash
docker build -t specothesis .
docker run --rm \
  -e SCANNER_BASE_URL=https://your-app.com \
  -v $(pwd)/captures:/app/captures \
  specothesis start --session my-session --headless
```

**Commit:** `feat: add Dockerfile`

---

### Task 27 — Secret redaction in outputs

**Source:** ROADMAP.md longer-term

Before writing OpenAPI examples, StepCI steps, and curl commands, scan captured values
for common secret patterns and replace with `<REDACTED>`.

**Patterns to detect:**

| Pattern | Description |
|---|---|
| `Authorization: Bearer eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` | JWT tokens |
| `"password"\s*:\s*"[^"]+"` | Password fields in JSON bodies |
| `"token"\s*:\s*"[^"]+"` | Token fields in JSON responses |
| `"api_key"\s*:\s*"[^"]+"` | API key fields |
| `[A-Za-z0-9]{40,}` in header values | Generic long tokens |

**Implementation:**
- Create `src/utils/redact.ts` with `redactValue(key: string, value: string): string`
- Call in `toCurl.ts`, `toStepci.ts`, and `toOpenApi.ts` example generation
- Add `SCANNER_DISABLE_REDACTION=true` escape hatch for dev environments
- Log which fields were redacted (count only, not values) at the end of the run

**Commit:** `feat: redact secrets from generated output files`

---

## Commit Cadence

| Task | Area | Commit message |
|---|---|---|
| 1 | test | `test: add vitest infrastructure` |
| 2 | test | `test: add fixture HAR for unit and integration tests` |
| 3 | test | `test: unit tests for transforms, coverage, anomalies, config` |
| 4 | test | `test: integration test for full pipeline` |
| 5 | chore | `chore: add eslint and prettier` |
| 6 | ci | `ci: add GitHub Actions CI and publish workflows` |
| 7 | fix | `fix: typed errors, fail-fast config validation, process exit codes` |
| 8 | fix | `fix: log anomaly rule errors, wrap response listener, fix manifest promise` |
| 9 | refactor | `refactor: fix @ts-expect-error, headless flag bug, loose any types` |
| 10 | fix | `fix: show matched-filter count in session summary` |
| 11 | fix | `fix: drift compares against previous run not base run` |
| 12 | feat | `feat: add --version flag` |
| 13 | feat | `feat: add --quiet flag` |
| 14 | fix | `fix: use curl -sS to show errors in silent mode` |
| 15 | fix | `fix: preserve custom headers in curl output` |
| 16 | refactor | `refactor: export normaliseCoveragePath, remove duplication` |
| 17 | fix | `fix: sort sessions by mtime not alphabetically` |
| 18 | feat | `feat: add SCANNER_PUBLIC_PATTERNS env var` |
| 19 | fix | `fix: use relative paths in post-session hints` |
| 20 | feat | `feat: CI/TTY detection, login cancel command` |
| 21 | feat | `feat: add API_HOST env variable to StepCI workflows` |
| 22 | feat | `feat: add specint replay command for existing HAR files` |
| 23 | feat | `feat: configurable anomaly thresholds via env vars` |
| 24 | feat | `feat: SCANNER_API_TITLE and SCANNER_API_VERSION env vars` |
| 25 | docs | `docs: add GitHub issue and PR templates` |
| 26 | feat | `feat: add Dockerfile` |
| 27 | feat | `feat: redact secrets from generated output files` |

---

## Definition of Done (per phase)

**Phase A:** `npm test` exits 0 with all tests passing.

**Phase B:** `npm run lint` exits 0. `npm run format -- --check` exits 0.

**Phase C:** CI green on GitHub for a test push. A GitHub Release triggers npm publish.

**Phase D:** All bugs listed are fixed. `npm test` still green after each fix.

**Phase E:** Each improvement has a corresponding test or manual verification step.

**Phase F:** Each feature has documentation in `README.md` and `USAGE.md`.
