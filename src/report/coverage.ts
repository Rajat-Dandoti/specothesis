import * as fs from 'fs';
import * as path from 'path';
import type { HarEntry } from '../utils/harFilter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EndpointCoverage {
  method: string;
  path: string;
  statusCodes: number[];
  callCount: number;
  hasAuth: boolean;
  avgResponseMs: number;
  requestSizes: number[];
  responseSizes: number[];
}

export interface CoverageSummary {
  sessionName: string;
  capturedAt: string;
  totalRequests: number;
  uniqueEndpoints: number;
  endpoints: EndpointCoverage[];
}

// ---------------------------------------------------------------------------
// Path normalisation (coverage only — different from OpenAPI parameterisation)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;
const HEX_LONG_RE = /^[0-9a-f]{9,}$/i;

function normaliseCoveragePath(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => {
      if (UUID_RE.test(seg) || NUMERIC_RE.test(seg) || HEX_LONG_RE.test(seg)) return '{id}';
      return seg;
    })
    .join('/');
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildCoverageSummary(entries: HarEntry[], sessionName: string): CoverageSummary {
  const groups = new Map<string, {
    method: string;
    path: string;
    statusCodes: Set<number>;
    callCount: number;
    hasAuth: boolean;
    responseTimes: number[];
    requestSizes: number[];
    responseSizes: number[];
  }>();

  for (const entry of entries) {
    let urlObj: URL;
    try { urlObj = new URL(entry.request.url); } catch { continue; }

    const method = entry.request.method.toUpperCase();
    const normPath = normaliseCoveragePath(urlObj.pathname);
    const key = `${method}:${normPath}`;

    const hasAuth = entry.request.headers.some(
      (h) => h.name.toLowerCase() === 'authorization'
    );

    if (!groups.has(key)) {
      groups.set(key, {
        method,
        path: normPath,
        statusCodes: new Set(),
        callCount: 0,
        hasAuth: false,
        responseTimes: [],
        requestSizes: [],
        responseSizes: [],
      });
    }

    const g = groups.get(key)!;
    g.statusCodes.add(entry.response.status);
    g.callCount++;
    if (hasAuth) g.hasAuth = true;
    if (entry.time >= 0) g.responseTimes.push(entry.time);
    if (entry.request.bodySize > 0) g.requestSizes.push(entry.request.bodySize);
    if (entry.response.bodySize > 0) g.responseSizes.push(entry.response.bodySize);
  }

  const endpoints: EndpointCoverage[] = [...groups.values()].map((g) => ({
    method: g.method,
    path: g.path,
    statusCodes: [...g.statusCodes].sort((a, b) => a - b),
    callCount: g.callCount,
    hasAuth: g.hasAuth,
    avgResponseMs: g.responseTimes.length > 0
      ? Math.round(g.responseTimes.reduce((s, t) => s + t, 0) / g.responseTimes.length)
      : 0,
    requestSizes: g.requestSizes,
    responseSizes: g.responseSizes,
  }));

  return {
    sessionName,
    capturedAt: new Date().toISOString(),
    totalRequests: entries.length,
    uniqueEndpoints: endpoints.length,
    endpoints,
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function writeCoverageReport(summary: CoverageSummary, outDir: string): void {
  const outPath = path.join(outDir, 'coverage.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`  [coverage] ${outPath}`);
}

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

export function printCoverageTable(summary: CoverageSummary): void {
  const { sessionName, totalRequests, uniqueEndpoints, endpoints } = summary;

  // Column widths — dynamic based on content
  const methodW = 6;  // "METHOD" / longest is "DELETE" = 6
  const pathW   = Math.max(4, ...endpoints.map((e) => e.path.length));
  const statusW = Math.max(6, ...endpoints.map((e) => e.statusCodes.join(', ').length));
  const authW   = 4;  // "AUTH"
  const avgW    = Math.max(3, ...endpoints.map((e) => `${e.avgResponseMs}ms`.length));

  const rowWidth = 2 + methodW + 2 + pathW + 2 + statusW + 2 + authW + 2 + avgW;
  const line = '-'.repeat(Math.max(rowWidth, 60));

  const pad = (s: string, w: number) => s.padEnd(w);

  console.log('');
  console.log(line);
  console.log(`  SESSION: ${sessionName}   ${totalRequests} request${totalRequests !== 1 ? 's' : ''}   ${uniqueEndpoints} endpoint${uniqueEndpoints !== 1 ? 's' : ''}`);
  console.log(line);
  console.log(
    `  ${pad('METHOD', methodW)}  ${pad('PATH', pathW)}  ${pad('STATUS', statusW)}  ${pad('AUTH', authW)}  AVG`
  );

  for (const ep of endpoints) {
    const status = ep.statusCodes.join(', ');
    const auth   = ep.hasAuth ? '/' : 'x';
    const avg    = `${ep.avgResponseMs}ms`;
    console.log(
      `  ${pad(ep.method, methodW)}  ${pad(ep.path, pathW)}  ${pad(status, statusW)}  ${pad(auth, authW)}  ${avg}`
    );
  }

  console.log(line);
  console.log('');
}
