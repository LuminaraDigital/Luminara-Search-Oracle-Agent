/**
 * Validates Telegram Mini App initData (HMAC-SHA256 over the sorted data-check string).
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Uses Web Crypto so it runs on Cloudflare Workers without node:crypto.
 */

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export type ValidationResult =
  | { ok: true; user: TelegramUser; authDate: number; startParam?: string }
  | { ok: false; reason: string };

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(message));
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Default Mini App initData freshness window (1 hour). Reopen the Mini App to refresh. */
export const TELEGRAM_INIT_DATA_TTL_SECONDS = 3600;

export async function validateInitData(
  initData: string,
  botToken: string,
  ttlSeconds = TELEGRAM_INIT_DATA_TTL_SECONDS,
): Promise<ValidationResult> {
  // Reject duplicate keys to defend against parameter injection & HTTP parameter pollution
  const rawPairs = initData.split('&');
  const seenKeys = new Set<string>();
  for (const pair of rawPairs) {
    if (!pair) continue;
    const eqIdx = pair.indexOf('=');
    const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    const key = decodeURIComponent(rawKey);
    if (seenKeys.has(key)) {
      return { ok: false, reason: 'initData contains duplicate parameters' };
    }
    seenKeys.add(key);
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'initData is not a query string' };
  }
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'initData has no hash' };
  // First-party HMAC validation excludes only `hash`.
  // Do NOT delete `signature` here: since Bot API 7.2 Telegram includes `signature`
  // in the signed payload, and stripping it causes signature mismatch for every real client.
  // (Third-party Ed25519 validation is the path that excludes both hash and signature.)
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = await hmac(enc.encode('WebAppData'), botToken);
  const computed = toHex(await hmac(secretKey, dataCheckString));
  if (!constantTimeEqual(computed, hash)) return { ok: false, reason: 'initData signature mismatch' };

  const nowSec = Date.now() / 1000;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate) return { ok: false, reason: 'initData missing auth_date' };
  if (authDate > nowSec + 60) return { ok: false, reason: 'initData auth_date is in the future' };
  if (nowSec - authDate > ttlSeconds) return { ok: false, reason: 'initData expired; reopen the app' };

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'initData has no user' };
  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return { ok: false, reason: 'user field is not JSON' };
  }
  if (typeof user.id !== 'number') return { ok: false, reason: 'user.id missing' };

  return { ok: true, user, authDate, startParam: params.get('start_param') || undefined };
}

function toBase64Url(str: string): string {
  const bytes = enc.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Creates an HttpOnly-compatible signed Telegram session token.
 * Contains user claims and cryptographic HMAC-SHA256 signature using the server bot token.
 */
export async function createTelegramSessionToken(
  user: TelegramUser,
  botToken: string,
  ttlSeconds = 14 * 24 * 3600,
): Promise<string> {
  const payload = {
    sub: String(user.id),
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const secretKey = await hmac(enc.encode('TelegramSessionToken'), botToken);
  const signature = toHex(await hmac(secretKey, payloadB64));
  return `tg_sess_${payloadB64}.${signature}`;
}

/**
 * Verifies a Telegram session token issued by createTelegramSessionToken.
 * Ensures the signature is valid, un-tampered, and non-expired.
 */
export async function verifyTelegramSessionToken(
  token: string,
  botToken: string,
): Promise<{ ok: true; user: TelegramUser } | { ok: false; reason: string }> {
  if (!token || !token.startsWith('tg_sess_')) return { ok: false, reason: 'Invalid token prefix' };
  const rest = token.slice('tg_sess_'.length);
  const dot = rest.indexOf('.');
  if (dot === -1) return { ok: false, reason: 'Malformed session token' };
  const payloadB64 = rest.slice(0, dot);
  const signature = rest.slice(dot + 1);

  const secretKey = await hmac(enc.encode('TelegramSessionToken'), botToken);
  const computed = toHex(await hmac(secretKey, payloadB64));
  if (!constantTimeEqual(computed, signature)) {
    return { ok: false, reason: 'Invalid session signature' };
  }

  let payload: { sub?: string; first_name?: string; last_name?: string; username?: string; exp?: number };
  try {
    payload = JSON.parse(fromBase64Url(payloadB64));
  } catch {
    return { ok: false, reason: 'Corrupt session payload' };
  }

  if (!payload.sub || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'Incomplete session payload' };
  }
  if (Date.now() / 1000 > payload.exp) {
    return { ok: false, reason: 'Session expired' };
  }

  return {
    ok: true,
    user: {
      id: Number(payload.sub),
      first_name: payload.first_name || '',
      last_name: payload.last_name,
      username: payload.username,
    },
  };
}
