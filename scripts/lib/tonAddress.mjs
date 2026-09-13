/**
 * TON merchant address rules for Node scripts. Mirrors validateTonAddress in worker/tonPayment.ts;
 * tests/tonAddress.test.ts keeps both implementations in parity.
 */

const RAW_ADDRESS_RE = /^(0|-1):[0-9a-fA-F]{64}$/;
const FRIENDLY_ADDRESS_RE = /^[A-Za-z0-9+/_-]{48}$/;
const TAG_BOUNCEABLE = 0x11;
const TAG_NON_BOUNCEABLE = 0x51;
const TESTNET_FLAG = 0x80;

export function crc16Xmodem(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function validateTonAddress(address, { production }) {
  const value = typeof address === 'string' ? address.trim() : '';
  if (!value) return { ok: false, reason: 'address is missing' };

  if (RAW_ADDRESS_RE.test(value)) return { ok: true, format: 'raw', testnet: false };
  if (value.includes(':')) {
    return { ok: false, reason: 'raw address must be 0: or -1: followed by 64 hex characters' };
  }
  if (!FRIENDLY_ADDRESS_RE.test(value)) {
    return { ok: false, reason: 'user-friendly address must be 48 base64url characters' };
  }

  const bytes = Uint8Array.from(Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  if (bytes.length !== 36) return { ok: false, reason: 'user-friendly address does not decode to 36 bytes' };

  const tag = bytes[0];
  const testnet = (tag & TESTNET_FLAG) !== 0;
  const baseTag = tag & ~TESTNET_FLAG;
  if (baseTag !== TAG_BOUNCEABLE && baseTag !== TAG_NON_BOUNCEABLE) {
    return { ok: false, reason: 'unknown address flag byte' };
  }
  if (bytes[1] !== 0x00) {
    return { ok: false, reason: 'user-friendly address must be on the basechain (EQ/UQ prefix)' };
  }
  const expected = (bytes[34] << 8) | bytes[35];
  if (crc16Xmodem(bytes.subarray(0, 34)) !== expected) {
    return { ok: false, reason: 'address checksum mismatch' };
  }
  if (testnet && production) {
    return { ok: false, reason: 'testnet address (kQ/0Q) is not allowed in production' };
  }
  return { ok: true, format: 'friendly', testnet };
}

function shortPrefix(value) {
  return `${String(value).slice(0, 4)}…`;
}

/**
 * Checks env.production.vars.TON_RECEIVING_ADDRESS in a parsed wrangler config.
 * `allowMissing` downgrades a missing address to a warning; an invalid address always fails.
 */
export function checkProductionTonAddress(config, { allowMissing = false } = {}) {
  const vars = config?.env?.production?.vars;
  if (!vars || typeof vars !== 'object') {
    return { ok: false, message: 'wrangler.jsonc has no env.production.vars block, so TON_RECEIVING_ADDRESS cannot be verified.' };
  }
  const raw = vars.TON_RECEIVING_ADDRESS;
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    const message =
      'env.production.vars.TON_RECEIVING_ADDRESS is not set in wrangler.jsonc. TON checkout fails closed until the operator adds the mainnet merchant wallet (EQ/UQ).';
    return allowMissing ? { ok: true, warning: message } : { ok: false, message };
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: 'env.production.vars.TON_RECEIVING_ADDRESS must be a string.' };
  }
  const result = validateTonAddress(raw, { production: true });
  if (!result.ok) {
    return {
      ok: false,
      message: `env.production.vars.TON_RECEIVING_ADDRESS (${shortPrefix(raw.trim())}) is invalid: ${result.reason}.`,
    };
  }
  return { ok: true };
}
