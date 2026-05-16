import { describe, it, expect } from 'vitest';
import { resolveOnlyFlag } from '../../src/args.js';
import type { ScannerFeatures } from '../../src/config.js';

const BASE_FEATURES: ScannerFeatures = {
  dedup: true,
  examples: true,
  openapi: true,
  stepci: true,
  curl: true,
  coverage: true,
  anomalies: true,
  drift: true,
  htmlReport: true,
};

describe('resolveOnlyFlag', () => {
  it('"openapi" → only openapi: true, all others false', () => {
    const f = resolveOnlyFlag('openapi', BASE_FEATURES);
    expect(f.openapi).toBe(true);
    expect(f.stepci).toBe(false);
    expect(f.curl).toBe(false);
    expect(f.coverage).toBe(false);
    expect(f.anomalies).toBe(false);
    expect(f.drift).toBe(false);
    expect(f.htmlReport).toBe(false);
  });

  it('"openapi,stepci" → both openapi and stepci true', () => {
    const f = resolveOnlyFlag('openapi,stepci', BASE_FEATURES);
    expect(f.openapi).toBe(true);
    expect(f.stepci).toBe(true);
    expect(f.curl).toBe(false);
    expect(f.coverage).toBe(false);
  });

  it('"anomalies" → anomalies true + coverage implied', () => {
    const f = resolveOnlyFlag('anomalies', BASE_FEATURES);
    expect(f.anomalies).toBe(true);
    expect(f.coverage).toBe(true);
    expect(f.drift).toBe(false);
    expect(f.htmlReport).toBe(false);
  });

  it('"drift" → drift true + coverage implied', () => {
    const f = resolveOnlyFlag('drift', BASE_FEATURES);
    expect(f.drift).toBe(true);
    expect(f.coverage).toBe(true);
    expect(f.anomalies).toBe(false);
    expect(f.htmlReport).toBe(false);
  });

  it('"html" → htmlReport + coverage + anomalies + drift all true', () => {
    const f = resolveOnlyFlag('html', BASE_FEATURES);
    expect(f.htmlReport).toBe(true);
    expect(f.coverage).toBe(true);
    expect(f.anomalies).toBe(true);
    expect(f.drift).toBe(true);
  });

  it('preserves non-output flags (dedup, examples) from baseFeatures', () => {
    const base: ScannerFeatures = { ...BASE_FEATURES, dedup: false, examples: false };
    const f = resolveOnlyFlag('openapi', base);
    expect(f.dedup).toBe(false);
    expect(f.examples).toBe(false);
  });

  it('throws with list of valid values for an unknown value', () => {
    expect(() => resolveOnlyFlag('unknown-output', BASE_FEATURES)).toThrow(/valid values/i);
  });

  it('throws mentioning the invalid value name', () => {
    expect(() => resolveOnlyFlag('badvalue', BASE_FEATURES)).toThrow('badvalue');
  });

  it('handles whitespace around comma-separated values', () => {
    const f = resolveOnlyFlag(' openapi , stepci ', BASE_FEATURES);
    expect(f.openapi).toBe(true);
    expect(f.stepci).toBe(true);
  });
});
