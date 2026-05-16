const WHOLE_WORD = new Set(['password','passwd','pass','pwd','secret',
  'token','apikey','credential','credentials','otp','pin','ssn','privatekey','privkey',
  'accesstoken','refreshtoken','idtoken','authtoken','bearertoken','clientsecret','xapikey']);
const SENSITIVE_SUFFIXES = new Set(['token','secret','password','apikey','passwd','key','credential']);

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  const normalised = lower.replace(/[-_.]/g, '');
  if (WHOLE_WORD.has(normalised)) return true;
  const segments = lower.split(/[-_.]/).filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  return segments.length > 1 && SENSITIVE_SUFFIXES.has(last);
}

/** Recursively redact values whose key is sensitive. */
export function redactObject(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactObject);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? '[REDACTED]' : redactObject(v);
  }
  return out;
}

/**
 * Replace any occurrence of a known secret string inside text.
 * Only applies to values longer than 8 chars to avoid false positives.
 */
export function redactKnownSecrets(text: string, secrets: string[]): string {
  let result = text;
  for (const s of secrets) {
    if (s && s.length >= 4) {
      result = result.split(s).join('[REDACTED]');
    }
  }
  return result;
}
