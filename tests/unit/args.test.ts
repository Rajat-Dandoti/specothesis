import { describe, it, expect } from 'vitest';
import { parseArgs, resolveOnlyFlag, COMMAND_HELP } from '../../src/args.js';
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

describe('parseArgs', () => {
  it('defaults command to start when no positional given', () => {
    const { command, commandIsExplicit } = parseArgs(['--url', 'https://app.com']);
    expect(command).toBe('start');
    expect(commandIsExplicit).toBe(false);
  });

  it('sets commandIsExplicit when command is named explicitly', () => {
    const { command, commandIsExplicit } = parseArgs(['start', '--url', 'https://app.com']);
    expect(command).toBe('start');
    expect(commandIsExplicit).toBe(true);
  });

  it('parses replay command with --har flag', () => {
    const { command, flags } = parseArgs(['replay', '--har', 'path/to/file.har']);
    expect(command).toBe('replay');
    expect(flags['har']).toBe('path/to/file.har');
  });

  it('parses profile command with subcommand positional', () => {
    const { command, flags } = parseArgs(['profile', 'list']);
    expect(command).toBe('profile');
    expect(flags._[1]).toBe('list');
  });

  it('parses --quiet via -q alias', () => {
    const { flags } = parseArgs(['-q']);
    expect(flags.quiet).toBe(true);
  });

  it('parses --version via -v alias', () => {
    const { flags } = parseArgs(['-v']);
    expect(flags.version).toBe(true);
  });
});

describe('COMMAND_HELP', () => {
  it('has entries for all known commands', () => {
    for (const cmd of ['start', 'replay', 'login', 'list', 'profile']) {
      expect(COMMAND_HELP[cmd]).toBeDefined();
      expect(typeof COMMAND_HELP[cmd]).toBe('string');
      expect(COMMAND_HELP[cmd].length).toBeGreaterThan(0);
    }
  });

  it('start help mentions --url and --session', () => {
    expect(COMMAND_HELP['start']).toContain('--url');
    expect(COMMAND_HELP['start']).toContain('--session');
  });

  it('replay help mentions --har', () => {
    expect(COMMAND_HELP['replay']).toContain('--har');
  });

  it('login help mentions --save-profile', () => {
    expect(COMMAND_HELP['login']).toContain('--save-profile');
  });

  it('profile help mentions list, show, delete subcommands', () => {
    expect(COMMAND_HELP['profile']).toContain('list');
    expect(COMMAND_HELP['profile']).toContain('show');
    expect(COMMAND_HELP['profile']).toContain('delete');
  });
});

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
