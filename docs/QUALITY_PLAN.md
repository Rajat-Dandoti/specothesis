# Specothesis — Quality & Professionalism Plan

> Goal: transform from a working vibe-coded tool into something that reads as intentional,
> maintainable, and production-ready. No feature work — only quality uplift.

---

## Phase A — Tests (highest impact)

### A1. Test infrastructure
- Add `vitest` as a dev dependency (`npm i -D vitest`)
- Add `"test": "vitest run"` and `"test:watch": "vitest"` to `package.json` scripts
- Create `vitest.config.ts` with ESM support:
  ```ts
  import { defineConfig } from 'vitest/config';
  export default defineConfig({ test: { environment: 'node' } });
  ```
- Create `tests/` directory at project root

### A2. Fixture HAR file
- Create `tests/fixtures/sample.har` — a minimal but realistic HAR with:
  - A login POST with JSON body and `access_token` response
  - A GET with path params (`/api/items/123`)
  - A GET with query params
  - A POST with `application/x-www-form-urlencoded` body
  - A response with a 4xx status code
  - A response with a large body (>50KB)
  - A request without an Authorization header
- This fixture drives all unit and integration tests without a live browser

### A3. Unit tests — pure transforms

**`tests/unit/normalisePath.test.ts`**
- Numeric segment → `{id}`
- UUID segment → `{id}`
- Long hex segment → `{id}`
- Clean path unchanged
- Multiple param segments get unique names (`{id}`, `{id2}`)

**`tests/unit/toCurl.test.ts`**
- `application/x-www-form-urlencoded` — each param is its own `--data-urlencode` flag
- JSON body — uses `--data` with correct quoting
- Authorization header is preserved
- `curl -sS` (not `-s`) — errors are shown

**`tests/unit/toOpenApi.test.ts`**
- Path params are correctly extracted (`/api/items/123` → `/api/items/{id}`)
- `operationId` derived correctly for GET, POST, DELETE
- Tags derived from first non-version path segment
- Login operation appears first in `paths`
- Duplicate param names get counter suffix

**`tests/unit/anomalies.test.ts`**
- Client error rule fires on 4xx
- Server error rule fires on 5xx
- Missing auth rule fires when no Authorization header
- Missing auth rule does NOT fire for endpoints matching `PUBLIC_KEYWORDS`
- Slow response rule fires above threshold
- Large payload rule fires above threshold

**`tests/unit/coverage.test.ts`**
- Auth column shows `false` when 0 of N requests have auth header
- Auth column shows `true` when at least one request has auth header
- Status code aggregation is correct

**`tests/unit/harFilter.test.ts`**
- Entries outside recording windows are filtered out
- Entries with non-xhr/fetch resource types are filtered out
- Entries not matching `urlFilter` glob are filtered out

### A4. Integration test

**`tests/integration/pipeline.test.ts`**
- Read `tests/fixtures/sample.har`
- Run full pipeline: filter → dedup → all transforms → all reports
- Assert output files exist: `openapi.yaml`, `stepci-workflow.yaml`, `curls/requests.sh`, `coverage.json`, `anomalies.json`, `report.html`
- Assert `openapi.yaml` is valid YAML and has `paths` with at least one entry
- Assert `stepci-workflow.yaml` has `tests` array
- Assert `coverage.json` has at least one endpoint entry
- Assert `anomalies.json` is an array
- Runs in a temp directory (`fs.mkdtempSync`) — cleans up after itself

### A5. Config test

**`tests/unit/config.test.ts`**
- `authMethod` auto-derives to `bearer-login` when `SCANNER_AUTH_URL` is set
- `authMethod` stays `none` when `SCANNER_AUTH_URL` is not set
- `--only openapi` disables all outputs except openapi
- `--only html` enables coverage + anomalies + drift + html
- `headless: false` CLI flag correctly overrides `SCANNER_HEADLESS=true` env

---

## Phase B — Linting and Formatting

### B1. ESLint
- Install: `npm i -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin`
- Create `.eslintrc.cjs`:
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
- Add `"lint": "eslint src/ tests/"` to scripts
- Fix all existing lint errors (likely: unused vars, explicit `any` types)

### B2. Prettier
- Install: `npm i -D prettier`
- Create `.prettierrc`:
  ```json
  { "singleQuote": true, "trailingComma": "es5", "printWidth": 100 }
  ```
- Add `"format": "prettier --write src/ tests/ scripts/"` to scripts
- Run once and commit the formatted output as a single "chore: format codebase" commit

### B3. Pre-commit hook (optional but professional)
- Install: `npm i -D lint-staged husky`
- Run `npx husky init`
- Configure lint-staged in `package.json`:
  ```json
  "lint-staged": {
    "src/**/*.ts": ["eslint --fix", "prettier --write"],
    "tests/**/*.ts": ["prettier --write"]
  }
  ```

---

