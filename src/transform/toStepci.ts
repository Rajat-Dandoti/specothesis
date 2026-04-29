import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { HarEntry } from '../utils/harFilter.js';
import { AUTH_ENV_REFS } from '../config.js';

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
    check: {
      status: number;
      jsonpath?: Record<string, Array<Record<string, boolean>>>;
    };
  };
}

interface StepciWorkflow {
  version: string;
  name: string;
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
]);

function buildHeaders(
  rawHeaders: Array<{ name: string; value: string }>,
  opts: { stripContentType?: boolean } = {}
): Record<string, string> | undefined {
  const result: Record<string, string> = {};

  for (const { name, value } of rawHeaders) {
    const lower = name.toLowerCase();
    if (SKIP_HEADERS.has(lower)) continue;
    // For multipart entries, skip content-type — the captured boundary string
    // is session-specific and would break replay. StepCI sets it automatically
    // when it sends a formData block.
    if (opts.stripContentType && lower === 'content-type') continue;
    result[name] = AUTH_ENV_REFS[lower] ?? value;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function buildJsonpathChecks(responseText: string | undefined): Record<string, Array<Record<string, boolean>>> | undefined {
  if (!responseText) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;

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
function buildRequestBody(postData: HarEntry['request']['postData']): {
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
        // File upload field — emit a placeholder path the user can substitute
        formData[p.name] = { file: `<path/to/${p.fileName}>` };
      } else {
        formData[p.name] = p.value ?? '';
      }
    }
    return { formData };
  }

  // ── application/json ──────────────────────────────────────────────────────
  if (mime.toLowerCase().includes('application/json')) {
    if (postData.text) {
      try {
        return { json: JSON.parse(postData.text) };
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
      for (const p of params) form[p.name] = p.value ?? '';
      return { form };
    }
    if (postData.text) {
      // Parse query-string style text as fallback
      const form: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(postData.text)) form[k] = v;
      return { form };
    }
    return {};
  }

  // ── everything else ───────────────────────────────────────────────────────
  return postData.text ? { body: postData.text } : {};
}

function entryToStep(entry: HarEntry): StepciStep {
  const { method, url, headers: reqHeaders, postData } = entry.request;
  const { status, content } = entry.response;

  const urlObj = new URL(url);
  const stepName = `${method} ${urlObj.pathname}`;

  const isMultipart = (postData?.mimeType ?? '').toLowerCase().includes('multipart/form-data');
  const headers = buildHeaders(reqHeaders, { stripContentType: isMultipart });
  const bodyFields = buildRequestBody(postData);
  const jsonpath = buildJsonpathChecks(content.text);

  const step: StepciStep = {
    name: stepName,
    http: {
      url,
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

/**
 * Convert filtered HAR entries to a StepCI workflow YAML and write it to outDir.
 */
export function toStepci(entries: HarEntry[], journeyName: string, outDir: string): void {
  const steps = entries.map(entryToStep);

  const workflow: StepciWorkflow = {
    version: '1.1',
    name: `Captured journey - ${journeyName}`,
    tests: {
      captured_api_calls: {
        steps,
      },
    },
  };

  const outPath = path.join(outDir, 'stepci-workflow.yaml');
  fs.writeFileSync(outPath, yaml.dump(workflow, { lineWidth: 120, quotingType: '"' }), 'utf-8');

  console.log(`  [stepci]  ${outPath}`);
}
