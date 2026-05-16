/**
 * Central config module.
 *
 * Priority (highest → lowest):
 *   1. CLI flags (parsed in capture.ts, merged in after this module loads)
 *   2. Environment variables (process.env)
 *   3. .env file (loaded by dotenv, same as env vars)
 *   4. Hardcoded defaults below
 *
 * All variables are prefixed with SCANNER_ to avoid collisions.
 */

import { config as loadDotenv } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigError } from './errors.js';

// Load .env from project root if it exists
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  loadDotenv({ path: envPath });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = env(key);
  if (!v) return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

export interface ScannerFeatures {
  // --- v1 outputs ---
  /** Deduplicate repeated identical requests (method + URL + body) */
  dedup: boolean;
  /** Generate openapi.yaml / openapi.json */
  openapi: boolean;
  /** Generate stepci-workflow.yaml */
  stepci: boolean;
  /** Generate curls/ directory */
  curl: boolean;

  // --- v2 phases ---
  /** Phase 1 — embed real captured values as examples in OpenAPI spec */
  examples: boolean;
  /** Phase 2 — write coverage.json and print coverage table */
  coverage: boolean;
  /** Phase 3 — write anomalies.json and print anomaly section */
  anomalies: boolean;
  /** Phase 4 — write drift.json and print drift section */
  drift: boolean;
  /** Phase 5 — write report.html */
  htmlReport: boolean;
  /** Redact sensitive field values (passwords, tokens, keys) in all generated outputs */
  redact: boolean;
}

export type AuthMethod = 'bearer-login' | 'bearer-static' | 'api-key' | 'basic' | 'none';
export type AuthBodyFormat = 'form' | 'json' | 'formData';

export interface ScannerConfig {
  /** Starting URL for the browser journey */
  baseUrl: string;
  /** Glob or full URL pattern to filter captured requests */
  urlFilter: string;
  /** Run browser in headless mode */
  headless: boolean;
  /** Slug for the captures output subfolder */
  outName: string;
  /** Path to an automation script (optional) */
  scriptPath: string | undefined;

  // --- Credentials (used by automation scripts and StepCI env refs) ---
  /** Login username / email */
  username: string | undefined;
  /** Login password */
  password: string | undefined;
  /** Bearer token for Authorization header */
  authToken: string | undefined;
  /** Generic API key */
  apiKey: string | undefined;
  /** Any extra named env vars you want forwarded to scripts, keyed by var name */
  extras: Record<string, string>;

  // --- API server (for OpenAPI spec) ---
  /**
   * Base URL of the API server — used as the global `servers` entry in the
   * generated OpenAPI spec. This is NOT the browser start URL; it is the host
   * your API calls actually go to (e.g. https://api.example.com).
   * If unset, the spec falls back to the most-frequent host in the HAR with a warning.
   */
  apiUrl: string | undefined;

  // --- Auth endpoint (optional) ---
  /**
   * Full URL of the login endpoint that returns a JWT.
   * When set, toStepci prepends an Authenticate step that captures the token
   * and injects it as "${{captures.token}}" in all subsequent steps.
   */
  authUrl: string | undefined;

  // --- Auth behaviour ---
  /** Strategy used for auth injection. Auto-set to bearer-login when authUrl is present. */
  authMethod: AuthMethod;
  /** Request body format sent to the login endpoint (bearer-login only). */
  authBodyFormat: AuthBodyFormat;
  /** Field name for the username/email in the login request body. Default: username */
  authUsernameField: string;
  /** Field name for the password in the login request body. Default: password */
  authPasswordField: string;
  /** JSONPath to extract the token from the login response. Default: $.access_token */
  authTokenPath: string;
  /** Value prepended before the token in the Authorization header. Default: Bearer */
  authScheme: string;

  // --- Session / profile ---
  /** Named session for this capture run (used as output folder name) */
  session: string | undefined;
  /** Name of a saved auth profile to load (reuse a previous login) */
  profile: string | undefined;
  /** Name to save the auth profile as after a login command */
  saveProfile: string | undefined;

