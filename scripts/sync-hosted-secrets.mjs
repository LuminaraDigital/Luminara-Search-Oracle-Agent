#!/usr/bin/env node
/**
 * Sync hosted provider secrets from local .env / .dev.vars into the Cloudflare Worker.
 * Never prints secret values. Requires wrangler auth.
 *
 * Usage:
 *   node scripts/sync-hosted-secrets.mjs           # dry-run (names only)
 *   node scripts/sync-hosted-secrets.mjs --apply   # put secrets
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');

const HOSTED_SECRETS = [
  'GROQ_API_KEY',
  'GROQ_API_KEY_FALLBACK',
  'NVIDIA_API_KEY',
  'NVIDIA_ORG_ID',
  'OPENROUTER_API_KEY',
  'OLLAMA_API_KEY',
  'GEMINI_API_KEY',
  'TAVILY_API_KEY',
  'EXA_API_KEY',
  'FIRECRAWL_API_KEY',
];

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        const k = l.slice(0, i).trim();
        const v = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
        return [k, v];
      })
      .filter(([k, v]) => k && v && !k.startsWith('VITE_')),
  );
}

const env = {
  ...loadEnvFile(resolve(root, '.env')),
  ...loadEnvFile(resolve(root, '.dev.vars')),
};

const present = HOSTED_SECRETS.filter((k) => Boolean(env[k]));
const missing = HOSTED_SECRETS.filter((k) => !env[k]);

console.log(`Hosted secrets found locally: ${present.length}/${HOSTED_SECRETS.length}`);
for (const k of present) {
  const v = env[k];
  console.log(`  ${k}: len=${v.length} fp=${v.slice(0, 4)}…${v.slice(-4)}`);
}
if (missing.length) {
  console.log(`Missing locally (skipped): ${missing.join(', ')}`);
}

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to put these on the Worker.');
  process.exit(0);
}

if (!present.length) {
  console.error('No secrets to apply.');
  process.exit(1);
}

let failed = 0;
for (const name of present) {
  const value = env[name];
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', name], {
    cwd: root,
    input: value,
    encoding: 'utf8',
    shell: true,
  });
  if (r.status !== 0) {
    failed += 1;
    console.error(`FAIL ${name}: ${(r.stderr || r.stdout || 'unknown error').slice(0, 200)}`);
  } else {
    console.log(`OK ${name}`);
  }
}

process.exit(failed ? 1 : 0);
