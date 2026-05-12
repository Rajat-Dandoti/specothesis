/**
 * Demo automation script for Specothesis.
 *
 * Simulates a short API journey against JSONPlaceholder by navigating
 * to a simple HTML page that fires a few fetch() calls.
 *
 * Usage (called automatically by capture.ts --script):
 *   npm run capture -- --url https://jsonplaceholder.typicode.com --out demo --filter "https://jsonplaceholder.typicode.com/**" --headless --script scripts/demo-journey.ts
 */

import type { Page, BrowserContext } from 'playwright';
import type { ScannerConfig } from '../src/config.js';

export default async function journey(page: Page, _context: BrowserContext, config: ScannerConfig): Promise<void> {
  // config.username, config.password, config.authToken, config.apiKey,
  // and config.extras are all available here for login flows etc.
  // Example: await page.fill('#username', config.username ?? '');
  //          await page.fill('#password', config.password ?? '');
  // JSONPlaceholder's own page fires no fetch calls — inject a small script
  // that makes representative REST calls and wait for them all to complete.
  await page.evaluate(async () => {
    const base = 'https://jsonplaceholder.typicode.com';

    // GET /posts
    await fetch(`${base}/posts`);

    // GET /posts/1
    await fetch(`${base}/posts/1`);

    // GET /posts/1/comments
    await fetch(`${base}/posts/1/comments`);

    // GET /users
    await fetch(`${base}/users`);

    // GET /users/1
    await fetch(`${base}/users/1`);

    // POST /posts
    await fetch(`${base}/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test Post', body: 'Hello world', userId: 1 }),
    });

    // PUT /posts/1
    await fetch(`${base}/posts/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 1, title: 'Updated', body: 'Updated body', userId: 1 }),
    });

    // DELETE /posts/1
    await fetch(`${base}/posts/1`, { method: 'DELETE' });
  });

  // Small wait to ensure response listeners fire before context.close()
  await page.waitForTimeout(500);
}
