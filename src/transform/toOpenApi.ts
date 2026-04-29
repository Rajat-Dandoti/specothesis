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

  // multipart/form-data
  if (mime.toLowerCase().includes('multipart/form-data')) {
    const params = postData.params ?? [];
    if (params.length === 0) return undefined;

    const properties: Record<string, JsonSchema> = {};
    for (const p of params) {
      if (p.fileName !== undefined) {
        properties[p.name] = { type: 'string', format: 'binary' };
      } else {
        properties[p.name] = { type: 'string' };
      }
    }

    return {
      required: true,
      content: {
        'multipart/form-data': {
          schema: { type: 'object', properties },
        },
      },
    };
  }

  // application/json
  if (mime.toLowerCase().includes('application/json')) {
    const text = postData.text ?? '';
    let schema: JsonSchema = { type: 'object' };
    try {
      const parsed = JSON.parse(text);
      schema = inferSchema(parsed);
    } catch {
      // unparseable — leave generic object
    }
    return {
      required: true,
      content: { 'application/json': { schema } },
    };
  }

  // application/x-www-form-urlencoded
  if (mime.toLowerCase().includes('application/x-www-form-urlencoded')) {
    const params = postData.params ?? [];
    const properties: Record<string, JsonSchema> = {};
    if (params.length > 0) {
      for (const p of params) properties[p.name] = { type: 'string' };
    } else if (postData.text) {
      for (const [k] of new URLSearchParams(postData.text)) properties[k] = { type: 'string' };
    }
    if (Object.keys(properties).length === 0) return undefined;
    return {
      required: true,
      content: {
        'application/x-www-form-urlencoded': {
          schema: { type: 'object', properties },
        },
      },
    };
  }

  // raw body
  if (postData.text) {
    return {
      required: true,
      content: { 'text/plain': { schema: { type: 'string' } } },
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Path parameterisation
// ---------------------------------------------------------------------------

const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function normalisePath(pathname: string): { template: string; paramNames: string[] } {
  const paramNames: string[] = [];
  const template = pathname
    .split('/')
    .map((seg, idx) => {
      if (ID_SEGMENT.test(seg)) {
        // derive a name from the previous segment, e.g. /users/42 → {userId}
        const prev = pathname.split('/')[idx - 1] ?? 'item';
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
  try {
    const parsed = JSON.parse(responseText);
    return inferSchema(parsed);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

interface OperationGroup {
  method: string;
  pathTemplate: string;
  paramNames: string[];
  entry: HarEntry; // representative entry (last seen wins)
}

export function toOpenApi(entries: HarEntry[], outDir: string): void {
  // Group by method + normalised path; last entry wins per group
  const groups = new Map<string, OperationGroup>();

  for (const entry of entries) {
    const urlObj = new URL(entry.request.url);
    const { template, paramNames } = normalisePath(urlObj.pathname);
    const key = `${entry.request.method.toUpperCase()}:${template}`;

    groups.set(key, {
      method: entry.request.method.toLowerCase(),
      pathTemplate: template,
      paramNames,
      entry,
    });
  }

  // Determine server base URL from first entry
  const firstUrl = new URL(entries[0].request.url);
  const serverUrl = `${firstUrl.protocol}//${firstUrl.host}`;

  // Always emit bearerAuth — the tool targets JWT-authenticated APIs.
  // The captured session may use cookies/profiles so the header won't always
  // appear in the HAR, but the spec should always document the auth scheme.

  // Build OpenAPI paths object
  const paths: Record<string, unknown> = {};

  for (const { method, pathTemplate, paramNames, entry } of groups.values()) {
    if (!paths[pathTemplate]) paths[pathTemplate] = {};

    const pathItem = paths[pathTemplate] as Record<string, unknown>;

    // Path parameters
    const parameters: unknown[] = paramNames.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    // Query parameters
    const urlObj = new URL(entry.request.url);
    for (const [k, v] of urlObj.searchParams) {
      parameters.push({
        name: k,
        in: 'query',
        required: false,
        schema: inferSchema(v),
        example: v,
      });
    }

    const requestBody = buildRequestBodySpec(entry.request.postData);

    const responseSchema = buildResponseSchema(entry.response.content.text);
    const responseContent = responseSchema
      ? { 'application/json': { schema: responseSchema } }
      : undefined;

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

    pathItem[method] = operation;
  }

  // Assemble spec
  const spec: Record<string, unknown> = {
    openapi: '3.0.3',
    info: {
      title: 'Captured API',
      version: '1.0.0',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
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
