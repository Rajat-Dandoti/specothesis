import { listProfiles, listSessions } from '../session.js';

export function run(): void {
  const profiles = listProfiles();
  const sessions = listSessions();

  console.log('\n=== Saved Profiles ===');
  if (profiles.length === 0) {
    console.log('  (none)  — run: npm run capture -- login --url <url> --save-profile <name>');
  } else {
    profiles.forEach((p) => console.log(`  • ${p}`));
  }

  console.log('\n=== Recent Sessions ===');
  if (sessions.length === 0) {
    console.log('  (none)');
  } else {
    sessions.slice(0, 10).forEach((s) => console.log(`  • ${s}`));
  }
  console.log('');
}
