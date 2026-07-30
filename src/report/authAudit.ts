import * as fs from 'fs';
import * as path from 'path';
import type { HarEntry } from '../utils/harFilter.js';

export interface TokenInUrl {
  url: string;
  param: string;
}

export interface AuthAuditResult {
  /** Total calls that included an Authorization header */
  withAuth: number;
  /** Total calls without an Authorization header */
  withoutAuth: number;
  /** Endpoints (method + path) that had no auth header */
  publicEndpoints: string[];
  /** Query params where a JWT or long token value was found in the URL */
  tokenInUrl: TokenInUrl[];
  /** True if auth header appears in any request after a logout/signout call */
  postLogoutReuse: boolean;
  /** URL of the detected logout endpoint, if any */
  logoutUrl?: string;
}

const LOGOUT_PATTERNS = /logout|signout|sign-out|log-out/i;

function isJwtOrLongToken(value: string): boolean {
  // JWT: three base64url segments separated by dots
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return true;
  // Long opaque token (> 32 chars, no spaces)
  return value.length > 32 && !/\s/.test(value);
}

function hasAuthHeader(entry: HarEntry): boolean {
  return entry.request.headers.some((h) => h.name.toLowerCase() === 'authorization');
}

export function buildAuthAudit(entries: HarEntry[]): AuthAuditResult {
  // Sort by start time so we can reason about sequence
  const sorted = [...entries].sort(
    (a, b) => new Date(a.startedDateTime).getTime() - new Date(b.startedDateTime).getTime()
  );

  let withAuth = 0;
  let withoutAuth = 0;
  const publicEndpoints: string[] = [];
  const tokenInUrl: TokenInUrl[] = [];

  // Find logout entry index (first match)
  const logoutIdx = sorted.findIndex((e) => LOGOUT_PATTERNS.test(e.request.url));
  const logoutUrl = logoutIdx >= 0 ? sorted[logoutIdx].request.url : undefined;

  let postLogoutReuse = false;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const auth = hasAuthHeader(entry);

    if (auth) {
      withAuth++;
      if (logoutIdx >= 0 && i > logoutIdx) postLogoutReuse = true;
    } else {
      withoutAuth++;
      let epPath = entry.request.url;
      try { epPath = new URL(entry.request.url).pathname; } catch { /* keep */ }
      const epKey = `${entry.request.method.toUpperCase()} ${epPath}`;
      if (!publicEndpoints.includes(epKey)) publicEndpoints.push(epKey);
    }

    // Check for token values leaked into URL query params
    try {
      const u = new URL(entry.request.url);
      for (const [k, v] of u.searchParams) {
        if (isJwtOrLongToken(v)) {
          tokenInUrl.push({ url: entry.request.url, param: k });
        }
      }
    } catch { /* skip */ }
  }

  return { withAuth, withoutAuth, publicEndpoints, tokenInUrl, postLogoutReuse, logoutUrl };
}

export function writeAuthAudit(result: AuthAuditResult, outDir: string): void {
  const outPath = path.join(outDir, 'auth-audit.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`  [auth]     ${outPath}`);
}

export function printAuthAudit(result: AuthAuditResult): void {
  if (result.tokenInUrl.length > 0) {
    console.log('  ⚠  AUTH WARNINGS');
    for (const t of result.tokenInUrl) {
      console.log(`  Token in URL query param "${t.param}": ${t.url}`);
    }
  }
  if (result.postLogoutReuse) {
    console.log(`  ⚠  Token reused after logout (${result.logoutUrl})`);
  }
}
