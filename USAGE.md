# API Scanner — Usage Guide

A Playwright-based utility that records API traffic during a browser journey and exports it as an OpenAPI spec and a StepCI regression workflow.

---

## Table of Contents

1. [How it works](#1-how-it-works)
2. [Prerequisites](#2-prerequisites)
3. [Installation](#3-installation)
4. [Configuration](#4-configuration)
5. [Commands](#5-commands)
   - [login — save an auth profile](#51-login--save-an-auth-profile)
   - [start — capture a session](#52-start--capture-a-session)
   - [list — show profiles and sessions](#53-list--show-profiles-and-sessions)
6. [Interactive controls (pause / resume / stop)](#6-interactive-controls-pause--resume--stop)
7. [Sessions and profiles in depth](#7-sessions-and-profiles-in-depth)
8. [Output files](#8-output-files)
9. [Writing an automation script](#9-writing-an-automation-script)
10. [Using the outputs](#10-using-the-outputs)
    - [Curl commands](#101-curl-commands)
    - [Schemathesis](#102-schemathesis--api-fuzzing)
    - [StepCI](#103-stepci--regression-tests)
    - [Playwright HAR replay](#104-playwright-har-replay)
11. [CI integration](#11-ci-integration)
12. [Reference](#12-reference)

---

## 1. How it works

```
  login command                   start command
  ─────────────                   ─────────────
  Browser opens                   Browser opens (optionally with saved auth)
  User logs in                          │
  q → save profile.json           Pause / Resume / Stop interactively
        │                               │
        ▼                         Playwright recordHar (urlFilter scoped)
  profiles/<name>.json                  │
        │                         raw.har
        │ (reuse on next start)         │
        └──────────────────────── filter to API calls + recording windows
                                        │
                          ┌─────────────┴──────────────┐
                          ▼                            ▼
                    openapi.yaml              stepci-workflow.yaml
                    openapi.json
                          │                            │
                          ▼                            ▼
                    schemathesis                  stepci run
                    (fuzzing)               (regression tests)
```

1. **Login once** — `login` opens a browser so you can authenticate. On `q`, Playwright saves cookies and localStorage to a named profile file. Every subsequent `start` session can load that profile — no need to log in again.
2. **Capture** — `start` opens the browser (optionally pre-authenticated). HAR recording runs the whole time. In manual mode you control recording with `p` / `r` / `q` — requests made while paused are excluded from outputs.
3. **Filter** — after the session ends, the HAR is filtered to XHR/fetch calls matching your URL filter, then further trimmed to only the active recording windows.
4. **Transform** — the filtered HAR becomes an OpenAPI 3.0 spec, a StepCI YAML workflow, and curl command files. Multipart form bodies are fully parsed; all headers are stripped except `Authorization`, which is replaced with an env-variable reference.
5. **Test** — schemathesis fuzzes the live API; StepCI replays the captured calls as regression tests.

---

## 2. Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18+ | https://nodejs.org |
| Python | 3.8+ | https://python.org (for schemathesis only) |
| schemathesis | latest | `pip install schemathesis` |
| stepci | latest | `npm install -g stepci` |

---

## 3. Installation

```bash
git clone <repo-url> api-scanner
cd api-scanner
npm install
npx playwright install chromium   # downloads the browser binary, first time only
cp .env.example .env              # fill in your values
```

---

## 4. Configuration

Configuration is resolved in this priority order — higher wins:

```
CLI flag  >  environment variable  >  .env file  >  built-in default
```

### 4.1 Set up your .env file

```bash
cp .env.example .env
```

Edit `.env` with your values. The file is gitignored — never commit it.

### 4.2 All variables

| Variable | CLI flag | Default | Description |
|---|---|---|---|
| `SCANNER_BASE_URL` | `--url` | _(required)_ | Starting URL opened in the browser |
| `SCANNER_URL_FILTER` | `--filter` | `**/api/**` | Glob to scope which requests are captured |
| `SCANNER_HEADLESS` | `--headless` | `false` | Run browser without a visible window |
| `SCANNER_SESSION` | `--session` | hostname slug | Session name — used as the output folder |
| `SCANNER_PROFILE` | `--profile` | _(none)_ | Name of a saved auth profile to load |
| `SCANNER_SCRIPT_PATH` | `--script` | _(none)_ | Path to an automation script |
| `SCANNER_USERNAME` | — | _(none)_ | Login username, available in scripts as `config.username` |
| `SCANNER_PASSWORD` | — | _(none)_ | Login password, available as `config.password` |
| `SCANNER_AUTH_TOKEN` | — | _(none)_ | Bearer token — written as `${{env.SCANNER_AUTH_TOKEN}}` in StepCI output |
| `SCANNER_API_KEY` | — | _(none)_ | API key — written as `${{env.SCANNER_API_KEY}}` in StepCI output |
| `SCANNER_EXTRA_*` | — | _(none)_ | Any extra vars, forwarded to scripts as `config.extras.KEY` |

### 4.3 URL filter tips

```bash
# Only requests whose path contains /api/ (default)
SCANNER_URL_FILTER=**/api/**

# Everything from one domain
SCANNER_URL_FILTER=https://api.example.com/**

# Capture everything — useful for initial discovery
SCANNER_URL_FILTER=**
```

---

## 5. Commands

### 5.1 `login` — save an auth profile

Opens a browser, you log in, then type `q` to save the authenticated state (cookies + localStorage) as a named profile. Run this once per app; all subsequent capture sessions can reuse the profile.

```bash
npm run login -- --url https://your-app.com --save-profile myapp
```

Or via the full command form:

```bash
npm run capture -- login --url https://your-app.com --save-profile myapp
```

What happens:
1. Browser opens at `--url`.
2. You log in manually.
3. Type `q` + Enter in the terminal.
4. Auth state is saved to `profiles/myapp.json`.

```
  Log in to the app, then type  q  and press Enter to save your profile.
> q
  Profile saved: /path/to/profiles/myapp.json

  Use it with:
    npm run capture -- start --url https://your-app.com --profile myapp --session <session-name>
```

---

### 5.2 `start` — capture a session

Opens the browser (optionally pre-authenticated with a profile), records API calls, and generates outputs. `start` is the default command — you can omit it.

**Manual journey (interactive):**

```bash
npm run capture -- start \
  --url https://your-app.com \
  --profile myapp \
  --session product-listing \
  --filter "**/api/**"
```

The browser opens already logged in. Use the terminal controls to pause, resume, and stop (see [section 6](#6-interactive-controls-pause--resume--stop)).

**Automated script:**

```bash
npm run capture -- start \
  --url https://your-app.com \
  --profile myapp \
  --session checkout \
  --headless \
  --script scripts/checkout-journey.ts
```

**Driven entirely by `.env`:**

```bash
# .env
SCANNER_BASE_URL=https://your-app.com
SCANNER_URL_FILTER=**/api/**
SCANNER_PROFILE=myapp
SCANNER_SESSION=product-listing

npm run capture
```

**Session deduplication** — if `captures/product-listing/` already exists, the new run goes into `captures/product-listing-2/`, then `captures/product-listing-3/`, etc.

---

### 5.3 `list` — show profiles and sessions

```bash
npm run list
```

Or:

```bash
npm run capture -- list
```

Output:

```
=== Saved Profiles ===
  • myapp
  • staging-admin

=== Recent Sessions ===
  • product-listing-2
  • product-listing
  • checkout
  • login-flow
```

---

## 6. Interactive controls (pause / resume / stop)

When running `start` in manual mode (no `--script`), recording is controlled from the terminal. The browser stays open throughout.

```
  ● RECORDING  |  session: "product-listing"  |  8 requests captured
  Commands:  p = pause   q = stop
> 
```

| Command | When | Effect |
|---|---|---|
| `p` + Enter | While recording | Pauses recording. Requests made while paused are **excluded** from outputs. Use this to navigate to the right place without capturing noise. |
| `r` + Enter | While paused | Resumes recording. Opens a new recording window. |
| `q` + Enter | Anytime | Stops the session, closes the browser, and generates outputs. |

**Paused state:**

```
  ⏸ PAUSED  |  session: "product-listing"  |  8 requests captured so far
  Commands:  r = resume  q = stop
> 
```

**How pause/resume works under the hood:** the tool records timestamps at each `p` and `r`. After the session ends, HAR entries whose `startedDateTime` falls outside the active windows are filtered out before generating the OpenAPI spec and StepCI workflow. The `raw.har` always contains everything.

---

## 7. Sessions and profiles in depth

### Recommended workflow for a multi-feature app

```bash
# Step 1: Log in once
npm run login -- --url https://your-app.com --save-profile myapp

# Step 2: Capture feature by feature
# — navigate to product listing, pause to skip noise, resume, stop
npm run capture -- start --url https://your-app.com --profile myapp --session product-listing

# — capture the checkout flow with the same logged-in state
npm run capture -- start --url https://your-app.com/cart --profile myapp --session checkout

# — capture user profile APIs
npm run capture -- start --url https://your-app.com/settings --profile myapp --session user-profile

# Step 3: Check what's been captured
npm run list
```

### Profile refresh

Profiles can expire if the app uses short-lived tokens or rotating sessions. Re-run `login` with the same profile name to overwrite:

```bash
npm run login -- --url https://your-app.com --save-profile myapp
```

### Multiple environments

Use a different profile name per environment:

```bash
npm run login -- --url https://staging.your-app.com --save-profile myapp-staging
npm run login -- --url https://your-app.com         --save-profile myapp-prod
```

### Capturing the same session across days

Each run of a named session gets its own numbered directory:

```
captures/
  checkout/            ← first capture
  checkout-2/          ← second capture
  checkout-3/          ← third capture
```

Compare OpenAPI specs across runs to detect API drift:

```bash
diff captures/checkout/openapi.yaml captures/checkout-2/openapi.yaml
```

---

## 8. Output files

Each session run creates a directory under `captures/`:

```
captures/
└── <session-name>/
    ├── raw.har                 # Full unmodified HAR — everything the browser saw
    ├── filtered.har            # API-only entries within recording windows
    ├── openapi.json            # OpenAPI 3.0 spec (JSON)
    ├── openapi.yaml            # OpenAPI 3.0 spec (YAML)
    ├── stepci-workflow.yaml    # StepCI regression workflow
    └── curls/
        ├── requests.sh         # All curl commands in one file
        ├── 001_POST_api_login.sh
        ├── 002_GET_api_products.sh
        └── ...                 # One .sh per captured request
```

`raw.har` is always preserved intact — it is the source of truth. You can reprocess it manually if you need to change the filter or widen the URL glob.

**Multipart/form-data** — request bodies are fully parsed from the raw boundary format and represented in the spec as `multipart/form-data` with proper field schemas. File upload fields are typed as `{ type: string, format: binary }`.

**Header policy** — all headers are stripped from curl and StepCI outputs. Only `Authorization` is kept, with its value replaced by `$SCANNER_AUTH_TOKEN`. This avoids leaking session tokens and boundary strings into committed files.

---

## 9. Writing an automation script

Scripts are TypeScript files that export a default async function. They receive three arguments: `page`, `context`, and `config`.

```typescript
import type { Page, BrowserContext } from 'playwright';
import type { ScannerConfig } from '../src/config.js';

export default async function journey(
  page: Page,
  context: BrowserContext,
  config: ScannerConfig
): Promise<void> {
  // config.username, config.password, config.authToken, config.apiKey,
  // config.extras — all populated from env / .env

  // If not using --profile for auth, you can log in inside the script:
  await page.goto('https://your-app.com/login');
  await page.fill('#email', config.username ?? '');
  await page.fill('#password', config.password ?? '');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');

  // Perform the journey you want to capture
  await page.click('text=Products');
  await page.waitForSelector('.product-grid');
  await page.click('.product-card:first-child');
  await page.waitForSelector('.product-detail');

  // Give in-flight requests time to settle before the HAR is flushed
  await page.waitForTimeout(500);
}
```

Place scripts under `scripts/` and reference them with `--script scripts/my-journey.ts`.

> **Note:** When using `--profile` for auth, you do not need to log in inside the script — the browser opens already authenticated.

### config.extras

Any `SCANNER_EXTRA_*` env var is stripped of its prefix and forwarded:

```bash
# .env
SCANNER_EXTRA_TENANT_ID=acme
SCANNER_EXTRA_REGION=us-east-1
```

```typescript
const tenantId = config.extras['TENANT_ID'];   // "acme"
const region   = config.extras['REGION'];       // "us-east-1"
```

---

## 10. Using the outputs

### 10.1 Curl commands

Every captured request is written as a ready-to-run curl command. This is the fastest way to manually replay or share a specific call.

**`curls/requests.sh`** — all calls in a single file, in capture order:

```bash
# 001 POST /api/auth/login
curl -s -X POST \
  -H 'Content-Type: application/json' \
  --data-raw '{"username":"alice","password":"secret"}' \
  'https://your-app.com/api/auth/login'

# 002 GET /api/products
curl -s -X GET \
  -H 'Authorization: $SCANNER_AUTH_TOKEN' \
  'https://your-app.com/api/products'

# 003 POST /api/documents/upload
curl -s -X POST \
  -H 'Authorization: $SCANNER_AUTH_TOKEN' \
  -F 'title=My document' \
  -F 'attachment=@<path/to/report.pdf>' \
  'https://your-app.com/api/documents/upload'
```

Run the whole suite with your token in scope:

```bash
export SCANNER_AUTH_TOKEN=eyJhbGci...
bash captures/checkout/curls/requests.sh
```

Or cherry-pick a single call:

```bash
export SCANNER_AUTH_TOKEN=eyJhbGci...
bash captures/checkout/curls/003_POST_api_documents_upload.sh
```

**Header policy:** only `Authorization` is emitted, with its value replaced by `$SCANNER_AUTH_TOKEN`. Session cookies, boundary strings, and transport headers are all stripped — the files are safe to commit.

---

### 10.2 Schemathesis — API fuzzing

Schemathesis reads the generated OpenAPI spec and fires hundreds of edge-case requests to find crashes, validation errors, and unexpected status codes.

```bash
pip install schemathesis   # once

schemathesis run ./captures/checkout/openapi.yaml \
  --url https://your-app.com \
  --checks all
```

Useful flags:

```bash
# Fastest check — just verify no 5xx responses
schemathesis run ./captures/checkout/openapi.yaml \
  --url https://your-app.com \
  --checks not_a_server_error

# Pass an auth token
schemathesis run ./captures/checkout/openapi.yaml \
  --url https://your-app.com \
  --header "Authorization: Bearer $SCANNER_AUTH_TOKEN"

# Limit to specific methods
schemathesis run ./captures/checkout/openapi.yaml \
  --url https://your-app.com \
  --method GET --method POST

# JUnit XML report for CI
schemathesis run ./captures/checkout/openapi.yaml \
  --url https://your-app.com \
  --report junit.xml
```

### 10.3 StepCI — regression tests

StepCI replays the captured calls as a test suite. Each step asserts the same status code observed during the session; JSON response shapes are validated for key presence.

```bash
npm install -g stepci   # once

stepci run ./captures/checkout/stepci-workflow.yaml
```

Auth headers use env-variable references — supply credentials at run time:

```bash
SCANNER_AUTH_TOKEN=eyJhbGci... \
SCANNER_API_KEY=sk-abc123 \
stepci run ./captures/checkout/stepci-workflow.yaml
```

Sample generated step for a JSON endpoint:

```yaml
- name: POST /api/orders
  http:
    url: https://your-app.com/api/orders
    method: POST
    headers:
      Authorization: ${{env.SCANNER_AUTH_TOKEN}}
      Content-Type: application/json
    json:
      productId: "abc123"
      quantity: 2
    check:
      status: 201
      jsonpath:
        $.id:
          - isPresent: true
        $.status:
          - isPresent: true
```

Sample generated step for a multipart upload:

```yaml
- name: POST /api/documents/upload
  http:
    url: https://your-app.com/api/documents/upload
    method: POST
    headers:
      Authorization: ${{env.SCANNER_AUTH_TOKEN}}
    formData:
      title: My document
      attachment:
        file: <path/to/hello.txt>   # replace with a real file path
    check:
      status: 201
```

Edit the generated YAML to tighten checks (exact values, schema assertions) before committing it to your test suite.

### 10.4 Playwright HAR replay

The `raw.har` file can mock all captured calls in a Playwright test, making tests fast and network-independent:

```typescript
import { test } from '@playwright/test';

test('checkout flow with mocked API', async ({ browser }) => {
  const context = await browser.newContext();
  await context.routeFromHAR('./captures/checkout/raw.har', {
    notFound: 'fallback',   // pass through anything not in the HAR
  });
  const page = await context.newPage();
  await page.goto('https://your-app.com');
  // ... rest of test
});
```

---

## 11. CI integration

### GitHub Actions example

```yaml
name: API regression

on:
  push:
    branches: [main]

jobs:
  stepci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm install
      - run: npx playwright install --with-deps chromium

      - name: Capture API journey
        env:
          SCANNER_BASE_URL: ${{ secrets.APP_URL }}
          SCANNER_USERNAME: ${{ secrets.APP_USERNAME }}
          SCANNER_PASSWORD: ${{ secrets.APP_PASSWORD }}
          SCANNER_AUTH_TOKEN: ${{ secrets.APP_AUTH_TOKEN }}
          SCANNER_HEADLESS: "true"
          SCANNER_SESSION: ci-run
        run: npm run capture -- --script scripts/my-journey.ts

      - name: Run StepCI regression
        env:
          SCANNER_AUTH_TOKEN: ${{ secrets.APP_AUTH_TOKEN }}
          SCANNER_API_KEY: ${{ secrets.APP_API_KEY }}
        run: stepci run captures/ci-run/stepci-workflow.yaml

      - name: Upload captures as artifact
        uses: actions/upload-artifact@v4
        with:
          name: api-captures
          path: captures/
```

> In CI you always use `--script` (no interactive terminal), so pause/resume is not applicable. The `login` command is also not needed in CI — use `SCANNER_USERNAME` / `SCANNER_PASSWORD` in your automation script directly, or pre-commit a `profiles/ci.json` to the repository if the app allows static tokens.

### Keeping a committed baseline

1. Run a capture once on a known-good state.
2. Copy the workflow: `cp captures/checkout/stepci-workflow.yaml tests/api-regression.yaml`
3. Commit `tests/api-regression.yaml`.
4. In CI, run directly: `stepci run tests/api-regression.yaml`

---

## 12. Reference

### Commands

```
npm run login   -- --url <url> --save-profile <name>
npm run capture -- [start] [options]
npm run list
```

| Command | Alias | Description |
|---|---|---|
| `start` | _(default)_ | Capture a named session |
| `login` | `npm run login` | Open browser, log in, save auth profile |
| `list` | `npm run list` | Show saved profiles and recent sessions |

### CLI flags

```
start:
  --url <url>           Starting URL  (env: SCANNER_BASE_URL)
  --session <name>      Session name / output folder  (env: SCANNER_SESSION)
  --profile <name>      Load saved auth profile  (env: SCANNER_PROFILE)
  --filter <glob>       URL capture filter  (env: SCANNER_URL_FILTER)
  --headless            Headless browser  (env: SCANNER_HEADLESS)
  --script <path>       Automation script
  --out <name>          Alias for --session (backwards compat)

login:
  --url <url>           App URL to open
  --save-profile <name> Name to save the profile under  (required)

  --help / -h           Show full help
```

### Environment variables

```
SCANNER_BASE_URL        Start URL
SCANNER_URL_FILTER      Capture filter glob        default: **/api/**
SCANNER_HEADLESS        true / false               default: false
SCANNER_SESSION         Session name / output folder
SCANNER_PROFILE         Saved auth profile to load
SCANNER_SCRIPT_PATH     Automation script path

SCANNER_USERNAME        Login username
SCANNER_PASSWORD        Login password
SCANNER_AUTH_TOKEN      Bearer token → ${{env.SCANNER_AUTH_TOKEN}} in StepCI
SCANNER_API_KEY         API key      → ${{env.SCANNER_API_KEY}} in StepCI
SCANNER_EXTRA_<KEY>     Arbitrary extras → config.extras.KEY
```

### Project structure

```
api-scanner/
├── src/
│   ├── capture.ts              # Entry point — CLI dispatch, browser, orchestration
│   ├── config.ts               # Config resolution (env + CLI merge)
│   ├── session.ts              # Profile save/load, session dir naming
│   ├── interactive.ts          # Pause / resume / stop terminal loop
│   ├── transform/
│   │   ├── toOpenApi.ts        # HAR entries → OpenAPI 3.0 spec (own generator)
│   │   ├── toStepci.ts         # HAR entries → StepCI YAML workflow
│   │   └── toCurl.ts           # HAR entries → curl .sh files (Authorization only)
│   └── utils/
│       ├── harFilter.ts        # HAR parsing, API-entry filtering, window filtering
│       ├── harNormalize.ts     # Multipart boundary parser, enrichHarEntries
│       └── formDataCapture.ts  # JS FormData intercept for file upload bodies
├── scripts/
│   ├── demo-journey.ts         # Example automation script (JSONPlaceholder)
│   └── demo-multipart.ts       # Example script with multipart uploads
├── captures/                   # Generated at runtime (gitignored)
│   └── <session-name>/         # One folder per named session run
│       ├── raw.har
│       ├── filtered.har
│       ├── openapi.json
│       ├── openapi.yaml
│       └── stepci-workflow.yaml
├── profiles/                   # Saved auth states (gitignored)
│   └── <profile-name>.json
├── .env.example                # Config template — copy to .env
├── .env                        # Your values (gitignored)
├── .gitignore
├── package.json
├── tsconfig.json
└── plan.md
```
