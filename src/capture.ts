import { createRequire } from 'module';
import minimist from 'minimist';
import { resolveConfig, type ScannerConfig } from './config.js';
import { resolveOnlyFlag } from './args.js';
import { ConfigError, CaptureError, TransformError } from './errors.js';

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

function applyOnlyFlag(cfg: ScannerConfig, only: string): ScannerConfig {
  try {
    const features = resolveOnlyFlag(only, cfg.features);
    return { ...cfg, features };
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
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
// Dispatch
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (COMMAND === 'list') {
    const { run } = await import('./commands/list.js');
    run();
  } else if (COMMAND === 'login') {
    const { run } = await import('./commands/login.js');
    await run(config);
  } else if (COMMAND === 'replay') {
    const harPath = argv['har'] as string | undefined;
    if (!harPath) {
      console.error('Error: --har <path> is required for the replay command');
      process.exit(1);
    }
    const { run } = await import('./commands/replay.js');
    await run(config, harPath);
  } else {
    const { run } = await import('./commands/start.js');
    await run(config);
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
