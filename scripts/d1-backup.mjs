#!/usr/bin/env node
/**
 * Export Luminara D1 to a local timestamped SQL dump for offline / R2 vaulting.
 * Patterns: independent export + checksum (Time Travel is not enough).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isStaging = process.argv.includes('--staging');
const isProd = process.argv.includes('--prod');

if (!isStaging && !isProd) {
  console.error('Usage: node scripts/d1-backup.mjs --staging | --prod');
  process.exit(1);
}

if (isProd && process.env.CONFIRM_PROD_BACKUP !== '1') {
  console.error('Refusing prod backup without CONFIRM_PROD_BACKUP=1');
  process.exit(1);
}

const dbName = isStaging ? 'luminara-users-staging' : 'luminara-users';
const envPart = isStaging ? ['--env', 'staging'] : ['--env', 'production'];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(root, 'artifacts', 'd1-backups');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, `${dbName}-${stamp}.sql`);

const args = ['d1', 'export', dbName, ...envPart, '--output', outFile];
console.log(`[d1-backup] wrangler ${args.join(' ')}`);
const result = spawnSync('npx', ['wrangler', ...args], {
  cwd: root,
  encoding: 'utf8',
  shell: true,
});

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  console.error('[d1-backup] FAILED');
  process.exit(result.status || 1);
}

if (!existsSync(outFile)) {
  console.error('[d1-backup] FAILED: output file missing');
  process.exit(1);
}

const body = readFileSync(outFile);
const sha256 = createHash('sha256').update(body).digest('hex');
const metaPath = `${outFile}.sha256`;
writeFileSync(metaPath, `${sha256}  ${outFile}\n`, 'utf8');
console.log(`[d1-backup] OK ${outFile}`);
console.log(`[d1-backup] sha256 ${sha256}`);
console.log('[d1-backup] Upload this file to R2 (d1-backups/) or offline vault the same day.');
