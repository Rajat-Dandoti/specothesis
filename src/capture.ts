import { createRequire } from 'module';
import { resolveConfig, type ScannerConfig } from './config.js';
import { parseArgs, resolveOnlyFlag, COMMAND_HELP } from './args.js';
import { ConfigError, CaptureError, TransformError } from './errors.js';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { command: COMMAND, commandIsExplicit, flags: argv } = parseArgs(process.argv.slice(2));

if (argv.version) {
  const _require = createRequire(import.meta.url);
  const pkg = _require('../package.json') as { version: string };
  console.log(pkg.version);
  process.exit(0);
}

if (argv.help || COMMAND === 'help') {
  // Per-subcommand help when the user types e.g. `specint replay --help`
  if (commandIsExplicit && COMMAND !== 'help' && COMMAND_HELP[COMMAND]) {
    console.log(`\n${COMMAND_HELP[COMMAND]}\n`);
  } else {
    console.log(`
Specothesis — capture browser API traffic and generate OpenAPI, StepCI, curl, and reports.

Usage:
  specint [command] [options]

Commands:
  start    (default) Capture a named session. Opens the browser; pause, resume,
           or stop from the terminal. Reuse a saved profile to skip login.
  login    Open the browser, log in manually, then save the auth state as a
           reusable profile (cookies + localStorage).
  list     List saved profiles and recent sessions.
  replay   Run the full pipeline on an existing HAR file — no browser needed.
  profile  Manage saved auth profiles (list / show / delete).

Run  specint <command> --help  for options specific to that command.

Common options (start):
  --url <url>            Starting URL  (env: SCANNER_BASE_URL)
  --session <name>       Session name — used as the output folder  (env: SCANNER_SESSION)
  --profile <name>       Load a saved auth profile  (env: SCANNER_PROFILE)
  --filter <glob>        URL capture filter  (env: SCANNER_URL_FILTER, default: "**/api/**")
  --only <outputs>       Comma-separated outputs: openapi, stepci, curl, coverage, anomalies, drift, html
  --quiet / -q           Suppress per-request log lines  (env: SCANNER_QUIET)
  --version / -v         Print version and exit

Credential env vars (set in .env or shell):
  SCANNER_USERNAME    Login username / email
  SCANNER_PASSWORD    Login password
  SCANNER_AUTH_TOKEN  Bearer token → \${{env.SCANNER_AUTH_TOKEN}} in StepCI output
  SCANNER_API_KEY     API key      → \${{env.SCANNER_API_KEY}} in StepCI output
  SCANNER_EXTRA_*     Arbitrary extras forwarded to automation scripts

Examples:
  specint login --url https://app.com --save-profile myapp
  specint start --url https://app.com --profile myapp --session checkout
  specint start --url https://app.com --only openapi,stepci
  specint replay --har captures/checkout/raw.har --only openapi
  specint profile list
`);
  }
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
  } else if (COMMAND === 'profile') {
    const subcommand = argv._[1] as string | undefined;
    const name = argv._[2] as string | undefined;
    const { run } = await import('./commands/profile.js');
    await run(subcommand, name);
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
