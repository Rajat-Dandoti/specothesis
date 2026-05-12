# api-scanner

Record API traffic from a real browser session and instantly get an **OpenAPI spec**, a **StepCI regression workflow**, **curl scripts**, and a full **coverage + anomaly report** — no proxy, no certificate installation, no manual spec writing.

Built on Playwright. Works with any web app.

---

## How it works

1. Open a browser with `api-scanner start`
2. Click through your app (or run an automation script)
3. Press `q` to stop — outputs are generated automatically

```
Browser (Playwright HAR recording)
  └── filter to XHR/fetch calls
       └── openapi.yaml / openapi.json   ← import into Swagger UI, Postman, code gen
       └── stepci-workflow.yaml          ← regression test suite, runs in CI
       └── curls/requests.sh             ← one curl command per captured request
       └── coverage.json                 ← per-endpoint stats
       └── anomalies.json                ← flagged issues: errors, slow responses, missing auth
       └── drift.json                    ← changes vs previous run
       └── report.html                   ← self-contained HTML report
```

---

## Install

```bash
git clone <repo-url> api-scanner
cd api-scanner
npm install
npx playwright install chromium
cp .env.example .env
```

Set `SCANNER_BASE_URL` in `.env` to your app's URL. Everything else has sensible defaults.

---

## Quickstart

```bash
# 1. Save your login state once (skip if your app doesn't need auth)
npm run capture -- login --url https://your-app.com --save-profile myapp

# 2. Capture a feature session
npm run capture -- start \
  --url https://your-app.com \
  --profile myapp \
  --session checkout

# 3. Run StepCI regression tests
stepci run captures/checkout/stepci-workflow.yaml

# 4. Fuzz the API with schemathesis
schemathesis run captures/checkout/openapi.yaml --url https://your-app.com --checks all

# 5. Open the HTML report
open captures/checkout/report.html
```

---

## Output files

Every capture run creates a folder under `captures/<session-name>/`:

| File | Description |
|---|---|
| `raw.har` | Full unmodified HAR — source of truth, always preserved |
| `filtered.har` | API-only entries within recording windows |
| `openapi.yaml` / `openapi.json` | OpenAPI 3.0.3 spec with inferred schemas |
| `stepci-workflow.yaml` | StepCI regression workflow |
| `curls/requests.sh` | All captured requests as curl commands |
| `coverage.json` | Per-endpoint stats: status codes, timings, auth presence |
| `anomalies.json` | Flagged issues across captured endpoints |
| `drift.json` | Endpoint changes vs the baseline run |
| `report.html` | Self-contained dark-theme report (coverage + anomalies + drift) |

---

## Auth configuration

By default api-scanner expects a login endpoint that returns `{"access_token": "..."}` with
a `multipart/form-data` body containing `username` and `password`. All of this is configurable:

```bash
# Login endpoint
SCANNER_AUTH_URL=https://auth.example.com/api/v1/login

# Auth method (auto-detected as bearer-login when AUTH_URL is set)
# bearer-login | bearer-static | api-key | basic | none
SCANNER_AUTH_METHOD=bearer-login

# Login body format: form (default) | json | formData
SCANNER_AUTH_BODY_FORMAT=json

# Field names in the login body
SCANNER_AUTH_USERNAME_FIELD=email
SCANNER_AUTH_PASSWORD_FIELD=password

# JSONPath to the token in the login response
# Supports: $.access_token | $.token | $.data.jwt | $.auth.token
SCANNER_AUTH_TOKEN_PATH=$.token

# Prefix before the token in Authorization header (default: Bearer)
SCANNER_AUTH_SCHEME=Bearer
```

See `.env.example` for the full reference with examples for each auth method.

---

## Feature flags

All nine outputs are individually toggleable. Set any to `false` in `.env` to disable:

```bash
SCANNER_ENABLE_OPENAPI=true
SCANNER_ENABLE_STEPCI=true
SCANNER_ENABLE_CURL=true
SCANNER_ENABLE_COVERAGE=true
SCANNER_ENABLE_ANOMALIES=true
SCANNER_ENABLE_DRIFT=true
SCANNER_ENABLE_HTML_REPORT=true
SCANNER_ENABLE_EXAMPLES=true    # captured values as examples in OpenAPI spec
SCANNER_ENABLE_DEDUP=true       # deduplicate identical requests
```

For one-off runs, use `--only` to override env flags without editing `.env`:

```bash
# OpenAPI spec only
npm run capture -- start --url https://app.com --only openapi

# Spec + StepCI workflow
npm run capture -- start --url https://app.com --only openapi,stepci

# Full report suite (html implies coverage + anomalies + drift)
npm run capture -- start --url https://app.com --only html
```

---

## Commands

```
npm run capture -- start    Capture a session (default command)
npm run capture -- login    Open browser, log in, save auth profile
npm run capture -- list     Show saved profiles and recent sessions
npm run capture -- --help   Full help and examples
```

### start options

```
--url <url>          Starting URL              (env: SCANNER_BASE_URL)
--session <name>     Output folder name        (env: SCANNER_SESSION)
--profile <name>     Load saved auth profile   (env: SCANNER_PROFILE)
--filter <glob>      URL capture filter        (env: SCANNER_URL_FILTER, default: **/api/**)
--headless           Headless browser          (env: SCANNER_HEADLESS)
--script <path>      Automation script
--only <outputs>     Comma-separated outputs: openapi, stepci, curl, coverage, anomalies, drift, html
```

### Interactive controls (manual mode)

```
p + Enter   Pause recording  — navigate without capturing noise
r + Enter   Resume recording
q + Enter   Stop and generate outputs
```

---

## Automation scripts

Pass a TypeScript script with `--script` for fully automated capture (useful in CI):

```typescript
import type { Page, BrowserContext } from 'playwright';
import type { ScannerConfig } from '../src/config.js';

export default async function journey(page: Page, context: BrowserContext, config: ScannerConfig) {
  await page.goto('https://your-app.com/login');
  await page.fill('#email', config.username ?? '');
  await page.fill('#password', config.password ?? '');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');

  await page.click('text=Products');
  await page.waitForSelector('.product-grid');
  await page.waitForTimeout(500);
}
```

---

## CI example (GitHub Actions)

```yaml
- name: Capture API journey
  env:
    SCANNER_BASE_URL: ${{ secrets.APP_URL }}
    SCANNER_USERNAME: ${{ secrets.APP_USERNAME }}
    SCANNER_PASSWORD: ${{ secrets.APP_PASSWORD }}
    SCANNER_HEADLESS: "true"
    SCANNER_SESSION: ci-run
  run: npm run capture -- --script scripts/my-journey.ts

- name: StepCI regression
  run: stepci run captures/ci-run/stepci-workflow.yaml
  env:
    SCANNER_AUTH_TOKEN: ${{ secrets.APP_AUTH_TOKEN }}
```

---

## Configuration reference

Full variable reference: **[USAGE.md](USAGE.md)**

Architecture and internals: **[ARCHITECTURE.md](ARCHITECTURE.md)**

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for dev setup, how to add anomaly rules, and PR conventions.

---

## License

MIT — see [LICENSE](LICENSE).
