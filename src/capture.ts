import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { chromium } from 'playwright';
import minimist from 'minimist';
import { resolveConfig, validateConfig, type ScannerConfig, type ScannerFeatures } from './config.js';
import { ConfigError, CaptureError, TransformError } from './errors.js';
import {
  readHar,
  filterApiEntries,
  filterByWindows,
  deduplicateEntries,
  writeFilteredHar,
} from './utils/harFilter.js';
import { enrichHarEntries } from './utils/harNormalize.js';
import {
  injectFormDataCapture,
  collectCapturedFormData,
  mergeFormDataIntoHar,
} from './utils/formDataCapture.js';
import { toOpenApi } from './transform/toOpenApi.js';
import { toStepci } from './transform/toStepci.js';
import { toCurl } from './transform/toCurl.js';
import {
  buildCoverageSummary,
  writeCoverageReport,
  printCoverageTable,
} from './report/coverage.js';
import { detectAnomalies, writeAnomalyReport, printAnomalies } from './report/anomalies.js';
import { detectDrift, loadPreviousCoverage, writeDriftReport, printDrift } from './report/drift.js';
import { generateHtmlReport } from './report/htmlReport.js';
import {
  saveProfile,
  getProfilePath,
  listProfiles,
  makeSessionDir,
  listSessions,
} from './session.js';
import { startInteractiveLoop, waitForSave } from './interactive.js';
import type { RecordingWindow } from './interactive.js';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = minimist(process.argv.slice(2), {
  string: ['url', 'out', 'filter', 'script', 'session', 'profile', 'save-profile', 'only', 'har'],
  boolean: ['headless', 'help', 'list', 'version', 'quiet', 'include-failed'],
  alias: { h: 'help', v: 'version', q: 'quiet' },
});

const COMMAND = (argv._[0] as string | undefined) ?? 'start'; // 'login' | 'start' | 'list' | 'replay'

if (argv.version) {
  const _require = createRequire(import.meta.url);
  const pkg = _require('../package.json') as { version: string };
  console.log(pkg.version);
  process.exit(0);
}

