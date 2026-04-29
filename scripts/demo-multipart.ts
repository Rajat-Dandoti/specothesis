/**
 * Demo script that fires a multipart/form-data POST so we can verify
 * the multipart capture fix works end-to-end.
 *
 * Uses httpbin.org which mirrors back exactly what it receives.
 */

import type { Page, BrowserContext } from 'playwright';
import type { ScannerConfig } from '../src/config.js';

export default async function journey(page: Page, _context: BrowserContext, _config: ScannerConfig): Promise<void> {
  await page.evaluate(async () => {
    const base = 'https://httpbin.org';

    // ── regular JSON POST (baseline) ─────────────────────────────────────────
    await fetch(`${base}/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice', role: 'admin' }),
    });

    // ── multipart/form-data POST with text fields ─────────────────────────────
    const formText = new FormData();
    formText.append('username', 'alice');
    formText.append('email', 'alice@example.com');
    formText.append('age', '30');
    await fetch(`${base}/post`, {
      method: 'POST',
      body: formText,
    });

    // ── multipart/form-data POST with a file field ────────────────────────────
    const formFile = new FormData();
    formFile.append('title', 'My document');
    formFile.append(
      'attachment',
      new Blob(['hello file content'], { type: 'text/plain' }),
      'hello.txt'
    );
    await fetch(`${base}/post`, {
      method: 'POST',
      body: formFile,
    });

    // ── GET for comparison ────────────────────────────────────────────────────
    await fetch(`${base}/get?status=active&page=1`);
  });

  await page.waitForTimeout(800);
}
