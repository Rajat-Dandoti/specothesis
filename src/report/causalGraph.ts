import * as fs from 'fs';
import * as path from 'path';
import type { HarEntry } from '../utils/harFilter.js';
import { ID_SEGMENT } from '../utils/pathNormalise.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CausalNode {
  index: number;
  method: string;
  path: string;
  status: number;
}

export interface CausalEdge {
  from: number;
  to: number;
  value: string;
  sourceField: string;          // JSON path in source response, e.g. "$.userId"
  targetLocation: 'path' | 'query' | 'body';
}

export interface CausalGraph {
  nodes: CausalNode[];
  edges: CausalEdge[];
}

// ---------------------------------------------------------------------------
// Value token extraction
// ---------------------------------------------------------------------------

interface ValueToken {
  value: string;
  jsonPath: string;
}

const ID_KEY = /id|key|ref|token|pk|fk|uuid|guid/i;

function isNumericId(value: number, parentKey: string): boolean {
  return Number.isInteger(value) && value > 0 && ID_KEY.test(parentKey);
}

function isStringId(value: string): boolean {
  return ID_SEGMENT.test(value) && value.length >= 3;
}

function extractTokens(obj: unknown, prefix = '$', parentKey = '', depth = 0): ValueToken[] {
  if (depth > 6) return [];
  const tokens: ValueToken[] = [];

  if (typeof obj === 'number' && isNumericId(obj, parentKey)) {
    tokens.push({ value: String(obj), jsonPath: prefix });
    return tokens;
  }
  if (typeof obj === 'string' && isStringId(obj)) {
    tokens.push({ value: obj, jsonPath: prefix });
    return tokens;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 5); i++) {
      tokens.push(...extractTokens(obj[i], `${prefix}[${i}]`, parentKey, depth + 1));
    }
    return tokens;
  }

  if (obj !== null && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      tokens.push(...extractTokens(val, `${prefix}.${key}`, key, depth + 1));
    }
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Request matching
// ---------------------------------------------------------------------------

function matchInRequest(entry: HarEntry, value: string): 'path' | 'query' | 'body' | null {
  try {
    const u = new URL(entry.request.url);

    // Path segments
    if (u.pathname.split('/').includes(value)) return 'path';

    // Query params
    for (const v of u.searchParams.values()) {
      if (v === value) return 'query';
    }
  } catch { /* skip */ }

  // Body text (JSON or form-encoded)
  const bodyText = entry.request.postData?.text;
  if (bodyText && bodyText.includes(value)) return 'body';

  return null;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildCausalGraph(entries: HarEntry[]): CausalGraph {
  // Sort by start time so causality flows forward
  const sorted = [...entries].sort(
    (a, b) => new Date(a.startedDateTime).getTime() - new Date(b.startedDateTime).getTime()
  );

  const nodes: CausalNode[] = sorted.map((e, i) => {
    let p = e.request.url;
    try { p = new URL(e.request.url).pathname; } catch { /* keep */ }
    return { index: i, method: e.request.method.toUpperCase(), path: p, status: e.response.status };
  });

  const edges: CausalEdge[] = [];
  const seenEdges = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const source = sorted[i];

    // Only extract tokens from successful responses
    if (source.response.status >= 400) continue;

    let parsed: unknown;
    try {
      const text = source.response.content.text;
      if (!text) continue;
      parsed = JSON.parse(text);
    } catch { continue; }

    const tokens = extractTokens(parsed);
    if (tokens.length === 0) continue;

    // Check all subsequent entries
    for (let j = i + 1; j < sorted.length; j++) {
      const target = sorted[j];
      for (const token of tokens) {
        const loc = matchInRequest(target, token.value);
        if (!loc) continue;

        // Deduplicate: same from→to→value→location
        const key = `${i}:${j}:${token.value}:${loc}`;
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);

        edges.push({ from: i, to: j, value: token.value, sourceField: token.jsonPath, targetLocation: loc });
        break; // one edge per (source, target) pair per token is enough
      }
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function writeCausalGraph(graph: CausalGraph, outDir: string): void {
  const outPath = path.join(outDir, 'causal-graph.json');
  fs.writeFileSync(outPath, JSON.stringify(graph, null, 2), 'utf-8');
  console.log(`  [causal]   ${outPath}`);
}

export function printCausalGraph(graph: CausalGraph): void {
  if (graph.edges.length === 0) return;

  // Group edges by source node and print unique downstream targets
  const bySource = new Map<number, CausalEdge[]>();
  for (const e of graph.edges) {
    const list = bySource.get(e.from) ?? [];
    list.push(e);
    bySource.set(e.from, list);
  }

  console.log(`  ⇢  ${graph.edges.length} causal data flow link${graph.edges.length !== 1 ? 's' : ''} detected`);
  for (const [fromIdx, edgeList] of bySource) {
    const src = graph.nodes[fromIdx];
    const targets = [...new Set(edgeList.map((e) => e.to))];
    const targetStr = targets.map((t) => `${graph.nodes[t].method} ${graph.nodes[t].path}`).join(', ');
    console.log(`  ${src.method} ${src.path} → ${targetStr}`);
  }
}
