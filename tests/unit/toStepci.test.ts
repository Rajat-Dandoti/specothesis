import { describe, it, expect } from 'vitest';
import { buildRequestBody } from '../../src/transform/toStepci.js';
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
