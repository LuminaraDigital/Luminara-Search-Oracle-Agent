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

export async function validateInitData(initData: string, botToken: string, ttlSeconds = 24 * 3600): Promise<ValidationResult> {
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
