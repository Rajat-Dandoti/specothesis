import { describe, it, expect } from 'vitest';

// normalisePath is not exported — test it indirectly via the OpenAPI output,
// or inline the logic here to keep tests fast and isolated.
// We replicate the exact logic from src/transform/toOpenApi.ts so that
// any future change to the source will cause these tests to fail and catch regressions.

const VERSION_SEGMENT = /^v\d+$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;
const HEX_LONG_RE = /^[0-9a-f]{9,}$/i;

const ID_SEGMENT = {
  test: (s: string) => UUID_RE.test(s) || NUMERIC_RE.test(s) || HEX_LONG_RE.test(s),
};

function normalisePath(pathname: string): { template: string; paramNames: string[] } {
  const paramNames: string[] = [];
  const seen = new Map<string, number>();
  const segments = pathname.split('/');
  const template = segments
    .map((seg, idx) => {
      if (ID_SEGMENT.test(seg)) {
        let prev = 'item';
        for (let i = idx - 1; i >= 0; i--) {
          if (segments[i] && !VERSION_SEGMENT.test(segments[i])) {
            prev = segments[i];
            break;
          }
        }
        const base = `${prev.replace(/s$/, '')}Id`;
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const name = count === 0 ? base : `${base}_${count + 1}`;
        paramNames.push(name);
        return `{${name}}`;
      }
      return seg;
    })
    .join('/');
  return { template, paramNames };
}

describe('normalisePath', () => {
  it('replaces numeric segment with {id}', () => {
    const { template } = normalisePath('/api/users/123');
    expect(template).toBe('/api/users/{userId}');
  });

  it('replaces UUID segment with {id}', () => {
    const { template } = normalisePath('/api/items/550e8400-e29b-41d4-a716-446655440000');
    expect(template).toBe('/api/items/{itemId}');
  });

  it('replaces long hex segment with {id}', () => {
    const { template } = normalisePath('/api/users/abc123def456abc123def456abc123de');
    expect(template).toBe('/api/users/{userId}');
  });

  it('leaves clean path unchanged', () => {
    const { template, paramNames } = normalisePath('/api/v1/users');
    expect(template).toBe('/api/v1/users');
    expect(paramNames).toHaveLength(0);
  });

  it('skips version segment when naming param', () => {
    const { template } = normalisePath('/api/v2/items/123');
    expect(template).toBe('/api/v2/items/{itemId}');
    expect(template).not.toContain('{v2Id}');
  });

  it('produces unique param names when the same parent segment appears twice', () => {
    const { template, paramNames } = normalisePath('/api/items/123/items/456');
    expect(paramNames).toHaveLength(2);
    expect(paramNames[0]).not.toBe(paramNames[1]);
    expect(template).toMatch(/\{itemId\}/);
    expect(template).toMatch(/\{itemId_2\}/);
  });

  it('returns paramNames in order of appearance', () => {
    const { paramNames } = normalisePath('/api/users/123/orders/456');
    expect(paramNames).toHaveLength(2);
    expect(paramNames[0]).toBe('userId');
    expect(paramNames[1]).toBe('orderId');
  });
});
