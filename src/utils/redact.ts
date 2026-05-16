// Normalise a field name to a lowercase alphanum string for pattern matching.
const normalise = (k: string) => k.toLowerCase().replace(/[-_.]/g, '');

// Field names (normalised) that indicate a secret value.
const SENSITIVE = new Set([
  'password', 'passwd', 'pass', 'pwd',
  'secret', 'clientsecret',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'bearertoken',
  'apikey', 'xapikey',
  'privatekey', 'privkey',
  'credential', 'credentials',
  'otp', 'pin',
  'ssn',
]);

export function isSensitiveKey(key: string): boolean {
  const n = normalise(key);
  return SENSITIVE.has(n) || [...SENSITIVE].some((s) => n.endsWith(s) || n.startsWith(s));
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
    if (s && s.length > 8) {
      result = result.split(s).join('[REDACTED]');
    }
  }
  return result;
}
