/**
 * FormData capture via browser-side fetch/XHR monkey-patching.
 *
 * Root cause: Chrome's CDP (used by Playwright for HAR recording) does NOT
 * include request bodies for multipart/form-data uploads in the HAR — the
 * entry gets bodySize:0 and no postData, regardless of the `content` setting.
 * This is a browser-level limitation that cannot be worked around via HAR.
 *
 * Fix: inject a script into the page that patches window.fetch and
 * XMLHttpRequest.send BEFORE any requests fire, capturing FormData fields
 * (names, text values, file names) into window.__apiScannerFd[]. After the
 * journey we read that array from Node.js and merge it back into the HAR
 * entries that are missing postData.
 */

import type { BrowserContext } from 'playwright';
import type { HarEntry, HarPostDataParam } from './harFilter.js';

// ---------------------------------------------------------------------------
// Captured entry shape (serialisable, lives in the browser)
// ---------------------------------------------------------------------------

export interface CapturedFormEntry {
  url: string;
  method: string; // always uppercase
  timestamp: string; // ISO — when the request was initiated in the browser
  params: Array<{
    name: string;
    value?: string; // text fields
    fileName?: string; // file fields
    contentType?: string;
  }>;
  mimeType: string; // full content-type including boundary
}

// ---------------------------------------------------------------------------
// Browser injection script
// ---------------------------------------------------------------------------

/**
 * Returns a self-contained IIFE string to inject into the page.
 * Patches window.fetch and XMLHttpRequest to record FormData fields.
 */
export function getBrowserScript(): string {
  return `(function () {
  if (window.__apiScannerFd !== undefined) return;
  window.__apiScannerFd = [];
  window.__apiScannerErrors = [];

  function extractParams(formData, mimeType) {
    var params = [];
    try {
      formData.forEach(function (value, name) {
        if (typeof File !== 'undefined' && value instanceof File) {
          params.push({
            name: name,
            fileName: value.name || '<unnamed>',
            contentType: value.type || 'application/octet-stream',
          });
        } else {
          params.push({ name: name, value: String(value) });
        }
      });
    } catch (e) { window.__apiScannerErrors.push('extractParams: ' + String(e)); }
    return params;
  }

  // ── fetch ─────────────────────────────────────────────────────────────────
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var body = (init && init.body) || (input instanceof Request ? input.body : null);
      var method = (init && init.method) || (input instanceof Request ? input.method : 'POST');
      var headers = (init && init.headers) || (input instanceof Request ? input.headers : null);
      if (body instanceof FormData) {
        var url =
          typeof input === 'string'
            ? input
            : input instanceof URL
            ? input.href
            : input.url;
        // Resolve relative URLs against the current page origin
        if (url && !url.startsWith('http')) {
          try { url = new URL(url, window.location.href).href; } catch (e) {}
        }
        var ct = (headers && (headers['content-type'] || headers['Content-Type'])) || 'multipart/form-data';
        window.__apiScannerFd.push({
          url: url,
          method: (method || 'POST').toUpperCase(),
          timestamp: new Date().toISOString(),
          params: extractParams(body, ct),
          mimeType: ct,
        });
      }
    } catch (e) { window.__apiScannerErrors.push('fetch patch: ' + String(e)); }
    return _fetch.apply(this, arguments);
  };

  // ── XMLHttpRequest ────────────────────────────────────────────────────────
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      var resolved = url;
      if (resolved && !resolved.startsWith('http')) {
        try { resolved = new URL(resolved, window.location.href).href; } catch (e) {}
      }
      this._asFdMethod = String(method).toUpperCase();
      this._asFdUrl = String(resolved);
    } catch (e) { window.__apiScannerErrors.push('XHR open patch: ' + String(e)); }
    return _open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (body instanceof FormData && this._asFdUrl) {
        window.__apiScannerFd.push({
          url: this._asFdUrl,
          method: this._asFdMethod || 'POST',
          timestamp: new Date().toISOString(),
          params: extractParams(body, 'multipart/form-data'),
          mimeType: 'multipart/form-data',
        });
      }
    } catch (e) { window.__apiScannerErrors.push('XHR send patch: ' + String(e)); }
    return _send.apply(this, arguments);
  };
})();`;
}

