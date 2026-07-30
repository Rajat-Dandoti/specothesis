import { describe, it, expect } from 'vitest';
import { buildCausalGraph } from '../../src/report/causalGraph.js';
import type { HarEntry } from '../../src/utils/harFilter.js';

const T0 = new Date('2026-07-01T10:00:00.000Z').getTime();

function makeEntry(opts: {
  url: string;
  method?: string;
  status?: number;
  responseText?: string;
  bodyText?: string;
  t?: number;
}): HarEntry {
  return {
    startedDateTime: new Date(T0 + (opts.t ?? 0)).toISOString(),
    time: 50,
    _resourceType: 'fetch',
    request: {
      method: opts.method ?? 'GET',
      url: opts.url,
      headers: [],
      queryString: [],
      bodySize: 0,
      headersSize: 0,
      ...(opts.bodyText
        ? { postData: { mimeType: 'application/json', text: opts.bodyText } }
        : {}),
    },
    response: {
      status: opts.status ?? 200,
      statusText: 'OK',
      headers: [],
      content: {
        size: opts.responseText?.length ?? 0,
        mimeType: 'application/json',
        text: opts.responseText,
      },
      bodySize: opts.responseText?.length ?? 0,
      headersSize: 0,
    },
  };
}

describe('buildCausalGraph — basic', () => {
  it('returns empty graph for empty entries', () => {
    const g = buildCausalGraph([]);
    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });

  it('returns no edges when no ID values flow forward', () => {
    const entries = [
      makeEntry({ url: 'https://api.example.com/users', responseText: '{"name":"Alice"}', t: 0 }),
      makeEntry({ url: 'https://api.example.com/products', t: 100 }),
    ];
    const g = buildCausalGraph(entries);
    expect(g.edges).toHaveLength(0);
  });
});

describe('buildCausalGraph — path dependency', () => {
  it('links GET /me → GET /users/42 when response contains id:42', () => {
    const entries = [
      makeEntry({ url: 'https://api.example.com/me', responseText: '{"id":42,"name":"Alice"}', t: 0 }),
      makeEntry({ url: 'https://api.example.com/users/42', t: 100 }),
    ];
    const g = buildCausalGraph(entries);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].targetLocation).toBe('path');
    expect(g.edges[0].value).toBe('42');
    expect(g.edges[0].sourceField).toBe('$.id');
  });

  it('links via UUID in path', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const entries = [
      makeEntry({ url: 'https://api.example.com/me', responseText: `{"userId":"${uuid}"}`, t: 0 }),
      makeEntry({ url: `https://api.example.com/users/${uuid}/profile`, t: 100 }),
    ];
    const g = buildCausalGraph(entries);
    expect(g.edges.some((e) => e.value === uuid && e.targetLocation === 'path')).toBe(true);
  });
});

describe('buildCausalGraph — query dependency', () => {
  it('links when ID appears in query param', () => {
    const entries = [
      makeEntry({ url: 'https://api.example.com/cart', responseText: '{"cartId":999}', t: 0 }),
      makeEntry({ url: 'https://api.example.com/checkout?cartId=999', t: 100 }),
    ];
    const g = buildCausalGraph(entries);
    expect(g.edges.some((e) => e.value === '999' && e.targetLocation === 'query')).toBe(true);
  });
});

describe('buildCausalGraph — body dependency', () => {
  it('links when ID appears in request body', () => {
    const entries = [
      makeEntry({ url: 'https://api.example.com/products', responseText: '{"productId":12345}', t: 0 }),
      makeEntry({
        url: 'https://api.example.com/cart',
        method: 'POST',
        bodyText: '{"productId":12345,"qty":1}',
        t: 100,
      }),
    ];
    const g = buildCausalGraph(entries);
    expect(g.edges.some((e) => e.value === '12345' && e.targetLocation === 'body')).toBe(true);
  });
});

describe('buildCausalGraph — edge cases', () => {
  it('ignores values from error responses (4xx)', () => {
    const entries = [
      makeEntry({ url: 'https://api.example.com/me', status: 404, responseText: '{"id":42}', t: 0 }),
      makeEntry({ url: 'https://api.example.com/users/42', t: 100 }),
    ];
    const g = buildCausalGraph(entries);
    expect(g.edges).toHaveLength(0);
  });

  it('does not link backwards in time', () => {
    // Even if t=100 entry response has id:42, it should NOT link to t=0 entry
    const entries = [
      makeEntry({ url: 'https://api.example.com/users/42', t: 0 }),
      makeEntry({ url: 'https://api.example.com/me', responseText: '{"id":42}', t: 100 }),
    ];
    const g = buildCausalGraph(entries);
    // Edge can only go from index 0→1 (sorted by time), me is index 1 — no forward target
    expect(g.edges).toHaveLength(0);
  });

  it('does not flag small numbers (< 100) as ID values', () => {
    const entries = [
      makeEntry({ url: 'https://api.example.com/status', responseText: '{"count":5,"status":200}', t: 0 }),
      makeEntry({ url: 'https://api.example.com/items/5', t: 100 }),
    ];
    const g = buildCausalGraph(entries);
    expect(g.edges).toHaveLength(0);
  });

  it('deduplicates edges for same from→to pair', () => {
    // Response has two fields with the same value — should produce at most one edge per (from, to)
    const entries = [
      makeEntry({
        url: 'https://api.example.com/me',
        responseText: '{"id":42000,"altId":42000}',
        t: 0,
      }),
      makeEntry({ url: 'https://api.example.com/users/42000', t: 100 }),
    ];
    const g = buildCausalGraph(entries);
    const pair = g.edges.filter((e) => e.from === 0 && e.to === 1);
    expect(pair.length).toBe(1);
  });

  it('nodes are sorted by startedDateTime', () => {
    const entries = [
      makeEntry({ url: 'https://api.example.com/b', t: 200 }),
      makeEntry({ url: 'https://api.example.com/a', t: 0 }),
    ];
    const g = buildCausalGraph(entries);
    expect(g.nodes[0].path).toBe('/a');
    expect(g.nodes[1].path).toBe('/b');
  });
});
