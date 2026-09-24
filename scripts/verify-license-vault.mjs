#!/usr/bin/env node
/**
 * Verify that remote KV license records match the newest local vault manifest.
 *
 * Reads `.secrets/license-vault.manifest.<vg_...>.json` (written by
 * scripts/seed-license-vault.mjs after --apply), lists remote KV
 * `license:key:*` records (wrangler kv list, same pattern as
 * scripts/revoke-license-keys.mjs) with cursor pagination support, and
 * reconciles:
 *   - verified:         remote record exists, sha256 matches, generation matches, not revoked
 *   - missing:          manifest entry has no remote record
 *   - stale_generation: remote record exists but vaultGeneration differs
 *   - revoked:          remote record exists but is revoked
 *   - unknown_remote:   remote key whose sha256 is not in the manifest
 *                        (legacy pre-rotation records carry a `legacy: true` flag)
 * Report prints counts only plus `verified N/N`. Raw key material is NEVER
 * printed. Exit 0 when every manifest entry verifies; exit 1 otherwise.
 *
 * Usage:
 *   node scripts/verify-license-vault.mjs            # human-readable report
 *   node scripts/verify-license-vault.mjs --json     # machine-readable report
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const NAMESPACE_ID = '00d331adea604a70945fb1651b7968b3';
const KV_PREFIX = 'license:key:';
const LIST_PAGE_SIZE = 1000;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const defaultSecretsDir = join(root, '.secrets');

/** Newest manifest file in the secrets dir. Exported for tests. */
export function findNewestManifestFile(dir = defaultSecretsDir) {
  if (!existsSync(dir)) return null;
  const matches = readdirSync(dir)
    .filter((name) => name.startsWith('license-vault.manifest.') && name.endsWith('.json'))
    .sort();
  return matches.length ? matches[matches.length - 1] : null;
}

/**
 * Load and validate the newest manifest. Exported for tests.
 * Returns { ok, manifest?, path?, error? }.
 */
export function loadNewestManifest(dir = defaultSecretsDir) {
  const filename = findNewestManifestFile(dir);
  if (!filename) {
    return {
      ok: false,
      error:
        `No vault manifest found in ${dir}. ` +
        'Run `node scripts/seed-license-vault.mjs --apply` first (it writes a manifest after applying).',
    };
  }
  let manifest;
  const path = join(dir, filename);
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { ok: false, error: `Could not parse manifest ${filename}: ${err instanceof Error ? err.message : err}` };
  }
  if (!manifest || !Array.isArray(manifest.entries)) {
    return { ok: false, error: `Manifest ${filename} is malformed: missing entries array.` };
  }
  if (manifest.entries.length === 0) {
    return { ok: false, error: `Manifest ${filename} is empty: nothing to verify. Re-run the seed with a non-empty vault.` };
  }
  return { ok: true, manifest, path };
}

/**
 * Reconcile a manifest against remote KV records. `remoteRecordsByName` is a
 * Map of KV key name -> parsed record object (or null when unparseable).
 * Exported for tests. The report contains counts and sha256 fingerprints only:
 * raw key values are NEVER included.
 */
export function reconcileManifest(manifest, remoteRecordsByName) {
  const manifestBySha = new Map(manifest.entries.map((e) => [String(e.sha256), e]));
  const report = {
    generation: manifest.generation || null,
    total: manifest.entries.length,
    verified: 0,
    missing: [],
    stale_generation: [],
    revoked: [],
    unknown_remote: [],
    legacy: 0,
  };

  const matchedNames = new Set();

  for (const entry of manifest.entries) {
    let hit = null;
    for (const [name, record] of remoteRecordsByName) {
      if (record && typeof record === 'object' && record.keySha256 === entry.sha256) {
        hit = { name, record };
        break;
      }
    }
    if (!hit) {
      report.missing.push(entry.sha256);
      continue;
    }
    matchedNames.add(hit.name);
    const rec = hit.record;
    if (rec.revoked === true) {
      report.revoked.push(entry.sha256);
      continue;
    }
    if (rec.vaultGeneration !== undefined && rec.vaultGeneration !== null && rec.vaultGeneration !== manifest.generation) {
      report.stale_generation.push(entry.sha256);
      continue;
    }
    report.verified += 1;
  }

  for (const [name, record] of remoteRecordsByName) {
    if (matchedNames.has(name)) continue;
    const sha = record && typeof record === 'object' ? record.keySha256 : undefined;
    if (typeof sha === 'string' && manifestBySha.has(sha)) continue;
    // Legacy records (seeded before the sha/generation fields existed) are
    // reported inside unknown_remote but tallied separately: not a failure.
    const isLegacy = record && typeof record === 'object' && typeof sha !== 'string';
    report.unknown_remote.push({ ref: sha || name, legacy: Boolean(isLegacy) });
    if (isLegacy) report.legacy += 1;
  }

  return report;
}

