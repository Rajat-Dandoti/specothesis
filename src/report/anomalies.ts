import * as fs from 'fs';
import * as path from 'path';
import type { HarEntry } from '../utils/harFilter.js';
import type { CoverageSummary, EndpointCoverage } from './coverage.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnomalySeverity = 'warn' | 'info';

export interface Anomaly {
  severity: AnomalySeverity;
  endpoint: string;
  rule: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Public-path heuristic
// ---------------------------------------------------------------------------

const PUBLIC_KEYWORDS = ['login', 'signup', 'register', 'health', 'ping', 'status', 'public'];

function isPublicPath(p: string): boolean {
  const lower = p.toLowerCase();
  return PUBLIC_KEYWORDS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

interface Rule {
  id: string;
  severity: AnomalySeverity;
  // Returns a message string if the rule fires, null otherwise.
  // Receives both the aggregated endpoint coverage and all raw entries for that endpoint.
  check(ep: EndpointCoverage, epEntries: HarEntry[]): string | null;
}

const RULES: Rule[] = [
  {
    id: 'client-error',
    severity: 'warn',
    check(ep) {
      const codes = ep.statusCodes.filter((s) => s >= 400 && s < 500);
      if (codes.length === 0) return null;
      return `Returned ${codes.join(', ')} during capture — was this expected?`;
    },
  },
  {
    id: 'server-error',
    severity: 'warn',
    check(ep) {
      const codes = ep.statusCodes.filter((s) => s >= 500);
      if (codes.length === 0) return null;
      return `Returned ${codes.join(', ')} — server error during capture`;
    },
  },
  {
    id: 'missing-auth',
    severity: 'warn',
    check(ep) {
      if (ep.hasAuth) return null;
      if (isPublicPath(ep.path)) return null;
      return 'No Authorization header — is this endpoint public?';
    },
  },
  {
    id: 'slow-response',
    severity: 'info',
    check(ep) {
      if (ep.avgResponseMs <= 2000) return null;
      return `Average response ${ep.avgResponseMs}ms — may indicate a slow query`;
    },
  },
  {
    id: 'large-response',
    severity: 'info',
    check(_ep, epEntries) {
      const LIMIT = 500 * 1024; // 500 kb in bytes
      const large = epEntries.find((e) => e.response.bodySize > LIMIT);
      if (!large) return null;
      const kb = Math.round(large.response.bodySize / 1024);
      return `Response body ${kb}kb — worth checking pagination`;
    },
  },
  {
    id: 'repeated-calls',
    severity: 'info',
    check(ep) {
      if (ep.callCount <= 5) return null;
      return `Called ${ep.callCount} times — possible polling or pagination loop`;
    },
  },
];

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectAnomalies(summary: CoverageSummary, entries: HarEntry[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  for (const ep of summary.endpoints) {
    // Collect raw entries that belong to this endpoint (matched by method + normalised path)
    // We re-derive the key the same way coverage.ts does: method + normalised path.
    // Rather than duplicating normalisation logic here, we filter by the method and
    // check that the normalised path suffix matches by testing the endpoint's stored path.
    const epEntries = entries.filter((e) => {
      if (e.request.method.toUpperCase() !== ep.method) return false;
      try {
        const u = new URL(e.request.url);
        // Normalise on the fly for matching: replace uuid/numeric/hex-long segments
        const norm = u.pathname
          .split('/')
          .map((seg) =>
            /^\d+$/.test(seg) ||
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
            /^[0-9a-f]{9,}$/i.test(seg)
              ? '{id}'
              : seg
          )
          .join('/');
        return norm === ep.path;
      } catch {
        return false;
      }
    });

    for (const rule of RULES) {
      try {
        const message = rule.check(ep, epEntries);
        if (message) {
          anomalies.push({
            severity: rule.severity,
            endpoint: `${ep.method} ${ep.path}`,
            rule: rule.id,
            message,
          });
        }
      } catch (err) {
        console.error(`[anomalies] rule "${rule.id}" threw on ${ep.method} ${ep.path}:`, err);
      }
    }
  }

  return anomalies;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function writeAnomalyReport(anomalies: Anomaly[], outDir: string): void {
  const outPath = path.join(outDir, 'anomalies.json');
  fs.writeFileSync(outPath, JSON.stringify(anomalies, null, 2), 'utf-8');
  console.log(`  [anomalies] ${outPath}`);
}

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

export function printAnomalies(anomalies: Anomaly[]): void {
  const warns = anomalies.filter((a) => a.severity === 'warn');
  const infos = anomalies.filter((a) => a.severity === 'info');

  if (anomalies.length === 0) {
    console.log('  ✓  No anomalies detected');
    return;
  }

  if (warns.length > 0) {
    console.log('  ⚠  WARNINGS');
    for (const a of warns) {
      console.log(`  ${a.endpoint.padEnd(40)}  ${a.rule.padEnd(16)}  ${a.message}`);
    }
  }

  if (infos.length > 0) {
    if (warns.length > 0) console.log('');
    console.log(
      `  ℹ  ${infos.length} informational finding${infos.length !== 1 ? 's' : ''} — see anomalies.json`
    );
  }
}
