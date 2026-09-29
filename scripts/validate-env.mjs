#!/usr/bin/env node
/**
 * Automated Environment Configuration Validator
 * Ensures staging and production environment variables are properly decoupled and conform to schema.
 *
 * Flags:
 *   --staging | --prod | --mode=<staging|production>
 *   --wrangler=<path>        validate a different wrangler.jsonc (tests)
 *   --allow-missing-ton      production: warn instead of fail when TON_RECEIVING_ADDRESS is unset
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from './lib/jsonc.mjs';
import { checkProductionTonAddress } from './lib/tonAddress.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const modeArg = process.argv.find((a) => a.startsWith('--mode='));
const targetMode = modeArg ? modeArg.split('=')[1] : process.argv.includes('--staging') ? 'staging' : 'production';
const wranglerArg = process.argv.find((a) => a.startsWith('--wrangler='));

console.log(`[EnvValidation] Validating configuration for target mode: ${targetMode}`);

const exampleFile = resolve(root, targetMode === 'staging' ? '.env.staging.example' : '.env.production.example');

if (!existsSync(exampleFile)) {
  console.error(`[EnvValidation] Missing expected template: ${exampleFile}`);
  process.exit(1);
}

// Read wrangler.jsonc to verify environment blocks exist
const wranglerPath = wranglerArg
  ? resolve(process.cwd(), wranglerArg.slice('--wrangler='.length))
  : resolve(root, 'wrangler.jsonc');
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

if (targetMode === 'production') {
  let config;
  try {
    config = parseJsonc(wranglerContent);
  } catch (err) {
    console.error(`[EnvValidation] wrangler.jsonc could not be parsed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const ton = checkProductionTonAddress(config, { allowMissing: process.argv.includes('--allow-missing-ton') });
  if (!ton.ok) {
    console.error(`[EnvValidation] ${ton.message}`);
    process.exit(1);
  }
  if (ton.warning) console.warn(`[EnvValidation] WARNING: ${ton.warning}`);

  const appCheck = checkAppCheckConfig(config, 'production');
  if (!appCheck.ok) {
    console.error(`[EnvValidation] ${appCheck.message}`);
    process.exit(1);
  }
}

if (targetMode === 'staging') {
  let config;
  try {
    config = parseJsonc(wranglerContent);
  } catch (err) {
    console.error(`[EnvValidation] wrangler.jsonc could not be parsed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const appCheck = checkAppCheckConfig(config, 'staging');
  if (!appCheck.ok) {
    console.error(`[EnvValidation] ${appCheck.message}`);
    process.exit(1);
  }
}

/**
 * When REQUIRE_APP_CHECK is true for an env, FIREBASE_PROJECT_NUMBER must be a non-empty numeric string.
 */
function checkAppCheckConfig(config, envName) {
  const vars =
    envName === 'staging'
      ? config?.env?.staging?.vars || {}
      : { ...(config?.vars || {}), ...(config?.env?.production?.vars || {}) };
  const required = String(vars.REQUIRE_APP_CHECK || '').trim().toLowerCase() === 'true';
  if (!required) return { ok: true };
  const projectNumber = String(vars.FIREBASE_PROJECT_NUMBER || '').trim();
  if (!/^\d{6,}$/.test(projectNumber)) {
    return {
      ok: false,
      message:
        `${envName}: REQUIRE_APP_CHECK=true but FIREBASE_PROJECT_NUMBER is missing or not numeric. ` +
        'Worker would return 503 APP_CHECK_MISCONFIGURED.',
    };
  }
  return { ok: true };
}

console.log(`[EnvValidation] Environment checks passed for ${targetMode}. Staging-production isolation verified.`);
process.exit(0);
