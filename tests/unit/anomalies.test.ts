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

function makeEntry(overrides: {
  url?: string;
  status?: number;
  bodySize?: number;
  hasAuth?: boolean;
  time?: number;
}): HarEntry {
  return {
    startedDateTime: '2026-05-13T10:00:00.000Z',
    time: overrides.time ?? 100,
    _resourceType: 'fetch',
    request: {
      method: 'GET',
      url: overrides.url ?? 'https://api.example.com/api/v1/items',
      headers:
        overrides.hasAuth !== false ? [{ name: 'authorization', value: 'Bearer token' }] : [],
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
    expect(anomalies.some((a) => a.rule === 'client-error')).toBe(true);
  });

  it('does not fire for 200', () => {
    const ep = makeEndpoint({ statusCodes: [200] });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ status: 200 })]);
    expect(anomalies.some((a) => a.rule === 'client-error')).toBe(false);
  });
});

describe('anomalies — server-error rule', () => {
  it('fires for 5xx status codes', () => {
    const ep = makeEndpoint({ statusCodes: [500] });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ status: 500 })]);
    expect(anomalies.some((a) => a.rule === 'server-error')).toBe(true);
  });
});

describe('anomalies — missing-auth rule', () => {
  it('fires when endpoint has no auth', () => {
    const ep = makeEndpoint({ hasAuth: false, path: '/api/v1/items' });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ hasAuth: false })]);
    expect(anomalies.some((a) => a.rule === 'missing-auth')).toBe(true);
  });

  it('does not fire for paths matching PUBLIC_KEYWORDS', () => {
    const ep = makeEndpoint({ hasAuth: false, path: '/api/v1/login' });
    const entry = makeEntry({ url: 'https://api.example.com/api/v1/login', hasAuth: false });
    const anomalies = detectAnomalies(makeSummary([ep]), [entry]);
    expect(anomalies.some((a) => a.rule === 'missing-auth')).toBe(false);
  });

  it('does not fire when endpoint has auth', () => {
    const ep = makeEndpoint({ hasAuth: true });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ hasAuth: true })]);
    expect(anomalies.some((a) => a.rule === 'missing-auth')).toBe(false);
  });
});

describe('anomalies — slow-response rule', () => {
  it('fires when avgResponseMs > 2000', () => {
    const ep = makeEndpoint({ avgResponseMs: 3200 });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ time: 3200 })]);
    expect(anomalies.some((a) => a.rule === 'slow-response')).toBe(true);
  });

  it('does not fire when avgResponseMs <= 2000', () => {
    const ep = makeEndpoint({ avgResponseMs: 500 });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ time: 500 })]);
    expect(anomalies.some((a) => a.rule === 'slow-response')).toBe(false);
  });
});

describe('anomalies — large-response rule', () => {
  it('fires when response body > 500KB', () => {
    const ep = makeEndpoint({ responseSizes: [614400] });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ bodySize: 614400 })]);
    expect(anomalies.some((a) => a.rule === 'large-response')).toBe(true);
  });

  it('does not fire when response body <= 500KB', () => {
    const ep = makeEndpoint({ responseSizes: [100] });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({ bodySize: 100 })]);
    expect(anomalies.some((a) => a.rule === 'large-response')).toBe(false);
  });

  it('fires when bodySize is -1 (gzip) but content.size exceeds limit', () => {
    const ep = makeEndpoint({ responseSizes: [614400] });
    // HAR records bodySize=-1 for gzip; content.size has the decompressed size
    const entry = makeEntry({ bodySize: 614400 });
    entry.response.bodySize = -1;
    entry.response.content.size = 614400;
    const anomalies = detectAnomalies(makeSummary([ep]), [entry]);
    expect(anomalies.some((a) => a.rule === 'large-response')).toBe(true);
  });
});

describe('anomalies — repeated-calls rule', () => {
  it('fires when callCount > 5', () => {
    const ep = makeEndpoint({ callCount: 8 });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({})]);
    expect(anomalies.some((a) => a.rule === 'repeated-calls')).toBe(true);
  });

  it('does not fire when callCount <= 5', () => {
    const ep = makeEndpoint({ callCount: 3 });
    const anomalies = detectAnomalies(makeSummary([ep]), [makeEntry({})]);
    expect(anomalies.some((a) => a.rule === 'repeated-calls')).toBe(false);
  });
});

