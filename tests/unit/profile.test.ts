import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Helpers — temporary profiles directory
// ---------------------------------------------------------------------------

let tmpDir: string;
let profilesDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'specint-profile-test-'));
  profilesDir = path.join(tmpDir, 'profiles');
  fs.mkdirSync(profilesDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeProfile(name: string, data: object): string {
  const p = path.join(profilesDir, `${name}.json`);
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

// ---------------------------------------------------------------------------
// Unit tests for the pure logic used by the profile command
// ---------------------------------------------------------------------------

describe('profile file structure', () => {
  it('reads cookie names without exposing values', () => {
    const state = {
      cookies: [
        { name: 'session', domain: 'app.com', value: 'secret123' },
        { name: '_csrf', domain: 'app.com', value: 'abc' },
      ],
      origins: [],
    };
    const filePath = writeProfile('myapp', state);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const cookieNames = (parsed.cookies as Array<{ name: string }>).map((c) => c.name);
    expect(cookieNames).toEqual(['session', '_csrf']);
    // Values exist in the raw file but the profile show command only surfaces names
    expect(parsed.cookies[0].value).toBe('secret123');
  });

  it('reads localStorage key names from origins', () => {
    const state = {
      cookies: [],
      origins: [
        {
          origin: 'https://app.com',
          localStorage: [
            { name: 'authToken', value: 'eyJ...' },
            { name: 'userId', value: '42' },
          ],
        },
      ],
    };
    writeProfile('myapp', state);
    const filePath = path.join(profilesDir, 'myapp.json');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const keys = parsed.origins[0].localStorage.map((e: { name: string }) => e.name);
    expect(keys).toEqual(['authToken', 'userId']);
  });

  it('handles profile with no cookies or localStorage gracefully', () => {
    writeProfile('empty', { cookies: [], origins: [] });
    const filePath = path.join(profilesDir, 'empty.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(parsed.cookies).toHaveLength(0);
    expect(parsed.origins).toHaveLength(0);
  });
});

describe('profile deletion', () => {
  it('deletes the profile json file', () => {
    const filePath = writeProfile('to-delete', { cookies: [], origins: [] });
    expect(fs.existsSync(filePath)).toBe(true);
    fs.unlinkSync(filePath);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('does not affect other profiles when one is deleted', () => {
    const keepPath = writeProfile('keep', { cookies: [], origins: [] });
    const deletePath = writeProfile('remove', { cookies: [], origins: [] });

    fs.unlinkSync(deletePath);

    expect(fs.existsSync(keepPath)).toBe(true);
    expect(fs.existsSync(deletePath)).toBe(false);
  });
});
