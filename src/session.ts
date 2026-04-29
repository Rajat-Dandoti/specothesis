/**
 * Session and profile management.
 *
 * Profile  = saved Playwright storageState (cookies + localStorage).
 *            Stored in profiles/<name>.json.
 *            Reused across multiple capture sessions so you only log in once.
 *
 * Session  = one named capture run.
 *            Output lives in captures/<session-name>/.
 *            If the directory already exists a numeric suffix is appended
 *            (captures/checkout-2/, captures/checkout-3/, …).
 */

import * as fs from 'fs';
import * as path from 'path';

export const PROFILES_DIR = path.join(process.cwd(), 'profiles');
export const CAPTURES_DIR = path.join(process.cwd(), 'captures');

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/** Ensure the profiles directory exists. */
function ensureProfilesDir(): void {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

/**
 * Persist a Playwright storageState file as a named profile.
 * `tmpPath` is the path Playwright wrote the storageState to.
 */
export function saveProfile(name: string, tmpPath: string): string {
  ensureProfilesDir();
  const dest = path.join(PROFILES_DIR, `${name}.json`);
  fs.copyFileSync(tmpPath, dest);
  return dest;
}

/**
 * Return the absolute path to a profile JSON file, or undefined if it
 * doesn't exist.
 */
export function getProfilePath(name: string): string | undefined {
  const p = path.join(PROFILES_DIR, `${name}.json`);
  return fs.existsSync(p) ? p : undefined;
}

/** List all saved profile names (without the .json extension). */
export function listProfiles(): string[] {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs
    .readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5));
}

// ---------------------------------------------------------------------------
// Session output directories
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').toLowerCase().slice(0, 50).replace(/-$/, '');
}

/**
 * Create and return a unique output directory for a session.
 * - First run of "checkout"  → captures/checkout/
 * - Second run               → captures/checkout-2/
 * - Third run                → captures/checkout-3/
 */
export function makeSessionDir(sessionName: string): string {
  fs.mkdirSync(CAPTURES_DIR, { recursive: true });
  const base = slugify(sessionName);
  let candidate = path.join(CAPTURES_DIR, base);

  if (!fs.existsSync(candidate)) {
    fs.mkdirSync(candidate, { recursive: true });
    return candidate;
  }

  let n = 2;
  while (fs.existsSync(path.join(CAPTURES_DIR, `${base}-${n}`))) n++;
  candidate = path.join(CAPTURES_DIR, `${base}-${n}`);
  fs.mkdirSync(candidate, { recursive: true });
  return candidate;
}

/** List existing session output directories, newest first. */
export function listSessions(): string[] {
  if (!fs.existsSync(CAPTURES_DIR)) return [];
  return fs
    .readdirSync(CAPTURES_DIR)
    .filter((d) => fs.statSync(path.join(CAPTURES_DIR, d)).isDirectory())
    .sort()
    .reverse();
}
