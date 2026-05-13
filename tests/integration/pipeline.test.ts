import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as url from 'url';
import { readHar, filterApiEntries, deduplicateEntries } from '../../src/utils/harFilter.js';
import { toOpenApi } from '../../src/transform/toOpenApi.js';
import { toStepci } from '../../src/transform/toStepci.js';
import { toCurl } from '../../src/transform/toCurl.js';
import { buildCoverageSummary, writeCoverageReport } from '../../src/report/coverage.js';
import { detectAnomalies, writeAnomalyReport } from '../../src/report/anomalies.js';
import { generateHtmlReport } from '../../src/report/htmlReport.js';
import yaml from 'js-yaml';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE_HAR = path.join(__dirname, '../fixtures/sample.har');
const URL_FILTER = '**/api/**';

const authCfg = {
  authBodyFormat: 'json' as const,
  authUsernameField: 'email',
  authPasswordField: 'password',
  authTokenPath: '$.access_token',
  authScheme: 'Bearer',
};

let tmpDir: string;
let entries: ReturnType<typeof filterApiEntries>;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specothesis-integration-'));
  const har = readHar(FIXTURE_HAR);
  entries = deduplicateEntries(filterApiEntries(har, URL_FILTER));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe('pipeline — OpenAPI output', () => {
  it('produces openapi.yaml with at least one path', () => {
    toOpenApi(entries, tmpDir, 'https://api.example.com', undefined, false, authCfg);
    const yamlPath = path.join(tmpDir, 'openapi.yaml');
    expect(fs.existsSync(yamlPath)).toBe(true);
    const spec = yaml.load(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
    expect(spec).toHaveProperty('openapi');
    expect(spec).toHaveProperty('paths');
    expect(Object.keys(spec.paths as object).length).toBeGreaterThan(0);
  });

  it('produces openapi.json', () => {
    const jsonPath = path.join(tmpDir, 'openapi.json');
    expect(fs.existsSync(jsonPath)).toBe(true);
    const spec = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(spec).toHaveProperty('paths');
  });
});

describe('pipeline — StepCI output', () => {
  it('produces stepci-workflow.yaml with a tests block', () => {
    toStepci(entries, 'test-session', tmpDir, undefined, authCfg);
    const workflowPath = path.join(tmpDir, 'stepci-workflow.yaml');
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = yaml.load(fs.readFileSync(workflowPath, 'utf-8')) as Record<string, unknown>;
    expect(workflow).toHaveProperty('tests');
  });
});

describe('pipeline — curl output', () => {
  it('produces curls/requests.sh with shebang', () => {
    toCurl(entries, tmpDir);
    const shPath = path.join(tmpDir, 'curls', 'requests.sh');
    expect(fs.existsSync(shPath)).toBe(true);
    const content = fs.readFileSync(shPath, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('produces one individual .sh per entry', () => {
    const files = fs.readdirSync(path.join(tmpDir, 'curls')).filter((f) => f !== 'requests.sh');
    expect(files.length).toBe(entries.length);
  });
});

describe('pipeline — coverage output', () => {
  it('produces coverage.json with endpoint data', () => {
    const summary = buildCoverageSummary(entries, 'test-session');
    writeCoverageReport(summary, tmpDir);
    const coveragePath = path.join(tmpDir, 'coverage.json');
    expect(fs.existsSync(coveragePath)).toBe(true);
    const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
    expect(coverage).toHaveProperty('endpoints');
    expect(coverage.endpoints.length).toBeGreaterThan(0);
  });
});

describe('pipeline — anomalies output', () => {
  it('produces anomalies.json as an array', () => {
    const summary = buildCoverageSummary(entries, 'test-session');
    const anomalies = detectAnomalies(summary, entries);
    writeAnomalyReport(anomalies, tmpDir);
    const anomalyPath = path.join(tmpDir, 'anomalies.json');
    expect(fs.existsSync(anomalyPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(anomalyPath, 'utf-8'));
    expect(Array.isArray(data)).toBe(true);
  });

  it('detects at least one anomaly in the fixture (has 404, large response, missing auth)', () => {
    const summary = buildCoverageSummary(entries, 'test-session');
    const anomalies = detectAnomalies(summary, entries);
    expect(anomalies.length).toBeGreaterThan(0);
  });
});

describe('pipeline — HTML report output', () => {
  it('produces report.html containing html tag', () => {
    const summary = buildCoverageSummary(entries, 'test-session');
    const anomalies = detectAnomalies(summary, entries);
    generateHtmlReport(summary, anomalies, null, tmpDir);
    const reportPath = path.join(tmpDir, 'report.html');
    expect(fs.existsSync(reportPath)).toBe(true);
    const content = fs.readFileSync(reportPath, 'utf-8');
    expect(content).toContain('<html');
  });
});
