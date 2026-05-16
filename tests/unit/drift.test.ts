import { describe, it, expect } from 'vitest';
import { computeDrift } from '../../src/report/drift.js';
import type { CoverageSummary, EndpointCoverage } from '../../src/report/coverage.js';

function makeEndpoint(overrides: Partial<EndpointCoverage> & { method: string; path: string }): EndpointCoverage {
  return {
    statusCodes: [200],
    callCount: 1,
    hasAuth: true,
    avgResponseMs: 100,
    requestSizes: [],
    responseSizes: [],
    ...overrides,
  };
}

function makeSummary(name: string, endpoints: EndpointCoverage[]): CoverageSummary {
  return {
    sessionName: name,
    capturedAt: new Date().toISOString(),
    totalRequests: endpoints.reduce((s, e) => s + e.callCount, 0),
    uniqueEndpoints: endpoints.length,
    endpoints,
  };
}

describe('computeDrift', () => {
  it('reports endpoint in current but absent in baseline as added', () => {
    const baseline = makeSummary('run-1', []);
    const current = makeSummary('run-2', [makeEndpoint({ method: 'GET', path: '/api/users' })]);
    const report = computeDrift(baseline, current);
    expect(report.added).toHaveLength(1);
    expect(report.added[0].endpoint).toBe('GET /api/users');
    expect(report.added[0].type).toBe('added');
    expect(report.removed).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
    expect(report.hasChanges).toBe(true);
  });

  it('reports endpoint in baseline but absent in current as removed', () => {
    const baseline = makeSummary('run-1', [makeEndpoint({ method: 'DELETE', path: '/api/items' })]);
    const current = makeSummary('run-2', []);
    const report = computeDrift(baseline, current);
    expect(report.removed).toHaveLength(1);
    expect(report.removed[0].endpoint).toBe('DELETE /api/items');
    expect(report.removed[0].type).toBe('removed');
    expect(report.added).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
    expect(report.hasChanges).toBe(true);
  });

  it('reports changed status codes', () => {
    const ep = makeEndpoint({ method: 'GET', path: '/api/orders', statusCodes: [200] });
    const baseline = makeSummary('run-1', [ep]);
    const updated = makeEndpoint({ method: 'GET', path: '/api/orders', statusCodes: [200, 404] });
    const current = makeSummary('run-2', [updated]);
    const report = computeDrift(baseline, current);
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0].type).toBe('changed');
    expect(report.changed[0].detail).toContain('status codes');
    expect(report.hasChanges).toBe(true);
  });

  it('reports auth flip (authenticated → unauthenticated)', () => {
    const ep = makeEndpoint({ method: 'POST', path: '/api/login', hasAuth: true });
    const baseline = makeSummary('run-1', [ep]);
    const updated = makeEndpoint({ method: 'POST', path: '/api/login', hasAuth: false });
    const current = makeSummary('run-2', [updated]);
    const report = computeDrift(baseline, current);
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0].detail).toContain('auth');
    expect(report.hasChanges).toBe(true);
  });

  it('reports no changes when baseline and current are identical', () => {
    const ep = makeEndpoint({ method: 'GET', path: '/api/health', statusCodes: [200], hasAuth: false });
    const baseline = makeSummary('run-1', [ep]);
    const current = makeSummary('run-2', [makeEndpoint({ method: 'GET', path: '/api/health', statusCodes: [200], hasAuth: false })]);
    const report = computeDrift(baseline, current);
    expect(report.added).toHaveLength(0);
    expect(report.removed).toHaveLength(0);
    expect(report.changed).toHaveLength(0);
    expect(report.hasChanges).toBe(false);
  });

  it('puts all current endpoints in added when baseline is empty', () => {
    const baseline = makeSummary('run-1', []);
    const current = makeSummary('run-2', [
      makeEndpoint({ method: 'GET', path: '/api/a' }),
      makeEndpoint({ method: 'POST', path: '/api/b' }),
    ]);
    const report = computeDrift(baseline, current);
    expect(report.added).toHaveLength(2);
    expect(report.removed).toHaveLength(0);
    expect(report.hasChanges).toBe(true);
  });

  it('preserves baseSession and compareSession names in report', () => {
    const baseline = makeSummary('session-alpha', []);
    const current = makeSummary('session-beta', []);
    const report = computeDrift(baseline, current);
    expect(report.baseSession).toBe('session-alpha');
    expect(report.compareSession).toBe('session-beta');
  });
});
