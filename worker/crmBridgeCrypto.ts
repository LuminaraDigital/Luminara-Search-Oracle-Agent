/**
 * Pure WebCrypto primitives for Luminara Suite <-> Luminara CRM wire security.
 *
 * Wire compatibility with `packages/Webkul/SuiteBridge`:
 * - Launch assertions: `<base64url(json_payload)>.<base64url(64_byte_ed25519_sig)>`
 * - Server-to-server HMAC: `sha256=<hmac_sha256("{ts}.{METHOD}.{path}.{rawBody}", secret)>`
 * - Encrypted D1 passport storage: AES-256-GCM (`v1:<iv_b64url>:<ct_b64url>` with AAD = `accountId`)
 */

import type { Env } from './env';
import { secretEquals } from './workerUtils';

export type CrmMode = 'standalone' | 'middle_layer';

const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

const SAFE_NEXT_PATH_RE = /^\/[a-zA-Z0-9/_-]{0,199}$/;

export function crmBaseUrl(env: Env): string {
  const raw = (env.CRM_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const isProdOrStaging = env.ENVIRONMENT === 'production' || env.ENVIRONMENT === 'staging';
    if (isProdOrStaging && parsed.protocol !== 'https:') return '';
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function crmBridgeOrigin(env: Env): string | null {
  if (!isCrmBridgeEnabled(env)) return null;
  const base = crmBaseUrl(env);
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

export function isCrmBridgeEnabled(env: Env): boolean {
  return env.CRM_BRIDGE_ENABLED === 'true' && Boolean(crmBaseUrl(env));
}

export function isStrongBridgeSecret(env: Env, secret: string): boolean {
  const trimmed = secret.trim();
  if (!trimmed) return false;
  const isProdOrStaging = env.ENVIRONMENT === 'production' || env.ENVIRONMENT === 'staging';
  return isProdOrStaging ? trimmed.length >= 32 : trimmed.length >= 8;
}

export function sanitizeNextPath(nextPath: unknown): string | undefined {
  if (typeof nextPath !== 'string') return undefined;
  const trimmed = nextPath.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.includes('..') || trimmed.includes('\\')) {
    return undefined;
  }
  return SAFE_NEXT_PATH_RE.test(trimmed) ? trimmed : undefined;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecode(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (encoded.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptPassportToken(plaintext: string, secret: string, accountId = ''): Promise<string> {
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params = accountId
    ? { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(accountId) }
    : { name: 'AES-GCM', iv };
  const encrypted = await crypto.subtle.encrypt(params, key, new TextEncoder().encode(plaintext));
  return `v1:${base64UrlEncode(iv)}:${base64UrlEncode(new Uint8Array(encrypted))}`;
}

export async function decryptPassportToken(
  ciphertext: string,
  secret: string,
  accountId = '',
  previousSecret?: string,
): Promise<string> {
  const parts = ciphertext.split(':');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new Error('Malformed encrypted CRM passport token.');
  }
  const iv = base64UrlDecode(parts[1]!);
  if (iv.length !== 12) {
    throw new Error('Invalid AES-GCM IV length.');
  }
  const data = base64UrlDecode(parts[2]!);
  const secrets = [secret, previousSecret].map((s) => (s || '').trim()).filter(Boolean);
  const aadList: Array<Uint8Array | undefined> = accountId
    ? [new TextEncoder().encode(accountId), undefined]
    : [undefined];

  for (const candidate of secrets) {
    const key = await deriveAesKey(candidate);
    for (const additionalData of aadList) {
      try {
        const params = additionalData ? { name: 'AES-GCM', iv, additionalData } : { name: 'AES-GCM', iv };
        const plain = await crypto.subtle.decrypt(params, key, data);
        return new TextDecoder().decode(plain);
      } catch {
        // Try next key / legacy AAD-less fallback during key rotation.
      }
    }
  }
  throw new Error('Unable to decrypt CRM passport token.');
}

export async function signSuiteHmac(
  secret: string,
  method: string,
  path: string,
  rawBody: string,
  timestampSec = Math.floor(Date.now() / 1000),
): Promise<{ timestamp: string; signature: string }> {
  const enc = new TextEncoder();
  const normalizedMethod = method.trim().toUpperCase();
  const normalizedPath = `/${path.trim().replace(/^\/+/, '')}`;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const canonical = `${timestampSec}.${normalizedMethod}.${normalizedPath}.${rawBody}`;
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(canonical));
  const hex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { timestamp: String(timestampSec), signature: `sha256=${hex}` };
}

export async function verifySuiteHmac(
  secret: string,
  method: string,
  path: string,
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  nowSec = Math.floor(Date.now() / 1000),
  previousSecret?: string,
): Promise<boolean> {
  if (!signatureHeader || !timestampHeader || !/^\d+$/.test(timestampHeader.trim())) {
    return false;
  }
  const ts = Number(timestampHeader.trim());
  if (Math.abs(nowSec - ts) > 300) return false;
  const secrets = [secret, previousSecret].map((s) => (s || '').trim()).filter(Boolean);
  if (secrets.length === 0) return false;

  const provided = signatureHeader.trim().toLowerCase();
  for (const candidate of secrets) {
    const expected = await signSuiteHmac(candidate, method, path, rawBody, ts);
    if (secretEquals(expected.signature, provided)) {
      return true;
    }
  }
  return false;
}

/**
 * Mint a 60-second single-use Ed25519 handoff assertion accepted by `POST /suite/handoff`.
 * Accepts either a 32-byte raw Ed25519 seed (base64) or a PKCS8 DER private key (base64).
 */
export async function mintLaunchAssertion(
  env: Env,
  claims: {
    sub: string;
    email?: string;
    nextPath?: string;
    crmMode?: CrmMode;
    ttlSeconds?: number;
    nowSec?: number;
  },
): Promise<{ assertion: string; expiresAt: number; handoffUrl: string }> {
  const keyB64 = (env.CRM_BRIDGE_SIGNING_KEY_B64 || '').trim();
  const base = crmBaseUrl(env);
  if (!keyB64 || !base) {
    throw new Error('CRM bridge signing key and base URL are required.');
  }

  const rawKeyBytes = base64UrlDecode(keyB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''));
  let pkcs8Bytes: Uint8Array;
  if (rawKeyBytes.length === 32) {
    pkcs8Bytes = new Uint8Array(ED25519_PKCS8_PREFIX.length + 32);
    pkcs8Bytes.set(ED25519_PKCS8_PREFIX, 0);
    pkcs8Bytes.set(rawKeyBytes, ED25519_PKCS8_PREFIX.length);
  } else {
    pkcs8Bytes = rawKeyBytes;
  }

  const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8Bytes, { name: 'Ed25519' }, false, ['sign']);

  const nowSec = claims.nowSec ?? Math.floor(Date.now() / 1000);
  const ttl = Math.max(15, Math.min(120, claims.ttlSeconds ?? 60));
  const exp = nowSec + ttl;
  const iss = (env.WEBAPP_URL || 'https://luminarasuite.com').replace(/\/+$/, '');
  const safeNext = sanitizeNextPath(claims.nextPath);

  const payload = {
    sub: claims.sub,
    iss,
    aud: base,
    jti: crypto.randomUUID(),
    iat: nowSec,
    exp,
    ...(claims.email ? { email: claims.email } : {}),
    ...(safeNext ? { next_path: safeNext } : {}),
    ...(claims.crmMode ? { crm_mode: claims.crmMode } : {}),
  };

  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sigBuf = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(payloadB64));
  const assertion = `${payloadB64}.${base64UrlEncode(new Uint8Array(sigBuf))}`;

  return {
    assertion,
    expiresAt: exp * 1000,
    handoffUrl: `${base}/suite/handoff`,
  };
}