/** Human-readable report printer. Raw keys never appear. Exported for tests. */
export function formatHumanReport(report) {
  const lines = [];
  lines.push(`Vault generation: ${report.generation || '(unknown)'}`);
  lines.push(`verified ${report.verified}/${report.total}`);
  lines.push(`missing: ${report.missing.length}`);
  lines.push(`stale_generation: ${report.stale_generation.length}`);
  lines.push(`revoked: ${report.revoked.length}`);
  lines.push(`unknown_remote: ${report.unknown_remote.length}${report.legacy ? ` (legacy: ${report.legacy})` : ''}`);
  if (report.verified === report.total && report.total > 0) {
    lines.push('OK: every manifest entry verified against remote KV.');
  } else {
    lines.push('FAILED: one or more manifest entries did not verify. Re-check rotation state.');
  }
  return lines.join('\n');
}

/** JSON report printer (counts, sha256 fingerprints and KV names only). Exported for tests. */
export function formatJsonReport(report) {
  return JSON.stringify(
    {
      generation: report.generation,
      total: report.total,
      verified: report.verified,
      ok: report.verified === report.total && report.total > 0,
      missing: report.missing,
      stale_generation: report.stale_generation,
      revoked: report.revoked,
      unknown_remote: report.unknown_remote,
      legacy: report.legacy,
    },
    null,
    2,
  );
}

/**
 * All-in-one verification from a manifest plus a remote record map.
 * Returns { report, ok }. Exported for tests.
 */
export function buildVerifyReport(manifest, remoteRecordsByName) {
  const report = reconcileManifest(manifest, remoteRecordsByName);
  return { report, ok: report.verified === report.total && report.total > 0 };
}

function wrangler(args) {
  const result = spawnSync('npx', ['wrangler', ...args], { stdio: 'pipe', shell: true, encoding: 'utf8' });
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function parseListKey(item) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object' && typeof item.name === 'string') return item.name;
  return null;
}

/**
 * Fetch all remote `license:key:*` records. Cursor pagination is explicit:
 * KV list pages are capped at 1000 keys; when a full page returns we restart
 * the prefix listing after the last seen key to continue the scan.
 * Returns a Map of KV key name to parsed record JSON.
 */
export function listRemoteLicenseRecords() {
  const out = new Map();
  let afterName = '';
  for (;;) {
    const args = ['kv', 'key', 'list', `--namespace-id=${NAMESPACE_ID}`, '--remote', `--prefix=${KV_PREFIX}`];
    const r = wrangler(args);
    if (r.status !== 0) {
      throw new Error(`wrangler kv list failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(r.stdout || '[]');
    } catch (err) {
      throw new Error(`could not parse wrangler kv list JSON: ${err instanceof Error ? err.message : err}`);
    }
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.keys) ? parsed.keys : [];
    let lastName = '';
    let fresh = 0;
    for (const item of items) {
      const name = parseListKey(item);
      if (!name || !name.startsWith(KV_PREFIX)) continue;
      if (name <= afterName) continue; // pagination guard, skip already-seen
      if (out.has(name)) continue;
      const got = wrangler(['kv', 'key', 'get', name, `--namespace-id=${NAMESPACE_ID}`, '--remote', '--text']);
      let record = null;
      if (got.status === 0) {
        try {
          record = JSON.parse(got.stdout);
        } catch {
          record = null;
        }
      }
      out.set(name, record);
      fresh += 1;
      lastName = name;
    }
    if (items.length < LIST_PAGE_SIZE || !lastName || fresh === 0) break;
    afterName = lastName;
  }
  return out;
}

async function main() {
  const json = process.argv.includes('--json');
  const loaded = loadNewestManifest(defaultSecretsDir);
  if (!loaded.ok) {
    if (json) {
      console.log(JSON.stringify({ ok: false, error: loaded.error }, null, 2));
    } else {
      console.error(loaded.error);
    }
    process.exit(1);
  }
  const manifest = loaded.manifest;
  const remote = listRemoteLicenseRecords();
  const { report, ok } = buildVerifyReport(manifest, remote);
  if (json) {
    console.log(formatJsonReport(report));
  } else {
    console.log(formatHumanReport(report));
  }
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
