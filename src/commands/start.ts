import * as path from 'path';
import { chromium } from 'playwright';
import type { ScannerConfig } from '../config.js';
import { validateConfig } from '../config.js';
import { CaptureError } from '../errors.js';
import {
  readHar,
  filterApiEntries,
  filterByWindows,
  deduplicateEntries,
} from '../utils/harFilter.js';
import { enrichHarEntries, injectResourceTypes, type ResourceTypeRecord } from '../utils/harNormalize.js';
import {
  injectFormDataCapture,
  collectCapturedFormData,
  mergeFormDataIntoHar,
} from '../utils/formDataCapture.js';
import { getProfilePath, makeSessionDir } from '../session.js';
import { startInteractiveLoop } from '../interactive.js';
import type { RecordingWindow } from '../interactive.js';
import { runPipeline } from '../pipeline.js';

export async function run(config: ScannerConfig): Promise<void> {
  validateConfig(config);

  const { baseUrl, urlFilter, headless, scriptPath } = config;
  const sessionName =
    config.session || config.outName || (baseUrl ? new URL(baseUrl).hostname : 'session');
  const profileName = config.profile;

  // Resolve profile path
  let profilePath: string | undefined;
  if (profileName) {
    profilePath = getProfilePath(profileName);
    if (!profilePath) {
      console.error(
        `Error: profile "${profileName}" not found. Run: npm run capture -- login --url ${baseUrl} --save-profile ${profileName}`
      );
      process.exit(1);
    }
  }

  const runDir = makeSessionDir(sessionName);
  const harPath = path.join(runDir, 'raw.har');


  console.log(`\n=== Specothesis — Session: "${sessionName}" ===`);
  console.log(`  URL:     ${baseUrl}`);
  console.log(`  Filter:  ${urlFilter}`);
  if (profileName) console.log(`  Profile: ${profileName}`);
  if (config.username) {
    const displayUser = process.stdout.isTTY ? config.username : '***';
    console.log(`  User:    ${displayUser}`);
  }
  console.log(`  Output:  ${runDir}`);
  console.log('');

  // -------------------------------------------------------------------------
  // Launch browser
  // -------------------------------------------------------------------------

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    ...(profilePath ? { storageState: profilePath } : {}),
    recordHar: {
      path: harPath,
      urlFilter,
      content: 'embed',
    },
  });

  // Inject FormData capture script — catches multipart bodies that CDP/HAR misses
  await injectFormDataCapture(context);

  const page = await context.newPage();

  let requestCount = 0;
  const resourceTypeRecords: ResourceTypeRecord[] = [];
  page.on('request', (req) => {
    resourceTypeRecords.push({ method: req.method(), url: req.url(), type: req.resourceType() });
    if (['xhr', 'fetch'].includes(req.resourceType())) {
      requestCount++;
      if (!config.quiet) console.log(`  [req] ${req.method()} ${req.url()}`);
    }
  });
  page.on('response', (res) => {
    try {
      if (['xhr', 'fetch'].includes(res.request().resourceType())) {
        if (!config.quiet) console.log(`  [res] ${res.status()} ${res.url()}`);
      }
    } catch {
      // res.request() can throw if the request was GC'd during navigation — safe to ignore
    }
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    await browser.close();
    throw new CaptureError(`Could not reach "${baseUrl}". Is the server running?\n  ${err instanceof Error ? err.message : err}`);
  }

  // -------------------------------------------------------------------------
  // Journey
  // -------------------------------------------------------------------------

  let recordingWindows: RecordingWindow[] = [];

  if (scriptPath) {
    // Automated script — no interactive controls
    console.log(`\nRunning automation script: ${scriptPath}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let script: any;
    try {
      script = await import(path.resolve(scriptPath));
    } catch (err) {
      await browser.close();
      throw new CaptureError(
        `Could not load script: ${scriptPath}\n  ${err instanceof Error ? err.message : err}\n  Check the file exists and has no syntax errors.`
      );
    }
    const fn = script.default || script;
    try {
      await fn(page, context, config);
    } catch (err) {
      await browser.close();
      throw new CaptureError(
        `Script failed during execution: ${err instanceof Error ? err.message : err}`
      );
    }
    console.log('Script completed.');
  } else {
    // Manual journey with interactive pause / resume / stop
    const loop = startInteractiveLoop(sessionName, () => requestCount);
    recordingWindows = await loop.waitForStop();
  }

  // -------------------------------------------------------------------------
  // Collect FormData captures before flushing (CDP won't have these bodies)
  // -------------------------------------------------------------------------

  const capturedFormData = await collectCapturedFormData(context);
  if (capturedFormData.length > 0) {
    console.log(`\n  Captured ${capturedFormData.length} FormData request(s) via JS intercept.`);
  }

  // -------------------------------------------------------------------------
  // Flush HAR and close
  // -------------------------------------------------------------------------

  await context.close();
  await browser.close();

  console.log(`\n  Captured ${requestCount} XHR/fetch requests (browser total).`);
  if (recordingWindows.length > 0) {
    console.log(
      `  Recording windows: ${recordingWindows.length} (paused ${recordingWindows.length - 1 > 0 ? recordingWindows.length - 1 + ' time(s)' : '0 times'})`
    );
  }
  console.log(`  Raw HAR: ${harPath}`);

  // -------------------------------------------------------------------------
  // Post-processing
  // -------------------------------------------------------------------------

  const har = readHar(harPath);
  if (!config.captureAllResourceTypes) {
    injectResourceTypes(har, resourceTypeRecords);
  }
  let apiEntries = filterApiEntries(har, urlFilter, {
    captureFailedRequests: config.captureFailedRequests,
    captureAllResourceTypes: config.captureAllResourceTypes,
  });

  // Apply recording-window filter (excludes requests made while paused)
  apiEntries = filterByWindows(apiEntries, recordingWindows);

  if (apiEntries.length === 0) {
    console.warn(`\n  No API entries matched the active filter: ${urlFilter}`);
    console.warn(`\n  Common fixes:`);
    console.warn(`    • Widen the filter:  specint start --filter "**"`);
    console.warn(`    • Match /v1/ paths:  specint start --filter "**/v1/**"`);
    console.warn(`    • Match by host:     specint start --filter "https://api.example.com/**"`);
    console.warn(`    • Verify your app makes XHR/fetch calls (not only page navigations)`);
    console.warn(`    • Set SCANNER_URL_FILTER in .env to avoid passing --filter each time`);
    process.exit(0);
  }

  console.log(`\n  Filtered to ${apiEntries.length} API entries. Generating outputs...\n`);

  // Merge JS-captured FormData into HAR entries missing postData
  mergeFormDataIntoHar(apiEntries, capturedFormData);

  enrichHarEntries(apiEntries);

  if (config.features.dedup) {
    const before = apiEntries.length;
    apiEntries = deduplicateEntries(apiEntries);
    const dropped = before - apiEntries.length;
    if (dropped > 0) {
      console.log(
        `  Deduplicated: removed ${dropped} duplicate request(s) (${apiEntries.length} unique remain).`
      );
    }
  }

  runPipeline({ apiEntries, har, sessionName, runDir, baseUrl, config });
}
