import type { HarEntry } from '../utils/harFilter.js';

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const METHOD_COLOR: Record<string, string> = {
  get: '#4caf50',
  post: '#ff9800',
  put: '#2196f3',
  delete: '#f44336',
  patch: '#9c27b0',
};

function methodColor(method: string): string {
  return METHOD_COLOR[method.toLowerCase()] ?? '#607d8b';
}

export interface WaterfallEntry {
  method: string;
  path: string;
  status: number;
  startOffsetMs: number;
  durationMs: number;
}

export function buildWaterfallEntries(entries: HarEntry[]): WaterfallEntry[] {
  if (entries.length === 0) return [];

  const parsed = entries.map((e) => {
    let path = e.request.url;
    try { path = new URL(e.request.url).pathname; } catch { /* keep full url */ }
    return {
      method: e.request.method,
      path,
      status: e.response.status,
      startMs: new Date(e.startedDateTime).getTime(),
      durationMs: Math.max(e.time, 1),
    };
  });

  const sessionStart = Math.min(...parsed.map((p) => p.startMs));
  return parsed.map((p) => ({
    method: p.method,
    path: p.path,
    status: p.status,
    startOffsetMs: p.startMs - sessionStart,
    durationMs: p.durationMs,
  }));
}

export function generateWaterfall(entries: HarEntry[]): string {
  const rows = buildWaterfallEntries(entries);
  if (rows.length === 0) return '';

  const LABEL_W = 270;
  const BAR_W = 480;
  const TOTAL_W = LABEL_W + BAR_W + 90;
  const ROW_H = 20;
  const PAD = 3;

  const totalMs = Math.max(...rows.map((r) => r.startOffsetMs + r.durationMs));
  const scale = (ms: number): number => (ms / (totalMs || 1)) * BAR_W;

  const rowSvg = rows
    .map((r, i) => {
      const x = scale(r.startOffsetMs);
      const w = Math.max(scale(r.durationMs), 2);
      const y = i * ROW_H;
      const color = methodColor(r.method);
      const label = `${r.method.toUpperCase()} ${r.path}`.slice(0, 44);
      const title = `${r.method} ${r.path} — ${Math.round(r.durationMs)}ms (t+${Math.round(r.startOffsetMs)}ms) ${r.status}`;
      const durLabel = r.durationMs >= 1000 ? `${(r.durationMs / 1000).toFixed(1)}s` : `${Math.round(r.durationMs)}ms`;
      return `<g transform="translate(0,${y})">
  <text x="${LABEL_W - 6}" y="${ROW_H / 2 + 4}" fill="#666" font-size="11" text-anchor="end" font-family="monospace">${esc(label)}</text>
  <rect x="${LABEL_W + x}" y="${PAD}" width="${w}" height="${ROW_H - PAD * 2}" fill="${color}" rx="1" opacity="0.85">
    <title>${esc(title)}</title>
  </rect>
  <text x="${LABEL_W + x + w + 4}" y="${ROW_H / 2 + 4}" fill="#444" font-size="10" font-family="monospace">${esc(durLabel)}</text>
</g>`;
    })
    .join('\n');

  // time axis labels
  const tickMs = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * totalMs));
  const axisY = rows.length * ROW_H + 4;
  const axisTicks = tickMs
    .map((ms) => {
      const x = LABEL_W + scale(ms);
      const label = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
      return `<text x="${x}" y="${axisY + 12}" fill="#444" font-size="10" font-family="monospace" text-anchor="middle">${esc(label)}</text>
<line x1="${x}" y1="${axisY}" x2="${x}" y2="${axisY + 4}" stroke="#333" stroke-width="1"/>`;
    })
    .join('\n');

  const height = rows.length * ROW_H + 24;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TOTAL_W} ${height}" width="100%" style="display:block">
${rowSvg}
<line x1="${LABEL_W}" y1="${axisY}" x2="${LABEL_W + BAR_W}" y2="${axisY}" stroke="#333" stroke-width="1"/>
${axisTicks}
</svg>`;
}
