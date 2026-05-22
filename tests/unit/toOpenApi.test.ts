import { describe, it, expect } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { normalisePath, inferSchema, toOpenApi } from '../../src/transform/toOpenApi.js';
import type { HarEntry } from '../../src/utils/harFilter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toOpenApi-test-'));
}

function makeEntry(overrides: {
  url: string;
  method?: string;
  status?: number;
  postData?: HarEntry['request']['postData'];
  responseText?: string;
}): HarEntry {
  return {
    startedDateTime: '2026-05-13T10:00:00.000Z',
    time: 50,
    _resourceType: 'fetch',
    request: {
      method: overrides.method ?? 'GET',
      url: overrides.url,
      headers: [],
      queryString: [],
      bodySize: 0,
      headersSize: 0,
      postData: overrides.postData,
    },
    response: {
      status: overrides.status ?? 200,
      statusText: 'OK',
      headers: [],
      content: {
        size: 0,
        mimeType: 'application/json',
        text: overrides.responseText,
      },
      bodySize: 0,
      headersSize: 0,
    },
  };
}

const AUTH_CFG = {
  authBodyFormat: 'form' as const,
  authUsernameField: 'username',
  authPasswordField: 'password',
  authTokenPath: '$.access_token',
  authMethod: 'bearer-login' as const,
};

// ---------------------------------------------------------------------------
// normalisePath
// ---------------------------------------------------------------------------

describe('normalisePath', () => {
  it('replaces numeric segments with parameterised names', () => {
    const { template } = normalisePath('/users/123');
    expect(template).toBe('/users/{userId}');
  });

  it('replaces UUID segments with parameterised names', () => {
    const { template } = normalisePath('/items/550e8400-e29b-41d4-a716-446655440000');
    expect(template).toBe('/items/{itemId}');
  });

  it('does not replace non-ID segments', () => {
    const { template } = normalisePath('/api/v1/users');
    expect(template).toBe('/api/v1/users');
  });

  it('collects paramNames for numeric id', () => {
    const { paramNames } = normalisePath('/posts/42/comments');
    expect(paramNames).toContain('postId');
  });

  it('returns empty paramNames when no id segments', () => {
    const { paramNames } = normalisePath('/api/health');
    expect(paramNames).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// inferSchema
// ---------------------------------------------------------------------------

describe('inferSchema', () => {
  it('infers null as string nullable', () => {
    const schema = inferSchema(null);
    expect(schema.type).toBe('string');
    expect(schema.nullable).toBe(true);
  });

  it('infers boolean', () => {
    expect(inferSchema(true).type).toBe('boolean');
  });

  it('infers integer', () => {
    expect(inferSchema(42).type).toBe('integer');
  });

  it('infers number for floats', () => {
    expect(inferSchema(3.14).type).toBe('number');
  });

  it('infers string', () => {
    expect(inferSchema('hello').type).toBe('string');
  });

  it('infers array with items schema', () => {
    const schema = inferSchema([1, 2, 3]);
    expect(schema.type).toBe('array');
    expect((schema.items as Record<string, unknown>).type).toBe('integer');
  });

  it('infers nested object with properties', () => {
    const schema = inferSchema({ name: 'Alice', age: 30 });
    expect(schema.type).toBe('object');
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.name.type).toBe('string');
    expect(props.age.type).toBe('integer');
  });

  it('includes example values when withExample=true', () => {
    const schema = inferSchema('test-value', true);
    expect(schema.example).toBe('test-value');
  });
});

// ---------------------------------------------------------------------------
// toOpenApi — end-to-end with temp dir
// ---------------------------------------------------------------------------

describe('toOpenApi — end-to-end', () => {
  it('writes openapi.json and openapi.yaml', () => {
    const dir = makeTempDir();
    const entries = [makeEntry({ url: 'https://api.example.com/api/users' })];
    toOpenApi(entries, dir, 'https://api.example.com', undefined, false, AUTH_CFG);
    expect(fs.existsSync(path.join(dir, 'openapi.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'openapi.yaml'))).toBe(true);
  });

  it('parameterises /users/123 → /users/{userId} in spec', () => {
    const dir = makeTempDir();
    const entries = [makeEntry({ url: 'https://api.example.com/api/users/123' })];
    toOpenApi(entries, dir, 'https://api.example.com', undefined, false, AUTH_CFG);
    const spec = JSON.parse(fs.readFileSync(path.join(dir, 'openapi.json'), 'utf-8')) as Record<string, unknown>;
    const paths = spec.paths as Record<string, unknown>;
    expect(Object.keys(paths)).toContain('/api/users/{userId}');
  });

  it('redacts password field in form body example (redact=true)', () => {
    const dir = makeTempDir();
    const entries = [
      makeEntry({
        url: 'https://api.example.com/api/login',
        method: 'POST',
        postData: {
          mimeType: 'application/x-www-form-urlencoded',
          params: [
            { name: 'username', value: 'alice' },
            { name: 'password', value: 'hunter2' },
          ],
        },
      }),
    ];
    toOpenApi(entries, dir, 'https://api.example.com', undefined, true, AUTH_CFG, {}, true);
    const spec = JSON.parse(fs.readFileSync(path.join(dir, 'openapi.json'), 'utf-8')) as Record<string, unknown>;
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const op = paths['/api/login']?.post as Record<string, unknown> | undefined;
    const rb = op?.requestBody as Record<string, unknown> | undefined;
    const content = rb?.content as Record<string, Record<string, unknown>> | undefined;
    const example = content?.['application/x-www-form-urlencoded']?.example as Record<string, unknown> | undefined;
    expect(example?.password).toBe('[REDACTED]');
    expect(example?.username).toBe('alice');
  });

  it('does NOT redact password when redact=false', () => {
    const dir = makeTempDir();
    const entries = [
      makeEntry({
        url: 'https://api.example.com/api/login',
        method: 'POST',
        postData: {
          mimeType: 'application/x-www-form-urlencoded',
          params: [
            { name: 'username', value: 'alice' },
            { name: 'password', value: 'hunter2' },
          ],
        },
      }),
    ];
    toOpenApi(entries, dir, 'https://api.example.com', undefined, true, AUTH_CFG, {}, false);
    const spec = JSON.parse(fs.readFileSync(path.join(dir, 'openapi.json'), 'utf-8')) as Record<string, unknown>;
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const op = paths['/api/login']?.post as Record<string, unknown> | undefined;
    const rb = op?.requestBody as Record<string, unknown> | undefined;
    const content = rb?.content as Record<string, Record<string, unknown>> | undefined;
    const example = content?.['application/x-www-form-urlencoded']?.example as Record<string, unknown> | undefined;
    expect(example?.password).toBe('hunter2');
  });

  it('puts login path first when authUrl is set', () => {
    const dir = makeTempDir();
    const entries = [makeEntry({ url: 'https://api.example.com/api/users' })];
    toOpenApi(
      entries,
      dir,
      'https://api.example.com',
      'https://auth.example.com/api/v1/login',
      false,
      AUTH_CFG
    );
    const spec = JSON.parse(fs.readFileSync(path.join(dir, 'openapi.json'), 'utf-8')) as Record<string, unknown>;
    const paths = spec.paths as Record<string, unknown>;
    const keys = Object.keys(paths);
    expect(keys[0]).toBe('/api/v1/login');
  });
});
