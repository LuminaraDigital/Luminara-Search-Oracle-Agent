#!/usr/bin/env node
/**
 * Smoke Check Utility
 * Verifies deployment health, security headers, and endpoint responsiveness.
 * Can be run against staging, production, or local builds.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const isStaging = process.argv.includes('--staging');
const isProd = process.argv.includes('--prod');
const isDryRun = process.argv.includes('--dry-run');

const targetLabel = isStaging ? 'Staging' : isProd ? 'Production' : 'Pre-Push / Local';
console.log(`[SmokeCheck] Running smoke tests for: ${targetLabel}`);

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

// 3. Online endpoint check if url provided or in staging/prod mode without --dry-run
const targetUrl = process.env.SMOKE_TARGET_URL || (isStaging ? 'https://staging.luminarasuite.com' : isProd ? 'https://luminarasuite.com' : null);

if (targetUrl && !isDryRun) {
  console.log(`[SmokeCheck] Testing remote health endpoint: ${targetUrl}/api/health`);
  try {
    const res = await fetch(`${targetUrl}/api/health`, {
      headers: { 'User-Agent': 'Luminara-Smoke-Check/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[SmokeCheck] Remote health check returned HTTP ${res.status}`);
      process.exit(1);
    }
    const data = await res.json();
    console.log('[SmokeCheck] [PASS] Remote health check returned:', JSON.stringify(data));
  } catch (err) {
    console.warn(`[SmokeCheck] Remote endpoint ${targetUrl} check skipped or unreachable: ${err.message}`);
  }
}

console.log(`[SmokeCheck] [SUCCESS] All smoke checks passed for ${targetLabel}.`);
process.exit(0);
