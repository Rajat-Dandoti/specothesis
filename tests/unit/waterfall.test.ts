import { describe, it, expect } from 'vitest';
import { buildWaterfallEntries, generateWaterfall } from '../../src/report/waterfall.js';
import type { HarEntry } from '../../src/utils/harFilter.js';

function makeEntry(url: string, startedDateTime: string, time: number, method = 'GET', status = 200): HarEntry {
  return {
    startedDateTime,
    time,
    _resourceType: 'fetch',
    request: { method, url, headers: [], queryString: [], bodySize: 0, headersSize: 0 },
    response: { status, statusText: 'OK', headers: [], content: { size: 0, mimeType: 'application/json' }, bodySize: 0, headersSize: 0 },
  };
}

const BASE = '2026-07-01T10:00:00.000Z';
const PLUS = (ms: number) => new Date(new Date(BASE).getTime() + ms).toISOString();

describe('buildWaterfallEntries', () => {
  it('returns empty array for no entries', () => {
    expect(buildWaterfallEntries([])).toEqual([]);
  });

  it('first entry has startOffsetMs of 0', () => {
    const entries = [makeEntry('https://api.example.com/users', BASE, 120)];
    const rows = buildWaterfallEntries(entries);
    expect(rows[0].startOffsetMs).toBe(0);
    expect(rows[0].durationMs).toBe(120);
  });

  it('offsets are relative to earliest entry', () => {
    const entries = [
      makeEntry('https://api.example.com/a', PLUS(500), 50),
      makeEntry('https://api.example.com/b', BASE, 100),
    ];
    const rows = buildWaterfallEntries(entries);
    // b started first (BASE) → offset 0; a started 500ms later → offset 500
    const b = rows.find((r) => r.path === '/b')!;
    const a = rows.find((r) => r.path === '/a')!;
    expect(b.startOffsetMs).toBe(0);
    expect(a.startOffsetMs).toBe(500);
  });

  it('extracts pathname from full URL', () => {
    const entries = [makeEntry('https://api.example.com/api/users?page=1', BASE, 80)];
    const rows = buildWaterfallEntries(entries);
    expect(rows[0].path).toBe('/api/users');
  });

  it('minimum duration is 1ms', () => {
    const entries = [makeEntry('https://api.example.com/ping', BASE, 0)];
    const rows = buildWaterfallEntries(entries);
    expect(rows[0].durationMs).toBe(1);
  });
});

describe('generateWaterfall', () => {
  it('returns empty string for no entries', () => {
    expect(generateWaterfall([])).toBe('');
  });

  it('returns an SVG string', () => {
    const entries = [
      makeEntry('https://api.example.com/users', BASE, 100),
      makeEntry('https://api.example.com/products', PLUS(200), 80, 'POST'),
    ];
    const svg = generateWaterfall(entries);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('includes method and path labels', () => {
    const entries = [makeEntry('https://api.example.com/orders', BASE, 60, 'DELETE')];
    const svg = generateWaterfall(entries);
    expect(svg).toContain('DELETE');
    expect(svg).toContain('/orders');
  });

  it('includes timing axis', () => {
    const entries = [makeEntry('https://api.example.com/a', BASE, 500)];
    const svg = generateWaterfall(entries);
    expect(svg).toContain('0ms');
  });
});