## Phase C — CI Pipeline

### C1. GitHub Actions — CI workflow

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

### C2. GitHub Actions — publish workflow

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
- Add `NPM_TOKEN` as a GitHub Actions secret (Settings → Secrets → Actions)
- Future publishes: create a GitHub Release → CI publishes automatically

---

## Phase D — Error Handling

### D1. Typed error classes

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

### D2. Fail-fast config validation

Add `validateConfig(config: ScannerConfig): void` in `src/config.ts`:
- `SCANNER_BASE_URL` must be a valid URL
- `SCANNER_AUTH_URL` must be a valid URL if set
- `SCANNER_AUTH_METHOD` must be one of the valid `AuthMethod` values if set
- `SCANNER_AUTH_TOKEN_PATH` must start with `$.` if set
- `SCANNER_HEADLESS` must be `true` or `false` if set
- Throw `ConfigError` with a clear message: `ConfigError: SCANNER_AUTH_METHOD must be one of: bearer-login, bearer-static, api-key, basic, none. Got: "beare"`
- Call `validateConfig(config)` at the top of `startCommand()` before anything else

### D3. Silent catch blocks

Fix every empty or nearly-empty catch in the codebase:

**`src/report/anomalies.ts`** — rule errors silently swallowed:
```ts
} catch (err) {
  console.error(`[anomalies] rule "${rule.id}" threw on ${ep.path}:`, err);
}
```

**`src/capture.ts`** — `response` event listener:
```ts
page.on('response', (res) => {
  try {
    if (['xhr', 'fetch'].includes(res.request().resourceType())) { ... }
  } catch {
    // request object GC'd during navigation — safe to ignore
  }
});
```
(This one is intentional — keep the catch but add the explanatory comment.)

### D4. Process exit codes
- `capture.ts` top-level should catch unhandled errors and exit with code 1:
  ```ts
  main().catch((err) => {
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  });
  ```

---

## Phase E — Type Safety Cleanup

### E1. Fix `@ts-expect-error` in `toStepci.ts`
Extend the `StepciStep` type to include the `captures` field:
```ts
interface StepciStep {
  // ... existing fields
  captures?: Record<string, { jsonpath: string }>;
}
```
Remove the `@ts-expect-error` comment.

### E2. Replace loose `any` types
- Audit `src/` for `any` — fix each with a proper type or `unknown`
- Common pattern: `JSON.parse()` returns `any` — type the result explicitly

### E3. `headless` CLI flag bug
In `capture.ts`:
```ts
// Current (broken — can't force headless:false from CLI)
headless: argv.headless || undefined,

// Fix
headless: argv.headless === true ? true : argv.headless === false ? false : undefined,
```
Or more cleanly:
```ts
headless: 'headless' in argv ? Boolean(argv.headless) : undefined,
```

---

## Phase F — Visible Polish

### F1. `--version` flag
In `capture.ts`:
```ts
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { version } = require('../package.json');

if (argv.version || argv.v) {
  console.log(`specint v${version}`);
  process.exit(0);
}
```

### F2. Fix `session.ts` sort order
`listSessions` sorts alphabetically → `checkout-10` before `checkout-2`.
Sort by directory mtime instead:
```ts
return sessions.sort((a, b) => {
  const aStat = fs.statSync(path.join(CAPTURES_DIR, a));
  const bStat = fs.statSync(path.join(CAPTURES_DIR, b));
  return bStat.mtimeMs - aStat.mtimeMs; // most recent first
});
```

### F3. Fix `toCurl.ts` silent errors
Change `curl -s` to `curl -sS` — silent mode but show errors.

### F4. Fix `anomalies.ts` shared normalization
Export `normaliseCoveragePath` from `coverage.ts` and import it in `anomalies.ts`.
Removes the duplicated regex logic.

### F5. `--quiet` flag
Add `--quiet` flag to suppress per-request logging.
Only print the final summary when `--quiet` is passed.
Add to help text and `USAGE.md`.

### F6. `.gitignore` additions
Add:
```
.hypothesis/
**/.DS_Store
```

---

## Commit strategy

Each phase is one commit (or one PR if working on a fork):

| Phase | Commit message |
|---|---|
| A | `test: add vitest suite — unit + integration` |
| B | `chore: add eslint, prettier, lint-staged` |
| C | `ci: add GitHub Actions CI and publish workflows` |
| D | `fix: typed errors, fail-fast config validation, silent catches` |
| E | `refactor: fix @ts-expect-error, loose any types, headless flag bug` |
| F | `fix: --version flag, session sort, curl -sS, shared normalisePath, --quiet` |

---

## Definition of done

- `npm run lint` exits 0
- `npm run build` exits 0
- `npm test` exits 0 with all tests passing
- `specint --version` prints `specint v1.0.0`
- `specint start --only openapi` runs without error against a test URL
- CI green on GitHub for main branch
