import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countLicenseKeys, decodeInput, LICENSE_KEY_PREFIX, recordOf } from '../scripts/count-license-keys.mjs';

/**
 * scripts/count-license-keys.mjs backs plan rule 2.15: the number of licence keys that are not
 * revoked must be the same before and after a production release. The script may only read.
 */

const SCRIPT = resolve(__dirname, '..', 'scripts', 'count-license-keys.mjs');
const SOURCE = readFileSync(SCRIPT, 'utf8');

/**
 * Anything that could change a file, a KV record or a remote system, or reach one at all.
 * Matched against the whole source, comments included.
 */
const WRITE_PATTERNS: Array<[string, RegExp]> = [
  ['the word put', /\bput\b/i],
  ['the word delete', /\bdelete\b/i],
  ['the word revoke', /\brevoke\b/i],
  ['a wrangler write command', /wrangler[^\n]*\b(put|delete|create|rename|execute|apply|deploy|rollback|restore)\b/i],
  ['an fs write', /\b(write|append|truncate|copy|rename|unlink|rm|rmdir|mkdir|mkdtemp|chmod|chown|symlink|link|utimes|cp)(File)?(Sync)?\s*\(/],
  ['a write stream or .write call', /createWriteStream|\.write\b/],
  ['fs opened for writing', /\bopen(Sync)?\s*\(/],
  ['a child process', /child_process|\bspawn|\bexec|\bfork\s*\(/],
  ['a network call', /\bfetch\s*\(|XMLHttpRequest|WebSocket|node:(http|https|net|tls|dgram|dns)\b|\brequire\s*\(/],
  ['dynamic code', /\beval\s*\(|new Function|\bimport\s*\(/],
];

function findWriteCalls(source: string): string[] {
  return WRITE_PATTERNS.filter(([, re]) => re.test(source)).map(([label]) => label);
}

const rec = (fields: Record<string, unknown>) => JSON.stringify({ plan: 'growth', durationDays: 3, isTrial: true, createdAt: 1, redeemed: false, ...fields });

/** Made-up records in the shape `wrangler kv bulk get` prints: name to stored text. None is a real key. */
const FIXTURE: Record<string, unknown> = {
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0001`]: rec({ key: 'LUM-FIXTURE-0001' }),
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0002`]: rec({ key: 'LUM-FIXTURE-0002' }),
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0003`]: rec({ key: 'LUM-FIXTURE-0003', revoked: false }),
  // Redeemed is not revoked: still counted.
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0004`]: rec({ key: 'LUM-FIXTURE-0004', redeemed: true, redemptionCount: 1 }),
  // The Worker refuses a key only when revoked is exactly true, so the count uses the same test.
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0005`]: rec({ key: 'LUM-FIXTURE-0005', revoked: 'true' }),
  // The { value, metadata } form.
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0006`]: { value: rec({ key: 'LUM-FIXTURE-0006' }), metadata: null },
  // An already-parsed record.
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0007`]: JSON.parse(rec({ key: 'LUM-FIXTURE-0007' })),
  // Revoked: not counted.
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0008`]: rec({ key: 'LUM-FIXTURE-0008', revoked: true, revokedAt: 2 }),
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0009`]: JSON.stringify({ key: 'LUM-FIXTURE-0009', revoked: true, revokedAt: 2 }),
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0010`]: { value: rec({ key: 'LUM-FIXTURE-0010', revoked: true }), metadata: null },
  // Not readable as a record, and no value at all: not counted, and reported.
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0011`]: 'this is not json',
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0012`]: '["an","array"]',
  [`${LICENSE_KEY_PREFIX}LUM-FIXTURE-0013`]: null,
  // Other records that share the namespace: ignored.
  'license:trial:claimed:acct_fixture': JSON.stringify({ key: 'LUM-FIXTURE-0001', redeemedAt: 1 }),
  'sub:acct_fixture': JSON.stringify({ plan: 'growth' }),
};
const EXPECTED_NOT_REVOKED = 7;

let dir = '';
let fixturePath = '';

function runCli(args: string[], input?: string | Buffer) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, input: input ?? '', encoding: 'utf8' });
}

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) out[name] = createHash('sha256').update(readFileSync(join(dir, name))).digest('hex');
  return out;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'count-license-keys-'));
  fixturePath = join(dir, 'records.json');
  writeFileSync(fixturePath, JSON.stringify(FIXTURE, null, 2));
});

afterAll(() => {
  try {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // A leftover temporary directory is not a test failure.
  }
});

