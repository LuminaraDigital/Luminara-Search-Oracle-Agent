/**
 * Read-only Search Console connect. Off unless GSC_OAUTH_ENABLED is on.
 * The only scope requested or stored is webmasters.readonly. No Search Console read runs here.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { identifiedForRequest } from './authMiddleware';
import { billingId, identify, json } from './workerUtils';

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const STATE_TTL_SEC = 600;

const ENABLING = new Set(['true', 'on', 'enforce', '1', 'yes']);

export function gscOauthEnabled(env: { GSC_OAUTH_ENABLED?: string }): boolean {
  return ENABLING.has(String(env.GSC_OAUTH_ENABLED ?? '').trim().toLowerCase());
}

function appOrigin(env: Env): string {
  const raw = (env.WEBAPP_URL || 'https://www.luminarasuite.com').trim().replace(/\/$/, '');
  return raw.startsWith('https://') ? raw : 'https://www.luminarasuite.com';
}

export function gscRedirectUri(env: Env): string {
  return `${appOrigin(env)}/api/gsc/callback`;
}

function missingSecret(env: Env): string | null {
  if (!env.GOOGLE_OAUTH_CLIENT_ID?.trim()) return 'GOOGLE_OAUTH_CLIENT_ID';
  if (!env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()) return 'GOOGLE_OAUTH_CLIENT_SECRET';
  if (!env.GSC_TOKEN_KEY?.trim()) return 'GSC_TOKEN_KEY';
  return null;
}

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptGscToken(secret: string, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), new TextEncoder().encode(token)),
  );
  return `v1:${b64url(iv)}:${b64url(cipher)}`;
}

export async function decryptGscToken(secret: string, stored: string): Promise<string | null> {
  const [version, ivPart, cipherPart] = stored.split(':');
  if (version !== 'v1' || !ivPart || !cipherPart) return null;
  const iv = fromB64url(ivPart);
  const cipher = fromB64url(cipherPart);
  if (!iv || !cipher) return null;
  try {
    const ivBuf = new Uint8Array(iv);
    const cipherBuf = new Uint8Array(cipher);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuf }, await aesKey(secret), cipherBuf);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export function gscScopesAllowed(scope: string): boolean {
  const parts = scope.split(/[\s,]+/).filter(Boolean);
  return parts.length > 0 && parts.every((part) => part === GSC_SCOPE);
}

function stateKey(state: string): string {
  return `gsc-oauth-state:${state}`;
}

async function signedIn(request: Request, env: Env): Promise<HostedIdentity | Response> {
  const who = identifiedForRequest(request) ?? await identify(request, env);
  if (!who.user) return json({ ok: false, error: who.error || 'Sign in required.' }, 401);
  return who.user;
}

function isUser(value: HostedIdentity | Response): value is HostedIdentity {
  return !(value instanceof Response);
}

export async function handleGscRoute(
  request: Request,
  env: Env,
  path: string,
  deps: { tokenFetcher?: typeof fetch } = {},
): Promise<Response | null> {
  if (path !== '/gsc/status' && path !== '/gsc/connect' && path !== '/gsc/disconnect' && path !== '/gsc/callback') {
    return null;
  }
  if (!gscOauthEnabled(env)) return json({ ok: false, error: 'Search Console connect is off.' }, 404);
  const user = await signedIn(request, env);
  if (!isUser(user)) return user;
  const accountId = billingId(user);
  if (path === '/gsc/status' && request.method === 'GET') return readStatus(env, accountId);
  if (path === '/gsc/disconnect' && request.method === 'POST') return disconnect(env, accountId);
  if (path === '/gsc/connect' && request.method === 'POST') return beginGscConnect(env, accountId);
  if (path === '/gsc/callback' && request.method === 'GET') return finishGscConnect(request, env, accountId, deps.tokenFetcher);
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}

async function readStatus(env: Env, accountId: string): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Search Console storage is unavailable.' }, 503);
  const row = await env.DB.prepare(
    `SELECT scopes, updated_at FROM gsc_oauth_tokens WHERE account_id = ?`,
  ).bind(accountId).first<{ scopes: string | null; updated_at: number }>();
  return json({
    ok: true,
    enabled: true,
    connected: Boolean(row),
    scopes: row?.scopes || null,
    updatedAt: row?.updated_at || null,
  });
}

async function disconnect(env: Env, accountId: string): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Search Console storage is unavailable.' }, 503);
  await env.DB.prepare(`DELETE FROM gsc_oauth_tokens WHERE account_id = ?`).bind(accountId).run();
  return json({ ok: true, connected: false });
}

export async function beginGscConnect(env: Env, accountId: string): Promise<Response> {
  const missing = missingSecret(env);
  if (missing) {
    return json({ ok: false, error: `Search Console connect needs the Worker secret ${missing}.` }, 503);
  }
  if (!env.LUMINARA_KV) return json({ ok: false, error: 'Search Console connect needs the LUMINARA_KV binding.' }, 503);
  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  const state = b64url(stateBytes);
  await env.LUMINARA_KV.put(stateKey(state), accountId, { expirationTtl: STATE_TTL_SEC });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID!.trim());
  url.searchParams.set('redirect_uri', gscRedirectUri(env));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GSC_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'false');
  url.searchParams.set('state', state);
  return json({ ok: true, url: url.toString() });
}

type TokenResponse = { refresh_token?: unknown; scope?: unknown; error?: unknown };

export async function finishGscConnect(
  request: Request,
  env: Env,
  accountId: string,
  tokenFetcher: typeof fetch = fetch,
): Promise<Response> {
  const missing = missingSecret(env);
  if (missing) return htmlPage(`Search Console connect needs the Worker secret ${missing}.`, 503);
  if (!env.DB || !env.LUMINARA_KV) return htmlPage('Search Console connect is not ready.', 503);
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const oauthError = url.searchParams.get('error');
  if (oauthError) return htmlPage('Google did not connect Search Console.', 400);
  if (code.length < 10 || code.length > 512 || /[\s<>]/.test(code) || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
    return htmlPage('This Search Console link is not valid.', 400);
  }
  const storedAccount = await env.LUMINARA_KV.get(stateKey(state));
  await env.LUMINARA_KV.delete(stateKey(state));
  if (!storedAccount || storedAccount !== accountId) return htmlPage('This Search Console link is not valid.', 400);
  let token: TokenResponse;
  try {
    const response = await tokenFetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: env.GOOGLE_OAUTH_CLIENT_ID!.trim(),
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!.trim(),
        redirect_uri: gscRedirectUri(env),
      }),
    });
    token = (await response.json()) as TokenResponse;
    if (!response.ok) return htmlPage('Google did not connect Search Console.', 502);
  } catch {
    return htmlPage('Google did not connect Search Console.', 502);
  }
  if (typeof token.refresh_token !== 'string' || !token.refresh_token) {
    return htmlPage('Google did not return a refresh token. Connect again and accept the read-only prompt.', 502);
  }
  const scope = typeof token.scope === 'string' ? token.scope : '';
  if (!gscScopesAllowed(scope)) {
    return htmlPage('Google returned a scope other than the read-only Search Console scope. Nothing was stored.', 400);
  }
  const encrypted = await encryptGscToken(env.GSC_TOKEN_KEY!.trim(), token.refresh_token);
  await env.DB.prepare(
    `INSERT INTO gsc_oauth_tokens (account_id, refresh_token_enc, scopes, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc, scopes = excluded.scopes, updated_at = excluded.updated_at`,
  ).bind(accountId, encrypted, GSC_SCOPE, Date.now()).run();
  return htmlPage('Search Console is connected for read-only access. You can close this tab.', 200);
}

function htmlPage(message: string, status: number): Response {
  const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Search Console</title></head><body><p>${safe}</p></body></html>`;
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
