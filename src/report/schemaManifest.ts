import * as fs from 'fs';
import * as path from 'path';
import { CAPTURES_DIR } from '../session.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchemaTestCase {
  testCaseId: string;
  result: 'fail' | 'error';
  statusReceived?: number;
  failureReason: string;
  reproduceCurl?: string;
}

export interface SchemaEndpointResult {
  method: string;
  path: string;
  failed: number;
  skipped: number;
  failures: SchemaTestCase[];
}

export interface SchemaManifest {
  sessionName: string;
  sourceSpec: string;
  ranAt: string;
  baseUrl: string;
  totalOperations: number;
  totalFailed: number;
  totalSkipped: number;
  endpoints: SchemaEndpointResult[];
}

// ---------------------------------------------------------------------------
// XML attribute extractor (no dependency needed — structure is predictable)
// ---------------------------------------------------------------------------

function attr(tag: string, name: string): string {
  const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(tag);
  if (!m) return '';
  return m[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&#9;/g, '\t')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)));
}

// ---------------------------------------------------------------------------
// Failure message parser
// ---------------------------------------------------------------------------

function parseFailureMessage(msg: string): SchemaTestCase {
  const idMatch = /Test Case ID:\s*(\S+)/.exec(msg);
  const ruleMatch = /^- (.+)$/m.exec(msg);
  const statMatch = /Received:\s*(\d+)/.exec(msg);
  const curlMatch = /Reproduce with:\s*\n\n\s+(curl[\s\S]+?)(?:\n\n|$)/.exec(msg);

  const testCaseId = idMatch?.[1] ?? 'unknown';
  const failureReason = ruleMatch?.[1]?.trim() ?? msg.split('\n')[0]?.trim() ?? 'unknown';
  const statusReceived = statMatch ? parseInt(statMatch[1], 10) : undefined;
  const reproduceCurl = curlMatch?.[1]?.trim().replace(/\s+/g, ' ');

  return {
    testCaseId,
    result: 'fail',
    ...(statusReceived !== undefined ? { statusReceived } : {}),
    failureReason,
    ...(reproduceCurl ? { reproduceCurl } : {}),
  };
}

// ---------------------------------------------------------------------------
// JUnit XML parser
// ---------------------------------------------------------------------------

interface RawTestCase {
  name: string;
  failures: string[]; // raw failure message strings
  skipped: number;
}

function parseJUnit(xml: string): { suiteAttr: Record<string, string>; cases: RawTestCase[] } {
  // Extract <testsuite ...> attributes
  const suiteTagMatch = /<testsuite([^>]*)>/i.exec(xml);
  const suiteTag = suiteTagMatch?.[1] ?? '';
  const suiteAttr: Record<string, string> = {};
  for (const m of suiteTag.matchAll(/(\w+)="([^"]*)"/g)) suiteAttr[m[1]] = m[2];

  // Extract all <testcase ...>...</testcase> blocks
  const cases: RawTestCase[] = [];
  const tcRe = /<testcase([^>]*)>([\s\S]*?)<\/testcase>/gi;

  for (const tcMatch of xml.matchAll(tcRe)) {
    const tcTag = tcMatch[1];
    const tcBody = tcMatch[2];
    const name = attr(`name="${attr(tcTag + '"', 'name')}"`, 'name') || attr(tcTag, 'name');

    // Collect all <failure message="..."/> within this testcase
    const failures: string[] = [];
    for (const fMatch of tcBody.matchAll(/<failure[^>]*message="([^"]*)"[^/]*\/>/gi)) {
      failures.push(attr(`message="${fMatch[1]}"`, 'message'));
    }
    // Also handle <failure ...>...</failure> (long-form)
    for (const fMatch of tcBody.matchAll(
      /<failure[^>]*message="([^"]*)"[^>]*>([\s\S]*?)<\/failure>/gi
    )) {
      failures.push(attr(`message="${fMatch[1]}"`, 'message'));
    }

    const skipped = (tcBody.match(/<skipped/gi) ?? []).length;

    cases.push({ name, failures, skipped });
  }

  return { suiteAttr, cases };
}

