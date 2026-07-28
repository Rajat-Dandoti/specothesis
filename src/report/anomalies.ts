import * as fs from 'fs';
import * as path from 'path';
import type { HarEntry } from '../utils/harFilter.js';
import type { CoverageSummary, EndpointCoverage } from './coverage.js';
import { normaliseCoveragePath } from './coverage.js';

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

const BASE_PUBLIC_KEYWORDS = ['login', 'signup', 'register', 'health', 'ping', 'status', 'public'];

function isPublicPath(p: string, extraPatterns: string[]): boolean {
  const lower = p.toLowerCase();
  return [...BASE_PUBLIC_KEYWORDS, ...extraPatterns].some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

export interface AnomalyOpts {
  publicPatterns?: string[];
  slowMs?: number;
  largeKb?: number;
  repeatedN?: number;
}

interface Rule {
  id: string;
  severity: AnomalySeverity;
  check(ep: EndpointCoverage, epEntries: HarEntry[], opts: AnomalyOpts): string | null;
}

// buildRules() is called once per pipeline run — no caching needed.
function buildRules(): Rule[] {
  return [
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
      check(ep, _entries, opts) {
        if (ep.hasAuth) return null;
        if (isPublicPath(ep.path, opts.publicPatterns ?? [])) return null;
        return 'No Authorization header — is this endpoint public?';
      },
    },
    {
      id: 'slow-response',
      severity: 'info',
      check(ep, _entries, opts) {
        const threshold = opts.slowMs ?? 2000;
        if (ep.avgResponseMs <= threshold) return null;
        return `Average response ${ep.avgResponseMs}ms — may indicate a slow query`;
      },
    },
    {
      id: 'large-response',
      severity: 'info',
      check(_ep, epEntries, opts) {
        const limit = (opts.largeKb ?? 500) * 1024;
        const large = epEntries.find((e) => Math.max(e.response.bodySize, e.response.content.size ?? 0) > limit);
        if (!large) return null;
        const kb = Math.round(Math.max(large.response.bodySize, large.response.content.size ?? 0) / 1024);
        return `Response body ${kb}kb — worth checking pagination`;
      },
    },
    {
      id: 'repeated-calls',
      severity: 'info',
      check(ep, _entries, opts) {
        const threshold = opts.repeatedN ?? 5;
        if (ep.callCount <= threshold) return null;
        return `Called ${ep.callCount} times — possible polling or pagination loop`;
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectAnomalies(
  summary: CoverageSummary,
  entries: HarEntry[],
  opts: AnomalyOpts = {}
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const rules = buildRules();

  for (const ep of summary.endpoints) {
    const epEntries = entries.filter((e) => {
      if (e.request.method.toUpperCase() !== ep.method) return false;
      try {
        const u = new URL(e.request.url);
        return normaliseCoveragePath(u.pathname) === ep.path;
      } catch {
        return false;
      }
    });

    for (const rule of rules) {
      try {
        const message = rule.check(ep, epEntries, opts);
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