  // --- Feature flags ---
  /** Toggle individual outputs and post-processing steps on/off */
  features: ScannerFeatures;

  // --- OpenAPI info ---
  /** Title field in the generated OpenAPI spec info block */
  apiTitle: string;
  /** Version field in the generated OpenAPI spec info block */
  apiVersion: string;
  /** Description field in the generated OpenAPI spec info block */
  apiDescription: string;

  // --- Anomaly thresholds ---
  /** Avg response time (ms) above which slow-response anomaly fires. Default: 2000 */
  anomalySlowMs: number;
  /** Response body size (KB) above which large-response anomaly fires. Default: 500 */
  anomalyLargeKb: number;
  /** Call count above which repeated-calls anomaly fires. Default: 5 */
  anomalyRepeatedN: number;
  /** Comma-separated path keywords treated as public (suppress missing-auth warning) */
  publicPatterns: string[];

  // --- Output control ---
  /** Suppress per-request [req]/[res] log lines; always print the final summary */
  quiet: boolean;
  /**
   * Include entries where no HTTP response was received (Playwright status -1).
   * Covers network errors, CORS preflight failures, and cancelled requests.
   * Default: false — these entries produce invalid OpenAPI status codes.
   */
  captureFailedRequests: boolean;
}

// ---------------------------------------------------------------------------
// Env-based defaults (before CLI override)
// ---------------------------------------------------------------------------

