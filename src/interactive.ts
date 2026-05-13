/**
 * Interactive terminal loop for pause / resume / stop during a capture session.
 *
 * Usage:
 *   const loop = startInteractiveLoop('checkout', () => requestCount);
 *   const windows = await loop.waitForStop();
 *   // windows = [{start, end}, {start, end}, ...]  (paused gaps are gaps between windows)
 *
 * Terminal UX:
 *   ● RECORDING  |  session: "checkout"  |  8 requests
 *   Commands:  p = pause   q = stop
 *   > p
 *   ⏸ PAUSED  |  session: "checkout"  |  8 requests captured so far
 *   Commands:  r = resume   q = stop
 *   > r
 *   ● RECORDING  |  session: "checkout"  |  8 requests
 *   Commands:  p = pause   q = stop
 *   > q
 *   Stopping...
 */

import * as readline from 'readline';

export interface RecordingWindow {
  start: string; // ISO timestamp when recording started / resumed
  end: string; // ISO timestamp when paused / stopped
}

type Status = 'recording' | 'paused';

export interface InteractiveLoop {
  /** Resolves with completed recording windows when the user types 'q'. */
  waitForStop(): Promise<RecordingWindow[]>;
}

function now(): string {
  return new Date().toISOString();
}

function printStatus(status: Status, sessionName: string, count: number): void {
  const indicator = status === 'recording' ? '● RECORDING' : '⏸ PAUSED';
  const cmds =
    status === 'recording' ? 'Commands:  p = pause   q = stop' : 'Commands:  r = resume  q = stop';

  console.log(`\n  ${indicator}  |  session: "${sessionName}"  |  ${count} requests captured`);
  console.log(`  ${cmds}`);
  process.stdout.write('> ');
}

export function startInteractiveLoop(
  sessionName: string,
  getRequestCount: () => number
): InteractiveLoop {
  return {
    waitForStop(): Promise<RecordingWindow[]> {
      return new Promise((resolve) => {
        const windows: RecordingWindow[] = [];
        let status: Status = 'recording';
        let windowStart = now();

        printStatus(status, sessionName, getRequestCount());

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: false,
        });

        rl.on('line', (raw) => {
          const cmd = raw.trim().toLowerCase();

          if (cmd === 'p' && status === 'recording') {
            // Close the current recording window
            windows.push({ start: windowStart, end: now() });
            status = 'paused';
            printStatus(status, sessionName, getRequestCount());
          } else if (cmd === 'r' && status === 'paused') {
            // Open a new recording window
            windowStart = now();
            status = 'recording';
            printStatus(status, sessionName, getRequestCount());
          } else if (cmd === 'q') {
            // Close current window if still recording
            if (status === 'recording') {
              windows.push({ start: windowStart, end: now() });
            }
            console.log('\n  Stopping session...');
            rl.close();
            resolve(windows);
          } else {
            // Unknown command — re-print the prompt
            printStatus(status, sessionName, getRequestCount());
          }
        });

        rl.on('close', () => {
          // stdin closed without 'q' (e.g. piped input ended)
          if (status === 'recording') {
            windows.push({ start: windowStart, end: now() });
          }
          resolve(windows);
        });
      });
    },
  };
}

/**
 * Simpler version used during the login command — just waits for 'q'.
 */
export function waitForSave(): Promise<void> {
  return new Promise((resolve) => {
    console.log('\n  Log in to the app, then type  q  and press Enter to save your profile.');
    process.stdout.write('> ');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', (raw) => {
      if (raw.trim().toLowerCase() === 'q') {
        rl.close();
        resolve();
      } else {
        process.stdout.write('> ');
      }
    });

    rl.on('close', () => resolve());
  });
}
