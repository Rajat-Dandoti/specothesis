import * as fs from 'fs';

export interface HarPostDataParam {
  name: string;
  value?: string; // present for text fields
  fileName?: string; // present for file upload parts
  contentType?: string; // MIME type of the part
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    postData?: {
      mimeType: string;
      text?: string; // empty for multipart — use params instead
      params?: HarPostDataParam[];
    };
    bodySize: number;
    headersSize: number;
  };
  response: {
    status: number;
    statusText: string;
    headers: Array<{ name: string; value: string }>;
    content: {
      size: number;
      mimeType: string;
      text?: string;
    };
    bodySize: number;
    headersSize: number;
  };
  _resourceType?: string;
}

export interface Har {
  log: {
    version: string;
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

/**
 * Converts a glob-style URL filter (e.g. "**\/api\/**") to a RegExp.
 * Supports * and ** wildcards only.
 */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*');
  return new RegExp(escaped);
}

/**
 * Read and parse a HAR file from disk.
 */
export function readHar(harPath: string): Har {
  const raw = fs.readFileSync(harPath, 'utf-8');
  return JSON.parse(raw) as Har;
}

/**
 * Filter HAR entries to only API-shaped calls:
 * - URL matches the provided glob filter
 * - resourceType is xhr, fetch, or other (excludes page navigations, static assets)
 *
 * NOTE: We deliberately do NOT filter by response MIME type.
 * API endpoints can return no body (201/204), text/plain, application/octet-stream,
 * or anything else — filtering on response type causes real endpoints to vanish.
 * The URL filter + resource type is enough to scope to API traffic.
 */
export function filterApiEntries(har: Har, urlFilter: string): HarEntry[] {
  const regex = globToRegex(urlFilter);

  return har.log.entries.filter((entry) => {
    const url = entry.request.url;

    if (!regex.test(url)) return false;

    // Exclude page navigations and browser-initiated static asset loads.
    // 'other' covers service-worker fetches and some XHR recorders.
    const resourceType = entry._resourceType;
    if (resourceType && !['xhr', 'fetch', 'other'].includes(resourceType)) return false;

    // Playwright records -1 for requests that never received an HTTP response
    // (network error, cancelled, preflight failure). No valid status = no useful data.
    if (entry.response.status < 100) return false;

    return true;
  });
}

/**
 * Further narrow a list of entries to only those that fall inside at least one
 * recording window (i.e. exclude requests made while the session was paused).
 *
 * If no windows are provided the original list is returned unchanged (backwards
 * compat with non-interactive / script-driven captures).
 */
export function filterByWindows(
  entries: HarEntry[],
  windows: Array<{ start: string; end: string }>
): HarEntry[] {
  if (windows.length === 0) return entries;

  return entries.filter((entry) => {
    const ts = new Date(entry.startedDateTime).getTime();
    return windows.some(
      (w) => ts >= new Date(w.start).getTime() && ts <= new Date(w.end).getTime()
    );
  });
}

/**
 * Deduplicate entries by exact request match: method + URL + body.
 *
 * Body fingerprint (evaluated after enrichHarEntries so multipart params
 * are already populated):
 *   - params present → stable JSON of params sorted by name
 *   - text present   → raw text
 *   - neither        → empty string
 *
 * First occurrence wins; subsequent identical requests are dropped.
 */
export function deduplicateEntries(entries: HarEntry[]): HarEntry[] {
  const seen = new Set<string>();
  const result: HarEntry[] = [];

  for (const entry of entries) {
    const { method, url, postData } = entry.request;

    let body = '';
    if (postData) {
      if (postData.params && postData.params.length > 0) {
        const sorted = [...postData.params].sort((a, b) => a.name.localeCompare(b.name));
        body = JSON.stringify(sorted);
      } else {
        body = postData.text ?? '';
      }
    }

    const key = `${method.toUpperCase()}:${url}:${body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }

  return result;
}

/**
 * Write a filtered HAR (subset of entries) to disk.
 */
export function writeFilteredHar(har: Har, entries: HarEntry[], outPath: string): void {
  const filtered: Har = {
    log: {
      ...har.log,
      entries,
    },
  };
  fs.writeFileSync(outPath, JSON.stringify(filtered, null, 2), 'utf-8');
}
