/**
 * Trust Receipt signing key (TN0-3). Ed25519 private JWK in the
 * RECEIPT_SIGNING_KEY secret; the public half is published at
 * GET /api/trust/keys so anyone can verify a receipt offline.
 *
 * Rotation: generate a new key (`npm run keys:receipt`), move the old public
 * JWK into RECEIPT_RETIRED_PUBLIC_KEYS (JSON array), then replace the secret.
 * Receipts carry `kid`, so old receipts keep verifying.
 */
import type { Env } from './env';
import {
  bytesToBase64Url,
  canonicalJson,
  receiptKeyId,
  type ReceiptPublicJwk,
} from '../services/trust/receiptCrypto';

type SigningKey = { key: CryptoKey; publicJwk: ReceiptPublicJwk };

let cached: { raw: string; value: SigningKey } | null = null;

export class ReceiptSigningUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptSigningUnavailable';
  }
}

async function loadSigningKey(env: Pick<Env, 'RECEIPT_SIGNING_KEY'>): Promise<SigningKey> {
  const raw = String(env.RECEIPT_SIGNING_KEY || '').trim();
  if (!raw) throw new ReceiptSigningUnavailable('RECEIPT_SIGNING_KEY is not configured');
  if (cached && cached.raw === raw) return cached.value;

  let jwk: { kty?: string; crv?: string; d?: string; x?: string };
  try {
    jwk = JSON.parse(raw);
  } catch {
    throw new ReceiptSigningUnavailable('RECEIPT_SIGNING_KEY must be an Ed25519 private JWK (JSON)');
  }
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.d || !jwk.x) {
    throw new ReceiptSigningUnavailable('RECEIPT_SIGNING_KEY must be an Ed25519 private JWK with d and x');
  }
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', d: jwk.d, x: jwk.x },
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const publicJwk: ReceiptPublicJwk = { kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid: await receiptKeyId(jwk.x) };
  const value = { key, publicJwk };
  cached = { raw, value };
  return value;
}

export function isReceiptSigningConfigured(env: Pick<Env, 'RECEIPT_SIGNING_KEY'>): boolean {
  return Boolean(String(env.RECEIPT_SIGNING_KEY || '').trim());
}

/** Signs canonicalJson(payload). Throws ReceiptSigningUnavailable when no key is configured. */
export async function signReceiptPayload(
  env: Pick<Env, 'RECEIPT_SIGNING_KEY'>,
  payload: unknown,
): Promise<{ signature: string; kid: string }> {
  const { key, publicJwk } = await loadSigningKey(env);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(canonicalJson(payload)));
  return { signature: bytesToBase64Url(new Uint8Array(sig)), kid: publicJwk.kid };
}

/** Current kid, or null when signing is not configured. */
export async function currentReceiptKid(env: Pick<Env, 'RECEIPT_SIGNING_KEY'>): Promise<string | null> {
  if (!isReceiptSigningConfigured(env)) return null;
  return (await loadSigningKey(env)).publicJwk.kid;
}

/** Public key set: current key first, then retired keys that still verify old receipts. */
export async function receiptPublicKeySet(
  env: Pick<Env, 'RECEIPT_SIGNING_KEY' | 'RECEIPT_RETIRED_PUBLIC_KEYS'>,
): Promise<{ keys: ReceiptPublicJwk[] }> {
  const keys: ReceiptPublicJwk[] = [];
  if (isReceiptSigningConfigured(env)) keys.push((await loadSigningKey(env)).publicJwk);
  const retiredRaw = String(env.RECEIPT_RETIRED_PUBLIC_KEYS || '').trim();
  if (retiredRaw) {
    try {
      const parsed = JSON.parse(retiredRaw) as Array<{ kty?: string; crv?: string; x?: string }>;
      for (const k of Array.isArray(parsed) ? parsed : []) {
        if (k?.kty === 'OKP' && k.crv === 'Ed25519' && typeof k.x === 'string' && k.x) {
          const kid = await receiptKeyId(k.x);
          if (!keys.some((existing) => existing.kid === kid)) keys.push({ kty: 'OKP', crv: 'Ed25519', x: k.x, kid });
        }
      }
    } catch {
      console.error('[receipts] RECEIPT_RETIRED_PUBLIC_KEYS is not valid JSON; retired keys not published');
    }
  }
  return { keys };
}

/** Test-only: drop the per-isolate key cache. */
export function resetReceiptKeyCacheForTests(): void {
  cached = null;
}