if (argv.help || COMMAND === 'help') {
  console.log(`
Specothesis — capture browser API traffic and generate OpenAPI, StepCI, curl, and reports.

Usage:
  specint [command] [options]

Commands:
  start   (default) Capture a named session. Opens the browser; pause, resume,
          or stop from the terminal. Reuse a saved profile to skip login.
  login   Open the browser, log in manually, then save the auth state as a
          reusable profile (cookies + localStorage).
  list    List saved profiles and recent sessions.
  replay  Run the full pipeline on an existing HAR file — no browser needed.

Options for  start:
  --url <url>            Starting URL  (env: SCANNER_BASE_URL)
  --session <name>       Session name — used as the output folder  (env: SCANNER_SESSION)
  --profile <name>       Load a saved auth profile  (env: SCANNER_PROFILE)
  --filter <glob>        URL capture filter  (env: SCANNER_URL_FILTER, default: "**/api/**")
  --headless             Headless browser  (env: SCANNER_HEADLESS)
  --script <file>        Automation script  (env: SCANNER_SCRIPT_PATH)
  --out <name>           Alias for --session (backwards compat)
  --only <outputs>       Comma-separated list of outputs to generate, disabling all others.
                         Valid: openapi, stepci, curl, coverage, anomalies, drift, html
                         Implied deps: anomalies→coverage, drift→coverage, html→coverage+anomalies+drift
  --quiet / -q           Suppress per-request [req]/[res] log lines; always print the final summary.
                         Env: SCANNER_QUIET=true
  --include-failed       Include requests that received no HTTP response (network errors, CORS
                         preflight failures, cancellations). Default: off. Env: SCANNER_CAPTURE_FAILED=true
  --version / -v         Print version and exit.

Options for  replay:
  --har <path>           Path to an existing HAR file (required)
  --session <name>       Output folder name (default: HAR filename without extension)
  --filter <glob>        URL filter — same as start  (default: **/api/**)
  --only <outputs>       Same as start

Options for  login:
  --url <url>            App URL to open for login
  --save-profile <name>  Name to save the profile under  (required)

Credential env vars (set in .env or shell):
  SCANNER_USERNAME    Login username / email
  SCANNER_PASSWORD    Login password
  SCANNER_AUTH_TOKEN  Bearer token → \${{env.SCANNER_AUTH_TOKEN}} in StepCI output
  SCANNER_API_KEY     API key      → \${{env.SCANNER_API_KEY}} in StepCI output
  SCANNER_EXTRA_*     Arbitrary extras forwarded to automation scripts

Interactive controls (during  start  in manual mode):
  p + Enter   Pause recording (navigate to the right place without capturing noise)
  r + Enter   Resume recording
  q + Enter   Stop and generate outputs

Examples:
  # Log in once and save profile
  specint login --url https://app.com --save-profile myapp

  # Capture a feature session reusing saved auth
  specint start --url https://app.com --profile myapp --session product-listing

  # Capture another feature (still logged in)
  specint start --url https://app.com/cart --profile myapp --session checkout

  # List saved profiles and sessions
  specint list

  # Generate only the OpenAPI spec for this run (ignore .env feature flags)
  specint start --url https://app.com --only openapi

  # Generate spec + StepCI workflow only
  specint start --url https://app.com --only openapi,stepci

  # Generate full HTML report suite (enables coverage, anomalies, drift, html)
  specint start --url https://app.com --only html

  # Replay an existing HAR file (from Chrome DevTools, Postman, mitmproxy, etc.)
  specint replay --har path/to/export.har --session my-session
  specint replay --har captures/checkout/raw.har --only openapi
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const VALID_ONLY_VALUES = [
  'openapi',
  'stepci',
  'curl',
  'coverage',
  'anomalies',
  'drift',
  'html',
] as const;
type OnlyValue = (typeof VALID_ONLY_VALUES)[number];

function applyOnlyFlag(cfg: ScannerConfig, only: string): ScannerConfig {
  const requested = only
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as OnlyValue[];

  const invalid = requested.filter((v) => !(VALID_ONLY_VALUES as readonly string[]).includes(v));
  if (invalid.length > 0) {
    console.error(`Error: unknown --only value(s): ${invalid.join(', ')}`);
    console.error(`Valid values: ${VALID_ONLY_VALUES.join(', ')}`);
    process.exit(1);
  }

  // Zero all output flags; preserve dedup and examples (not output selectors)
  const features: ScannerFeatures = {
    dedup: cfg.features.dedup,
    examples: cfg.features.examples,
    redact: cfg.features.redact,
    openapi: false,
    stepci: false,
    curl: false,
    coverage: false,
    anomalies: false,
    drift: false,
    htmlReport: false,
  };

  for (const v of requested) {
    if (v === 'openapi') {
      features.openapi = true;
    }
    if (v === 'stepci') {
      features.stepci = true;
    }
    if (v === 'curl') {
      features.curl = true;
    }
    if (v === 'coverage') {
      features.coverage = true;
    }
    if (v === 'anomalies') {
      features.anomalies = true;
      features.coverage = true;
    }
    if (v === 'drift') {
      features.drift = true;
      features.coverage = true;
    }
    if (v === 'html') {
      features.htmlReport = true;
      features.coverage = true;
      features.anomalies = true;
      features.drift = true;
    }
  }

  return { ...cfg, features };
}

let config = resolveConfig({
  baseUrl: argv.url,
  urlFilter: argv.filter,
  headless: 'headless' in argv ? Boolean(argv.headless) : undefined,
  outName: argv.out,
  scriptPath: argv.script,
  session: argv.session ?? argv.out,
  profile: argv.profile,
  saveProfile: argv['save-profile'],
  quiet: argv.quiet ? true : undefined,
  captureFailedRequests: argv['include-failed'] ? true : undefined,
});

if (argv.only) {
  config = applyOnlyFlag(config, argv.only as string);
}

// ---------------------------------------------------------------------------
// list command
// ---------------------------------------------------------------------------

function listCommand(): void {
  const profiles = listProfiles();
  const sessions = listSessions();

  console.log('\n=== Saved Profiles ===');
  if (profiles.length === 0) {
    console.log('  (none)  — run: npm run capture -- login --url <url> --save-profile <name>');
  } else {
    profiles.forEach((p) => console.log(`  • ${p}`));
  }

  console.log('\n=== Recent Sessions ===');
  if (sessions.length === 0) {
    console.log('  (none)');
  } else {
    sessions.slice(0, 10).forEach((s) => console.log(`  • ${s}`));
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// login command
// ---------------------------------------------------------------------------

async function loginCommand(): Promise<void> {
  const { baseUrl, headless } = config;
  const profileName = config.saveProfile;

  if (!baseUrl) {
    console.error('Error: --url is required for the login command');
    process.exit(1);
  }
  if (!profileName) {
    console.error('Error: --save-profile <name> is required for the login command');
    process.exit(1);
  }

  console.log(`\n=== Specothesis — Login ===`);
  console.log(`  URL:     ${baseUrl}`);
  console.log(`  Profile: ${profileName}`);
  console.log('');

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const { saved } = await waitForSave();

  if (!saved) {
    await context.close();
    await browser.close();
    return;
  }

  // Save auth state before closing
  const tmpPath = path.join(process.cwd(), `.profile-tmp-${Date.now()}.json`);
  await context.storageState({ path: tmpPath });
  await context.close();
  await browser.close();

  const savedPath = saveProfile(profileName, tmpPath);
  fs.unlinkSync(tmpPath);

  console.log(`\n  Profile saved: ${savedPath}`);
  console.log(`\n  Use it with:`);
  console.log(
    `    npm run capture -- start --url ${baseUrl} --profile ${profileName} --session <session-name>\n`
  );
}

// ---------------------------------------------------------------------------
// start command
// ---------------------------------------------------------------------------

async function startCommand(): Promise<void> {
  validateConfig(config);

  const { baseUrl, urlFilter, headless, scriptPath } = config;
  const sessionName =
    config.session || config.outName || (baseUrl ? new URL(baseUrl).hostname : 'session');
  const profileName = config.profile;

  // Resolve profile path
  let profilePath: string | undefined;
  if (profileName) {
    profilePath = getProfilePath(profileName);
    if (!profilePath) {
      console.error(
        `Error: profile "${profileName}" not found. Run: npm run capture -- login --url ${baseUrl} --save-profile ${profileName}`
      );
      process.exit(1);
    }
  }

  const runDir = makeSessionDir(sessionName);
  const harPath = path.join(runDir, 'raw.har');
  const filteredHarPath = path.join(runDir, 'filtered.har');

  console.log(`\n=== Specothesis — Session: "${sessionName}" ===`);
  console.log(`  URL:     ${baseUrl}`);
  console.log(`  Filter:  ${urlFilter}`);
  if (urlFilter === '**/api/**')
    console.log(`  Tip:     Use --filter "**" to capture all requests, or set SCANNER_URL_FILTER in .env`);
  if (profileName) console.log(`  Profile: ${profileName}`);
  if (config.username) {
    const displayUser = process.stdout.isTTY ? config.username : '***';
    console.log(`  User:    ${displayUser}`);
  }
  console.log(`  Output:  ${runDir}`);
  console.log('');

  // -------------------------------------------------------------------------
  // Launch browser
  // -------------------------------------------------------------------------

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    ...(profilePath ? { storageState: profilePath } : {}),
    recordHar: {
      path: harPath,
      urlFilter,
      content: 'embed',
    },
  });

  // Inject FormData capture script — catches multipart bodies that CDP/HAR misses
  await injectFormDataCapture(context);

  const page = await context.newPage();

  let requestCount = 0;
  page.on('request', (req) => {
    if (['xhr', 'fetch'].includes(req.resourceType())) {
      requestCount++;
      if (!config.quiet) console.log(`  [req] ${req.method()} ${req.url()}`);
    }
  });
  page.on('response', (res) => {
    try {
      if (['xhr', 'fetch'].includes(res.request().resourceType())) {
        if (!config.quiet) console.log(`  [res] ${res.status()} ${res.url()}`);
      }
    } catch {
      // res.request() can throw if the request was GC'd during navigation — safe to ignore
    }
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  // -------------------------------------------------------------------------
  // Journey
  // -------------------------------------------------------------------------

  let recordingWindows: RecordingWindow[] = [];

  if (scriptPath) {
    // Automated script — no interactive controls
    console.log(`\nRunning automation script: ${scriptPath}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let script: any;
    try {
      script = await import(path.resolve(scriptPath));
    } catch (err) {
      await browser.close();
      throw new CaptureError(
        `Could not load script: ${scriptPath}\n  ${err instanceof Error ? err.message : err}\n  Check the file exists and has no syntax errors.`
      );
    }
    const fn = script.default || script;
    await fn(page, context, config);
    console.log('Script completed.');
  } else {
    // Manual journey with interactive pause / resume / stop
    const loop = startInteractiveLoop(sessionName, () => requestCount);
    recordingWindows = await loop.waitForStop();
  }

  // -------------------------------------------------------------------------
  // Collect FormData captures before flushing (CDP won't have these bodies)
  // -------------------------------------------------------------------------

  const capturedFormData = await collectCapturedFormData(context);
  if (capturedFormData.length > 0) {
    console.log(`\n  Captured ${capturedFormData.length} FormData request(s) via JS intercept.`);
  }

  // -------------------------------------------------------------------------
  // Flush HAR and close
  // -------------------------------------------------------------------------

  await context.close();
  await browser.close();

  console.log(`\n  Captured ${requestCount} XHR/fetch requests (browser total).`);
  if (recordingWindows.length > 0) {
    console.log(
      `  Recording windows: ${recordingWindows.length} (paused ${recordingWindows.length - 1 > 0 ? recordingWindows.length - 1 + ' time(s)' : '0 times'})`
    );
  }
  console.log(`  Raw HAR: ${harPath}`);

  // -------------------------------------------------------------------------
  // Post-processing
  // -------------------------------------------------------------------------

  const har = readHar(harPath);
  let apiEntries = filterApiEntries(har, urlFilter, {
    captureFailedRequests: config.captureFailedRequests,
  });

  // Apply recording-window filter (excludes requests made while paused)
  apiEntries = filterByWindows(apiEntries, recordingWindows);

  if (apiEntries.length === 0) {
    console.warn(`\n  No API entries matched the active filter: ${urlFilter}`);
    console.warn(`\n  Common fixes:`);
    console.warn(`    • Widen the filter:  specint start --filter "**"`);
    console.warn(`    • Match /v1/ paths:  specint start --filter "**/v1/**"`);
    console.warn(`    • Match by host:     specint start --filter "https://api.example.com/**"`);
    console.warn(`    • Verify your app makes XHR/fetch calls (not only page navigations)`);
    console.warn(`    • Set SCANNER_URL_FILTER in .env to avoid passing --filter each time`);
    process.exit(0);
  }

  console.log(`\n  Filtered to ${apiEntries.length} API entries. Generating outputs...\n`);

  // Merge JS-captured FormData into HAR entries missing postData
  mergeFormDataIntoHar(apiEntries, capturedFormData);

  enrichHarEntries(apiEntries);

  if (config.features.dedup) {
    const before = apiEntries.length;
    apiEntries = deduplicateEntries(apiEntries);
    const dropped = before - apiEntries.length;
    if (dropped > 0) {
      console.log(
        `  Deduplicated: removed ${dropped} duplicate request(s) (${apiEntries.length} unique remain).`
      );
    }
  }

  writeFilteredHar(har, apiEntries, filteredHarPath);
  runPipeline(apiEntries, har, sessionName, runDir, baseUrl);
}

