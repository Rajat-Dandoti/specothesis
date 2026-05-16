import { describe, it, expect } from 'vitest';
import { isSensitiveKey, redactObject, redactKnownSecrets } from '../../src/utils/redact.js';

// ---------------------------------------------------------------------------
// isSensitiveKey
// ---------------------------------------------------------------------------

describe('isSensitiveKey — exact matches', () => {
  it('matches "password"', () => expect(isSensitiveKey('password')).toBe(true));
  it('matches "token"', () => expect(isSensitiveKey('token')).toBe(true));
  it('matches "secret"', () => expect(isSensitiveKey('secret')).toBe(true));
  it('matches "apikey"', () => expect(isSensitiveKey('apikey')).toBe(true));
  it('matches "otp"', () => expect(isSensitiveKey('otp')).toBe(true));
});

describe('isSensitiveKey — compound with separator', () => {
  it('matches "access_token"', () => expect(isSensitiveKey('access_token')).toBe(true));
  it('matches "client-secret"', () => expect(isSensitiveKey('client-secret')).toBe(true));
  it('matches "X-Api-Key"', () => expect(isSensitiveKey('X-Api-Key')).toBe(true));
});

describe('isSensitiveKey — case-insensitive', () => {
  it('matches "PASSWORD"', () => expect(isSensitiveKey('PASSWORD')).toBe(true));
  it('matches "ACCESS_TOKEN"', () => expect(isSensitiveKey('ACCESS_TOKEN')).toBe(true));
  it('matches "Token"', () => expect(isSensitiveKey('Token')).toBe(true));
});

describe('isSensitiveKey — non-sensitive keys', () => {
  it('does not match "username"', () => expect(isSensitiveKey('username')).toBe(false));
  it('does not match "email"', () => expect(isSensitiveKey('email')).toBe(false));
  it('does not match "name"', () => expect(isSensitiveKey('name')).toBe(false));
  it('does not match "id"', () => expect(isSensitiveKey('id')).toBe(false));
});

// Known bug: prefix/suffix matching is overly broad — these currently WILL match.
// They are expected to be fixed in Phase 3.
describe('isSensitiveKey — known false positives (Phase 3 bug)', () => {
  it.fails('tokenCount should NOT match (known bug)', () =>
    expect(isSensitiveKey('tokenCount')).toBe(false)
  );
  it.fails('apikeystatus should NOT match (known bug)', () =>
    expect(isSensitiveKey('apikeystatus')).toBe(false)
  );
});

// ---------------------------------------------------------------------------
// redactObject
// ---------------------------------------------------------------------------

describe('redactObject', () => {
  it('redacts a top-level sensitive field', () => {
    const result = redactObject({ password: 'hunter2' });
    expect((result as Record<string, unknown>).password).toBe('[REDACTED]');
  });

  it('passes through non-sensitive fields', () => {
    const result = redactObject({ username: 'alice', email: 'alice@example.com' });
    expect((result as Record<string, unknown>).username).toBe('alice');
    expect((result as Record<string, unknown>).email).toBe('alice@example.com');
  });

  it('redacts nested sensitive fields', () => {
    const result = redactObject({ user: { password: 'secret123', name: 'Bob' } }) as Record<string, unknown>;
    const user = result.user as Record<string, unknown>;
    expect(user.password).toBe('[REDACTED]');
    expect(user.name).toBe('Bob');
  });

  it('handles arrays of objects', () => {
    const result = redactObject([{ token: 'abc', id: 1 }]) as Array<Record<string, unknown>>;
    expect(result[0].token).toBe('[REDACTED]');
    expect(result[0].id).toBe(1);
  });

  it('returns null as-is', () => {
    expect(redactObject(null)).toBeNull();
  });

  it('returns primitives as-is', () => {
    expect(redactObject(42)).toBe(42);
    expect(redactObject('hello')).toBe('hello');
    expect(redactObject(true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// redactKnownSecrets
// ---------------------------------------------------------------------------

describe('redactKnownSecrets', () => {
  it('replaces a known secret substring in text', () => {
    const secret = 'super-secret-token-12345';
    const result = redactKnownSecrets(`Bearer ${secret}`, [secret]);
    expect(result).toBe('Bearer [REDACTED]');
  });

  it('skips secrets shorter than 9 chars', () => {
    const result = redactKnownSecrets('token: abc12345', ['abc12345']);
    expect(result).toBe('token: abc12345');
  });

  it('handles empty input string', () => {
    expect(redactKnownSecrets('', ['some-long-secret'])).toBe('');
  });

  it('handles empty secrets array', () => {
    expect(redactKnownSecrets('no secrets here', [])).toBe('no secrets here');
  });

  it('replaces multiple occurrences in text', () => {
    const secret = 'my-secret-key-xyz';
    const result = redactKnownSecrets(`${secret} and ${secret}`, [secret]);
    expect(result).toBe('[REDACTED] and [REDACTED]');
  });

  it('does not replace when secret is exactly 8 chars (boundary)', () => {
    // length > 8 means length must be at least 9; exactly 8 is skipped
    const result = redactKnownSecrets('val: 12345678', ['12345678']);
    expect(result).toBe('val: 12345678');
  });
});