describe('count-license-keys.mjs can only read', () => {
  it('has no write call of any kind in its source', () => {
    expect(findWriteCalls(SOURCE)).toEqual([]);
  });

  it('imports readFileSync and fileURLToPath, and nothing else', () => {
    const imports = SOURCE.split('\n').filter((line) => /^\s*import\b/.test(line));
    expect(imports).toEqual(["import { readFileSync } from 'node:fs';", "import { fileURLToPath } from 'node:url';"]);
    // Every use of the fs module goes through that one function.
    expect(SOURCE.match(/\b\w+Sync\b/g)?.every((name) => name === 'readFileSync')).toBe(true);
  });

  it('the source check itself catches each kind of write it is meant to catch', () => {
    const samples: Array<[string, string]> = [
      ['the word put', "await env.LUMINARA_KV.put(name, JSON.stringify(record));"],
      ['the word delete', 'await kv.delete(name);'],
      ['the word revoke', 'revoke(name);'],
      ['a wrangler write command', "run('npx wrangler kv bulk put file.json --remote');"],
      ['a wrangler write command', "run('npx wrangler d1 execute luminara-users --remote');"],
      ['an fs write', "writeFileSync('out.json', text);"],
      ['an fs write', "fs.appendFile('out.json', text, done);"],
      ['an fs write', "unlinkSync('records.json');"],
      ['a write stream or .write call', 'process.stdout.write(String(count));'],
      ['fs opened for writing', "const fd = openSync('out.json', 'w');"],
      ['a child process', "import { spawnSync } from 'node:child_process';"],
      ['a child process', "execFileSync('npx', ['wrangler']);"],
      ['a network call', "await fetch('https://api.cloudflare.com/client/v4/');"],
      ['dynamic code', "const fs = await import('node:fs');"],
    ];
    for (const [label, line] of samples) {
      expect(findWriteCalls(`${SOURCE}\n${line}\n`), line).toContain(label);
    }
  });
});

describe('count-license-keys.mjs counts the records that are not revoked', () => {
  it('counts the fixture', () => {
    expect(countLicenseKeys([FIXTURE])).toEqual({ total: 13, notRevoked: EXPECTED_NOT_REVOKED, revoked: 3, noValue: 1, unreadable: 2, ignored: 2 });
  });

  it('treats revoked exactly as the Worker does: only `revoked === true` stops a redemption', () => {
    const worker = readFileSync(resolve(__dirname, '..', 'worker', 'licenseService.ts'), 'utf8');
    expect(worker).toContain('keyRecord.revoked === true');
    expect(worker).toContain('`license:key:${key}`');
    expect(SOURCE).toContain('record.revoked === true');
    expect(LICENSE_KEY_PREFIX).toBe('license:key:');
  });

  it('reads a stored record whether it arrives as text, wrapped, or already parsed', () => {
    expect(recordOf('{"key":"K","revoked":true}')).toEqual({ key: 'K', revoked: true });
    expect(recordOf({ value: '{"key":"K"}', metadata: null })).toEqual({ key: 'K' });
    expect(recordOf({ key: 'K', value: 'kept: this is a record, not a wrapper' })).toMatchObject({ key: 'K' });
    expect(recordOf('nope')).toBeNull();
    expect(recordOf('7')).toBeNull();
    expect(recordOf(null)).toBeNull();
  });

  it('accepts an array of { name, value } or { key, value } and counts a record named twice once', () => {
    const name = (n: number) => `${LICENSE_KEY_PREFIX}LUM-FIXTURE-A${n}`;
    const first = [{ name: name(1), value: rec({}) }, { key: name(2), value: rec({ revoked: true }) }];
    const second = [{ name: name(1), value: rec({}) }, { name: name(3), value: rec({}) }];
    expect(countLicenseKeys([first, second])).toMatchObject({ total: 3, notRevoked: 2, revoked: 1 });
  });

  it('refuses input that is not a list of records', () => {
    expect(() => countLicenseKeys(['text'])).toThrow();
    expect(() => countLicenseKeys([[42]])).toThrow();
    expect(() => countLicenseKeys([null])).toThrow();
  });
});

describe('count-license-keys.mjs as the owner runs it', () => {
  it('prints one number for a records file, names no key, and leaves the directory as it found it', () => {
    const before = snapshot();
    const res = runCli([fixturePath]);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(`${EXPECTED_NOT_REVOKED}\n`);
    expect(res.stderr).toMatch(/1 record\(s\) had no value/);
    expect(res.stderr).toMatch(/2 record\(s\) could not be read/);
    expect(res.stderr).not.toMatch(/LUM-FIXTURE/);
    expect(snapshot()).toEqual(before);
    expect(Object.keys(before)).toEqual(['records.json']);
  });

  it('prints the same number when the records are piped in', () => {
    const res = runCli([], JSON.stringify(FIXTURE));
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(`${EXPECTED_NOT_REVOKED}\n`);
  });

  it('exits 1 with an empty stdout when given the key list instead of the records', () => {
    const namesOnly = Object.keys(FIXTURE).map((name) => ({ name }));
    const res = runCli([], JSON.stringify(namesOnly));
    expect(res.status).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toMatch(/holds no values/);
    expect(res.stderr).not.toMatch(/LUM-FIXTURE/);
  });

  it('exits 1 with an empty stdout when the input is not JSON or the file is missing', () => {
    const notJson = runCli([], 'Authentication error [code: 10000]');
    expect(notJson.status).toBe(1);
    expect(notJson.stdout).toBe('');
    const missing = runCli([join(dir, 'no-such-file.json')]);
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe('');
  });
});

describe('count-license-keys.mjs input decoding', () => {
  it('reads UTF-8 with a byte order mark and UTF-16 as Windows PowerShell redirects it', () => {
    const text = JSON.stringify(FIXTURE);
    const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    for (const buffer of [Buffer.from(text, 'utf8'), utf8Bom, utf16]) {
      expect(countLicenseKeys([JSON.parse(decodeInput(buffer))]).notRevoked).toBe(EXPECTED_NOT_REVOKED);
    }
  });
});
