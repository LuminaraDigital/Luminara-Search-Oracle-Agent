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
 * Usage:
 *   node scripts/seed-license-vault.mjs           # dry-run
 *   node scripts/seed-license-vault.mjs --apply   # wrangler kv bulk put --remote
 */
import { writeFileSync, unlinkSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const NAMESPACE_ID = '00d331adea604a70945fb1651b7968b3';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const vaultPath = join(root, '.secrets', 'license-vault.json');

function loadVault() {
  if (!existsSync(vaultPath)) {
    console.error(`Missing ${vaultPath}`);
    console.error('Create it with an array of { key, plan, durationDays, isTrial?, campaign? } objects.');
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(vaultPath, 'utf8'));
  if (!Array.isArray(raw) || raw.length === 0) {
    console.error('license-vault.json must be a non-empty array');
    process.exit(1);
  }
  return raw.map((row) => {
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
  });
}

function toKvBulk(entries) {
  const now = Date.now();
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
    };
    return {
      key: `license:key:${seed.key}`,
      value: JSON.stringify(record),
    };
  });
}

const apply = process.argv.includes('--apply');
const vault = loadVault();
const bulk = toKvBulk(vault);
const tmp = join(here, `.license-vault-bulk-${Date.now()}.json`);

console.log(`Vault serials: ${vault.length}`);
if (!apply) {
  console.log('Dry run. Re-run with --apply to write production KV.');
  console.log(`Sample key prefix: ${vault[0].key.slice(0, 12)}…`);
  process.exit(0);
}

mkdirSync(join(root, '.secrets'), { recursive: true });
writeFileSync(tmp, JSON.stringify(bulk), 'utf8');
try {
  const result = spawnSync(
    'npx',
    ['wrangler', 'kv', 'bulk', 'put', tmp, `--namespace-id=${NAMESPACE_ID}`, '--remote'],
    { stdio: 'inherit', shell: true },
  );
  if (result.status !== 0) process.exit(result.status || 1);
  console.log(`Seeded ${bulk.length} license keys into LUMINARA_KV.`);
} finally {
  try {
    unlinkSync(tmp);
  } catch {
    /* ignore */
  }
}
