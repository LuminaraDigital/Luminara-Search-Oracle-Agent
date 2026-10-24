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
 * APPCHECK_ENFORCE is off | log | enforce.
 * When REQUIRE_APP_CHECK is true, or APPCHECK_ENFORCE is enforce, FIREBASE_PROJECT_NUMBER
 * must be a non-empty numeric string and the client site key must be available.
 */
function checkAppCheckConfig(config, envName) {
  const vars =
    envName === 'staging'
      ? config?.env?.staging?.vars || {}
      : { ...(config?.vars || {}), ...(config?.env?.production?.vars || {}) };
  const mode = String(vars.APPCHECK_ENFORCE || 'off').trim().toLowerCase();
  if (mode !== 'off' && mode !== 'log' && mode !== 'enforce') {
    return { ok: false, message: `${envName}: APPCHECK_ENFORCE must be off, log, or enforce.` };
  }
  const required = String(vars.REQUIRE_APP_CHECK || '').trim().toLowerCase() === 'true' || mode === 'enforce';
  if (!required) return { ok: true };
  const projectNumber = String(vars.FIREBASE_PROJECT_NUMBER || '').trim();
  if (!/^\d{6,}$/.test(projectNumber)) {
    return {
      ok: false,
      message:
        `${envName}: App Check enforcement is on but FIREBASE_PROJECT_NUMBER is missing or not numeric. ` +
        'Worker would return 503 APP_CHECK_MISCONFIGURED.',
    };
  }
  const envFile = resolve(root, envName === 'staging' ? '.env.staging' : '.env.production');
  const fileHasKey = existsSync(envFile) && /^VITE_FIREBASE_APPCHECK_SITE_KEY=\S+/m.test(readFileSync(envFile, 'utf8'));
  if (!String(process.env.VITE_FIREBASE_APPCHECK_SITE_KEY || '').trim() && !fileHasKey) {
    return {
      ok: false,
      message:
        `${envName}: App Check enforcement is on but VITE_FIREBASE_APPCHECK_SITE_KEY is in neither the job env nor ${envFile}. ` +
        'The client would send no App Check token and enforced requests would be rejected.',
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

function checkSecretPlaceholders(config) {
  const blocks = [
    ['top-level', config?.vars || {}],
    ['staging', config?.env?.staging?.vars || {}],
    ['production', config?.env?.production?.vars || {}],
  ];
  const secretNames = ['AUDIT_RECEIPT_ACCOUNT_HMAC_KEY', 'REQUEST_SIGNING_KEYS'];
  for (const [name, vars] of blocks) {
    for (const secretName of secretNames) {
      if (Object.prototype.hasOwnProperty.call(vars, secretName)) {
        return {
          ok: false,
          message: `${name} vars must not set ${secretName}. Set it with wrangler secret put. It is not a var.`,
        };
      }
    }
  }
  for (const rel of ['.env.staging.example', '.env.production.example', '.dev.vars.example']) {
    const text = readFileSync(resolve(root, rel), 'utf8');
    for (const secretName of secretNames) {
      if (!new RegExp(`^# ${secretName}=\\s*$`, 'm').test(text)) {
        return { ok: false, message: `${rel} must contain the commented placeholder: # ${secretName}=` };
      }
      if (new RegExp(`^${secretName}=\\S`, 'm').test(text)) {
        return { ok: false, message: `${rel} must not assign a value to ${secretName}.` };
      }
    }
  }
  return { ok: true };
}

let wranglerConfig;
try {
  wranglerConfig = parseJsonc(wranglerContent);
} catch (err) {
  console.error(`[EnvValidation] wrangler.jsonc could not be parsed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
const secretPlaceholders = checkSecretPlaceholders(wranglerConfig);
if (!secretPlaceholders.ok) {
  console.error(`[EnvValidation] ${secretPlaceholders.message}`);
  process.exit(1);
}

console.log(`[EnvValidation] Environment checks passed for ${targetMode}. Staging-production isolation verified.`);
process.exit(0);
