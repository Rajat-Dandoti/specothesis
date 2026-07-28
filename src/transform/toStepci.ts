import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { HarEntry } from '../utils/harFilter.js';
import { AUTH_ENV_REFS, type AuthBodyFormat } from '../config.js';
import { TransformError } from '../errors.js';
import { isSensitiveKey, redactObject } from '../utils/redact.js';

interface StepciStep {
  name: string;
  http: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    json?: unknown;
    form?: Record<string, string>;
    formData?: Record<string, unknown>;
    body?: string;
    captures?: Record<string, { jsonpath: string }>;
    check: {
      status: number;
      jsonpath?: Record<string, Array<Record<string, boolean>>>;
    };
  };
}

interface StepciWorkflow {
  version: string;
  name: string;
  env?: Record<string, string>;
  tests: {
    captured_api_calls: {
      steps: StepciStep[];
    };
  };
}

/** Headers to omit entirely (noisy / session-specific / security-sensitive). */
const SKIP_HEADERS = new Set([
  // HTTP/2 pseudo-headers — not valid in StepCI http steps
  ':authority',
  ':method',
  ':path',
  ':scheme',
  ':status',
  // Session / transport noise
  'cookie',
  'set-cookie',
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'pragma',
  'priority',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  // Browser fingerprint / environment-specific
  'origin',
  'referer',
  'user-agent',
]);

