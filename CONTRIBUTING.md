# Contributing

## Dev setup

```bash
git clone https://github.com/Rajat-Dandoti/specothesis.git specothesis
cd specothesis
npm install
npx playwright install chromium   # downloads the Chromium binary — required, safe to re-run
cp .env.example .env              # fill in SCANNER_BASE_URL at minimum
```

Run a test capture (against JSONPlaceholder — no auth needed):

```bash
SCANNER_BASE_URL=https://jsonplaceholder.typicode.com \
SCANNER_URL_FILTER="https://jsonplaceholder.typicode.com/**" \
npm run capture -- start --session test-run --script scripts/demo-journey.ts --headless
```

Outputs land in `captures/test-run/`. Inspect the generated files to verify your change.

Build the TypeScript before testing the compiled output:

```bash
npm run build
node dist/capture.js --help
```

---

## Adding a new output format

1. Create `src/transform/toMyFormat.ts`:
   ```ts
   import type { HarEntry } from '../utils/harFilter.js';
   import type { ScannerConfig } from '../config.js';

   export function toMyFormat(entries: HarEntry[], outDir: string, config: ScannerConfig): void {
     // write files to outDir
   }
   ```

2. Add the feature flag to `ScannerFeatures` in `src/config.ts`:
   ```ts
   myFormat: boolean;
   ```

3. Add the default to `defaultConfig`:
   ```ts
   myFormat: envBool('SCANNER_ENABLE_MY_FORMAT', true),
   ```

4. Import and call in `src/capture.ts`:
   ```ts
   if (config.features.myFormat) toMyFormat(apiEntries, runDir, config);
   ```

5. Add `SCANNER_ENABLE_MY_FORMAT=true` to `.env.example` with a short comment.

6. Add `myFormat` to the valid `--only` values in `capture.ts` if it is a user-selectable output.

---

## Adding a new anomaly rule

Rules live in `buildRules()` inside `src/report/anomalies.ts`. Each rule implements:

```ts
interface Rule {
  id: string;                   // kebab-case, unique
  severity: 'warn' | 'info';
  check(ep: EndpointCoverage, epEntries: HarEntry[], opts: AnomalyOpts): string | null;
}
```

**What you get in `ep: EndpointCoverage`:**

```ts
interface EndpointCoverage {
  path: string;            // normalised path template, e.g. "/api/users/{userId}"
  method: string;          // uppercase HTTP method
  statusCodes: number[];   // all distinct status codes seen across captures
  callCount: number;       // total number of times this endpoint was captured
  hasAuth: boolean;        // true if any captured request had an Authorization header
  avgResponseMs: number;   // mean response time in milliseconds
  maxResponseMs: number;   // slowest single response in milliseconds
  avgResponseKb: number;   // mean response body size in KB
}
```

**What you get in `opts: AnomalyOpts`:**

```ts
interface AnomalyOpts {
  publicPatterns?: string[];  // extra path keywords treated as public (no missing-auth warn)
  slowMs?: number;            // SCANNER_ANOMALY_SLOW_MS (default: 2000)
  largeKb?: number;           // SCANNER_ANOMALY_LARGE_KB (default: 500)
  repeatedN?: number;         // SCANNER_ANOMALY_REPEATED_N (default: 5)
}
```

**Worked example — detect endpoints that always return an empty array:**

```ts
{
  id: 'empty-response',
  severity: 'info',
  check(ep, epEntries) {
    const allEmpty = epEntries.every((e) => {
      try {
        const body = JSON.parse(e.response.content.text ?? '');
        return Array.isArray(body) && body.length === 0;
      } catch {
        return false;
      }
    });
    if (!allEmpty || epEntries.length === 0) return null;
    return 'Always returned an empty array — is this endpoint seeded with data?';
  },
},
```

**Writing a test in `tests/unit/anomalies.test.ts`:**

```ts
it('empty-response fires when all captured responses are []', () => {
  // Arrange — build a minimal HarEntry with an empty-array response body
  const entry = makeEntry({ responseBody: '[]' });  // see fixtures/makeEntry helper

  // Act
  const results = detectAnomalies(
    { entries: [entry] } as any,
    makeCoverage({ path: '/api/items', statusCodes: [200], callCount: 1 })
  );

  // Assert
  const rule = results.find((a) => a.rule === 'empty-response');
  expect(rule).toBeDefined();
  expect(rule?.severity).toBe('info');
});
```

Return a message string when the rule fires, `null` when it doesn't. Rules that depend on
response body content should handle JSON parse errors gracefully — not every response is JSON.

---

## PR conventions

- One logical change per PR.
- Add a `CHANGELOG.md` entry under `[Unreleased]` for anything user-visible.
- Update `USAGE.md` if a new env var, CLI flag, or output file is introduced.
- TypeScript must compile cleanly (`npm run build`) before opening a PR.
- Keep commit messages in the imperative mood and reference the affected area:
  `feat(toOpenApi): add operationId derivation`
  `fix(toStepci): skip browser fingerprint headers`
