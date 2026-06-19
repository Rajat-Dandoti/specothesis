import { describe, it, expect } from 'vitest';
import {
  filterApiEntries,
  filterByWindows,
  deduplicateEntries,
} from '../../src/utils/harFilter.js';
import type { Har, HarEntry } from '../../src/utils/harFilter.js';

function makeEntry(overrides: Partial<HarEntry> & { url: string; method?: string }): HarEntry {
  return {
    startedDateTime: '2026-05-13T10:00:00.000Z',
    time: 100,
    _resourceType: 'fetch',
    request: {
      method: overrides.method ?? 'GET',
      url: overrides.url,
      headers: [],
      queryString: [],
      bodySize: 0,
      headersSize: 0,
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [],
      content: { size: 0, mimeType: 'application/json' },
      bodySize: 0,
      headersSize: 0,
    },
    ...overrides,
  };
}

function makeHar(entries: HarEntry[]): Har {
  return { log: { version: '1.2', creator: { name: 'test', version: '1' }, entries } };
}

describe('filterApiEntries', () => {
  it('keeps entries matching the url filter', () => {
    const har = makeHar([
      makeEntry({ url: 'https://api.example.com/api/users' }),
      makeEntry({ url: 'https://api.example.com/static/app.js' }),
    ]);
    const result = filterApiEntries(har, '**/api/**');
    expect(result).toHaveLength(1);
    expect(result[0].request.url).toBe('https://api.example.com/api/users');
  });

  it('excludes non-xhr/fetch resource types', () => {
    const har = makeHar([
      makeEntry({ url: 'https://api.example.com/api/users', _resourceType: 'document' }),
      makeEntry({ url: 'https://api.example.com/api/users', _resourceType: 'fetch' }),
    ]);
    const result = filterApiEntries(har, '**/api/**');
    expect(result).toHaveLength(1);
    expect(result[0]._resourceType).toBe('fetch');
  });

  it('excludes entries with no resourceType by default', () => {
    const entry = makeEntry({ url: 'https://api.example.com/api/users' });
    delete entry._resourceType;
    const har = makeHar([entry]);
    const result = filterApiEntries(har, '**/api/**');
    expect(result).toHaveLength(0);
  });

  it('keeps entries with no resourceType when captureAllResourceTypes=true', () => {
    const entry = makeEntry({ url: 'https://api.example.com/api/users' });
    delete entry._resourceType;
    const har = makeHar([entry]);
    const result = filterApiEntries(har, '**/api/**', { captureAllResourceTypes: true });
    expect(result).toHaveLength(1);
  });
});

describe('filterByWindows', () => {
  it('returns all entries when no windows provided', () => {
    const entries = [
      makeEntry({
        url: 'https://api.example.com/api/a',
        startedDateTime: '2026-05-13T10:00:00.000Z',
      }),
      makeEntry({
        url: 'https://api.example.com/api/b',
        startedDateTime: '2026-05-13T10:01:00.000Z',
      }),
    ];
    expect(filterByWindows(entries, [])).toHaveLength(2);
  });

  it('excludes entries outside recording windows', () => {
    const entries = [
      makeEntry({
        url: 'https://api.example.com/api/a',
        startedDateTime: '2026-05-13T10:00:00.000Z',
      }),
      makeEntry({
        url: 'https://api.example.com/api/b',
        startedDateTime: '2026-05-13T10:05:00.000Z',
      }),
    ];
    const windows = [{ start: '2026-05-13T10:00:00.000Z', end: '2026-05-13T10:02:00.000Z' }];
    const result = filterByWindows(entries, windows);
    expect(result).toHaveLength(1);
    expect(result[0].request.url).toContain('/api/a');
  });
});

describe('deduplicateEntries', () => {
  it('removes exact duplicate requests', () => {
    const entries = [
      makeEntry({ url: 'https://api.example.com/api/users', method: 'GET' }),
      makeEntry({ url: 'https://api.example.com/api/users', method: 'GET' }),
    ];
    expect(deduplicateEntries(entries)).toHaveLength(1);
  });

  it('keeps different methods as distinct entries', () => {
    const entries = [
      makeEntry({ url: 'https://api.example.com/api/users', method: 'GET' }),
      makeEntry({ url: 'https://api.example.com/api/users', method: 'POST' }),
    ];
    expect(deduplicateEntries(entries)).toHaveLength(2);
  });
});

describe('filterApiEntries — failed requests (status=-1)', () => {
  it('excludes entry with status=-1 when captureFailedRequests=false', () => {
    const entry = makeEntry({ url: 'https://api.example.com/api/users' });
    entry.response.status = -1;
    const har = makeHar([entry]);
    const result = filterApiEntries(har, '**/api/**', { captureFailedRequests: false });
    expect(result).toHaveLength(0);
  });

  it('includes entry with status=-1 when captureFailedRequests=true', () => {
    const entry = makeEntry({ url: 'https://api.example.com/api/users' });
    entry.response.status = -1;
    const har = makeHar([entry]);
    const result = filterApiEntries(har, '**/api/**', { captureFailedRequests: true });
    expect(result).toHaveLength(1);
  });
});
