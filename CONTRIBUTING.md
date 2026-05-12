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

All rules live in the `RULES` array in `src/report/anomalies.ts`:

```ts
{
  id: 'my-rule',
  severity: 'warn',   // or 'info'
  check(ep: EndpointCoverage, epEntries: HarEntry[]): string | null {
    if (someCondition) return 'Short description of the problem';
    return null;
  },
}
```

The rule receives both the aggregated `EndpointCoverage` stats and the raw `HarEntry[]`
for that endpoint. Return a message string when the rule fires, `null` when it doesn't.

---

## PR conventions

- One logical change per PR.
- Add a `CHANGELOG.md` entry under `[Unreleased]` for anything user-visible.
- Update `USAGE.md` if a new env var, CLI flag, or output file is introduced.
- TypeScript must compile cleanly (`npm run build`) before opening a PR.
- Keep commit messages in the imperative mood and reference the affected area:
  `feat(toOpenApi): add operationId derivation`
  `fix(toStepci): skip browser fingerprint headers`
