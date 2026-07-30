import { describe, it, expect } from 'vitest';
import { buildAuthAudit } from '../../src/report/authAudit.js';
import type { HarEntry } from '../../src/utils/harFilter.js';

function makeEntry(
  url: string,
  opts: { auth?: string; time?: number; method?: string; status?: number } = {}
): HarEntry {
  const headers: Array<{ name: string; value: string }> = [];
  if (opts.auth) headers.push({ name: 'authorization', value: opts.auth });
  return {
    startedDateTime: new Date(opts.time ?? Date.now()).toISOString(),
    time: 50,
    _resourceType: 'fetch',
    request: { method: opts.method ?? 'GET', url, headers, queryString: [], bodySize: 0, headersSize: 0 },
    response: {
      status: opts.status ?? 200,
      statusText: 'OK',
      headers: [],
      content: { size: 0, mimeType: 'application/json' },
      bodySize: 0,
      headersSize: 0,
    },
  };
}

const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('buildAuthAudit — basic counts', () => {
  it('counts auth vs no-auth calls correctly', () => {
    const entries = [
      makeEntry('https://api.example.com/users', { auth: TOKEN }),
      makeEntry('https://api.example.com/public'),
      makeEntry('https://api.example.com/products', { auth: TOKEN }),
    ];
    const result = buildAuthAudit(entries);
    expect(result.withAuth).toBe(2);
    expect(result.withoutAuth).toBe(1);
  });

  it('lists public endpoints (no auth)', () => {
    const entries = [
      makeEntry('https://api.example.com/health'),
      makeEntry('https://api.example.com/users', { auth: TOKEN }),
    ];
    const result = buildAuthAudit(entries);
    expect(result.publicEndpoints).toContain('GET /health');
  });

  it('deduplicates public endpoints across multiple calls', () => {
    const entries = [
      makeEntry('https://api.example.com/health'),
      makeEntry('https://api.example.com/health'),
    ];
    const result = buildAuthAudit(entries);
    expect(result.publicEndpoints.filter((e) => e === 'GET /health')).toHaveLength(1);
  });
});

describe('buildAuthAudit — token in URL', () => {
  it('flags JWT value in query param', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const entries = [makeEntry(`https://api.example.com/export?token=${jwt}`)];
    const result = buildAuthAudit(entries);
    expect(result.tokenInUrl.length).toBeGreaterThan(0);
    expect(result.tokenInUrl[0].param).toBe('token');
  });

  it('does not flag short query param values', () => {
    const entries = [makeEntry('https://api.example.com/search?q=hello&page=1')];
    const result = buildAuthAudit(entries);
    expect(result.tokenInUrl).toHaveLength(0);
  });
});

describe('buildAuthAudit — post-logout reuse', () => {
  it('detects token use after logout call', () => {
    const now = Date.now();
    const entries = [
      makeEntry('https://api.example.com/users', { auth: TOKEN, time: now }),
      makeEntry('https://api.example.com/auth/logout', { time: now + 1000, method: 'POST' }),
      makeEntry('https://api.example.com/me', { auth: TOKEN, time: now + 2000 }),
    ];
    const result = buildAuthAudit(entries);
    expect(result.postLogoutReuse).toBe(true);
    expect(result.logoutUrl).toContain('/logout');
  });

  it('does not flag token use before logout', () => {
    const now = Date.now();
    const entries = [
      makeEntry('https://api.example.com/users', { auth: TOKEN, time: now }),
      makeEntry('https://api.example.com/auth/logout', { time: now + 1000, method: 'POST' }),
    ];
    const result = buildAuthAudit(entries);
    expect(result.postLogoutReuse).toBe(false);
  });

  it('returns postLogoutReuse false when no logout endpoint', () => {
    const entries = [
      makeEntry('https://api.example.com/users', { auth: TOKEN }),
      makeEntry('https://api.example.com/products', { auth: TOKEN }),
    ];
    const result = buildAuthAudit(entries);
    expect(result.postLogoutReuse).toBe(false);
    expect(result.logoutUrl).toBeUndefined();
  });
});