// ---------------------------------------------------------------------------
// Inject into context (runs on every page load in the context)
// ---------------------------------------------------------------------------

export async function injectFormDataCapture(context: BrowserContext): Promise<void> {
  await context.addInitScript(getBrowserScript());
}

// ---------------------------------------------------------------------------
// Collect captured data from all open pages
// ---------------------------------------------------------------------------

export async function collectCapturedFormData(
  context: BrowserContext
): Promise<CapturedFormEntry[]> {
  const all: CapturedFormEntry[] = [];

  for (const page of context.pages()) {
    try {
      const raw: unknown = await page.evaluate('window.__apiScannerFd ?? []');
      const entries = Array.isArray(raw) ? raw as CapturedFormEntry[] : [];
      all.push(...entries);
      // Surface any browser-side capture errors back to Node
      const errs: string[] = await page.evaluate('window.__apiScannerErrors ?? []') as string[];
      for (const e of errs) console.warn(`  [formdata] WARNING: ${e}`);
    } catch {
      // page may have been closed
    }
  }

  return all;
}

// ---------------------------------------------------------------------------
// Merge captured FormData back into HAR entries missing postData
// ---------------------------------------------------------------------------

/**
 * For every HAR entry that has no postData (or empty params) AND whose
 * Content-Type header indicates multipart/form-data, find the matching
 * captured FormData entry and inject it.
 *
 * Correlation: method + URL exact match, timestamps within MATCH_WINDOW_MS.
 * Multiple calls to the same endpoint are matched FIFO (first captured →
 * first HAR entry by startedDateTime).
 */
// 15 s window accommodates slow API responses on flaky networks. The injected
// script captures the timestamp when the request fires; the HAR entry appears
// after the response completes. On very slow APIs this gap can exceed 10 s.
const MATCH_WINDOW_MS = 15_000;

export function mergeFormDataIntoHar(entries: HarEntry[], captured: CapturedFormEntry[]): void {
  if (captured.length === 0) return;

  // Build a FIFO queue per method+url key
  const queues = new Map<string, CapturedFormEntry[]>();
  for (const c of captured) {
    const key = `${c.method}:${c.url}`;
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key)!.push(c);
  }

  for (const entry of entries) {
    const { method, url, headers } = entry.request;

    // Only process entries that are missing postData or have no params
    const existingPd = entry.request.postData;
    if (existingPd?.params && existingPd.params.length > 0) continue;

    // Must have a multipart content-type header
    const ct = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
    if (!ct.toLowerCase().includes('multipart/form-data')) continue;

    const key = `${method.toUpperCase()}:${url}`;
    const queue = queues.get(key);
    if (!queue || queue.length === 0) continue;

    const harTs = new Date(entry.startedDateTime).getTime();

    // Find the first queued entry within the time window
    const idx = queue.findIndex((c) => {
      const diff = Math.abs(new Date(c.timestamp).getTime() - harTs);
      return diff <= MATCH_WINDOW_MS;
    });

    if (idx === -1) continue;

    const match = queue.splice(idx, 1)[0];

    // Build HarPostDataParam array
    const params: HarPostDataParam[] = match.params.map((p) => ({
      name: p.name,
      ...(p.value !== undefined ? { value: p.value } : {}),
      ...(p.fileName !== undefined ? { fileName: p.fileName } : {}),
      ...(p.contentType ? { contentType: p.contentType } : {}),
    }));

    entry.request.postData = {
      mimeType: ct, // keep the original content-type with boundary
      params,
      // text intentionally left empty — the boundary string had no body for
      // the file part and is useless for downstream tooling
    };
  }
}