// ---------------------------------------------------------------------------
// Build manifest
// ---------------------------------------------------------------------------

export function buildManifest(
  junitPath: string,
  sessionName: string,
  baseUrl: string
): SchemaManifest {
  let xml: string;
  try {
    xml = fs.readFileSync(junitPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Could not read JUnit results at: ${junitPath}\n` +
      `  ${err instanceof Error ? err.message : err}\n` +
      `  Run 'specint test' to generate results before building the manifest.`
    );
  }
  const { suiteAttr, cases } = parseJUnit(xml);

  const ranAt = new Date().toISOString();
  const sourceSpec = path.join('captures', sessionName, 'openapi.yaml');

  const endpoints: SchemaEndpointResult[] = [];
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const tc of cases) {
    // Parse "METHOD /path" — skip "Stateful tests" and similar non-operation entries
    const opMatch = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)$/i.exec(tc.name.trim());

    if (!opMatch) {
      // Non-operation entry (e.g. "Stateful tests") — still count failures
      totalFailed += tc.failures.length;
      totalSkipped += tc.skipped;
      continue;
    }

    const method = opMatch[1].toUpperCase();
    const opPath = opMatch[2];
    const failures = tc.failures.map(parseFailureMessage);

    endpoints.push({
      method,
      path: opPath,
      failed: tc.failures.length,
      skipped: tc.skipped,
      failures,
    });

    totalFailed += tc.failures.length;
    totalSkipped += tc.skipped;
  }

  const totalOperations = parseInt(suiteAttr['tests'] ?? '0', 10);

  return {
    sessionName,
    sourceSpec,
    ranAt,
    baseUrl,
    totalOperations,
    totalFailed,
    totalSkipped,
    endpoints,
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function writeManifest(manifest: SchemaManifest, sessionName: string): string {
  const outDir = path.join(CAPTURES_DIR, sessionName);
  const outPath = path.join(outDir, 'schemathesis-manifest.json');

  if (!fs.existsSync(outDir)) {
    console.error(`Error: session directory not found: ${outDir}`);
    process.exit(1);
  }

  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), 'utf-8');
  return outPath;
}

// ---------------------------------------------------------------------------
// Print
// ---------------------------------------------------------------------------

export function printManifest(manifest: SchemaManifest): void {
  const { sessionName, sourceSpec, totalOperations, totalFailed, endpoints } = manifest;

  const methodW = 6;
  const pathW = Math.max(4, ...endpoints.map((e) => e.path.length));
  const line = '-'.repeat(Math.max(methodW + pathW + 30, 55));

  console.log('');
  console.log(`  SCHEMATHESIS MANIFEST  ${sessionName}`);
  console.log(`  Source: ${sourceSpec}`);
  console.log(line);
  console.log(`  ${'METHOD'.padEnd(methodW)}  ${'PATH'.padEnd(pathW)}  FAIL  SKIP`);

  for (const ep of endpoints) {
    const failCls = ep.failed > 0 ? '!' : ' ';
    console.log(
      `  ${failCls}${ep.method.padEnd(methodW - 1)}  ${ep.path.padEnd(pathW)}  ${String(ep.failed).padEnd(4)}  ${ep.skipped}`
    );
  }

  console.log(line);
  console.log(`  Total: ${totalOperations} operations   ${totalFailed} failed\n`);

  const allFailures = endpoints.flatMap((ep) =>
    ep.failures.map((f) => ({ endpoint: `${ep.method} ${ep.path}`, ...f }))
  );

  if (allFailures.length > 0) {
    console.log('  FAILURES');
    for (const f of allFailures) {
      console.log(`  ${f.endpoint}`);
      if (f.statusReceived !== undefined) console.log(`    received: ${f.statusReceived}`);
      console.log(`    reason:   ${f.failureReason}`);
      console.log('');
    }
  }
}
