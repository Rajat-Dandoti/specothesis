import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { HarEntry } from '../utils/harFilter.js';
import type { AuthBodyFormat } from '../config.js';
import { TransformError } from '../errors.js';
import { isSensitiveKey, redactObject } from '../utils/redact.js';
import { ID_SEGMENT } from '../utils/pathNormalise.js';

// ---------------------------------------------------------------------------
// Schema inference
// ---------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>;

export function inferSchema(value: unknown, withExample = false): JsonSchema {
  const ex = (v: unknown) => (withExample ? { example: v } : {});
  if (value === null) return { type: 'string', nullable: true, ...ex(null) };
  if (typeof value === 'boolean') return { type: 'boolean', ...ex(value) };
  if (typeof value === 'number')
    return Number.isInteger(value)
      ? { type: 'integer', ...ex(value) }
      : { type: 'number', ...ex(value) };
  if (typeof value === 'string') return { type: 'string', ...ex(value) };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      items: value.length > 0 ? inferSchema(value[0], withExample) : {},
      ...ex(value),
    };
  }
  if (typeof value === 'object') {
    const properties: Record<string, JsonSchema> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      properties[k] = inferSchema(v, withExample);
    }
    return { type: 'object', properties, ...ex(value) };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Request body builder
// ---------------------------------------------------------------------------

