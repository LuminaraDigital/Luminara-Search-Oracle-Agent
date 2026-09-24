#!/usr/bin/env node
/**
 * Revoke license keys in Cloudflare KV (production LUMINARA_KV).
 *
 * Reads a JSON array of raw key strings from a file path given as argv. The key
 * list is obtained out-of-band (e.g. the leaked-keys file held in the ops vault);
 * this script must never contain key material itself.
 *
 * Mirrors the auth/KV approach of scripts/seed-license-vault.mjs (same namespace,
 * same `license:key:<KEY>` records). For each key it reads the current record,
 * merges revoked=true + revokedAt while preserving every other field (plan,
 * redemption history, campaign), and writes it back. A missing record becomes a
 * tombstone so the key is explicitly revoked rather than merely unknown.
 * worker/licenseService.ts rejects revoked keys on activation.
 *
 * Usage:
 *   node scripts/revoke-license-keys.mjs path/to/leaked-keys.json           # dry-run (default)
 *   node scripts/revoke-license-keys.mjs path/to/leaked-keys.json --apply    # write production KV
 *
 * Input shape: a JSON array of key strings, e.g. ["LUM-<TIER>-<N>D-XXXX-YYYY", ...]
 */
import { writeFileSync, unlinkSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute, resolve } from 'node:path';

// Production LUMINARA_KV namespace (same id as wrangler.jsonc / seed-license-vault.mjs).
const PROD_NAMESPACE_ID = '00d331adea604a70945fb1651b7968b3';
const KV_PREFIX = 'license:key:';

/**
 * Parse and validate the out-of-band key list. Exported for tests.
 * Normalizes like worker/licenseService.ts normalizeLicenseKey: trim, uppercase,
 * strip non-alphanumerics except dashes.
 */
export function loadKeys(listPath) {
  if (!listPath) {
    return { ok: false, error: 'key list path is required (JSON array of key strings)' };
  }
  const abs = isAbsolute(listPath) ? listPath : resolve(process.cwd(), listPath);
  if (!existsSync(abs)) return { ok: false, error: `missing key list file: ${abs}` };
  let raw;
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (err) {
    return { ok: false, error: `could not parse JSON: ${err.message}` };
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'key list must be a non-empty JSON array of key strings' };
  }
  const keys = [
    ...new Set(
      raw.map((k) =>
        String(k || '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9-]/g, ''),
      ),
    ),
  ];
  const invalid = keys.filter((k) => !k.startsWith('LUM-') || k.length < 8);
  if (invalid.length) {
    return {
      ok: false,
      error: `${invalid.length} malformed ${invalid.length === 1 ? 'entry' : 'entries'}: keys must look like LUM-... (min 8 chars). Fix the list file.`,
    };
  }
  return { ok: true, keys };
}

/**
 * Merge revocation into an existing KV record (or build a tombstone when absent).
 * Exported for tests. Preserves plan / redemption / campaign history.
 */
export function mergeRevocation(existingValueJson, key, revokedAt) {
  let record = {};
  if (typeof existingValueJson === 'string' && existingValueJson.trim()) {
    try {
      record = JSON.parse(existingValueJson);
    } catch {
      record = {};
    }
  }
  return JSON.stringify({
    ...record,
    key: String(record.key || key),
    revoked: true,
    revokedAt,
  });
}

function wrangler(args) {
  const result = spawnSync('npx', ['wrangler', ...args], { stdio: 'pipe', shell: true, encoding: 'utf8' });
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const listPath = args.find((a) => !a.startsWith('--'));

  const loaded = loadKeys(listPath);
  if (!loaded.ok) {
    console.error(`Error: ${loaded.error}`);
    console.error('Usage: node scripts/revoke-license-keys.mjs <keys.json> [--apply]');
    process.exit(1);
  }
  const keys = loaded.keys;

  console.log(`Revocation list: ${keys.length} unique key${keys.length === 1 ? '' : 's'}`);

  if (!apply) {
    // Dry run must make zero network calls: print what WOULD change, then exit.
    console.log('Dry run. Would set revoked=true + revokedAt on each of these KV records:');
    for (const key of keys) {
      console.log(`  - ${KV_PREFIX}${key} -> revoked in place (history preserved), or tombstone if absent`);
    }
    console.log('Re-run with --apply to read current records and write revocations to production KV.');
    process.exit(0);
  }

  const revokedAt = Date.now();
  const planned = [];
  const missing = [];

  for (const key of keys) {
    const r = wrangler([
      'kv', 'key', 'get', `${KV_PREFIX}${key}`,
      `--namespace-id=${PROD_NAMESPACE_ID}`,
      '--remote',
      '--text',
    ]);
    if (r.status !== 0) {
      missing.push(key);
      planned.push({ key, value: mergeRevocation(null, key, revokedAt), existed: false });
    } else {
      planned.push({ key, value: mergeRevocation(r.stdout, key, revokedAt), existed: true });
    }
  }

  console.log(`Existing records: ${planned.filter((p) => p.existed).length}, absent (tombstone): ${missing.length}`);

  // Bulk put the merged records; scratch file outside the repo, removed after.
  const dir = mkdtempSync(join(tmpdir(), 'luminara-revoke-'));
  const bulkFile = join(dir, 'bulk.json');
  writeFileSync(bulkFile, JSON.stringify(planned.map(({ key, value }) => ({ key: `${KV_PREFIX}${key}`, value }))), 'utf8');
  try {
    const put = wrangler(['kv', 'bulk', 'put', bulkFile, `--namespace-id=${PROD_NAMESPACE_ID}`, '--remote']);
    if (put.status !== 0) {
      console.error(put.stderr || put.stdout);
      process.exit(put.status || 1);
    }
    console.log(`Revoked ${planned.length} license keys in production LUMINARA_KV.`);
    console.log('Verify: activation of a revoked key must now return the revoked error (see docs/plans/license-rotation-runbook.md).');
  } finally {
    try {
      unlinkSync(bulkFile);
    } catch {
      /* ignore */
    }
  }
}

// CLI guard: run main() only when executed directly, not when imported by tests.
const invoked = process.argv[1] && process.argv[1].includes('revoke-license-keys');
if (invoked) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}