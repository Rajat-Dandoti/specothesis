import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildRequestBody, toStepci } from '../../src/transform/toStepci.js';
import type { HarEntry } from '../../src/utils/harFilter.js';

type PostData = HarEntry['request']['postData'];

describe('buildRequestBody', () => {
  it('returns empty object when postData is undefined', () => {
    expect(buildRequestBody(undefined)).toEqual({});
  });

  it('returns formData object for multipart/form-data params', () => {
    const postData: PostData = {
      mimeType: 'multipart/form-data',
      params: [
        { name: 'username', value: 'alice' },
        { name: 'file', value: '', fileName: 'photo.jpg' },
      ],
    };
    const result = buildRequestBody(postData, false);
    expect(result.formData).toBeDefined();
    expect(result.formData!.username).toBe('alice');
    expect(result.formData!.file).toEqual({ file: '<path/to/photo.jpg>' });
  });

  it('returns json object for application/json body', () => {
    const postData: PostData = {
      mimeType: 'application/json',
      text: JSON.stringify({ name: 'test', value: 42 }),
    };
    const result = buildRequestBody(postData, false);
    expect(result.json).toEqual({ name: 'test', value: 42 });
  });

  it('returns form object for application/x-www-form-urlencoded params', () => {
    const postData: PostData = {
      mimeType: 'application/x-www-form-urlencoded',
      params: [
        { name: 'foo', value: 'bar' },
        { name: 'baz', value: 'qux' },
      ],
    };
    const result = buildRequestBody(postData, false);
    expect(result.form).toEqual({ foo: 'bar', baz: 'qux' });
  });

  it('redacts sensitive key in multipart params when redact=true', () => {
    const postData: PostData = {
      mimeType: 'multipart/form-data',
      params: [
        { name: 'username', value: 'alice' },
        { name: 'password', value: 'hunter2' },
      ],
    };
    const result = buildRequestBody(postData, true);
    expect(result.formData!.password).toBe('[REDACTED]');
    expect(result.formData!.username).toBe('alice');
  });

  it('does NOT redact sensitive key when redact=false', () => {
    const postData: PostData = {
      mimeType: 'multipart/form-data',
      params: [{ name: 'password', value: 'hunter2' }],
    };
    const result = buildRequestBody(postData, false);
    expect(result.formData!.password).toBe('hunter2');
  });

  it('redacts sensitive key in JSON body when redact=true', () => {
    const postData: PostData = {
      mimeType: 'application/json',
      text: JSON.stringify({ username: 'alice', token: 'abc123' }),
    };
    const result = buildRequestBody(postData, true);
    const json = result.json as Record<string, unknown>;
    expect(json.token).toBe('[REDACTED]');
    expect(json.username).toBe('alice');
  });

  it('redacts sensitive key in form-urlencoded params when redact=true', () => {
    const postData: PostData = {
      mimeType: 'application/x-www-form-urlencoded',
      params: [
        { name: 'email', value: 'alice@example.com' },
        { name: 'secret', value: 'mysecret' },
      ],
    };
    const result = buildRequestBody(postData, true);
    expect(result.form!.secret).toBe('[REDACTED]');
    expect(result.form!.email).toBe('alice@example.com');
  });

  it('returns body for unknown content type with text', () => {
    const postData: PostData = {
      mimeType: 'text/plain',
      text: 'raw body content',
    };
    const result = buildRequestBody(postData);
    expect(result.body).toBe('raw body content');
  });
});

// ---------------------------------------------------------------------------
// Helper to make a minimal HarEntry for toStepci integration tests
// ---------------------------------------------------------------------------

