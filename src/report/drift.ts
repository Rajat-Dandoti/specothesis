import * as fs from 'fs';
import * as path from 'path';
import type { CoverageSummary, EndpointCoverage } from './coverage.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DriftType = 'added' | 'removed' | 'changed';

export interface EndpointDrift {
  type: DriftType;
  endpoint: string;
  detail?: string;
}

export interface DriftReport {
  baseSession: string;
  compareSession: string;
  hasChanges: boolean;
  added: EndpointDrift[];
  removed: EndpointDrift[];
  changed: EndpointDrift[];
}

// ---------------------------------------------------------------------------
// Load previous coverage
// ---------------------------------------------------------------------------

/**
 * Given the current session directory, find the previous session's coverage.json.
 *
 * Naming convention (from session.ts):
 *   First run  → captures/checkout/
 *   Second run → captures/checkout-2/
 *   Third run  → captures/checkout-3/
 *
 * Strategy: strip the trailing -N suffix to find the base name, then look for
 * captures/<base>/coverage.json. If this IS the base (no suffix), return null —
 * there is nothing to compare against yet.
 */
export function loadPreviousCoverage(currentDir: string): CoverageSummary | null {
  const capturesDir = path.dirname(currentDir);
  const currentName = path.basename(currentDir);

  const baseName = currentName.replace(/-\d+$/, '');
  if (baseName === currentName) return null; // this is already the base run

  const prevPath = path.join(capturesDir, baseName, 'coverage.json');
  if (!fs.existsSync(prevPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(prevPath, 'utf-8')) as CoverageSummary;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Diff logic
// ---------------------------------------------------------------------------

function endpointKey(ep: EndpointCoverage): string {
  return `${ep.method}:${ep.path}`;
}

function statusSetEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

export function detectDrift(current: CoverageSummary, previous: CoverageSummary): DriftReport {
  const prevMap = new Map<string, EndpointCoverage>(
    previous.endpoints.map((ep) => [endpointKey(ep), ep])
  );
  const currMap = new Map<string, EndpointCoverage>(
    current.endpoints.map((ep) => [endpointKey(ep), ep])
  );

  const added: EndpointDrift[] = [];
  const removed: EndpointDrift[] = [];
  const changed: EndpointDrift[] = [];

  // Added — in current but not in previous
  for (const [key, ep] of currMap) {
    if (!prevMap.has(key)) {
      added.push({ type: 'added', endpoint: `${ep.method} ${ep.path}` });
    }
  }

  // Removed — in previous but not in current
  for (const [key, ep] of prevMap) {
    if (!currMap.has(key)) {
      removed.push({ type: 'removed', endpoint: `${ep.method} ${ep.path}` });
    }
  }

  // Changed — same key, different status codes or auth presence
  for (const [key, curr] of currMap) {
    const prev = prevMap.get(key);
    if (!prev) continue;

    const details: string[] = [];

    if (!statusSetEqual(curr.statusCodes, prev.statusCodes)) {
      details.push(
        `status codes: [${prev.statusCodes.join(', ')}] → [${curr.statusCodes.join(', ')}]`
      );
    }

    if (curr.hasAuth !== prev.hasAuth) {
      const was = prev.hasAuth ? 'authenticated' : 'unauthenticated';
      const now = curr.hasAuth ? 'authenticated' : 'unauthenticated';
      details.push(`auth: ${was} → ${now}`);
    }

    if (details.length > 0) {
      changed.push({
        type: 'changed',
        endpoint: `${curr.method} ${curr.path}`,
        detail: details.join('; '),
      });
    }
  }

  return {
    baseSession: previous.sessionName,
    compareSession: current.sessionName,
    hasChanges: added.length > 0 || removed.length > 0 || changed.length > 0,
    added,
    removed,
    changed,
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function writeDriftReport(drift: DriftReport, outDir: string): void {
  const outPath = path.join(outDir, 'drift.json');
  fs.writeFileSync(outPath, JSON.stringify(drift, null, 2), 'utf-8');
  console.log(`  [drift]    ${outPath}`);
}

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

export function printDrift(drift: DriftReport): void {
  if (!drift.hasChanges) {
    console.log(`  ↕  No API drift detected (vs ${drift.baseSession})`);
    return;
  }

  console.log(`  ↕  API DRIFT  (vs ${drift.baseSession})`);

  for (const d of drift.added) {
    console.log(`  +  ${d.endpoint.padEnd(45)}  ADDED`);
  }
  for (const d of drift.removed) {
    console.log(`  -  ${d.endpoint.padEnd(45)}  REMOVED`);
  }
  for (const d of drift.changed) {
    console.log(`  ~  ${d.endpoint.padEnd(45)}  CHANGED  ${d.detail ?? ''}`);
  }
}
