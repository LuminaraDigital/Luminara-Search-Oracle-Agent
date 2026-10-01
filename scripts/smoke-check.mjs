#!/usr/bin/env node
/**
 * Smoke Check Utility
 * Verifies deployment health, security headers, and endpoint responsiveness.
 * Can be run against staging, production, or local builds.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const isStaging = process.argv.includes('--staging');
const isProd = process.argv.includes('--prod');
const isDryRun = process.argv.includes('--dry-run');

const targetLabel = isStaging ? 'Staging' : isProd ? 'Production' : 'Pre-Push / Local';
console.log(`[SmokeCheck] Running smoke tests for: ${targetLabel}`);

/** Suite-10x P1 + industry ops: migration files Worker code expects. */
const REQUIRED_D1_MIGRATIONS = [
  'migrations/0011_mcp_action_requests.sql',
  'migrations/0012_budget_policies.sql',
  'migrations/0013_mcp_action_requests_kind.sql',
  'migrations/0014_weekly_decision_loop.sql',
  'migrations/0015_privacy_observability_memory.sql',
  'migrations/0016_memory_history.sql',
  'migrations/0017_proof_ledger.sql',
];

const REQUIRED_D1_TABLES = [
  'mcp_action_requests',
  'budget_policies',
  'cost_events',
  'budget_incidents',
  'audit_findings',
  'weekly_decisions',
  'privacy_jobs',
  'product_analytics_events',
  'invoice_reconcile_runs',
  'memory_history',
  'proof_anchors',
];

// 1. Verify build bundle integrity
const distPath = resolve(root, 'dist');
if (!existsSync(distPath)) {
  console.warn('[SmokeCheck] dist/ folder does not exist yet. Run `npm run build` prior to production smoke checks.');
} else {
  const indexHtml = resolve(distPath, 'index.html');
  if (!existsSync(indexHtml)) {
    console.error('[SmokeCheck] FAILED: dist/index.html is missing!');
    process.exit(1);
  }
  const content = readFileSync(indexHtml, 'utf8');
  if (!content.includes('<!DOCTYPE html>') || !content.includes('<div id="root">')) {
    console.error('[SmokeCheck] FAILED: dist/index.html is malformed!');
    process.exit(1);
  }
  console.log('[SmokeCheck] [PASS] dist/ bundle integrity verified.');
}

// 2. Verify worker configuration
const wranglerJson = resolve(root, 'wrangler.jsonc');
if (!existsSync(wranglerJson)) {
  console.error('[SmokeCheck] FAILED: wrangler.jsonc missing!');
  process.exit(1);
}
console.log('[SmokeCheck] [PASS] Worker configuration verified.');

// 2b. D1 migration files on disk (always). Remote table probe when staging/prod.
for (const rel of REQUIRED_D1_MIGRATIONS) {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) {
    console.error(`[SmokeCheck] FAILED: missing D1 migration ${rel}`);
    process.exit(1);
  }
}
console.log('[SmokeCheck] [PASS] D1 migration files present (0011-0017).');

function probeRemoteD1Tables() {
  if (process.env.SMOKE_D1_PREFLIGHT === '0') {
    console.log('[SmokeCheck] [SKIP] remote D1 preflight (SMOKE_D1_PREFLIGHT=0).');
    return;
  }
  const dbName = isStaging ? 'luminara-users-staging' : 'luminara-users';
  const sql = `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${REQUIRED_D1_TABLES.map((t) => `'${t}'`).join(',')})`;
  const envPart = isStaging ? '--env staging' : '';
  // Single shell string so Windows keeps --command SQL intact (JSON.stringify quotes it).
  const cmdline = `npx wrangler d1 execute ${dbName} --remote ${envPart} --command ${JSON.stringify(sql)} --json`;
  console.log(`[SmokeCheck] Probing remote D1 tables on ${dbName}...`);
  const res = spawnSync(cmdline, {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error(
      `[SmokeCheck] FAILED: wrangler d1 execute exit ${res.status}. Apply migrations before deploy (npm run db:migrate${isStaging ? ':staging' : ''}).`,
    );
    if (res.stderr) console.error(res.stderr.slice(0, 1200));
    if (res.stdout) console.error(String(res.stdout).slice(0, 800));
    process.exit(1);
  }
  const out = String(res.stdout || '');
  const missing = REQUIRED_D1_TABLES.filter((t) => !out.includes(t));
  if (missing.length) {
    console.error(
      `[SmokeCheck] FAILED: remote D1 missing tables: ${missing.join(', ')}. Run migrate before deploying this Worker SHA.`,
    );
    console.error('[SmokeCheck] wrangler stdout (truncated):', out.slice(0, 800));
    process.exit(1);
  }
  console.log('[SmokeCheck] [PASS] Remote D1 governance/budget tables present.');
}

if ((isStaging || isProd) && !isDryRun) {
  probeRemoteD1Tables();
}

// 3. Online endpoint check if url provided or in staging/prod mode without --dry-run
const targetUrl = process.env.SMOKE_TARGET_URL || (isStaging ? 'https://staging.luminarasuite.com' : isProd ? 'https://luminarasuite.com' : null);

if (targetUrl && !isDryRun) {
  console.log(`[SmokeCheck] Testing remote health endpoint: ${targetUrl}/api/health`);
  let data;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${targetUrl}/api/health`, {
      headers: { 'User-Agent': 'Luminara-Smoke-Check/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`[SmokeCheck] FAILED: remote health returned HTTP ${res.status}`);
      process.exit(1);
    }
    data = await res.json();
  } catch (err) {
    console.error(
      `[SmokeCheck] FAILED: remote endpoint ${targetUrl}/api/health unreachable: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
  if (!data || data.ok !== true) {
    console.error('[SmokeCheck] FAILED: /api/health JSON missing ok:true');
    process.exit(1);
  }
  if (data.requireAuth !== true) {
    console.error('[SmokeCheck] FAILED: /api/health requireAuth must be true on hosted staging/prod');
    process.exit(1);
  }
  if (typeof data.appCheckRequired !== 'boolean') {
    console.error('[SmokeCheck] FAILED: /api/health must expose boolean appCheckRequired');
    process.exit(1);
  }
  console.log('[SmokeCheck] [PASS] Remote health check returned:', JSON.stringify(data));

  // Findings board must be mounted and auth-gated (unsigned GET → 401).
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const findingsRes = await fetch(
      `${targetUrl}/api/findings?domain=smoke.example.com`,
      {
        headers: { 'User-Agent': 'Luminara-Smoke-Check/1.0' },
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);
    if (findingsRes.status !== 401) {
      console.error(
        `[SmokeCheck] FAILED: GET /api/findings expected 401 when unsigned, got HTTP ${findingsRes.status}`,
      );
      process.exit(1);
    }
    console.log('[SmokeCheck] [PASS] GET /api/findings returns 401 when unsigned.');
  } catch (err) {
    console.error(
      `[SmokeCheck] FAILED: /api/findings probe unreachable: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}

console.log(`[SmokeCheck] [SUCCESS] All smoke checks passed for ${targetLabel}.`);