function makeEntry(url: string, opts: { status?: number; responseText?: string; method?: string } = {}): HarEntry {
  return {
    startedDateTime: new Date().toISOString(),
    time: 50,
    _resourceType: 'fetch',
    request: {
      method: opts.method ?? 'GET',
      url,
      headers: [],
      queryString: [],
      bodySize: 0,
      headersSize: 0,
    },
    response: {
      status: opts.status ?? 200,
      statusText: opts.status && opts.status >= 400 ? 'Bad Request' : 'OK',
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

const DEFAULT_AUTH_CFG = {
  authBodyFormat: 'form' as const,
  authUsernameField: 'username',
  authPasswordField: 'password',
  authTokenPath: '$.access_token',
  authScheme: 'Bearer',
  authMethod: 'none' as const,
};

describe('toStepci — JSONPath checks', () => {
  it('generates isPresent checks for object response keys', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toStepci-'));
    const entry = makeEntry('https://api.example.com/users', {
      responseText: JSON.stringify({ id: 1, name: 'Alice' }),
    });
    toStepci([entry], 'test', tmpDir, undefined, DEFAULT_AUTH_CFG);
    const yaml = fs.readFileSync(path.join(tmpDir, 'stepci-workflow.yaml'), 'utf-8');
    expect(yaml).toContain('$.id');
    expect(yaml).toContain('isPresent');
  });

  it('skips JSONPath checks for 4xx responses', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toStepci-'));
    const entry = makeEntry('https://api.example.com/users', {
      status: 400,
      responseText: JSON.stringify({ error: 'Bad Request' }),
    });
    toStepci([entry], 'test', tmpDir, undefined, DEFAULT_AUTH_CFG);
    const yaml = fs.readFileSync(path.join(tmpDir, 'stepci-workflow.yaml'), 'utf-8');
    expect(yaml).not.toContain('$.error');
    expect(yaml).not.toContain('isPresent');
  });

  it('generates $.length check for array responses', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toStepci-'));
    const entry = makeEntry('https://api.example.com/users', {
      responseText: JSON.stringify([{ id: 1 }, { id: 2 }]),
    });
    toStepci([entry], 'test', tmpDir, undefined, DEFAULT_AUTH_CFG);
    const yaml = fs.readFileSync(path.join(tmpDir, 'stepci-workflow.yaml'), 'utf-8');
    expect(yaml).toContain('$.length');
  });
});

describe('toStepci — auth URL filter (M1)', () => {
  it('excludes auth endpoint from steps by full URL, not just pathname', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toStepci-'));
    const authUrl = 'https://auth.example.com/api/session';
    const entries = [
      makeEntry('https://auth.example.com/api/session', { method: 'POST' }), // login — should be excluded
      makeEntry('https://api.example.com/api/session'),                        // same path, different host — must stay
      makeEntry('https://api.example.com/users'),
    ];
    toStepci(entries, 'test', tmpDir, authUrl, { ...DEFAULT_AUTH_CFG, authMethod: 'bearer-login' as const });
    const yaml = fs.readFileSync(path.join(tmpDir, 'stepci-workflow.yaml'), 'utf-8');
    // The main API /api/session must appear (different host — url becomes ${{env.API_HOST}}/api/session)
    expect(yaml).toContain('/api/session');
    // Should have Authenticate step + 2 captured steps (not 3)
    const stepMatches = yaml.match(/- name:/g);
    expect(stepMatches?.length).toBe(3); // Authenticate + api/session + users
  });
});

describe('toStepci — API_HOST derivation (M2)', () => {
  it('uses most-frequent origin, not first entry origin', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toStepci-'));
    const entries = [
      makeEntry('https://analytics.example.com/track'),    // first entry — minority host
      makeEntry('https://api.example.com/users'),
      makeEntry('https://api.example.com/products'),
      makeEntry('https://api.example.com/orders'),
    ];
    toStepci(entries, 'test', tmpDir, undefined, DEFAULT_AUTH_CFG);
    const yaml = fs.readFileSync(path.join(tmpDir, 'stepci-workflow.yaml'), 'utf-8');
    expect(yaml).toContain('API_HOST: https://api.example.com');
  });
});
