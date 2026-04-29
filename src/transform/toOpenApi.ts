import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { HarEntry } from '../utils/harFilter.js';

// ---------------------------------------------------------------------------
// Schema inference
// ---------------------------------------------------------------------------

type JsonSchema = Record<string, unknown>;

function inferSchema(value: unknown): JsonSchema {
  if (value === null) return { type: 'string', nullable: true };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'number') return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' };
  if (typeof value === 'string') return { type: 'string' };
  if (Array.isArray(value)) {
    return { type: 'array', items: value.length > 0 ? inferSchema(value[0]) : {} };
  }
  if (typeof value === 'object') {
    const properties: Record<string, JsonSchema> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      properties[k] = inferSchema(v);
    }
    return { type: 'object', properties };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Request body builder
// ---------------------------------------------------------------------------

function buildRequestBodySpec(postData: HarEntry['request']['postData']): Record<string, unknown> | undefined {
  if (!postData) return undefined;

  const mime = postData.mimeType ?? '';

  if (mime.toLowerCase().includes('multipart/form-data')) {
    const params = postData.params ?? [];
    if (params.length === 0) return undefined;
    const properties: Record<string, JsonSchema> = {};
    for (const p of params) {
      properties[p.name] = p.fileName !== undefined
        ? { type: 'string', format: 'binary' }
        : { type: 'string' };
    }
    return { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties } } } };
  }

  if (mime.toLowerCase().includes('application/json')) {
    const text = postData.text ?? '';
    let schema: JsonSchema = { type: 'object' };
    try { schema = inferSchema(JSON.parse(text)); } catch { /* leave generic */ }
    return { required: true, content: { 'application/json': { schema } } };
  }

  if (mime.toLowerCase().includes('application/x-www-form-urlencoded')) {
    const params = postData.params ?? [];
    const properties: Record<string, JsonSchema> = {};
    if (params.length > 0) {
      for (const p of params) properties[p.name] = { type: 'string' };
    } else if (postData.text) {
      for (const [k] of new URLSearchParams(postData.text)) properties[k] = { type: 'string' };
    }
    if (Object.keys(properties).length === 0) return undefined;
    return { required: true, content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties } } } };
  }

  if (postData.text) {
    return { required: true, content: { 'text/plain': { schema: { type: 'string' } } } };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Path parameterisation
// ---------------------------------------------------------------------------

const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function normalisePath(pathname: string): { template: string; paramNames: string[] } {
  const paramNames: string[] = [];
  const segments = pathname.split('/');
  const template = segments
    .map((seg, idx) => {
      if (ID_SEGMENT.test(seg)) {
        const prev = segments[idx - 1] ?? 'item';
        const name = `${prev.replace(/s$/, '')}Id`;
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

function buildResponseSchema(responseText: string | undefined): JsonSchema | undefined {
  if (!responseText) return undefined;
  try { return inferSchema(JSON.parse(responseText)); } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// Auth (login) operation
// ---------------------------------------------------------------------------

/**
 * Parse the auth URL and build a login operation for the spec.
 * Detects the tenant segment via the /local/{tenant}/login pattern and
 * replaces it with a {tenant} path parameter.
 *
 * Returns the auth server origin, the path template, and the operation object.
 */
function buildLoginOperation(authUrl: string): {
  serverUrl: string;
  pathTemplate: string;
  operation: Record<string, unknown>;
} | undefined {
  let parsed: URL;
  try { parsed = new URL(authUrl); } catch {
    console.warn(`  [openapi] WARNING: SCANNER_AUTH_URL is not a valid URL: "${authUrl}" — login operation skipped.`);
    return undefined;
  }

  if (!parsed.pathname || parsed.pathname === '/') {
    console.warn(`  [openapi] WARNING: SCANNER_AUTH_URL has no path (got "${authUrl}"). Set the full login URL, e.g. https://auth.example.com/api/v1/local/mytenant/login`);
    return undefined;
  }

  const serverUrl = `${parsed.protocol}//${parsed.host}`;

  // Replace the tenant segment: /local/<tenant>/login → /local/{tenant}/login
  const pathTemplate = parsed.pathname.replace(
    /\/local\/([^/]+)\/login/,
    '/local/{tenant}/login'
  );

  const operation: Record<string, unknown> = {
    summary: 'Login — obtain a JWT',
    description:
      'POST your credentials to receive an `access_token`. ' +
      'Copy the token value, click **Authorize** at the top of the page, ' +
      'and paste it into the **bearerAuth** field (without the "Bearer " prefix — Swagger adds it automatically).',
    tags: ['Authentication'],
    parameters: [
      {
        name: 'tenant',
        in: 'path',
        required: true,
        description: 'Your tenant / organisation slug (e.g. "privasapien")',
        schema: { type: 'string' },
      },
    ],
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            required: ['username', 'password'],
            properties: {
              username: { type: 'string', description: 'Your login email or username' },
              password: { type: 'string', format: 'password' },
            },
          },
        },
      },
    },
    security: [],   // login endpoint does not require auth
    responses: {
      '200': {
        description: 'Login successful',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                access_token: { type: 'string', description: 'JWT — use this as the Bearer token' },
                message: { type: 'string', example: 'Login successful' },
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
  entryServerUrl: string;   // origin of the actual entry URL
  entry: HarEntry;
}

export function toOpenApi(
  entries: HarEntry[],
  outDir: string,
  baseUrl: string,
  authUrl?: string
): void {
  const baseOrigin = (() => {
    try { const u = new URL(baseUrl); return `${u.protocol}//${u.host}`; } catch { return baseUrl; }
  })();

  // Group by method + normalised path; last entry wins per group
  const groups = new Map<string, OperationGroup>();

  for (const entry of entries) {
    const urlObj = new URL(entry.request.url);
    const entryServerUrl = `${urlObj.protocol}//${urlObj.host}`;
    const { template, paramNames } = normalisePath(urlObj.pathname);
    const key = `${entry.request.method.toUpperCase()}:${entryServerUrl}:${template}`;

    groups.set(key, {
      method: entry.request.method.toLowerCase(),
      pathTemplate: template,
      paramNames,
      entryServerUrl,
      entry,
    });
  }

  // Build paths
  const paths: Record<string, unknown> = {};

  for (const { method, pathTemplate, paramNames, entryServerUrl, entry } of groups.values()) {
    if (!paths[pathTemplate]) paths[pathTemplate] = {};
    const pathItem = paths[pathTemplate] as Record<string, unknown>;

    const parameters: unknown[] = paramNames.map((name) => ({
      name, in: 'path', required: true, schema: { type: 'string' },
    }));

    const urlObj = new URL(entry.request.url);
    for (const [k, v] of urlObj.searchParams) {
      parameters.push({ name: k, in: 'query', required: false, schema: inferSchema(v), example: v });
    }

    const requestBody = buildRequestBodySpec(entry.request.postData);
    const responseSchema = buildResponseSchema(entry.response.content.text);
    const responseContent = responseSchema ? { 'application/json': { schema: responseSchema } } : undefined;

    const operation: Record<string, unknown> = {
      summary: `${method.toUpperCase()} ${pathTemplate}`,
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

    // Per-operation server override when this entry's host differs from the base
    if (entryServerUrl !== baseOrigin) {
      operation.servers = [{ url: entryServerUrl }];
    }

    pathItem[method] = operation;
  }

  // Inject the login operation when authUrl is configured
  if (authUrl) {
    const login = buildLoginOperation(authUrl);
    if (login) {
      if (!paths[login.pathTemplate]) paths[login.pathTemplate] = {};
      const pathItem = paths[login.pathTemplate] as Record<string, unknown>;
      // Add per-path server override so Swagger routes the call to the auth server
      (pathItem as Record<string, unknown>).servers = [{ url: login.serverUrl }];
      pathItem.post = login.operation;
    }
  }

  // Assemble spec
  const spec: Record<string, unknown> = {
    openapi: '3.0.3',
    info: { title: 'Captured API', version: '1.0.0' },
    servers: [{ url: baseOrigin }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'JWT obtained from **POST /local/{tenant}/login**. ' +
            'Click Authorize, paste only the token value (no "Bearer " prefix).',
        },
      },
    },
    paths,
  };

  const jsonPath = path.join(outDir, 'openapi.json');
  const yamlPath = path.join(outDir, 'openapi.yaml');

  fs.writeFileSync(jsonPath, JSON.stringify(spec, null, 2), 'utf-8');
  fs.writeFileSync(yamlPath, yaml.dump(spec, { lineWidth: 120 }), 'utf-8');

  console.log(`  [openapi] ${jsonPath}`);
  console.log(`  [openapi] ${yamlPath}`);
}
