import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { PROFILES_DIR, listProfiles, getProfilePath } from '../session.js';

// ---------------------------------------------------------------------------
// specint profile <subcommand> [name]
// ---------------------------------------------------------------------------

export async function run(subcommand: string | undefined, name: string | undefined): Promise<void> {
  const cmd = subcommand ?? 'list';

  if (cmd === 'list') {
    runList();
  } else if (cmd === 'show') {
    runShow(name);
  } else if (cmd === 'delete') {
    await runDelete(name);
  } else {
    console.error(
      `Unknown profile subcommand '${cmd}'. Valid: list, show <name>, delete <name>`
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

function runList(): void {
  const profiles = listProfiles();

  if (profiles.length === 0) {
    console.log(
      '\n  No saved profiles.\n  Run: specint login --url <url> --save-profile <name>\n'
    );
    return;
  }

  console.log('\nSaved profiles:\n');
  for (const profileName of profiles) {
    const filePath = path.join(PROFILES_DIR, `${profileName}.json`);
    const stat = fs.statSync(filePath);
    const date = stat.mtime.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    console.log(`  • ${profileName.padEnd(24)} saved ${date}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

interface StorageOrigin {
  origin: string;
  localStorage?: Array<{ name: string; value: string }>;
}

interface StorageState {
  cookies?: Array<{ name: string; domain: string }>;
  origins?: StorageOrigin[];
}

function runShow(name: string | undefined): void {
  if (!name) {
    console.error('Usage: specint profile show <name>');
    process.exit(1);
  }

  const filePath = getProfilePath(name);
  if (!filePath) {
    console.error(`Profile '${name}' not found. Run 'specint profile list' to see saved profiles.`);
    process.exit(1);
  }

  let data: StorageState;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StorageState;
  } catch {
    console.error(`Could not read profile file: ${filePath}`);
    process.exit(1);
  }

  const stat = fs.statSync(filePath);
  console.log(`\nProfile: ${name}`);
  console.log(`File:    ${filePath}`);
  console.log(
    `Saved:   ${stat.mtime.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
  );

  const cookies = data.cookies ?? [];
  if (cookies.length > 0) {
    console.log(`\nCookies (${cookies.length} — names only, no values):`);
    for (const c of cookies) {
      console.log(`  • ${c.name}  [domain: ${c.domain}]`);
    }
  } else {
    console.log('\nCookies: none');
  }

  const origins = data.origins ?? [];
  for (const origin of origins) {
    const keys = (origin.localStorage ?? []).map((e) => e.name);
    if (keys.length > 0) {
      console.log(`\nlocalStorage @ ${origin.origin} (${keys.length} keys — names only):`);
      for (const k of keys) console.log(`  • ${k}`);
    }
  }

  if (origins.length === 0 && cookies.length === 0) {
    console.log('\n  (empty profile — no cookies or localStorage saved)');
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

async function runDelete(name: string | undefined): Promise<void> {
  if (!name) {
    console.error('Usage: specint profile delete <name>');
    process.exit(1);
  }

  const filePath = getProfilePath(name);
  if (!filePath) {
    console.error(`Profile '${name}' not found. Run 'specint profile list' to see saved profiles.`);
    process.exit(1);
  }

  const confirmed = await confirm(`  Delete profile '${name}'? [y/N] `);
  if (!confirmed) {
    console.log('  Cancelled — profile not deleted.');
    return;
  }

  fs.unlinkSync(filePath);
  console.log(`  Profile '${name}' deleted.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // Non-interactive (CI / piped): treat as no
      resolve(false);
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    process.stdout.write(question);

    let resolved = false;
    const done = (result: boolean) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    rl.on('line', (line) => {
      rl.close();
      done(line.trim().toLowerCase() === 'y');
    });

    rl.on('close', () => done(false));
  });
}
