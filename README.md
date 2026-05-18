# Specothesis

[![npm version](https://img.shields.io/npm/v/specothesis)](https://www.npmjs.com/package/specothesis)
[![CI](https://github.com/Rajat-Dandoti/specothesis/actions/workflows/ci.yml/badge.svg)](https://github.com/Rajat-Dandoti/specothesis/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/specothesis)](LICENSE)
[![node](https://img.shields.io/node/v/specothesis)](https://nodejs.org)

Record API traffic from a real browser session and instantly get an **OpenAPI spec**, a **StepCI regression workflow**, **curl scripts**, and a full **coverage + anomaly report** — no proxy, no certificate installation, no manual spec writing.

Built on Playwright. Works with any web app.

> Conceived and directed by [Rajat Dandoti](https://github.com/Rajat-Dandoti). Built through AI-assisted development with [Claude](https://claude.ai).

---

## How it works

1. Open a browser with `specint start`
2. Click through your app (or run an automation script)
3. Press `q` to stop — outputs are generated automatically

https://github.com/user-attachments/assets/5d21c076-b568-4e44-bf58-ea4e4cca85f8

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

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| [Node.js](https://nodejs.org) | ≥ 18.0.0 | Required |
| [Playwright Chromium](https://playwright.dev) | any | Installed via `npx playwright install chromium` |
| [StepCI](https://stepci.com) | any | Optional — replays the generated `stepci-workflow.yaml` regression suite |
| [Schemathesis](https://schemathesis.io) | any | Optional — fuzzes your API using the generated `openapi.yaml` |

**Installing optional tools:**
```bash
npm install -g stepci          # StepCI regression runner
pip install schemathesis        # Schemathesis API fuzzer (requires Python)
```

Or use the Makefile to set everything up in one shot — see [Contributing](#contributing).

The generated `openapi.yaml` can also be imported directly into **Postman** (File → Import) or **Swagger UI** without any additional tooling.

---

## Install

**From npm (recommended):**
```bash
npm install -g specothesis
npx playwright install chromium   # install the browser — required even if Playwright is already installed
```

After the global install, the `specint` command is available everywhere:
```bash
specint --version   # should print the installed version
specint --help
```

> **Why `npm install -g`?** A local install (`npm install specothesis`) works with `npx specint`
> but won't put `specint` in your PATH. The global install is required for the bare `specint` command.

> Playwright ships without browsers by default. `npx playwright install chromium` downloads
> the Chromium binary that Specothesis uses to record traffic. If you already have Playwright
> installed for another project, you may already have Chromium — but running this command is
> safe to re-run and will no-op if it's already present.

Then copy the example config to your project directory:
```bash
curl -O https://raw.githubusercontent.com/Rajat-Dandoti/specothesis/main/.env.example
mv .env.example .env
# set SCANNER_BASE_URL in .env
```

> By default Specothesis captures **all XHR/fetch requests** (`SCANNER_URL_FILTER=**`). Use
> `--filter` or `SCANNER_URL_FILTER` in `.env` to narrow captures to a specific path pattern
> if you want to exclude noise (third-party analytics, CDN calls, etc.).

**From source:**
```bash
git clone https://github.com/Rajat-Dandoti/specothesis.git specothesis
cd specothesis
npm install
npx playwright install chromium
cp .env.example .env
npm run build   # produces dist/ and makes specint available via npm link
```

Set `SCANNER_BASE_URL` in `.env` to your app's URL. Everything else has sensible defaults.

---

## Quickstart

> **URL filter:** All XHR/fetch requests are captured by default. Use `--filter` to narrow
> captures if you want to exclude noise (analytics, CDN, third-party calls):
> ```bash
> --filter "**/api/**"                   # only URLs containing /api/
> --filter "**/v1/**"                    # only URLs containing /v1/
> --filter "https://api.example.com/**"  # only calls to a specific host
> ```
> Set `SCANNER_URL_FILTER` in `.env` to avoid passing it every time.

```bash
# 1. Save your login state once (skip if your app doesn't need auth)
specint login --url https://your-app.com --save-profile myapp

# 2. Capture a feature session
specint start \
  --url https://your-app.com \
  --profile myapp \
  --session checkout \
  --filter "**/api/**"   # optional: narrow to /api/ paths only

# 3. Run StepCI regression tests
stepci run captures/checkout/stepci-workflow.yaml

# 4. Fuzz the API with schemathesis
schemathesis run captures/checkout/openapi.yaml --url https://your-app.com --checks all

# 5. Open the HTML report
open captures/checkout/report.html        # macOS
xdg-open captures/checkout/report.html   # Linux
```

---

Full CLI reference, all env vars, and advanced configuration: **[USAGE.md](USAGE.md)**

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

Pick the row that matches your API and set those variables in `.env`:

| Your API auth | Variables to set |
|---|---|
| Login endpoint → Bearer token | `SCANNER_AUTH_URL`, `SCANNER_USERNAME`, `SCANNER_PASSWORD` |
| Static Bearer token (no login) | `SCANNER_AUTH_METHOD=bearer-static`, `SCANNER_AUTH_TOKEN` |
| API key header | `SCANNER_AUTH_METHOD=api-key`, `SCANNER_API_KEY` |
| HTTP Basic auth | `SCANNER_AUTH_METHOD=basic`, `SCANNER_USERNAME`, `SCANNER_PASSWORD` |
| No auth / public API | `SCANNER_AUTH_METHOD=none` (or set nothing) |

**Customising the login flow** (bearer-login only):

```bash
SCANNER_AUTH_URL=https://auth.example.com/api/v1/login

# Login body format: form (default) | json | formData
SCANNER_AUTH_BODY_FORMAT=json

# Field names in the login body (defaults: username, password)
SCANNER_AUTH_USERNAME_FIELD=email
SCANNER_AUTH_PASSWORD_FIELD=password

# JSONPath to the token in the login response (default: $.access_token)
SCANNER_AUTH_TOKEN_PATH=$.token

# Prefix before the token in Authorization header (default: Bearer)
SCANNER_AUTH_SCHEME=Bearer
```

See `.env.example` for the full reference with examples for each auth method.

---

## Feature flags

All outputs are individually toggleable. Set any to `false` in `.env` to disable:

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
SCANNER_ENABLE_REDACTION=true   # redact sensitive values in all generated outputs
```

## Secret redaction

By default, Specothesis redacts sensitive field values — passwords, tokens, API keys, secrets — in every generated output (OpenAPI examples, StepCI request bodies, curl commands). The raw HAR file is never redacted so replay always works.

Redaction is key-name based: any field whose name matches common patterns (`password`, `token`, `apiKey`, `secret`, `credential`, etc.) has its value replaced with `[REDACTED]`.

To disable (e.g. in a sandboxed dev environment where you want full values in outputs):

```bash
SCANNER_ENABLE_REDACTION=false
```

For one-off runs, use `--only` to override env flags without editing `.env`:

```bash
# OpenAPI spec only
specint start --url https://app.com --only openapi

# Spec + StepCI workflow
specint start --url https://app.com --only openapi,stepci

# Full report suite (html implies coverage + anomalies + drift)
specint start --url https://app.com --only html
```

---

## Commands

```
specint start            Capture a session (default command)
specint login            Open browser, log in, save auth profile
specint list             Show saved profiles and recent sessions
specint replay --har … Run the pipeline on an existing HAR file
specint profile list     List saved profiles with creation date
specint profile show …   Show profile details (no secret values)
specint profile delete … Delete a saved profile
specint <cmd> --help     Command-specific help
```

### start options

```
--url <url>          Starting URL              (env: SCANNER_BASE_URL)
--session <name>     Output folder name        (env: SCANNER_SESSION)
--profile <name>     Load saved auth profile   (env: SCANNER_PROFILE)
--filter <glob>      URL capture filter        (env: SCANNER_URL_FILTER, default: **)
                     Must match your API's URL pattern — if no entries match, outputs are skipped.
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
  run: specint start --script scripts/my-journey.ts

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

A `Makefile` is included for convenience:

```bash
make install   # npm install + Playwright Chromium — minimum to run specothesis
make setup     # full setup: install + Python venv + schemathesis + stepci + .env
make build     # compile TypeScript → dist/
make clean     # remove dist/ and .venv/
```

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for dev setup, how to add anomaly rules, and PR conventions.

---

## License

MIT — see [LICENSE](LICENSE).
