import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { toCurl } from '../../src/transform/toCurl.js';
import type { HarEntry } from '../../src/utils/harFilter.js';

function makeEntry(overrides: {
  method?: string;
  url?: string;
  headers?: Array<{ name: string; value: string }>;
  postData?: HarEntry['request']['postData'];
}): HarEntry {
  return {
    startedDateTime: '2026-05-13T10:00:00.000Z',
    time: 100,
    _resourceType: 'fetch',
    request: {
      method: overrides.method ?? 'GET',
      url: overrides.url ?? 'https://api.example.com/api/v1/test',
      headers: overrides.headers ?? [],
      queryString: [],
      postData: overrides.postData,
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
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specothesis-curl-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

function getCombined(dir: string): string {
  return fs.readFileSync(path.join(dir, 'curls', 'requests.sh'), 'utf-8');
}

describe('toCurl — form-urlencoded', () => {
  it('emits one --data-urlencode flag per param', () => {
    const entry = makeEntry({
      method: 'POST',
      postData: {
        mimeType: 'application/x-www-form-urlencoded',
        params: [
          { name: 'name', value: 'Widget' },
          { name: 'qty', value: '3' },
        ],
      },
    });
    toCurl([entry], tmpDir);
    const output = getCombined(tmpDir);
    const matches = output.match(/--data-urlencode/g);
    expect(matches).toHaveLength(2);
    expect(output).toContain("--data-urlencode 'name=Widget'");
    expect(output).toContain("--data-urlencode 'qty=3'");
  });
});

describe('toCurl — JSON body', () => {
  it('emits --data-raw with the JSON body', () => {
    const entry = makeEntry({
      method: 'POST',
      postData: {
        mimeType: 'application/json',
        text: '{"key":"value"}',
      },
    });
    toCurl([entry], tmpDir);
    const output = getCombined(tmpDir);
    expect(output).toContain('--data-raw');
    expect(output).toContain('{"key":"value"}');
  });
});

describe('toCurl — Authorization header', () => {
  it('preserves Authorization header as $SCANNER_AUTH_TOKEN', () => {
    const entry = makeEntry({
      headers: [{ name: 'authorization', value: 'Bearer secret-token' }],
    });
    toCurl([entry], tmpDir);
    const output = getCombined(tmpDir);
    expect(output).toContain('Authorization: $SCANNER_AUTH_TOKEN');
    expect(output).not.toContain('secret-token');
  });
});

describe('toCurl — curl flags', () => {
  it('uses curl -sS not curl -s', () => {
    const entry = makeEntry({});
    toCurl([entry], tmpDir);
    const output = getCombined(tmpDir);
    expect(output).toContain('curl -sS');
    expect(output).not.toMatch(/curl -s[^S]/);
  });
});

describe('toCurl — custom headers', () => {
  it('preserves custom headers like X-Tenant-ID', () => {
    const entry = makeEntry({
      headers: [
        { name: 'X-Tenant-ID', value: 'acme' },
        { name: 'X-Request-ID', value: 'abc123' },
      ],
    });
    toCurl([entry], tmpDir);
    const output = getCombined(tmpDir);
    expect(output).toContain('X-Tenant-ID: acme');
    expect(output).toContain('X-Request-ID: abc123');
  });

  it('drops noisy browser headers like user-agent and origin', () => {
    const entry = makeEntry({
      headers: [
        { name: 'user-agent', value: 'Mozilla/5.0' },
        { name: 'origin', value: 'https://app.example.com' },
        { name: 'X-Custom', value: 'keep-me' },
      ],
    });
    toCurl([entry], tmpDir);
    const output = getCombined(tmpDir);
    expect(output).not.toContain('user-agent');
    expect(output).not.toContain('Mozilla');
    expect(output).not.toContain('origin');
    expect(output).toContain('X-Custom: keep-me');
  });
});

describe('toCurl — output files', () => {
  it('creates requests.sh with shebang', () => {
    toCurl([makeEntry({})], tmpDir);
    const output = getCombined(tmpDir);
    expect(output.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('creates one individual .sh file per entry', () => {
    toCurl([makeEntry({}), makeEntry({ url: 'https://api.example.com/api/v1/other' })], tmpDir);
    const files = fs.readdirSync(path.join(tmpDir, 'curls')).filter((f) => f !== 'requests.sh');
    expect(files).toHaveLength(2);
  });
});
