import * as fs from 'fs';
import * as path from 'path';
import type { ScannerConfig } from '../config.js';
import {
  readHar,
  filterApiEntries,
  deduplicateEntries,
} from '../utils/harFilter.js';
import { enrichHarEntries } from '../utils/harNormalize.js';
import { makeSessionDir } from '../session.js';
import { runPipeline } from '../pipeline.js';

export async function run(config: ScannerConfig, harPath: string): Promise<void> {
  if (!fs.existsSync(harPath)) {
    console.error(`Error: HAR file not found: ${harPath}`);
    process.exit(1);
  }

  const { urlFilter } = config;
  const sessionName =
    config.session || config.outName || path.basename(harPath, path.extname(harPath));
  const baseUrl = config.baseUrl || config.apiUrl || '';

  const runDir = makeSessionDir(sessionName);
  console.log(`\n=== Specothesis — Replay ===`);
  console.log(`  HAR:     ${harPath}`);
  console.log(`  Filter:  ${urlFilter}`);
  console.log(`  Output:  ${runDir}\n`);

  let har: ReturnType<typeof readHar>;
  try {
    har = readHar(harPath);
  } catch (err) {
    console.error(`\nError: could not read HAR file: ${harPath}`);
    console.error(`  ${err instanceof Error ? err.message : err}`);
    console.error(`  Run 'specint start' to capture a session, or export a HAR from`);
    console.error(`  Chrome DevTools (Network tab → right-click → Save all as HAR).`);
    process.exit(1);
  }

  let apiEntries = filterApiEntries(har, urlFilter, {
    captureFailedRequests: config.captureFailedRequests,
  });

  if (apiEntries.length === 0) {
    console.warn(`\n  No API entries matched the active filter: ${urlFilter}`);
    console.warn(`\n  Common fixes:`);
    console.warn(`    • Widen the filter:  specint replay --har ${harPath} --filter "**"`);
    console.warn(`    • Set SCANNER_URL_FILTER in .env to avoid passing --filter each time`);
    process.exit(0);
  }

  console.log(`  Filtered to ${apiEntries.length} API entries. Generating outputs...\n`);

  enrichHarEntries(apiEntries);

  if (config.features.dedup) {
    const before = apiEntries.length;
    apiEntries = deduplicateEntries(apiEntries);
    const dropped = before - apiEntries.length;
    if (dropped > 0) {
      console.log(`  Deduplicated: removed ${dropped} duplicate(s) (${apiEntries.length} unique remain).`);
    }
  }

  runPipeline({ apiEntries, har, sessionName, runDir, baseUrl, config });
}
