#!/usr/bin/env node
/**
 * Count the licence keys that are not revoked (plan rule 2.15, task SW0a-12).
 *
 * Prints one number on stdout and changes nothing. That is true by construction: this file
 * imports two functions (readFileSync, fileURLToPath), starts no process and opens no network
 * connection. tests/countLicenseKeys.test.ts reads this source and fails if anything that could
 * change a file or a record is added to it, so keep this comment free of such words too.
 *
 * What is counted
 *   A licence key is a KV record named `license:key:<KEY>` (worker/licenseService.ts), and its
 *   `revoked` field is the only place a revocation is stored. The count is: records under that
 *   prefix whose value reads as a JSON object and whose `revoked` is not exactly true, the same
 *   test the Worker applies before it redeems a key.
 *   - A redeemed key is still counted. It is used up, not revoked.
 *   - The built-in campaign codes (BUILTIN_CAMPAIGN_KEYS) are constants in code, not records, so
 *     they are not counted until one has been redeemed once and has a record of its own.
 *   - The D1 tables license_key_claims and license_redemptions are not used: they hold
 *     redemptions and know nothing about revocation.
 *
 * Where the input comes from
 *   Reading production KV needs the owner's Cloudflare login, so this script never does it.
 *   The owner runs two read-only wrangler commands and gives this script what they print:
 *
 *     npx wrangler kv key list --namespace-id=00d331adea604a70945fb1651b7968b3 --remote --prefix=license:key: > names.json
 *     npx wrangler kv bulk get names.json --namespace-id=00d331adea604a70945fb1651b7968b3 --remote > records.json
 *     node scripts/count-license-keys.mjs records.json
 *
 *   Both files hold raw licence keys. Keep them outside any repository checkout and remove them
 *   when the number has been noted. Run the two wrangler commands from Git Bash or cmd: Windows
 *   PowerShell 5.1 re-encodes redirected text as UTF-16, which wrangler may not read back as
 *   the names file (this script accepts either encoding for the records file).
 *   If wrangler refuses a long names file, split it and pass every records file to this script:
 *   a record named in more than one file is counted once.
 *
 * Usage
 *   node scripts/count-license-keys.mjs <records.json> [<more.json> ...]
 *   <command that prints records> | node scripts/count-license-keys.mjs
 *
 * Accepted input: a JSON object of name to value (what `kv bulk get` prints; a value is the
 * stored text, or { value, metadata } around it), or a JSON array of { name | key, value }.
 *
 * Exit 0: the number is on stdout. Notes about entries that could not be read go to stderr and
 * never name a key. Exit 1: the input cannot be counted, and stdout stays empty.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LICENSE_KEY_PREFIX = 'license:key:';

/** Decode a file or stdin. Redirected output on Windows may be UTF-16 or carry a byte order mark. */
export function decodeInput(buffer) {
  let text;
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.toString('utf16le');
  else text = buffer.toString('utf8');
  // Drop a leading byte order mark (code point 0xFEFF), which JSON.parse refuses.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Turn parsed input into [name, value] pairs. Throws when the shape is not one of the two accepted. */
export function entriesOf(parsed) {
  if (Array.isArray(parsed)) {
    return parsed.map((item) => {
      if (typeof item === 'string') return [item, undefined];
      if (item && typeof item === 'object') {
        const name = typeof item.name === 'string' ? item.name : typeof item.key === 'string' ? item.key : null;
        if (name !== null) return [name, item.value];
      }
      throw new Error('an array entry has no name');
    });
  }
  if (parsed && typeof parsed === 'object') return Object.entries(parsed);
  throw new Error('the input is neither a JSON object nor a JSON array');
}

/** The stored record as an object, or null when the value is absent or cannot be read as one. */
export function recordOf(value) {
  let v = value;
  const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  // wrangler may wrap the stored text as { value, metadata }. A record itself has key, plan or revoked.
  if (isPlainObject(v) && Object.hasOwn(v, 'value') && !Object.hasOwn(v, 'key') && !Object.hasOwn(v, 'plan') && !Object.hasOwn(v, 'revoked')) {
    v = v.value;
  }
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return isPlainObject(v) ? v : null;
}

/**
 * Count over one or more parsed inputs. A record named in several inputs is counted once (the
 * last one read wins). Returns the tallies; `notRevoked` is the number the script prints.
 */
export function countLicenseKeys(parsedInputs) {
  const byName = new Map();
  let ignored = 0;
  for (const parsed of parsedInputs) {
    for (const [name, value] of entriesOf(parsed)) {
      if (typeof name !== 'string' || !name.startsWith(LICENSE_KEY_PREFIX)) {
        ignored += 1;
        continue;
      }
      byName.set(name, value);
    }
  }
  const tally = { total: byName.size, notRevoked: 0, revoked: 0, noValue: 0, unreadable: 0, ignored };
  for (const value of byName.values()) {
    if (value === undefined || value === null) {
      tally.noValue += 1;
      continue;
    }
    const record = recordOf(value);
    if (!record) tally.unreadable += 1;
    else if (record.revoked === true) tally.revoked += 1;
    else tally.notRevoked += 1;
  }
  return tally;
}

function fail(message) {
  console.error(`[count-license-keys] ${message}`);
  process.exit(1);
}

function main() {
  const files = process.argv.slice(2);
  if (files.some((arg) => arg.startsWith('-')) || (files.length === 0 && process.stdin.isTTY)) {
    fail('Usage: node scripts/count-license-keys.mjs <records.json> [<more.json> ...]   (or pipe the records in). See the top of the script for the two read-only commands that produce the input.');
  }
  const sources = files.length ? files : [0]; // 0 is stdin
  const parsedInputs = [];
  for (const source of sources) {
    const label = source === 0 ? 'stdin' : `input ${sources.indexOf(source) + 1}`;
    let text;
    try {
      text = decodeInput(readFileSync(source));
    } catch (err) {
      fail(`could not read ${label}: ${err && err.code ? err.code : 'read error'}`);
    }
    try {
      parsedInputs.push(JSON.parse(text));
    } catch {
      fail(`${label} is not JSON. It must be what "wrangler kv bulk get" printed.`);
    }
  }

  let tally;
  try {
    tally = countLicenseKeys(parsedInputs);
  } catch (err) {
    fail(`the input cannot be counted: ${err instanceof Error ? err.message : 'unknown shape'}.`);
  }

  if (tally.total > 0 && tally.noValue === tally.total) {
    fail(`the input names ${tally.total} record(s) but holds no values. Give this script the output of "wrangler kv bulk get", not of "wrangler kv key list".`);
  }
  if (tally.total === 0) console.error(`[count-license-keys] note: no record under "${LICENSE_KEY_PREFIX}" in the input. Check the prefix and the namespace.`);
  if (tally.noValue > 0) console.error(`[count-license-keys] note: ${tally.noValue} record(s) had no value and were not counted.`);
  if (tally.unreadable > 0) console.error(`[count-license-keys] note: ${tally.unreadable} record(s) could not be read as JSON objects and were not counted.`);
  if (tally.ignored > 0) console.error(`[count-license-keys] note: ${tally.ignored} entr(ies) outside "${LICENSE_KEY_PREFIX}" were ignored.`);

  console.log(String(tally.notRevoked));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
