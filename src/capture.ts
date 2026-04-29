import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import minimist from 'minimist';
import { resolveConfig } from './config.js';
import { readHar, filterApiEntries, filterByWindows, writeFilteredHar } from './utils/harFilter.js';
import { enrichHarEntries } from './utils/harNormalize.js';
import { injectFormDataCapture, collectCapturedFormData, mergeFormDataIntoHar } from './utils/formDataCapture.js';
import { toOpenApi } from './transform/toOpenApi.js';
import { toStepci } from './transform/toStepci.js';
import { toCurl } from './transform/toCurl.js';
import { saveProfile, getProfilePath, listProfiles, makeSessionDir, listSessions } from './session.js';
import { startInteractiveLoop, waitForSave } from './interactive.js';
import type { RecordingWindow } from './interactive.js';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = minimist(process.argv.slice(2), {
  string: ['url', 'out', 'filter', 'script', 'session', 'profile', 'save-profile'],
  boolean: ['headless', 'help', 'list'],
  alias: { h: 'help' },
});

const COMMAND = (argv._[0] as string | undefined) ?? 'start'; // 'login' | 'start' | 'list'

if (argv.help || COMMAND === 'help') {
  console.log(`
Usage:
  npm run capture -- [command] [options]

Commands:
  start   (default) Capture a named session. Opens the browser; pause, resume,
          or stop from the terminal. Reuse a saved profile to skip login.
  login   Open the browser, log in manually, then save the auth state as a
          reusable profile (cookies + localStorage).
  list    List saved profiles and recent sessions.

Options for  start:
  --url <url>            Starting URL  (env: SCANNER_BASE_URL)
  --session <name>       Session name — used as the output folder  (env: SCANNER_SESSION)
  --profile <name>       Load a saved auth profile  (env: SCANNER_PROFILE)
  --filter <glob>        URL capture filter  (env: SCANNER_URL_FILTER, default: "**/api/**")
  --headless             Headless browser  (env: SCANNER_HEADLESS)
  --script <file>        Automation script  (env: SCANNER_SCRIPT_PATH)
  --out <name>           Alias for --session (backwards compat)

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
  npm run capture -- login --url https://app.com --save-profile myapp

  # Capture a feature session reusing saved auth
  npm run capture -- start --url https://app.com --profile myapp --session product-listing

  # Capture another feature (still logged in)
  npm run capture -- start --url https://app.com/cart --profile myapp --session checkout

  # List saved profiles and sessions
  npm run capture -- list
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const config = resolveConfig({
  baseUrl: argv.url,
  urlFilter: argv.filter,
  headless: argv.headless || undefined,
  outName: argv.out,
  scriptPath: argv.script,
  session: argv.session ?? argv.out,
  profile: argv.profile,
  saveProfile: argv['save-profile'],
});

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

  console.log(`\n=== API Scanner — Login ===`);
  console.log(`  URL:     ${baseUrl}`);
  console.log(`  Profile: ${profileName}`);
  console.log('');

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  await waitForSave();

  // Save auth state before closing
  const tmpPath = path.join(process.cwd(), `.profile-tmp-${Date.now()}.json`);
  await context.storageState({ path: tmpPath });
  await context.close();
  await browser.close();

  const savedPath = saveProfile(profileName, tmpPath);
  fs.unlinkSync(tmpPath);

  console.log(`\n  Profile saved: ${savedPath}`);
  console.log(`\n  Use it with:`);
  console.log(`    npm run capture -- start --url ${baseUrl} --profile ${profileName} --session <session-name>\n`);
}

// ---------------------------------------------------------------------------
// start command
// ---------------------------------------------------------------------------

async function startCommand(): Promise<void> {
  const { baseUrl, urlFilter, headless, scriptPath } = config;
  const sessionName = config.session || config.outName || (baseUrl ? new URL(baseUrl).hostname : 'session');
  const profileName = config.profile;

  if (!baseUrl) {
    console.error('Error: --url is required (or set SCANNER_BASE_URL in .env)');
    process.exit(1);
  }

  // Resolve profile path
  let profilePath: string | undefined;
  if (profileName) {
    profilePath = getProfilePath(profileName);
    if (!profilePath) {
      console.error(`Error: profile "${profileName}" not found. Run: npm run capture -- login --url ${baseUrl} --save-profile ${profileName}`);
      process.exit(1);
    }
  }

  const runDir = makeSessionDir(sessionName);
  const harPath = path.join(runDir, 'raw.har');
  const filteredHarPath = path.join(runDir, 'filtered.har');

  console.log(`\n=== API Scanner — Session: "${sessionName}" ===`);
  console.log(`  URL:     ${baseUrl}`);
  console.log(`  Filter:  ${urlFilter}`);
  if (profileName) console.log(`  Profile: ${profileName}`);
  if (config.username) console.log(`  User:    ${config.username}`);
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
      console.log(`  [req] ${req.method()} ${req.url()}`);
    }
  });
  page.on('response', (res) => {
    if (['xhr', 'fetch'].includes(res.request().resourceType())) {
      console.log(`  [res] ${res.status()} ${res.url()}`);
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
    const script = await import(path.resolve(scriptPath));
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

  console.log(`\n  Captured ${requestCount} XHR/fetch requests total.`);
  if (recordingWindows.length > 0) {
    console.log(`  Recording windows: ${recordingWindows.length} (paused ${recordingWindows.length - 1 > 0 ? recordingWindows.length - 1 + ' time(s)' : '0 times'})`);
  }
  console.log(`  Raw HAR: ${harPath}`);

  // -------------------------------------------------------------------------
  // Post-processing
  // -------------------------------------------------------------------------

  const har = readHar(harPath);
  let apiEntries = filterApiEntries(har, urlFilter);

  // Apply recording-window filter (excludes requests made while paused)
  apiEntries = filterByWindows(apiEntries, recordingWindows);

  if (apiEntries.length === 0) {
    console.warn('\n  No API entries matched. Check --filter or widen the glob.');
    process.exit(0);
  }

  console.log(`\n  Filtered to ${apiEntries.length} API entries. Generating outputs...\n`);

  // Merge JS-captured FormData into HAR entries missing postData
  mergeFormDataIntoHar(apiEntries, capturedFormData);

  enrichHarEntries(apiEntries);
  writeFilteredHar(har, apiEntries, filteredHarPath);

  toOpenApi(apiEntries, runDir);
  toStepci(apiEntries, sessionName, runDir);
  toCurl(apiEntries, runDir);

  console.log(`\nDone. Outputs in:\n  ${runDir}\n`);
  console.log('Next steps:');
  console.log(`  schemathesis run ${path.join(runDir, 'openapi.yaml')} --url ${baseUrl} --checks all`);
  console.log(`  stepci run ${path.join(runDir, 'stepci-workflow.yaml')}`);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (COMMAND === 'list') {
    listCommand();
  } else if (COMMAND === 'login') {
    await loginCommand();
  } else {
    await startCommand();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