describe('anomalies — no-cache-headers rule', () => {
  function makeEntryWithResponseHeaders(
    url: string,
    responseHeaders: Array<{ name: string; value: string }>
  ): HarEntry {
    const e = makeEntry({ url });
    e.response.headers = responseHeaders;
    return e;
  }

  it('fires for GET called 2+ times with no Cache-Control or ETag', () => {
    const ep = makeEndpoint({ method: 'GET', callCount: 2 });
    const entry = makeEntryWithResponseHeaders('https://api.example.com/api/v1/items', []);
    const anomalies = detectAnomalies(makeSummary([ep]), [entry, entry]);
    expect(anomalies.some((a) => a.rule === 'no-cache-headers')).toBe(true);
  });

  it('does not fire when Cache-Control is present', () => {
    const ep = makeEndpoint({ method: 'GET', callCount: 2 });
    const entry = makeEntryWithResponseHeaders('https://api.example.com/api/v1/items', [
      { name: 'cache-control', value: 'max-age=3600' },
    ]);
    const anomalies = detectAnomalies(makeSummary([ep]), [entry, entry]);
    expect(anomalies.some((a) => a.rule === 'no-cache-headers')).toBe(false);
  });

  it('does not fire for POST endpoints', () => {
    const ep = makeEndpoint({ method: 'POST', callCount: 3 });
    const entry = makeEntry({ url: 'https://api.example.com/api/v1/items' });
    entry.request.method = 'POST';
    const anomalies = detectAnomalies(makeSummary([ep]), [entry, entry, entry]);
    expect(anomalies.some((a) => a.rule === 'no-cache-headers')).toBe(false);
  });

  it('does not fire for GET called only once', () => {
    const ep = makeEndpoint({ method: 'GET', callCount: 1 });
    const entry = makeEntryWithResponseHeaders('https://api.example.com/api/v1/items', []);
    const anomalies = detectAnomalies(makeSummary([ep]), [entry]);
    expect(anomalies.some((a) => a.rule === 'no-cache-headers')).toBe(false);
  });
});

describe('anomalies — etag-unused rule', () => {
  it('fires when server sends ETag but client never sends If-None-Match', () => {
    const ep = makeEndpoint({ method: 'GET', callCount: 2 });
    const entry1 = makeEntry({});
    entry1.response.headers = [{ name: 'etag', value: '"abc123"' }];
    const entry2 = makeEntry({});
    entry2.response.headers = [{ name: 'etag', value: '"abc123"' }];
    const anomalies = detectAnomalies(makeSummary([ep]), [entry1, entry2]);
    expect(anomalies.some((a) => a.rule === 'etag-unused')).toBe(true);
  });

  it('does not fire when no ETag in responses', () => {
    const ep = makeEndpoint({ method: 'GET', callCount: 2 });
    const entry = makeEntry({});
    const anomalies = detectAnomalies(makeSummary([ep]), [entry, entry]);
    expect(anomalies.some((a) => a.rule === 'etag-unused')).toBe(false);
  });

  it('does not fire when client sends If-None-Match', () => {
    const ep = makeEndpoint({ method: 'GET', callCount: 2 });
    const entry1 = makeEntry({});
    entry1.response.headers = [{ name: 'etag', value: '"abc123"' }];
    const entry2 = makeEntry({});
    entry2.request.headers = [{ name: 'if-none-match', value: '"abc123"' }];
    const anomalies = detectAnomalies(makeSummary([ep]), [entry1, entry2]);
    expect(anomalies.some((a) => a.rule === 'etag-unused')).toBe(false);
  });
});

describe('anomalies — missing-auth + SCANNER_PUBLIC_PATTERNS', () => {
  it('suppresses missing-auth when path matches a custom public pattern', () => {
    // "/api/v1/metrics" contains "metrics" — pass it as publicPatterns
    const ep = makeEndpoint({ hasAuth: false, path: '/api/v1/metrics' });
    const entry = makeEntry({ url: 'https://api.example.com/api/v1/metrics', hasAuth: false });
    const anomalies = detectAnomalies(makeSummary([ep]), [entry], {
      publicPatterns: ['metrics'],
    });
    expect(anomalies.some((a) => a.rule === 'missing-auth')).toBe(false);
  });

  it('still fires missing-auth when path does NOT match the custom public pattern', () => {
    const ep = makeEndpoint({ hasAuth: false, path: '/api/v1/orders' });
    const entry = makeEntry({ url: 'https://api.example.com/api/v1/orders', hasAuth: false });
    const anomalies = detectAnomalies(makeSummary([ep]), [entry], {
      publicPatterns: ['metrics'],
    });
    expect(anomalies.some((a) => a.rule === 'missing-auth')).toBe(true);
  });
});