// ---------------------------------------------------------------------------
// Shared pipeline (transforms + reports) — used by start and replay
// ---------------------------------------------------------------------------

function runPipeline(
  apiEntries: ReturnType<typeof filterApiEntries>,
  har: ReturnType<typeof readHar>,
  sessionName: string,
  runDir: string,
  baseUrl: string
): void {
  const filteredHarPath = path.join(runDir, 'filtered.har');

  const authCfg = {
    authBodyFormat: config.authBodyFormat,
    authUsernameField: config.authUsernameField,
    authPasswordField: config.authPasswordField,
    authTokenPath: config.authTokenPath,
    authScheme: config.authScheme,
  };

  if (config.features.openapi)
    toOpenApi(apiEntries, runDir, config.apiUrl, config.authUrl, config.features.examples, authCfg, {
      title: config.apiTitle,
      version: config.apiVersion,
      description: config.apiDescription,
    }, config.features.redact);
  if (config.features.stepci) toStepci(apiEntries, sessionName, runDir, config.authUrl, authCfg, config.features.redact);
  if (config.features.curl) toCurl(apiEntries, runDir, config.features.redact);

  writeFilteredHar(har, apiEntries, filteredHarPath);

  const needsSummary =
    config.features.coverage ||
    config.features.anomalies ||
    config.features.drift ||
    config.features.htmlReport;
  const coverageSummary = needsSummary ? buildCoverageSummary(apiEntries, sessionName) : null;

  if (config.features.coverage && coverageSummary) {
    writeCoverageReport(coverageSummary, runDir);
    printCoverageTable(coverageSummary);
  }

  const anomalies =
    config.features.anomalies && coverageSummary
      ? detectAnomalies(coverageSummary, apiEntries, {
          publicPatterns: config.publicPatterns,
          slowMs: config.anomalySlowMs,
          largeKb: config.anomalyLargeKb,
          repeatedN: config.anomalyRepeatedN,
        })
      : [];
  if (config.features.anomalies && coverageSummary) {
    writeAnomalyReport(anomalies, runDir);
    printAnomalies(anomalies);
  }

  let driftReport = null;
  if (config.features.drift && coverageSummary) {
    const previousCoverage = loadPreviousCoverage(runDir);
    if (previousCoverage) {
      driftReport = detectDrift(coverageSummary, previousCoverage);
      writeDriftReport(driftReport, runDir);
      printDrift(driftReport);
    }
  }

  if (config.features.htmlReport && coverageSummary) {
    generateHtmlReport(coverageSummary, anomalies, driftReport, runDir);
  }

  const relDir = path.relative(process.cwd(), runDir);
  console.log(`\nDone. Outputs in:\n  ${relDir}\n`);
  console.log('Next steps:');
  console.log(`  schemathesis run ${relDir}/openapi.yaml --url ${baseUrl} --checks all`);
  console.log(`  stepci run ${relDir}/stepci-workflow.yaml`);
}

