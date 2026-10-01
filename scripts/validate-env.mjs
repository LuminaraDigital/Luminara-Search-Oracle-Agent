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
import { checkProductionTonAddress, validateTonAddress } from './lib/tonAddress.mjs';

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
  const chain = checkChainNetworkConfig(config, 'production');
  if (!chain.ok) {
    console.error(`[EnvValidation] ${chain.message}`);
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
  const chain = checkChainNetworkConfig(config, 'staging');
  if (!chain.ok) {
    console.error(`[EnvValidation] ${chain.message}`);
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

/**
 * Fail closed if CHAIN_NETWORK / TON API hosts / XDC RPC / merchant address disagree.
 */
function checkChainNetworkConfig(config, envName) {
  const vars =
    envName === 'staging'
      ? config?.env?.staging?.vars || {}
      : { ...(config?.vars || {}), ...(config?.env?.production?.vars || {}) };

  const network = String(vars.CHAIN_NETWORK || '').trim().toLowerCase();
  if (network !== 'testnet' && network !== 'mainnet') {
    return { ok: false, message: `${envName}: CHAIN_NETWORK must be testnet or mainnet.` };
  }
  if (envName === 'production' && network !== 'mainnet') {
    return { ok: false, message: 'production: CHAIN_NETWORK must be mainnet.' };
  }
  if (envName === 'staging' && network !== 'testnet') {
    return { ok: false, message: 'staging: CHAIN_NETWORK must be testnet.' };
  }

  const tonBase = String(vars.CHAIN_TON_API_BASE || '').trim();
  if (!tonBase) {
    return { ok: false, message: `${envName}: CHAIN_TON_API_BASE is required.` };
  }
  if (network === 'testnet' && !/testnet/i.test(tonBase)) {
    return { ok: false, message: `${envName}: CHAIN_TON_API_BASE must be a testnet Toncenter host.` };
  }
  if (network === 'mainnet' && /testnet/i.test(tonBase)) {
    return { ok: false, message: `${envName}: CHAIN_TON_API_BASE must not be a testnet host.` };
  }

  const tonFallback = String(vars.CHAIN_TON_API_FALLBACK_BASE || '').trim();
  if (tonFallback) {
    if (network === 'testnet' && !/testnet/i.test(tonFallback)) {
      return { ok: false, message: `${envName}: CHAIN_TON_API_FALLBACK_BASE must be testnet TonAPI.` };
    }
    if (network === 'mainnet' && /testnet/i.test(tonFallback)) {
      return { ok: false, message: `${envName}: CHAIN_TON_API_FALLBACK_BASE must not be testnet.` };
    }
  }

  const xdc = String(vars.CHAIN_XDC_RPC_URL || '').trim();
  if (!xdc) {
    return { ok: false, message: `${envName}: CHAIN_XDC_RPC_URL is required.` };
  }
  if (network === 'testnet' && !/apothem/i.test(xdc)) {
    return { ok: false, message: `${envName}: CHAIN_XDC_RPC_URL should point at Apothem (testnet).` };
  }
  if (network === 'mainnet' && /apothem/i.test(xdc)) {
    return { ok: false, message: `${envName}: CHAIN_XDC_RPC_URL must not be Apothem on mainnet.` };
  }

  const merchant = String(vars.TON_RECEIVING_ADDRESS || '').trim();
  if (!merchant) {
    return { ok: false, message: `${envName}: TON_RECEIVING_ADDRESS is required with CHAIN_NETWORK.` };
  }
  const address = validateTonAddress(merchant, { production: envName === 'production' });
  if (!address.ok) {
    return { ok: false, message: `${envName}: TON_RECEIVING_ADDRESS invalid: ${address.reason}.` };
  }
  if (address.format === 'raw') {
    return { ok: false, message: `${envName}: raw 0:/-1: merchant addresses are not allowed.` };
  }
  if (network === 'testnet' && !address.testnet) {
    return { ok: false, message: `${envName}: CHAIN_NETWORK=testnet requires a kQ/0Q merchant address.` };
  }
  if (network === 'mainnet' && address.testnet) {
    return { ok: false, message: `${envName}: CHAIN_NETWORK=mainnet rejects kQ/0Q merchant addresses.` };
  }

  return { ok: true };
}

console.log(`[EnvValidation] Environment checks passed for ${targetMode}. Staging-production isolation verified.`);
process.exit(0);
