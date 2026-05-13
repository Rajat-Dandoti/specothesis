import { describe, it, expect } from 'vitest';
import { buildCoverageSummary } from '../../src/report/coverage.js';
import type { HarEntry } from '../../src/utils/harFilter.js';

function makeEntry(overrides: {
  url?: string;
  method?: string;
  status?: number;
  hasAuth?: boolean;
  time?: number;
  bodySize?: number;
}): HarEntry {
  return {
    startedDateTime: '2026-05-13T10:00:00.000Z',
    time: overrides.time ?? 100,
    _resourceType: 'fetch',
    request: {
      method: overrides.method ?? 'GET',
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

describe('buildCoverageSummary', () => {
  it('groups entries by method + normalised path', () => {
    const entries = [
      makeEntry({ url: 'https://api.example.com/api/v1/users/123' }),
      makeEntry({ url: 'https://api.example.com/api/v1/users/456' }),
    ];
    const summary = buildCoverageSummary(entries, 'test');
    expect(summary.uniqueEndpoints).toBe(1);
    expect(summary.endpoints[0].path).toBe('/api/v1/users/{id}');
  });

  it('counts total requests correctly', () => {
    const entries = [
      makeEntry({ url: 'https://api.example.com/api/v1/users' }),
      makeEntry({ url: 'https://api.example.com/api/v1/items' }),
      makeEntry({ url: 'https://api.example.com/api/v1/items' }),
    ];
    const summary = buildCoverageSummary(entries, 'test');
    expect(summary.totalRequests).toBe(3);
  });

  it('sets hasAuth true when at least one request has auth header', () => {
    const entries = [
      makeEntry({ hasAuth: false }),
      makeEntry({ hasAuth: true }),
    ];
    const summary = buildCoverageSummary(entries, 'test');
    expect(summary.endpoints[0].hasAuth).toBe(true);
  });

  it('sets hasAuth false when no requests have auth header', () => {
    const entries = [
      makeEntry({ hasAuth: false }),
      makeEntry({ hasAuth: false }),
    ];
    const summary = buildCoverageSummary(entries, 'test');
    expect(summary.endpoints[0].hasAuth).toBe(false);
  });

  it('aggregates status codes', () => {
    const entries = [
      makeEntry({ status: 200 }),
      makeEntry({ status: 404 }),
      makeEntry({ status: 200 }),
    ];
    const summary = buildCoverageSummary(entries, 'test');
    expect(summary.endpoints[0].statusCodes).toContain(200);
    expect(summary.endpoints[0].statusCodes).toContain(404);
  });

  it('separates different methods as distinct endpoints', () => {
    const entries = [
      makeEntry({ method: 'GET', url: 'https://api.example.com/api/v1/items' }),
      makeEntry({ method: 'POST', url: 'https://api.example.com/api/v1/items' }),
    ];
    const summary = buildCoverageSummary(entries, 'test');
    expect(summary.uniqueEndpoints).toBe(2);
  });
});
