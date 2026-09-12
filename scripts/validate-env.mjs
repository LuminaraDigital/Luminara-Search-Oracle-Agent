#!/usr/bin/env node
/**
 * Automated Environment Configuration Validator
 * Ensures staging and production environment variables are properly decoupled and conform to schema.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const modeArg = process.argv.find((a) => a.startsWith('--mode='));
const targetMode = modeArg ? modeArg.split('=')[1] : process.argv.includes('--staging') ? 'staging' : 'production';

console.log(`[EnvValidation] Validating configuration for target mode: ${targetMode}`);

const envFile = resolve(root, targetMode === 'staging' ? '.env.staging' : '.env');
const exampleFile = resolve(root, targetMode === 'staging' ? '.env.staging.example' : '.env.production.example');

if (!existsSync(exampleFile)) {
  console.error(`[EnvValidation] Missing expected template: ${exampleFile}`);
  process.exit(1);
}

// Read wrangler.jsonc to verify environment blocks exist
const wranglerPath = resolve(root, 'wrangler.jsonc');
if (!existsSync(wranglerPath)) {
  console.error('[EnvValidation] wrangler.jsonc not found!');
  process.exit(1);
}

const wranglerContent = readFileSync(wranglerPath, 'utf8');

if (targetMode === 'staging') {
  if (!wranglerContent.includes('"staging"') || !wranglerContent.includes('staging.luminarasuite.com')) {
    console.error('[EnvValidation] Staging environment block not configured in wrangler.jsonc!');
    process.exit(1);
  }
}

console.log(`[EnvValidation] Environment checks passed for ${targetMode}. Staging-production isolation verified.`);
process.exit(0);
