import * as fs from 'fs';
import * as path from 'path';
import type { HarEntry } from '../utils/harFilter.js';

// ---------------------------------------------------------------------------
// Header policy: preserve all non-noisy headers; replace Authorization value
// ---------------------------------------------------------------------------

const SKIP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'accept-language',
  'origin',
  'referer',
  'user-agent',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'cookie',
]);

function buildHeaders(headers: Array<{ name: string; value: string }>): string[] {
  return headers
    .filter((h) => !SKIP_HEADERS.has(h.name.toLowerCase()))
    .map((h) => {
      if (h.name.toLowerCase() === 'authorization') {
        return `-H 'Authorization: $SCANNER_AUTH_TOKEN'`;
      }
      return `-H ${shellQuote(`${h.name}: ${h.value}`)}`;
    });
}

// ---------------------------------------------------------------------------
// Body flags
// ---------------------------------------------------------------------------

function bodyFlags(postData: HarEntry['request']['postData']): string[] {
  if (!postData) return [];

  const mime = postData.mimeType ?? '';

  if (mime.toLowerCase().includes('multipart/form-data')) {
    const params = postData.params ?? [];
    if (params.length === 0)
      return postData.text ? [`--data-raw ${shellQuote(postData.text)}`] : [];
    return params.map((p) =>
      p.fileName
        ? `-F ${shellQuote(`${p.name}=@<path/to/${p.fileName}>`)}`
        : `-F ${shellQuote(`${p.name}=${p.value ?? ''}`)}`
    );
  }

  if (mime.toLowerCase().includes('application/json')) {
    const body = postData.text ?? '';
    return [`-H 'Content-Type: application/json'`, `--data-raw ${shellQuote(body)}`];
  }

  if (mime.toLowerCase().includes('application/x-www-form-urlencoded')) {
    const params = postData.params ?? [];
    if (params.length > 0) {
      return params.map((p) => `--data-urlencode ${shellQuote(`${p.name}=${p.value ?? ''}`)}`);
    }
    if (postData.text) return [`-d ${shellQuote(postData.text)}`];
    return [];
  }

  return postData.text ? [`--data-raw ${shellQuote(postData.text)}`] : [];
}

/** Single-quote a string for POSIX shell, escaping any single quotes inside. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Build one curl command
// ---------------------------------------------------------------------------

function toCurlCommand(entry: HarEntry): string {
  const { method, url, headers, postData } = entry.request;

  const flags: string[] = [`curl -sS -X ${method}`];

  flags.push(...buildHeaders(headers));
  flags.push(...bodyFlags(postData));
  flags.push(shellQuote(url));

  return flags.join(' \\\n  ');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Write one .sh per entry + a combined requests.sh into outDir/curls/. */
export function toCurl(entries: HarEntry[], outDir: string): void {
  const curlsDir = path.join(outDir, 'curls');
  fs.mkdirSync(curlsDir, { recursive: true });

  const combined: string[] = ['#!/usr/bin/env bash', ''];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const urlObj = new URL(entry.request.url);

    // Build a filesystem-safe slug from the path
    const slug =
      urlObj.pathname
        .replace(/^\//, '')
        .replace(/\//g, '_')
        .replace(/[^a-zA-Z0-9_.-]/g, '') || 'root';
    const num = String(i + 1).padStart(3, '0');
    const fileName = `${num}_${entry.request.method}_${slug}.sh`;

    const cmd = toCurlCommand(entry);
    const shContent = `#!/usr/bin/env bash\n\n${cmd}\n`;

    fs.writeFileSync(path.join(curlsDir, fileName), shContent, 'utf-8');

    combined.push(`# ${num} ${entry.request.method} ${urlObj.pathname}`);
    combined.push(cmd);
    combined.push('');
  }

  fs.writeFileSync(path.join(curlsDir, 'requests.sh'), combined.join('\n'), 'utf-8');

  console.log(`  [curl]    ${curlsDir}/ (${entries.length} requests + requests.sh)`);
}