function buildRequestBodySpec(
  postData: HarEntry['request']['postData'],
  withExample = false,
  redact = true
): Record<string, unknown> | undefined {
  if (!postData) return undefined;

  const mime = postData.mimeType ?? '';

  if (mime.toLowerCase().includes('multipart/form-data')) {
    const params = postData.params ?? [];
    if (params.length === 0) return undefined;
    const properties: Record<string, JsonSchema> = {};
    const exampleMap: Record<string, unknown> = {};
    for (const p of params) {
      if (p.fileName !== undefined) {
        properties[p.name] = { type: 'string', format: 'binary' };
        if (withExample) exampleMap[p.name] = `<path/to/${p.fileName}>`;
      } else {
        properties[p.name] = { type: 'string' };
        if (withExample) exampleMap[p.name] = (redact && isSensitiveKey(p.name)) ? '[REDACTED]' : (p.value ?? '');
      }
    }
    const schema: JsonSchema = { type: 'object', properties };
    const contentEntry: Record<string, unknown> = { schema };
    if (withExample) contentEntry.example = exampleMap;
    return { required: true, content: { 'multipart/form-data': contentEntry } };
  }

  if (mime.toLowerCase().includes('application/json')) {
    const text = postData.text ?? '';
    let parsed: unknown;
    let schema: JsonSchema = { type: 'object' };
    try {
      parsed = JSON.parse(text);
      schema = inferSchema(parsed, withExample);
    } catch {
      /* leave generic */
    }
    const contentEntry: Record<string, unknown> = { schema };
    if (withExample && parsed !== undefined) contentEntry.example = redact ? redactObject(parsed) : parsed;
    return { required: true, content: { 'application/json': contentEntry } };
  }

  if (mime.toLowerCase().includes('application/x-www-form-urlencoded')) {
    const params = postData.params ?? [];
    const properties: Record<string, JsonSchema> = {};
    const exampleMap: Record<string, unknown> = {};
    if (params.length > 0) {
      for (const p of params) {
        properties[p.name] = { type: 'string' };
        if (withExample) exampleMap[p.name] = (redact && isSensitiveKey(p.name)) ? '[REDACTED]' : (p.value ?? '');
      }
    } else if (postData.text) {
      for (const [k, v] of new URLSearchParams(postData.text)) {
        properties[k] = { type: 'string' };
        if (withExample) exampleMap[k] = (redact && isSensitiveKey(k)) ? '[REDACTED]' : v;
      }
    }
    if (Object.keys(properties).length === 0) return undefined;
    const schema: JsonSchema = { type: 'object', properties };
    const contentEntry: Record<string, unknown> = { schema };
    if (withExample && Object.keys(exampleMap).length > 0) contentEntry.example = exampleMap;
    return { required: true, content: { 'application/x-www-form-urlencoded': contentEntry } };
  }

  if (postData.text) {
    return { required: true, content: { 'text/plain': { schema: { type: 'string' } } } };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Path parameterisation
// ---------------------------------------------------------------------------

const VERSION_SEGMENT = /^v\d+$/i;

// ---------------------------------------------------------------------------
// operationId + tag derivation
// ---------------------------------------------------------------------------

function deriveOperationId(method: string, pathTemplate: string): string {
  const segments = pathTemplate.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? 'root';
  // Strip path param braces: {userId} → userId
  const cleaned = last.replace(/^\{(.+)\}$/, '$1');
  // kebab-case to camelCase
  const camel = cleaned.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
  return method.toLowerCase() + camel.charAt(0).toUpperCase() + camel.slice(1);
}

function deriveTag(pathTemplate: string): string | undefined {
  const segments = pathTemplate.split('/').filter(Boolean);
  // Return the first segment that isn't a version prefix, 'api', or a path parameter
  return segments.find(
    (s) => !VERSION_SEGMENT.test(s) && s.toLowerCase() !== 'api' && !s.startsWith('{')
  );
}

export function normalisePath(pathname: string): { template: string; paramNames: string[] } {
  const paramNames: string[] = [];
  const seen = new Map<string, number>();
  const segments = pathname.split('/');
  const template = segments
    .map((seg, idx) => {
      if (ID_SEGMENT.test(seg)) {
        // Walk back to find the nearest non-version, non-empty segment for the param name
        let prev = 'item';
        for (let i = idx - 1; i >= 0; i--) {
          if (segments[i] && !VERSION_SEGMENT.test(segments[i])) {
            prev = segments[i];
            break;
          }
        }
        const base = `${prev.replace(/s$/, '')}Id`;
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const name = count === 0 ? base : `${base}_${count + 1}`;
        paramNames.push(name);
        return `{${name}}`;
      }
      return seg;
    })
    .join('/');
  return { template, paramNames };
}

// ---------------------------------------------------------------------------
// Response body schema
// ---------------------------------------------------------------------------

function buildResponseSchema(
  responseText: string | undefined,
  withExample = false,
  redact = true
): JsonSchema | undefined {
  if (!responseText) return undefined;
  try {
    const parsed = JSON.parse(responseText);
    const schema = inferSchema(parsed, withExample);
    if (withExample) schema.example = redact ? redactObject(parsed) : parsed;
    return schema;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Auth (login) operation
// ---------------------------------------------------------------------------

interface LoginAuthConfig {
  authBodyFormat: AuthBodyFormat;
  authUsernameField: string;
  authPasswordField: string;
  authTokenPath: string;
}

/**
 * Build a login operation for the spec using the provided auth URL and config.
 * The URL path is used as-is — no application-specific pattern matching.
 */
function buildLoginOperation(
  authUrl: string,
  authCfg: LoginAuthConfig
):
  | {
      serverUrl: string;
      pathTemplate: string;
      operation: Record<string, unknown>;
    }
  | undefined {
  let parsed: URL;
  try {
    parsed = new URL(authUrl);
  } catch {
    console.warn(
      `  [openapi] WARNING: SCANNER_AUTH_URL is not a valid URL: "${authUrl}" — login operation skipped.`
    );
    return undefined;
  }

  if (!parsed.pathname || parsed.pathname === '/') {
    console.warn(
      `  [openapi] WARNING: SCANNER_AUTH_URL has no path (got "${authUrl}"). Set the full login URL, e.g. https://auth.example.com/api/v1/login`
    );
    return undefined;
  }

  const serverUrl = `${parsed.protocol}//${parsed.host}`;
  const pathTemplate = parsed.pathname;

  // Derive the token field name from the JSONPath (last segment after the final dot)
  const tokenField = authCfg.authTokenPath.split('.').pop() ?? 'token';

  // Determine content type from body format
  const fmt = authCfg.authBodyFormat;
  const contentType =
    fmt === 'json'
      ? 'application/json'
      : fmt === 'formData'
        ? 'multipart/form-data'
        : 'application/x-www-form-urlencoded';

  const bodySchema = {
    type: 'object',
    required: [authCfg.authUsernameField, authCfg.authPasswordField],
    properties: {
      [authCfg.authUsernameField]: { type: 'string', description: 'Your login email or username' },
      [authCfg.authPasswordField]: { type: 'string', format: 'password' },
    },
  };

  const operation: Record<string, unknown> = {
    summary: 'Login — obtain an access token',
    description:
      'POST your credentials to receive an access token. ' +
      'Copy the token value, click **Authorize** at the top of the page, ' +
      'and paste it into the **bearerAuth** field.',
    tags: ['Authentication'],
    requestBody: {
      required: true,
      content: { [contentType]: { schema: bodySchema } },
    },
    security: [],
    responses: {
      '200': {
        description: 'Login successful',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                [tokenField]: { type: 'string', description: 'Access token' },
              },
            },
          },
        },
      },
    },
  };

  return { serverUrl, pathTemplate, operation };
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

interface OperationGroup {
  method: string;
  pathTemplate: string;
  paramNames: string[];
  entryServerUrl: string; // origin of the actual entry URL
  entry: HarEntry;
}

export interface OpenApiInfoOverrides {
  title?: string;
  version?: string;
  description?: string;
}

export function toOpenApi(
  entries: HarEntry[],
  outDir: string,
  apiUrl: string | undefined,
  authUrl: string | undefined,
  includeExamples: boolean,
  authCfg: LoginAuthConfig,
  infoOverrides: OpenApiInfoOverrides = {},
  redact = true
): void {
  // Resolve the server URL for the spec.
  // baseServerUrl  — full URL used in servers[0] (preserves any base path in SCANNER_API_URL)
  // baseOriginHost — protocol+host only, used when deciding per-operation server overrides
  const { baseServerUrl, baseOriginHost } = (() => {
    if (apiUrl) {
      try {
        const u = new URL(apiUrl);
        const host = `${u.protocol}//${u.host}`;
        const basePath = u.pathname.replace(/\/$/, '');
        const serverUrl = basePath && basePath !== '' ? `${host}${basePath}` : host;
        return { baseServerUrl: serverUrl, baseOriginHost: host };
      } catch {
        /* fall through */
      }
    }
    const freq = new Map<string, number>();
    for (const e of entries) {
      try {
        const u = new URL(e.request.url);
        const o = `${u.protocol}//${u.host}`;
        freq.set(o, (freq.get(o) ?? 0) + 1);
      } catch {
        /* skip */
      }
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    console.warn(
      `  [openapi] WARNING: SCANNER_API_URL not set. Using most-frequent host "${top}" as spec server. Set SCANNER_API_URL to suppress this warning.`
    );
    return { baseServerUrl: top, baseOriginHost: top };
  })();

  // Group by method + normalised path; last entry wins per group
  const groups = new Map<string, OperationGroup>();

  for (const entry of entries) {
    const urlObj = new URL(entry.request.url);
    const entryServerUrl = `${urlObj.protocol}//${urlObj.host}`;
    const { template, paramNames } = normalisePath(urlObj.pathname);
    const key = `${entry.request.method.toUpperCase()}:${entryServerUrl}:${template}`;

    if (groups.has(key)) {
      console.warn(`  [openapi] WARNING: duplicate entry for ${entry.request.method.toUpperCase()} ${template} — last entry wins.`);
    }
    groups.set(key, {
      method: entry.request.method.toLowerCase(),
      pathTemplate: template,
      paramNames,
      entryServerUrl,
      entry,
    });
  }

  // Build paths — login first so it appears at the top in Swagger UI
  const paths: Record<string, unknown> = {};
  // Track used operationIds to deduplicate across all operations
  const usedOperationIds = new Map<string, number>();

  if (authUrl) {
    const login = buildLoginOperation(authUrl, authCfg);
    if (login) {
      paths[login.pathTemplate] = {
        servers: [{ url: login.serverUrl }],
        post: login.operation,
      };
      usedOperationIds.set('postAuthenticate', 1);
    }
  }

  const sortedGroups = [...groups.values()].sort((a, b) =>
    `${a.method}:${a.pathTemplate}`.localeCompare(`${b.method}:${b.pathTemplate}`)
  );

  for (const { method, pathTemplate, paramNames, entryServerUrl, entry } of sortedGroups) {
    if (!paths[pathTemplate]) paths[pathTemplate] = {};
    const pathItem = paths[pathTemplate] as Record<string, unknown>;

    const parameters: unknown[] = paramNames.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    const urlObj = new URL(entry.request.url);
    for (const [k, v] of urlObj.searchParams) {
      parameters.push({
        name: k,
        in: 'query',
        required: false,
        schema: inferSchema(v),
        example: (redact && isSensitiveKey(k)) ? '[REDACTED]' : v,
      });
    }

    const requestBody = buildRequestBodySpec(entry.request.postData, includeExamples, redact);
    const responseSchema = buildResponseSchema(entry.response.content.text, includeExamples, redact);
    const responseContent = responseSchema
      ? { 'application/json': { schema: responseSchema } }
      : undefined;

    // Deduplicated operationId
    const baseId = deriveOperationId(method, pathTemplate);
    const count = usedOperationIds.get(baseId) ?? 0;
    usedOperationIds.set(baseId, count + 1);
    const operationId = count === 0 ? baseId : `${baseId}_${count + 1}`;

    // Tag from first meaningful path segment
    const tag = deriveTag(pathTemplate);

    const operation: Record<string, unknown> = {
      operationId,
      summary: `${method.toUpperCase()} ${pathTemplate}`,
      ...(tag ? { tags: [tag] } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      security: [{ bearerAuth: [] }],
      responses: {
        [String(entry.response.status)]: {
          description: entry.response.statusText || 'OK',
          ...(responseContent ? { content: responseContent } : {}),
        },
      },
    };

    // Per-operation server override when this entry's host differs from the configured base
    if (entryServerUrl !== baseOriginHost) {
      operation.servers = [{ url: entryServerUrl }];
    }

    pathItem[method] = operation;
  }

  // Assemble spec
  const spec: Record<string, unknown> = {
    openapi: '3.0.3',
    info: {
      title: infoOverrides.title ?? 'Captured API',
      version: infoOverrides.version ?? '1.0.0',
      description: infoOverrides.description ?? 'Generated by Specothesis',
    },
    servers: [{ url: baseServerUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: authUrl
            ? `Access token obtained from **POST ${new URL(authUrl).pathname}**. Click Authorize, paste only the token value (no "Bearer " prefix).`
            : 'Bearer token. Click Authorize and paste the token value (no "Bearer " prefix).',
        },
      },
    },
    paths,
  };

  const jsonPath = path.join(outDir, 'openapi.json');
  const yamlPath = path.join(outDir, 'openapi.yaml');

  try {
    fs.writeFileSync(jsonPath, JSON.stringify(spec, null, 2), 'utf-8');
    fs.writeFileSync(yamlPath, yaml.dump(spec, { lineWidth: 120 }), 'utf-8');
  } catch (err) {
    throw new TransformError(`Failed to write OpenAPI spec to ${outDir}: ${err instanceof Error ? err.message : err}`);
  }

  console.log(`  [openapi] ${jsonPath}`);
  console.log(`  [openapi] ${yamlPath}`);
}