function buildHeaders(
  rawHeaders: Array<{ name: string; value: string }>,
  opts: { stripContentType?: boolean; useCaptures?: boolean; authScheme?: string } = {}
): Record<string, string> | undefined {
  const result: Record<string, string> = {};

  for (const { name, value } of rawHeaders) {
    const lower = name.toLowerCase();
    if (SKIP_HEADERS.has(lower)) continue;
    if (opts.stripContentType && lower === 'content-type') continue;

    if (lower === 'authorization') {
      if (opts.useCaptures) {
        // Login step captured the token — prefix it with the configured scheme.
        const scheme = opts.authScheme?.trim() ?? 'Bearer';
        result[name] = scheme ? scheme + ' ${{captures.token}}' : '${{captures.token}}';
      } else {
        result[name] = AUTH_ENV_REFS[lower] ?? value;
      }
    } else {
      result[name] = AUTH_ENV_REFS[lower] ?? value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function buildJsonpathChecks(
  responseText: string | undefined,
  status: number
): Record<string, Array<Record<string, boolean>>> | undefined {
  if (!responseText || status >= 400) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return undefined;
  }

  if (parsed === null) return undefined;

  if (Array.isArray(parsed)) {
    return { '$.length': [{ isPresent: true }] };
  }

  if (typeof parsed !== 'object') return undefined;

  const checks: Record<string, Array<Record<string, boolean>>> = {};
  for (const key of Object.keys(parsed as Record<string, unknown>).slice(0, 5)) {
    checks[`$.${key}`] = [{ isPresent: true }];
  }

  return Object.keys(checks).length > 0 ? checks : undefined;
}

/**
 * Build the request body fields for a StepCI step.
 * Handles three content-type families:
 *   - application/json       → json:
 *   - multipart/form-data    → formData: (text fields inline; file fields as path placeholders)
 *   - anything else          → body: (raw string)
 */
export function buildRequestBody(postData: HarEntry['request']['postData'], redact = true): {
  json?: unknown;
  form?: Record<string, string>;
  formData?: Record<string, unknown>;
  body?: string;
} {
  if (!postData) return {};

  const mime = postData.mimeType ?? '';

  // ── multipart/form-data ───────────────────────────────────────────────────
  if (mime.toLowerCase().includes('multipart/form-data')) {
    const params = postData.params ?? [];

    if (params.length === 0) {
      // params missing — fall back to raw text if available
      return postData.text ? { body: postData.text } : {};
    }

    const formData: Record<string, unknown> = {};
    for (const p of params) {
      if (p.fileName) {
        formData[p.name] = { file: `<path/to/${p.fileName}>` };
      } else {
        formData[p.name] = (redact && isSensitiveKey(p.name)) ? '[REDACTED]' : (p.value ?? '');
      }
    }
    return { formData };
  }

  // ── application/json ──────────────────────────────────────────────────────
  if (mime.toLowerCase().includes('application/json')) {
    if (postData.text) {
      try {
        const parsed = JSON.parse(postData.text);
        return { json: redact ? redactObject(parsed) : parsed };
      } catch {
        return { body: postData.text };
      }
    }
    return {};
  }

  // ── application/x-www-form-urlencoded ─────────────────────────────────────
  if (mime.toLowerCase().includes('application/x-www-form-urlencoded')) {
    const params = postData.params ?? [];
    if (params.length > 0) {
      const form: Record<string, string> = {};
      for (const p of params) form[p.name] = (redact && isSensitiveKey(p.name)) ? '[REDACTED]' : (p.value ?? '');
      return { form };
    }
    if (postData.text) {
      const form: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(postData.text)) form[k] = (redact && isSensitiveKey(k)) ? '[REDACTED]' : v;
      return { form };
    }
    return {};
  }

  // ── everything else ───────────────────────────────────────────────────────
  return postData.text ? { body: postData.text } : {};
}

function entryToStep(
  entry: HarEntry,
  useCaptures = false,
  authScheme?: string,
  apiHost?: string,
  redact = true
): StepciStep {
  const { method, url, headers: reqHeaders, postData } = entry.request;
  const { status, content } = entry.response;

  const urlObj = new URL(url);
  const stepName = `${method} ${urlObj.pathname}`;
  const stepUrl =
    apiHost && urlObj.origin === apiHost
      ? `\${{env.API_HOST}}${urlObj.pathname}${urlObj.search}`
      : url;

  const isMultipart = (postData?.mimeType ?? '').toLowerCase().includes('multipart/form-data');
  const headers = buildHeaders(reqHeaders, {
    stripContentType: isMultipart,
    useCaptures,
    authScheme,
  });
  const bodyFields = buildRequestBody(postData, redact);
  const jsonpath = buildJsonpathChecks(content.text, status);

  const step: StepciStep = {
    name: stepName,
    http: {
      url: stepUrl,
      method,
      ...(headers ? { headers } : {}),
      ...bodyFields,
      check: {
        status,
        ...(jsonpath ? { jsonpath } : {}),
      },
    },
  };

  return step;
}

interface LoginStepConfig {
  authBodyFormat: AuthBodyFormat;
  authUsernameField: string;
  authPasswordField: string;
  authTokenPath: string;
}

/**
 * Build a login step that POSTs credentials and captures the token.
 * Subsequent steps reference the token as ${{captures.token}}.
 */
function buildLoginStep(authUrl: string, cfg: LoginStepConfig): StepciStep {
  const usernameRef = '${{env.SCANNER_USERNAME}}';
  const passwordRef = '${{env.SCANNER_PASSWORD}}';

  let bodyFields: {
    form?: Record<string, string>;
    formData?: Record<string, unknown>;
    json?: unknown;
  };

  if (cfg.authBodyFormat === 'json') {
    bodyFields = {
      json: { [cfg.authUsernameField]: usernameRef, [cfg.authPasswordField]: passwordRef },
    };
  } else if (cfg.authBodyFormat === 'formData') {
    bodyFields = {
      formData: { [cfg.authUsernameField]: usernameRef, [cfg.authPasswordField]: passwordRef },
    };
  } else {
    bodyFields = {
      form: { [cfg.authUsernameField]: usernameRef, [cfg.authPasswordField]: passwordRef },
    };
  }

  return {
    name: 'Authenticate',
    http: {
      url: authUrl,
      method: 'POST',
      ...bodyFields,
      captures: {
        token: { jsonpath: cfg.authTokenPath },
      },
      check: { status: 200 },
    },
  };
}

interface StepciAuthConfig extends LoginStepConfig {
  authScheme: string;
}

/**
 * Convert filtered HAR entries to a StepCI workflow YAML and write it to outDir.
 * When authUrl is provided a login step is prepended and all Authorization headers
 * reference ${{captures.token}} instead of the static env var.
 */
export function toStepci(
  entries: HarEntry[],
  journeyName: string,
  outDir: string,
  authUrl: string | undefined,
  authCfg: StepciAuthConfig,
  redact = true
): void {
  const useCaptures = !!authUrl;

  // Extract the API host from the first entry for the env block
  // Derive API_HOST from most-frequent origin across all entries (same heuristic as toOpenApi)
  let apiHost: string | undefined;
  if (entries.length > 0) {
    const freq = new Map<string, number>();
    for (const e of entries) {
      try {
        const o = new URL(e.request.url).origin;
        freq.set(o, (freq.get(o) ?? 0) + 1);
      } catch { /* skip */ }
    }
    apiHost = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  // Exclude the login entry by full URL (origin + pathname) not just pathname
  const filteredEntries = authUrl
    ? entries.filter(e => {
        try {
          const eu = new URL(e.request.url);
          const au = new URL(authUrl);
          return !(eu.origin === au.origin && eu.pathname === au.pathname);
        } catch { return true; }
      })
    : entries;

  const steps: StepciStep[] = [];

  if (authUrl) steps.push(buildLoginStep(authUrl, authCfg));

  steps.push(...filteredEntries.map((e) => entryToStep(e, useCaptures, authCfg.authScheme, apiHost, redact)));

  const workflow: StepciWorkflow = {
    version: '1.1',
    name: `Captured journey - ${journeyName}`,
    ...(apiHost ? { env: { API_HOST: apiHost } } : {}),
    tests: {
      captured_api_calls: {
        steps,
      },
    },
  };

  const outPath = path.join(outDir, 'stepci-workflow.yaml');
  try {
    fs.writeFileSync(outPath, yaml.dump(workflow, { lineWidth: 120, quotingType: '"' }), 'utf-8');
  } catch (err) {
    throw new TransformError(`Failed to write StepCI workflow to ${outPath}: ${err instanceof Error ? err.message : err}`);
  }

  console.log(`  [stepci]  ${outPath}`);
}
