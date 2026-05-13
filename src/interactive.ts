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
        let windowStart = now();

        // Non-TTY (CI / piped input): auto-stop when stdin closes
        if (!process.stdin.isTTY) {
          const rl = readline.createInterface({ input: process.stdin, terminal: false });
          rl.on('close', () => {
            windows.push({ start: windowStart, end: now() });
            resolve(windows);
          });
          return;
        }

        let status: Status = 'recording';
        printStatus(status, sessionName, getRequestCount());

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          terminal: false,
        });

        rl.on('line', (raw) => {
          const cmd = raw.trim().toLowerCase();

          if (cmd === 'p' && status === 'recording') {
            windows.push({ start: windowStart, end: now() });
            status = 'paused';
            printStatus(status, sessionName, getRequestCount());
          } else if (cmd === 'r' && status === 'paused') {
            windowStart = now();
            status = 'recording';
            printStatus(status, sessionName, getRequestCount());
          } else if (cmd === 'q') {
            if (status === 'recording') {
              windows.push({ start: windowStart, end: now() });
            }
            console.log('\n  Stopping session...');
            rl.close();
            resolve(windows);
          } else {
            printStatus(status, sessionName, getRequestCount());
          }
        });

        rl.on('close', () => {
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
export function waitForSave(): Promise<{ saved: boolean }> {
  return new Promise((resolve) => {
    console.log(
      '\n  Log in to the app, then type  q  and press Enter to save your profile.\n' +
        '  Type  x  to cancel without saving.'
    );
    process.stdout.write('> ');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', (raw) => {
      const cmd = raw.trim().toLowerCase();
      if (cmd === 'q') {
        rl.close();
        resolve({ saved: true });
      } else if (cmd === 'x') {
        console.log('\n  Cancelled — no profile saved.');
        rl.close();
        resolve({ saved: false });
      } else {
        process.stdout.write('> ');
      }
    });

    rl.on('close', () => resolve({ saved: false }));
  });
}
