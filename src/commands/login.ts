import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import type { ScannerConfig } from '../config.js';
import { saveProfile } from '../session.js';
import { waitForSave } from '../interactive.js';

export async function run(config: ScannerConfig): Promise<void> {
  const { baseUrl, headless } = config;
  const profileName = config.saveProfile;

  if (!baseUrl) {
    console.error('Error: --url is required for the login command');
    process.exit(1);
  }
  if (!profileName) {
    console.error('Error: --save-profile <name> is required for the login command');
    process.exit(1);
  }

  console.log(`\n=== Specothesis — Login ===`);
  console.log(`  URL:     ${baseUrl}`);
  console.log(`  Profile: ${profileName}`);
  console.log('');

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const { saved } = await waitForSave();

  if (!saved) {
    await context.close();
    await browser.close();
    return;
  }

  // Save auth state before closing
  const tmpPath = path.join(process.cwd(), `.profile-tmp-${Date.now()}.json`);
  await context.storageState({ path: tmpPath });
  await context.close();
  await browser.close();

  const savedPath = saveProfile(profileName, tmpPath);
  fs.unlinkSync(tmpPath);

  console.log(`\n  Profile saved: ${savedPath}`);
  console.log(`\n  Use it with:`);
  console.log(
    `    npm run capture -- start --url ${baseUrl} --profile ${profileName} --session <session-name>\n`
  );
}
