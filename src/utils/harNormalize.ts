/**
 * HAR enrichment for multipart/form-data entries.
 *
 * Playwright stores multipart bodies as raw boundary text in postData.text
 * and leaves postData.params empty. enrichHarEntries() parses that text and
 * populates params in-place so downstream code (toStepci, toOpenApi, toCurl)
 * can read structured fields without dealing with raw boundaries.
 */

import type { HarEntry, HarPostDataParam, Har } from './harFilter.js';

export interface ResourceTypeRecord {
  method: string;
  url: string;
  type: string;
}

/**
 * Playwright 1.x does not write _resourceType into HAR files.
 * Back-fill it from live request-event captures so filterApiEntries() can filter correctly.
 * Uses order-preserving bucket matching for duplicate method+url pairs.
 */
export function injectResourceTypes(har: Har, records: ResourceTypeRecord[]): void {
  const buckets = new Map<string, string[]>();
  for (const { method, url, type } of records) {
    const key = `${method.toUpperCase()}:${url}`;
    const arr = buckets.get(key);
    if (arr) arr.push(type);
    else buckets.set(key, [type]);
  }

  const consumed = new Map<string, number>();
  for (const entry of har.log.entries) {
    const key = `${entry.request.method.toUpperCase()}:${entry.request.url}`;
    const types = buckets.get(key);
    if (!types) continue;
    const idx = consumed.get(key) ?? 0;
    entry._resourceType = types[Math.min(idx, types.length - 1)];
    consumed.set(key, idx + 1);
  }
}

// ---------------------------------------------------------------------------
// Multipart boundary text parser
// ---------------------------------------------------------------------------

/**
 * Extract the boundary token from a multipart Content-Type string.
 * e.g. "multipart/form-data; boundary=----WebKitFormBoundaryXXX"
 *   →  "----WebKitFormBoundaryXXX"
 */
export function extractBoundary(mimeType: string): string | undefined {
  const m = mimeType.match(/boundary=([^\s;]+)/i);
  return m?.[1];
}

/**
 * Parse a raw multipart/form-data body string into structured params.
 */
export function parseMultipartText(text: string, boundary: string): HarPostDataParam[] {
  const params: HarPostDataParam[] = [];
  const delimiter = `--${boundary}`;

  const parts = text.split(delimiter);

  for (const part of parts) {
    const trimmed = part.trimStart();
    if (trimmed === '' || trimmed.startsWith('--')) continue;

    const headerBodySep = part.indexOf('\r\n\r\n');
    if (headerBodySep === -1) continue;

    const headerBlock = part.slice(0, headerBodySep);
    const body = part.slice(headerBodySep + 4).replace(/\r\n$/, '');

    const dispositionMatch = headerBlock.match(
      /Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i
    );
    if (!dispositionMatch) continue;

    const name = dispositionMatch[1];
    const fileName = dispositionMatch[2] ?? undefined;

    const ctMatch = headerBlock.match(/Content-Type:\s*([^\r\n]+)/i);
    const contentType = ctMatch?.[1]?.trim();

    params.push({
      name,
      value: fileName !== undefined ? undefined : body,
      ...(fileName !== undefined ? { fileName } : {}),
      ...(contentType ? { contentType } : {}),
    });
  }

  return params;
}

// ---------------------------------------------------------------------------
// Enrich entries in place
// ---------------------------------------------------------------------------

/**
 * For each multipart entry with empty params but a populated text boundary,
 * parse the boundary text and write the result into postData.params.
 */
export function enrichHarEntries(entries: HarEntry[]): void {
  for (const entry of entries) {
    const pd = entry.request.postData;
    if (!pd) continue;

    const mime = pd.mimeType ?? '';
    if (!mime.toLowerCase().includes('multipart/form-data')) continue;

    if (pd.params && pd.params.length > 0) continue;

    if (pd.text) {
      const boundary = extractBoundary(mime);
      if (boundary) {
        const parsed = parseMultipartText(pd.text, boundary);
        if (parsed.length > 0) pd.params = parsed;
      }
    }
  }
}