export const defaultConfig: ScannerConfig = {
  baseUrl: env('SCANNER_BASE_URL') ?? '',
  urlFilter: env('SCANNER_URL_FILTER') ?? '**/api/**',
  headless: envBool('SCANNER_HEADLESS', false),
  outName: env('SCANNER_OUT_NAME') ?? '',
  scriptPath: env('SCANNER_SCRIPT_PATH'),

  username: env('SCANNER_USERNAME'),
  password: env('SCANNER_PASSWORD'),
  authToken: env('SCANNER_AUTH_TOKEN'),
  apiKey: env('SCANNER_API_KEY'),

  apiUrl: env('SCANNER_API_URL'),
  authUrl: env('SCANNER_AUTH_URL'),

  // Auth behaviour — auto-derive method from authUrl when not explicitly set
  authMethod: (() => {
    const m = env('SCANNER_AUTH_METHOD');
    if (m) return m as AuthMethod;
    return env('SCANNER_AUTH_URL') ? 'bearer-login' : 'none';
  })(),
  authBodyFormat: (env('SCANNER_AUTH_BODY_FORMAT') ?? 'form') as AuthBodyFormat,
  authUsernameField: env('SCANNER_AUTH_USERNAME_FIELD') ?? 'username',
  authPasswordField: env('SCANNER_AUTH_PASSWORD_FIELD') ?? 'password',
  authTokenPath: env('SCANNER_AUTH_TOKEN_PATH') ?? '$.access_token',
  authScheme: env('SCANNER_AUTH_SCHEME') ?? 'Bearer',

  session: env('SCANNER_SESSION'),
  profile: env('SCANNER_PROFILE'),
  saveProfile: undefined,

  // Collect any SCANNER_EXTRA_* vars for arbitrary forwarding
  extras: Object.fromEntries(
    Object.entries(process.env)
      .filter(([k]) => k.startsWith('SCANNER_EXTRA_'))
      .map(([k, v]) => [k.replace(/^SCANNER_EXTRA_/, ''), v as string])
  ),

  features: {
    dedup: envBool('SCANNER_ENABLE_DEDUP', true),
    openapi: envBool('SCANNER_ENABLE_OPENAPI', true),
    stepci: envBool('SCANNER_ENABLE_STEPCI', true),
    curl: envBool('SCANNER_ENABLE_CURL', true),
    examples: envBool('SCANNER_ENABLE_EXAMPLES', true),
    coverage: envBool('SCANNER_ENABLE_COVERAGE', true),
    anomalies: envBool('SCANNER_ENABLE_ANOMALIES', true),
    drift: envBool('SCANNER_ENABLE_DRIFT', true),
    htmlReport: envBool('SCANNER_ENABLE_HTML_REPORT', true),
    redact: envBool('SCANNER_ENABLE_REDACTION', true),
  },

  apiTitle: env('SCANNER_API_TITLE') ?? 'Captured API',
  apiVersion: env('SCANNER_API_VERSION') ?? '1.0.0',
  apiDescription: env('SCANNER_API_DESCRIPTION') ?? 'Generated by Specothesis',

  anomalySlowMs: parseInt(env('SCANNER_ANOMALY_SLOW_MS') ?? '2000'),
  anomalyLargeKb: parseInt(env('SCANNER_ANOMALY_LARGE_KB') ?? '500'),
  anomalyRepeatedN: parseInt(env('SCANNER_ANOMALY_REPEATED_N') ?? '5'),
  publicPatterns: (env('SCANNER_PUBLIC_PATTERNS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  quiet: envBool('SCANNER_QUIET', false),
  captureFailedRequests: envBool('SCANNER_CAPTURE_FAILED', false),
};

/**
 * Merge CLI-supplied values over the env-based defaults.
 * Undefined / empty CLI values fall back to env defaults.
 */
export function resolveConfig(cliOverrides: Partial<ScannerConfig>): ScannerConfig {
  return {
    ...defaultConfig,
    ...Object.fromEntries(
      Object.entries(cliOverrides).filter(([, v]) => v !== undefined && v !== '')
    ),
  };
}

const VALID_AUTH_METHODS: AuthMethod[] = ['bearer-login', 'bearer-static', 'api-key', 'basic', 'none'];
const VALID_AUTH_BODY_FORMATS: AuthBodyFormat[] = ['form', 'json', 'formData'];

/**
 * Validate config at startup and throw ConfigError with a clear message on
 * the first invalid value found. Called before any browser or file I/O.
 */
export function validateConfig(config: ScannerConfig): void {
  if (!config.baseUrl) {
    throw new ConfigError('SCANNER_BASE_URL is required. Set it in .env or pass --url <url>.');
  }
  try {
    new URL(config.baseUrl);
  } catch {
    throw new ConfigError(`SCANNER_BASE_URL is not a valid URL: "${config.baseUrl}"`);
  }

  if (config.authUrl) {
    try {
      new URL(config.authUrl);
    } catch {
      throw new ConfigError(`SCANNER_AUTH_URL is not a valid URL: "${config.authUrl}"`);
    }
  }

  if (!VALID_AUTH_METHODS.includes(config.authMethod)) {
    throw new ConfigError(
      `SCANNER_AUTH_METHOD must be one of: ${VALID_AUTH_METHODS.join(', ')}. Got: "${config.authMethod}"`
    );
  }

  if (!VALID_AUTH_BODY_FORMATS.includes(config.authBodyFormat)) {
    throw new ConfigError(
      `SCANNER_AUTH_BODY_FORMAT must be one of: ${VALID_AUTH_BODY_FORMATS.join(', ')}. Got: "${config.authBodyFormat}"`
    );
  }

  if (!config.authTokenPath.startsWith('$.')) {
    throw new ConfigError(
      `SCANNER_AUTH_TOKEN_PATH must start with "$." (e.g. $.access_token). Got: "${config.authTokenPath}"`
    );
  }
}

/**
 * Map of auth header names → the StepCI env-variable reference that should
 * replace the captured value in generated workflows.
 *
 * StepCI syntax: ${{env.VAR_NAME}}
 */
export const AUTH_ENV_REFS: Record<string, string> = {
  authorization: '${{env.SCANNER_AUTH_TOKEN}}',
  'x-api-key': '${{env.SCANNER_API_KEY}}',
  'x-auth-token': '${{env.SCANNER_AUTH_TOKEN}}',
  token: '${{env.SCANNER_AUTH_TOKEN}}',
};
