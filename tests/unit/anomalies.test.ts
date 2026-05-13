import { describe, it, expect } from 'vitest';
import { detectAnomalies } from '../../src/report/anomalies.js';
import type { HarEntry } from '../../src/utils/harFilter.js';
import type { CoverageSummary, EndpointCoverage } from '../../src/report/coverage.js';

function makeEndpoint(overrides: Partial<EndpointCoverage>): EndpointCoverage {
  return {
    method: 'GET',
    path: '/api/v1/items',
    statusCodes: [200],
    callCount: 1,
    hasAuth: true,
    avgResponseMs: 100,
    requestSizes: [0],
    responseSizes: [100],
    ...overrides,
  };
}

function makeSummary(endpoints: EndpointCoverage[]): CoverageSummary {
  return {
    sessionName: 'test',
    capturedAt: new Date().toISOString(),
    totalRequests: endpoints.reduce((s, e) => s + e.callCount, 0),
    uniqueEndpoints: endpoints.length,
    endpoints,
  };
}

function makeEntry(overrides: { url?: string; status?: number; bodySize?: number; hasAuth?: boolean; time?: number }): HarEntry {
  return {
    startedDateTime: '2026-05-13T10:00:00.000Z',
    time: overrides.time ?? 100,
    _resourceType: 'fetch',
    request: {
      method: 'GET',
      url: overrides.url ?? 'https://api.example.com/api/v1/items',
      headers: overrides.hasAuth !== false ? [{ name: 'authorization', value: 'Bearer token' }] : [],
      queryString: [],
      bodySize: 0,
      headersSize: 0,
    },
    response: {
      status: overrides.status ?? 200,
      statusText: 'OK',
      headers: [],
      content: { size: overrides.bodySize ?? 100, mimeType: 'application/json' },
      bodySize: overrides.bodySize ?? 100,
      headersSize: 0,
    },
  };
}

describe('anomalies — client-error rule', () => {
  it('fires for 4xx status codes', () => {
    const ep = makeEndpoint({ statusCodes: [404] });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ status: 404 })]);
    expect(anomalies.some(a => a.rule === 'client-error')).toBe(true);
  });

  it('does not fire for 200', () => {
    const ep = makeEndpoint({ statusCodes: [200] });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ status: 200 })]);
    expect(anomalies.some(a => a.rule === 'client-error')).toBe(false);
  });
});

describe('anomalies — server-error rule', () => {
  it('fires for 5xx status codes', () => {
    const ep = makeEndpoint({ statusCodes: [500] });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ status: 500 })]);
    expect(anomalies.some(a => a.rule === 'server-error')).toBe(true);
  });
});

describe('anomalies — missing-auth rule', () => {
  it('fires when endpoint has no auth', () => {
    const ep = makeEndpoint({ hasAuth: false, path: '/api/v1/items' });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ hasAuth: false })]);
    expect(anomalies.some(a => a.rule === 'missing-auth')).toBe(true);
  });

  it('does not fire for paths matching PUBLIC_KEYWORDS', () => {
    const ep = makeEndpoint({ hasAuth: false, path: '/api/v1/login' });
    const entry = makeEntry({ url: 'https://api.example.com/api/v1/login', hasAuth: false });
    const anomalies = detectAnomalies(makeSummary([ep]), [entry]);
    expect(anomalies.some(a => a.rule === 'missing-auth')).toBe(false);
  });

  it('does not fire when endpoint has auth', () => {
    const ep = makeEndpoint({ hasAuth: true });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ hasAuth: true })]);
    expect(anomalies.some(a => a.rule === 'missing-auth')).toBe(false);
  });
});

describe('anomalies — slow-response rule', () => {
  it('fires when avgResponseMs > 2000', () => {
    const ep = makeEndpoint({ avgResponseMs: 3200 });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ time: 3200 })]);
    expect(anomalies.some(a => a.rule === 'slow-response')).toBe(true);
  });

  it('does not fire when avgResponseMs <= 2000', () => {
    const ep = makeEndpoint({ avgResponseMs: 500 });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ time: 500 })]);
    expect(anomalies.some(a => a.rule === 'slow-response')).toBe(false);
  });
});

describe('anomalies — large-response rule', () => {
  it('fires when response body > 500KB', () => {
    const ep = makeEndpoint({ responseSizes: [614400] });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ bodySize: 614400 })]);
    expect(anomalies.some(a => a.rule === 'large-response')).toBe(true);
  });

  it('does not fire when response body <= 500KB', () => {
    const ep = makeEndpoint({ responseSizes: [100] });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ bodySize: 100 })]);
    expect(anomalies.some(a => a.rule === 'large-response')).toBe(false);
  });
});

describe('anomalies — repeated-calls rule', () => {
  it('fires when callCount > 5', () => {
    const ep = makeEndpoint({ callCount: 8 });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({})]);
    expect(anomalies.some(a => a.rule === 'repeated-calls')).toBe(true);
  });

  it('does not fire when callCount <= 5', () => {
    const ep = makeEndpoint({ callCount: 3 });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({})]);
    expect(anomalies.some(a => a.rule === 'repeated-calls')).toBe(false);
  });
});