// ---------------------------------------------------------------------------
// replay command
// ---------------------------------------------------------------------------

async function replayCommand(): Promise<void> {
  const harPath = argv['har'] as string | undefined;
  if (!harPath) {
    console.error('Error: --har <path> is required for the replay command');
    process.exit(1);
  }
  if (!fs.existsSync(harPath)) {
    console.error(`Error: HAR file not found: ${harPath}`);
    process.exit(1);
  }

  const { urlFilter } = config;
  const sessionName =
    config.session || config.outName || path.basename(harPath, path.extname(harPath));
  const baseUrl = config.baseUrl || config.apiUrl || '';

  const runDir = makeSessionDir(sessionName);
  console.log(`\n=== Specothesis — Replay ===`);
  console.log(`  HAR:     ${harPath}`);
  console.log(`  Filter:  ${urlFilter}`);
  console.log(`  Output:  ${runDir}\n`);

  let har: ReturnType<typeof readHar>;
  try {
    har = readHar(harPath);
  } catch (err) {
    console.error(`\nError: could not read HAR file: ${harPath}`);
    console.error(`  ${err instanceof Error ? err.message : err}`);
    console.error(`  Run 'specint start' to capture a session, or export a HAR from`);
    console.error(`  Chrome DevTools (Network tab → right-click → Save all as HAR).`);
    process.exit(1);
  }
  let apiEntries = filterApiEntries(har, urlFilter, {
    captureFailedRequests: config.captureFailedRequests,
  });

  if (apiEntries.length === 0) {
    console.warn(`\n  No API entries matched the active filter: ${urlFilter}`);
    console.warn(`\n  Common fixes:`);
    console.warn(`    • Widen the filter:  specint replay --har ${harPath} --filter "**"`);
    console.warn(`    • Set SCANNER_URL_FILTER in .env to avoid passing --filter each time`);
    process.exit(0);
  }

  console.log(`  Filtered to ${apiEntries.length} API entries. Generating outputs...\n`);

  enrichHarEntries(apiEntries);

  if (config.features.dedup) {
    const before = apiEntries.length;
    apiEntries = deduplicateEntries(apiEntries);
    const dropped = before - apiEntries.length;
    if (dropped > 0) {
      console.log(`  Deduplicated: removed ${dropped} duplicate(s) (${apiEntries.length} unique remain).`);
    }
  }

  runPipeline(apiEntries, har, sessionName, runDir, baseUrl);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (COMMAND === 'list') {
    listCommand();
  } else if (COMMAND === 'login') {
    await loginCommand();
  } else if (COMMAND === 'replay') {
    await replayCommand();
  } else {
    await startCommand();
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`\nConfiguration error: ${err.message}\n`);
  } else if (err instanceof CaptureError) {
    console.error(`\nCapture error: ${err.message}\n`);
  } else if (err instanceof TransformError) {
    console.error(`\nTransform error: ${err.message}\n`);
  } else {
    console.error('Fatal error:', err);
  }
  process.exit(1);
});
