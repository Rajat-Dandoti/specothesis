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

  // --- Session / profile ---
  /** Named session for this capture run (used as output folder name) */
  session: string | undefined;
  /** Name of a saved auth profile to load (reuse a previous login) */
  profile: string | undefined;
  /** Name to save the auth profile as after a login command */
  saveProfile: string | undefined;
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

  session: env('SCANNER_SESSION'),
  profile: env('SCANNER_PROFILE'),
  saveProfile: undefined,

  // Collect any SCANNER_EXTRA_* vars for arbitrary forwarding
  extras: Object.fromEntries(
    Object.entries(process.env)
      .filter(([k]) => k.startsWith('SCANNER_EXTRA_'))
      .map(([k, v]) => [k.replace(/^SCANNER_EXTRA_/, ''), v as string])
  ),
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
