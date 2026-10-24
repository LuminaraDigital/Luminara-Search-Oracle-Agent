/**
 * HMAC-SHA256 request signing.
 *
 * specs/, docs/, and worker/securityHardening.ts do not name a request-signing
 * route. The existing HMAC request check is POST /webhooks/auth (x-auth-signature),
 * which has no timestamp, nonce, or key id. When REQUEST_SIGNING_REQUIRED is
 * "true", that route uses this scheme instead. The flag is off in production.
 * Signed Audit Receipts stay in D1. Keys are env only (REQUEST_SIGNING_KEYS).
 *
 * Headers: x-luminara-key-id, x-luminara-timestamp (unix seconds),
 * x-luminara-nonce, x-luminara-signature (hex HMAC-SHA256).
 * Canonical string: keyId, timestamp, nonce, METHOD, path, SHA-256(body), joined by newlines.
 */
import type { Env } from './env';
import { json } from './workerUtils';

export const REQUEST_SIGNING_PATHS = ['/webhooks/auth'] as const;
export const REQUEST_SIGNING_WINDOW_SEC = 300;

const KEY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

export type RequestSigningFailure = 'unknown_key' | 'expired' | 'tampered' | 'replayed';

export function isRequestSigningRequired(env: Pick<Env, 'REQUEST_SIGNING_REQUIRED'>): boolean {
  return String(env.REQUEST_SIGNING_REQUIRED || '') === 'true';
}

/** JSON object of key id to secret. Empty is no keys. A bad shape is misconfigured. Never log the raw value. */
export function parseRequestSigningKeys(raw: string | undefined): { ok: true; keys: Record<string, string> } | { ok: false } {
  const text = String(raw || '').trim();
  if (!text) return { ok: true, keys: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false };
  const keys: Record<string, string> = {};
  for (const [id, secret] of Object.entries(parsed)) {
    if (!KEY_ID_RE.test(id) || typeof secret !== 'string' || new TextEncoder().encode(secret).byteLength < 32) {
      return { ok: false };
    }
    keys[id] = secret;
  }
  return { ok: true, keys };
}

async function sha256Hex(bytes: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function canonical(input: { keyId: string; timestamp: string; nonce: string; method: string; path: string; bodyHash: string }): string {
  return [input.keyId, input.timestamp, input.nonce, input.method.toUpperCase(), input.path, input.bodyHash].join('\n');
}

export async function signRequestMac(input: {
  secret: string;
  keyId: string;
  timestampSec: number;
  nonce: string;
  method: string;
  path: string;
  body: string;
}): Promise<string> {
  const bodyHash = await sha256Hex(input.body);
  const message = canonical({
    keyId: input.keyId,
    timestamp: String(input.timestampSec),
    nonce: input.nonce,
    method: input.method,
    path: input.path,
    bodyHash,
  });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function verifySignedRequest(input: {
  keys: Record<string, string>;
  keyId: string;
  timestamp: string;
  nonce: string;
  signature: string;
  method: string;
  path: string;
  body: string;
  nowSec: number;
  consumeNonce: (keyId: string, nonce: string, nowMs: number) => Promise<boolean>;
}): Promise<{ ok: true } | { ok: false; code: RequestSigningFailure }> {
  const secret = input.keys[input.keyId];
  if (!secret) return { ok: false, code: 'unknown_key' };
  if (!/^\d+$/.test(input.timestamp) || !NONCE_RE.test(input.nonce)) return { ok: false, code: 'tampered' };
  const timestamp = Number(input.timestamp);
  if (Math.abs(input.nowSec - timestamp) > REQUEST_SIGNING_WINDOW_SEC) return { ok: false, code: 'expired' };
  const mac = hexToBytes(input.signature.trim());
  if (!mac) return { ok: false, code: 'tampered' };
  const bodyHash = await sha256Hex(input.body);
  const message = canonical({
    keyId: input.keyId,
    timestamp: input.timestamp,
    nonce: input.nonce,
    method: input.method,
    path: input.path,
    bodyHash,
  });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const matches = await crypto.subtle.verify('HMAC', key, mac, new TextEncoder().encode(message));
  if (!matches) return { ok: false, code: 'tampered' };
  const fresh = await input.consumeNonce(input.keyId, input.nonce, input.nowSec * 1000);
  if (!fresh) return { ok: false, code: 'replayed' };
  return { ok: true };
}

async function consumeD1Nonce(db: D1Database, keyId: string, nonce: string, nowMs: number): Promise<boolean | null> {
  try {
    await db.prepare(`DELETE FROM signed_request_nonces WHERE seen_at < ?`).bind(nowMs - REQUEST_SIGNING_WINDOW_SEC * 1000).run();
    const inserted = await db.prepare(
      `INSERT INTO signed_request_nonces (key_id, nonce, seen_at) VALUES (?, ?, ?) ON CONFLICT(key_id, nonce) DO NOTHING`,
    )
      .bind(keyId, nonce, nowMs)
      .run();
    return Number(inserted.meta?.changes ?? 0) === 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/no such table: signed_request_nonces/i.test(msg)) return null;
    throw err;
  }
}

/** Null when the request may continue. A Response when signing refuses it. */
export async function enforceRequestSigning(env: Env, request: Request, path: string, body: string): Promise<Response | null> {
  if (!isRequestSigningRequired(env) || !(REQUEST_SIGNING_PATHS as readonly string[]).includes(path)) {
    return null;
  }
  const parsed = parseRequestSigningKeys(env.REQUEST_SIGNING_KEYS);
  if (!parsed.ok || Object.keys(parsed.keys).length === 0) {
    return json(
      { ok: false, error: 'REQUEST_SIGNING_KEYS is not configured. No request was accepted.', code: 'REQUEST_SIGNING_MISCONFIGURED' },
      503,
    );
  }
  if (!env.DB) {
    return json({ ok: false, error: 'Request signing needs D1.', code: 'D1_UNAVAILABLE' }, 503);
  }
  const db = env.DB;
  let tableMissing = false;
  const result = await verifySignedRequest({
    keys: parsed.keys,
    keyId: request.headers.get('x-luminara-key-id') || '',
    timestamp: request.headers.get('x-luminara-timestamp') || '',
    nonce: request.headers.get('x-luminara-nonce') || '',
    signature: request.headers.get('x-luminara-signature') || '',
    method: request.method,
    path,
    body,
    nowSec: Math.floor(Date.now() / 1000),
    consumeNonce: async (keyId, nonce, nowMs) => {
      const fresh = await consumeD1Nonce(db, keyId, nonce, nowMs);
      if (fresh == null) {
        tableMissing = true;
        return false;
      }
      return fresh;
    },
  });
  if (tableMissing) {
    return json({ ok: false, error: 'Request signing needs migration 0040.', code: 'REQUEST_SIGNING_TABLE_MISSING' }, 503);
  }
  if (result.ok) return null;
  return json({ ok: false, error: 'Invalid request signature.', code: result.code }, 401);
}
