/**
 * The token profile (token.json) and its TEP-64 on-chain encoding.
 *
 * token.json is the single place the name, symbol, decimals, description,
 * image and supply are written down. The deploy tooling and the tests both
 * read it from here, so the two cannot disagree.
 */
import { readFileSync } from 'node:fs';
import { beginCell, Cell, Dictionary } from '@ton/core';
import { sha256_sync } from '@ton/crypto';

export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals: string;
  description: string;
  image: string;
}

export interface TokenProfile {
  /** Whole tokens, as a decimal string. The on-chain amount is this times 10^decimals. */
  supply: string;
  metadata: TokenMetadata;
}

/** TEP-64 keys this package can read back out of a content cell. */
export const METADATA_KEYS = [
  'name',
  'symbol',
  'decimals',
  'description',
  'image',
  'image_data',
  'uri',
  'amount_style',
  'render_type',
] as const;

const ONCHAIN_CONTENT_TAG = 0x00;
const SNAKE_DATA_TAG = 0x00;

/** Largest amount a Jetton balance can hold (TL-B `VarUInteger 16`). */
const MAX_COINS = (1n << 120n) - 1n;

const METADATA_FIELDS = ['name', 'symbol', 'decimals', 'description', 'image'] as const;

export function validateTokenProfile(profile: TokenProfile): TokenProfile {
  const { supply, metadata } = profile ?? ({} as TokenProfile);
  if (typeof supply !== 'string' || !/^[1-9][0-9]*$/.test(supply)) {
    throw new Error('token.json: "supply" must be a positive whole number written as a string, for example "100000000".');
  }
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('token.json: "metadata" is missing.');
  }
  // Everything in "metadata" is written on-chain, so nothing unexpected may ride along.
  const unknown = Object.keys(metadata).filter((key) => !(METADATA_FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    throw new Error(`token.json: "metadata" has unknown field(s): ${unknown.join(', ')}. Allowed: ${METADATA_FIELDS.join(', ')}.`);
  }
  for (const key of METADATA_FIELDS) {
    const value = metadata[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`token.json: "metadata.${key}" must be a non-empty string.`);
    }
    // Wallets show these strings as they are: no control characters, no stray spaces at the ends.
    // eslint-disable-next-line no-control-regex
    if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error(`token.json: "metadata.${key}" must not start or end with a space or contain control characters.`);
    }
  }
  if (!/^[A-Z0-9]{2,11}$/.test(metadata.symbol)) {
    throw new Error('token.json: "metadata.symbol" must be 2 to 11 upper-case letters or digits.');
  }
  if (!/^(0|[1-9][0-9]?)$/.test(metadata.decimals) || Number(metadata.decimals) > 18) {
    throw new Error('token.json: "metadata.decimals" must be a whole number from 0 to 18, written as a string.');
  }
  let image: URL;
  try {
    image = new URL(metadata.image);
  } catch {
    throw new Error('token.json: "metadata.image" must be an absolute URL.');
  }
  if (image.protocol !== 'https:') {
    throw new Error('token.json: "metadata.image" must be an https URL. Wallets will not load anything else.');
  }
  if (image.href !== metadata.image) {
    throw new Error(`token.json: "metadata.image" must be written in its normal form: ${image.href}`);
  }
  if (supplyInUnits(profile) > MAX_COINS) {
    throw new Error('token.json: "supply" times 10^decimals does not fit in a Jetton balance.');
  }
  return profile;
}

export function loadTokenProfile(): TokenProfile {
  const raw = readFileSync(new URL('../token.json', import.meta.url), 'utf8');
  return validateTokenProfile(JSON.parse(raw) as TokenProfile);
}

/** The supply in the smallest unit, which is what the contract stores. */
export function supplyInUnits(profile: TokenProfile): bigint {
  return BigInt(profile.supply) * 10n ** BigInt(profile.metadata.decimals);
}

/** Converts whole tokens to the smallest unit, for example `toUnits(profile, '1.5')`. */
export function toUnits(profile: TokenProfile, tokens: string): bigint {
  const decimals = Number(profile.metadata.decimals);
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(tokens);
  if (!match) throw new Error(`"${tokens}" is not a token amount. Use digits with an optional decimal point.`);
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) {
    throw new Error(`"${tokens}" has more than ${decimals} decimal places.`);
  }
  const units = BigInt(match[1] + fraction.padEnd(decimals, '0'));
  if (units > MAX_COINS) throw new Error(`"${tokens}" is more than a Jetton balance can hold.`);
  return units;
}

/** Formats an amount in the smallest unit as whole tokens, for example `1,000.5`. */
export function formatUnits(profile: TokenProfile, units: bigint): string {
  if (units < 0n) throw new Error('A token amount cannot be negative.');
  const decimals = Number(profile.metadata.decimals);
  const base = 10n ** BigInt(decimals);
  const whole = (units / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (units % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function metadataKey(name: string): bigint {
  return BigInt(`0x${sha256_sync(name).toString('hex')}`);
}

/**
 * Encodes metadata as a TEP-64 on-chain content cell: tag 0x00, then a
 * dictionary from sha256(key) to the value in snake format.
 */
export function buildOnchainContent(metadata: Record<string, string>): Cell {
  const fields = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
  for (const [key, value] of Object.entries(metadata)) {
    fields.set(metadataKey(key), beginCell().storeUint(SNAKE_DATA_TAG, 8).storeStringTail(value).endCell());
  }
  return beginCell().storeUint(ONCHAIN_CONTENT_TAG, 8).storeDict(fields).endCell();
}

/**
 * Decodes a TEP-64 on-chain content cell. `keyCount` is the number of entries
 * actually stored, so callers can tell when a cell holds keys outside
 * {@link METADATA_KEYS}.
 */
export function parseOnchainContent(content: Cell): { fields: Record<string, string>; keyCount: number } {
  const data = content.beginParse();
  const tag = data.loadUint(8);
  if (tag !== ONCHAIN_CONTENT_TAG) {
    throw new Error(`Expected on-chain metadata (tag 0x00) but found tag 0x${tag.toString(16).padStart(2, '0')}.`);
  }
  const stored = data.loadDict(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
  const fields: Record<string, string> = {};
  for (const key of METADATA_KEYS) {
    const cell = stored.get(metadataKey(key));
    if (!cell) continue;
    const value = cell.beginParse();
    const format = value.loadUint(8);
    if (format !== SNAKE_DATA_TAG) {
      throw new Error(`Metadata key "${key}" uses data format 0x${format.toString(16)}; only snake format (0x00) is supported.`);
    }
    fields[key] = value.loadStringTail();
  }
  return { fields, keyCount: stored.size };
}
