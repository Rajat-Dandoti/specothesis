import minimist from 'minimist';
import type { ScannerFeatures } from './config.js';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  command: string;
  /** true when the user explicitly typed the command name (e.g. `specint start`),
   *  false when it was inferred as the default (`specint --url ...`). */
  commandIsExplicit: boolean;
  flags: minimist.ParsedArgs;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = minimist(argv, {
    string: ['url', 'out', 'filter', 'script', 'session', 'profile', 'save-profile', 'only', 'har'],
    boolean: ['headless', 'help', 'list', 'version', 'quiet', 'include-failed'],
    alias: { h: 'help', v: 'version', q: 'quiet' },
  });
  const rawCommand = flags._[0] as string | undefined;
  const command = rawCommand ?? 'start';
  return { command, commandIsExplicit: rawCommand !== undefined, flags };
}

// ---------------------------------------------------------------------------
// Per-subcommand help text (I1)
// ---------------------------------------------------------------------------

export const COMMAND_HELP: Record<string, string> = {
  start: `Usage: specint [start] [options]

Options:
  --url <url>            Starting URL  (env: SCANNER_BASE_URL)
  --session <name>       Session name — used as the output folder  (env: SCANNER_SESSION)
  --profile <name>       Load a saved auth profile  (env: SCANNER_PROFILE)
  --filter <glob>        URL capture filter  (env: SCANNER_URL_FILTER, default: "**/api/**")
  --headless             Headless browser  (env: SCANNER_HEADLESS)
  --script <file>        Automation script  (env: SCANNER_SCRIPT_PATH)
  --out <name>           Alias for --session (backwards compat)
  --only <outputs>       Comma-separated outputs to generate, disabling all others.
                         Valid: openapi, stepci, curl, coverage, anomalies, drift, html
                         Implied deps: anomalies→coverage, drift→coverage, html→all three
  --quiet / -q           Suppress per-request [req]/[res] log lines  (env: SCANNER_QUIET)
  --include-failed       Include requests that received no HTTP response  (env: SCANNER_CAPTURE_FAILED)
  --version / -v         Print version and exit
  --help / -h            Show this help

Interactive controls (manual mode):
  p + Enter   Pause recording
  r + Enter   Resume recording
  q + Enter   Stop and generate outputs`,

  replay: `Usage: specint replay --har <path> [options]

Options:
  --har <path>           Path to an existing HAR file (required)
  --session <name>       Output folder name (default: HAR filename without extension)
  --filter <glob>        URL filter — same as start  (default: **/api/**)
  --only <outputs>       Comma-separated outputs: openapi, stepci, curl, coverage, anomalies, drift, html`,

  login: `Usage: specint login --url <url> --save-profile <name>

Options:
  --url <url>            App URL to open for login
  --save-profile <name>  Name to save the profile under (required)

  After logging in, type  q + Enter  to save the profile, or  x + Enter  to cancel.`,

  list: `Usage: specint list

  Lists saved auth profiles and recent capture sessions.`,

  profile: `Usage: specint profile <subcommand> [name]

Subcommands:
  list              List all saved profiles with creation date
  show <name>       Show profile details: origins, cookie names, localStorage keys (no values)
  delete <name>     Delete a saved profile`,
};

// ---------------------------------------------------------------------------
// --only flag resolution
// ---------------------------------------------------------------------------

export const VALID_ONLY_VALUES = [
  'openapi',
  'stepci',
  'curl',
  'coverage',
  'anomalies',
  'drift',
  'html',
] as const;

export type OnlyValue = (typeof VALID_ONLY_VALUES)[number];

/**
 * Parse a comma-separated --only string and return a new ScannerFeatures object
 * with only the requested outputs enabled, plus their implied dependencies:
 *   anomalies → coverage
 *   drift     → coverage
 *   html      → coverage + anomalies + drift
 *
 * The non-output flags (dedup, examples, redact) are preserved from baseFeatures.
 * Throws an Error with a list of valid values when any unknown value is supplied.
 */
export function resolveOnlyFlag(onlyStr: string, baseFeatures: ScannerFeatures): ScannerFeatures {
  const requested = onlyStr
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as OnlyValue[];

  const invalid = requested.filter((v) => !(VALID_ONLY_VALUES as readonly string[]).includes(v));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown --only value(s): ${invalid.join(', ')}. Valid values: ${VALID_ONLY_VALUES.join(', ')}`
    );
  }

  // Start with all output flags off; preserve non-output flags
  const features: ScannerFeatures = {
    dedup: baseFeatures.dedup,
    examples: baseFeatures.examples,
    openapi: false,
    stepci: false,
    curl: false,
    coverage: false,
    anomalies: false,
    drift: false,
    htmlReport: false,
  };

  for (const v of requested) {
    if (v === 'openapi') features.openapi = true;
    if (v === 'stepci') features.stepci = true;
    if (v === 'curl') features.curl = true;
    if (v === 'coverage') features.coverage = true;
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

  return features;
}
