/**
 * HAR enrichment for multipart/form-data entries.
 *
 * Playwright stores multipart bodies as raw boundary text in postData.text
 * and leaves postData.params empty. enrichHarEntries() parses that text and
 * populates params in-place so downstream code (toStepci, toOpenApi, toCurl)
 * can read structured fields without dealing with raw boundaries.
 */

import type { HarEntry, HarPostDataParam } from './harFilter.js';

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
