#!/usr/bin/env node
/**
 * Seed license serials into Cloudflare KV from a local vault file.
 *
 * Serial keys must not live in git. Put them in:
 *   .secrets/license-vault.json
 *
 * Shape:
 *   [{ "key": "LUM-...", "plan": "growth", "durationDays": 30, "isTrial": false, "campaign": "ops" }, ...]
 *
 * Each run mints a vault generation id (vg_<UTC date>_<8 hex>) that is stamped
 * onto every seeded record as `vaultGeneration` together with `keySha256`
 * (full sha256 hex of the normalized key). After `--apply`, a manifest with
 * only sha256 fingerprints (never raw keys) is written to
 *   .secrets/license-vault.manifest.<vaultGeneration>.json
 * so `scripts/verify-license-vault.mjs` can prove remote state after rotation.
 *
 * Usage:
 *   node scripts/seed-license-vault.mjs           # dry-run
 *   node scripts/seed-license-vault.mjs --apply   # wrangler kv bulk put --remote
 */
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const NAMESPACE_ID = '00d331adea604a70945fb1651b7968b3';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const vaultPath = join(root, '.secrets', 'license-vault.json');

/**
 * Full sha256 hex of the normalized (trimmed, uppercased) key. Mirrors
 * licenseKeySha256 in worker/auditLog.ts (same domain separator) so manifest
 * entries and worker records compare 1:1. Node crypto; never returns raw keys.
 * Exported for tests.
 */
export function keySha256(key) {
  const normalized = String(key || '').trim().toUpperCase();
  return createHash('sha256').update(`luminara-license-key:${normalized}`).digest('hex');
}

/**
 * Vault generation id: vg_<UTC YYYYMMDD>_<8 lowercase hex from crypto>.
 * Exported for tests; date + entropy are injectable.
 */
export function newVaultGeneration(now = new Date(), entropy = randomBytes(4)) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hex = Buffer.from(entropy).toString('hex').slice(0, 8);
  return `vg_${yyyy}${mm}${dd}_${hex}`;
}

export function normalizeVaultRow(row) {
  if (!row || typeof row.key !== 'string' || typeof row.plan !== 'string') {
    throw new Error('Each vault row needs key and plan strings');
  }
  const durationDays = Math.max(1, Number(row.durationDays) || 3);
  return {
    key: String(row.key).trim().toUpperCase(),
    plan: String(row.plan).trim().toLowerCase(),
    durationDays,
    isTrial: row.isTrial ?? durationDays <= 7,
    campaign: row.campaign || 'ops_vault_seed',
  };
}

export function parseVault(rawJson) {
  const raw = JSON.parse(rawJson);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('license-vault.json must be a non-empty array');
  }
  return raw.map(normalizeVaultRow);
}

export function loadVault(path = vaultPath) {
  if (!existsSync(path)) {
    return {
      ok: false,
      error:
        `Missing ${path}\n` +
        'Create it with an array of { key, plan, durationDays, isTrial?, campaign? } objects.',
    };
  }
  let entries;
  try {
    entries = parseVault(readFileSync(path, 'utf8'));
  } catch (err) {
    return { ok: false, error: `Could not load vault: ${err instanceof Error ? err.message : err}` };
  }
  return { ok: true, entries };
}

/**
 * Build KV bulk entries. Each record gains keySha256 + vaultGeneration when a
 * generation id is supplied. No raw keys are added beyond the existing `key`
 * field the record already carries. Exported for tests.
 */
export function toKvBulk(entries, generation = null, now = Date.now()) {
  return entries.map((seed) => {
    const record = {
      key: seed.key,
      plan: seed.plan,
      durationDays: seed.durationDays,
      isTrial: seed.isTrial,
      campaign: seed.campaign,
      createdAt: now,
      redeemed: false,
      maxRedemptions: 1,
      redemptionCount: 0,
      ...(generation
        ? { keySha256: keySha256(seed.key), vaultGeneration: generation }
        : {}),
    };
    return {
      key: `license:key:${seed.key}`,
      value: JSON.stringify(record),
    };
  });
}

/**
 * Manifest for post-rotation verification. Contains ONLY sha256 fingerprints
 * and public plan metadata: raw key material is never written to manifests.
 * Exported for tests; returns plain JSON-shaped data.
 */
export function buildManifest(entries, generation, now = Date.now()) {
  return {
    tool: 'luminara-license-vault',
    generation,
    createdAt: new Date(now).toISOString(),
    count: entries.length,
    entries: entries.map((seed) => ({
      sha256: keySha256(seed.key),
      plan: seed.plan,
      durationDays: seed.durationDays,
    })),
  };
}

export function manifestFilename(generation) {
  return `license-vault.manifest.${generation}.json`;
}

export function manifestPathFor(generation, dir = join(root, '.secrets')) {
  return join(dir, manifestFilename(generation));
}

/** Exported for tests: writes the manifest, returns the path. */
export function writeManifest(manifest, dir = join(root, '.secrets')) {
  mkdirSync(dir, { recursive: true });
  const path = manifestPathFor(manifest.generation, dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const generation = newVaultGeneration();
  console.log(`Vault generation: ${generation}`);

  const loaded = loadVault(vaultPath);
  if (!loaded.ok) {
    console.error(loaded.error);
    process.exit(1);
  }
  const vault = loaded.entries;
  const bulk = toKvBulk(vault, generation);
  const tmp = join(here, `.license-vault-bulk-${Date.now()}.json`);

  console.log(`Vault serials: ${vault.length}`);
  if (!apply) {
    console.log('Dry run. Re-run with --apply to write production KV.');
    console.log(`Sample key prefix: ${vault[0].key.slice(0, 12)}...`);
    return;
  }

  mkdirSync(join(root, '.secrets'), { recursive: true });
  writeFileSync(tmp, JSON.stringify(bulk), 'utf8');
  try {
    const result = spawnSync(
      'npx',
      ['wrangler', 'kv', 'bulk', 'put', tmp, `--namespace-id=${NAMESPACE_ID}`, '--remote'],
      { stdio: 'inherit', shell: true },
    );
    if (result.status !== 0) {
      process.exitCode = result.status || 1;
      return;
    }
    const manifest = buildManifest(vault, generation);
    const manifestPath = writeManifest(manifest);
    console.log(`Seeded ${bulk.length} license keys into LUMINARA_KV.`);
    console.log(`Verification summary: wrote ${bulk.length} record(s) under generation ${generation}.`);
    console.log(`Manifest: ${manifestPath} (sha256 fingerprints only; never commit it).`);
    console.log('Verify remote state with: node scripts/verify-license-vault.mjs');
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
