import { describe, test, expect } from 'vitest';
import * as path from 'path';
import { buildManifest } from '../../src/report/schemaManifest.js';

const FIXTURE = path.resolve('tests/fixtures/schemathesis-junit.xml');
const SESSION = 'nebula';
const BASE_URL = 'https://api.dev-v5.privasapien.com';

describe('buildManifest', () => {
  test('returns correct session metadata', () => {
    const m = buildManifest(FIXTURE, SESSION, BASE_URL);
    expect(m.sessionName).toBe(SESSION);
    expect(m.baseUrl).toBe(BASE_URL);
    expect(m.sourceSpec).toBe('captures/nebula/openapi.yaml');
    expect(typeof m.ranAt).toBe('string');
  });

  test('counts total operations from testsuite attribute', () => {
    const m = buildManifest(FIXTURE, SESSION, BASE_URL);
    // fixture has tests="13" on the <testsuite> element
    expect(m.totalOperations).toBe(13);
  });

  test('extracts only HTTP-method endpoints (skips "Stateful tests")', () => {
    const m = buildManifest(FIXTURE, SESSION, BASE_URL);
    // fixture has 12 real operations + 1 "Stateful tests" entry
    expect(m.endpoints).toHaveLength(12);
    const names = m.endpoints.map((e) => `${e.method} ${e.path}`);
    expect(names).not.toContain('Stateful tests');
  });

  test('parses endpoint method and path correctly', () => {
    const m = buildManifest(FIXTURE, SESSION, BASE_URL);
    const login = m.endpoints.find((e) => e.path === '/api/v1/local/{tenant}/login');
    expect(login).toBeDefined();
    expect(login!.method).toBe('POST');
  });

  test('counts failures per endpoint', () => {
    const m = buildManifest(FIXTURE, SESSION, BASE_URL);
    const login = m.endpoints.find((e) => e.path === '/api/v1/local/{tenant}/login')!;
    // fixture has 2 <failure> elements for POST /api/v1/local/{tenant}/login
    expect(login.failed).toBe(2);
    expect(login.failures).toHaveLength(2);
  });

  test('counts skipped per endpoint', () => {
    const m = buildManifest(FIXTURE, SESSION, BASE_URL);
    const login = m.endpoints.find((e) => e.path === '/api/v1/local/{tenant}/login')!;
    // fixture has 1 <skipped> for this testcase
    expect(login.skipped).toBe(1);
  });

  test('extracts test case IDs from failure messages', () => {
    const m = buildManifest(FIXTURE, SESSION, BASE_URL);
    const login = m.endpoints.find((e) => e.path === '/api/v1/local/{tenant}/login')!;
    const ids = login.failures.map((f) => f.testCaseId);
    expect(ids).toContain('7zTbFn');
    expect(ids).toContain('N0SrI6');
  });

  test('extracts failure reasons', () => {
    const m = buildManifest(FIXTURE, SESSION, BASE_URL);
    const login = m.endpoints.find((e) => e.path === '/api/v1/local/{tenant}/login')!;
    const reasons = login.failures.map((f) => f.failureReason);
    expect(reasons).toContain('Unsupported methods');
    expect(reasons).toContain('Undocumented HTTP status code');
  });

  test('extracts received status codes', () => {
    const m = buildManifest(FIXTURE, SESSION, BASE_URL);
    const health = m.endpoints.find((e) => e.path === '/api/health')!;
    expect(health.failures[0].statusReceived).toBe(401);
  });

  test('accumulates totalFailed including Stateful tests entry', () => {
    const m = buildManifest(FIXTURE, SESSION, BASE_URL);
    // 12 endpoint failures (1 per endpoint that has failures) + 2 for login + 1 for stateful = let's just verify it's >= endpoint sum
    const endpointSum = m.endpoints.reduce((acc, e) => acc + e.failed, 0);
    // Stateful tests has 1 failure — total must exceed endpoint sum
    expect(m.totalFailed).toBeGreaterThan(endpointSum);
  });

  test('totalSkipped includes skipped from all testcases', () => {
    const m = buildManifest(FIXTURE, SESSION, BASE_URL);
    const endpointSkipSum = m.endpoints.reduce((acc, e) => acc + e.skipped, 0);
    expect(m.totalSkipped).toBe(endpointSkipSum); // Stateful tests has no <skipped>
  });

  test('throws on missing file', () => {
    expect(() => buildManifest('/nonexistent/junit.xml', SESSION, BASE_URL)).toThrow(
      'Could not read JUnit results'
    );
  });
});
