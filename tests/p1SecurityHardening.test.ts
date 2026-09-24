import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import { isAdminAuthorized } from '../worker/adminAuth';
import { licenseKeyFingerprint, recordAuditLogBestEffort } from '../worker/auditLog';
import { identifyMcpOAuthToken } from '../worker/mcpOAuth';
import {
  hashSharePassword,
  hashSharePasswordSalted,
  verifySharePassword,
  handleShareRoute,
  SHARE_PW_ITERATIONS,
} from '../worker/shareService';
import { crc16Xmodem } from '../worker/tonPayment';
import { sha256Hex } from '../worker/workerUtils';
import { createSqliteD1 } from './helpers/sqliteD1';
import { loadKeys, mergeRevocation } from '../scripts/revoke-license-keys.mjs';
import { writeFileSync, mkdtempSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Shared fakes
// ---------------------------------------------------------------------------

function kv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  } as unknown as KVNamespace;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } }) } as unknown as Fetcher,
    LUMINARA_KV: kv(),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    ...overrides,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

let ipCounter = 0;
const req = (path: string, init: RequestInit = {}, ip = `10.7.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`) => {
  const headers = new Headers(init.headers || {});
  headers.set('cf-connecting-ip', ip);
  return new Request(`https://luminarasuite.com${path}`, { ...init, headers });
};

const botToken = '123456:ADMIN_TEST';
function signInitData(fields: Record<string, string>): string {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

// ---------------------------------------------------------------------------
// 1) ADMIN_SECRET separation
// ---------------------------------------------------------------------------

describe('P1 ADMIN_SECRET separation', () => {
  const adminRoutes: Array<{ path: string; init: RequestInit; name: string }> = [
    { path: '/api/admin/users', init: {}, name: 'admin users dump' },
    { path: '/api/admin/license/generate', init: { method: 'POST', body: JSON.stringify({ plan: 'growth' }) }, name: 'admin generate' },
    { path: '/api/admin/license/seed', init: { method: 'POST', body: JSON.stringify({ keys: [{ key: 'LUM-GROWTH-30D-TEST-TEST', plan: 'growth' }] }) }, name: 'admin seed' },
    { path: '/api/telegram/refund', init: { method: 'POST', body: JSON.stringify({ userId: 123, chargeId: 'ch_x' }) }, name: 'telegram refund' },
  ];

  it('isAdminAuthorized fails closed with 503 when ADMIN_SECRET is unset', async () => {
    const result = isAdminAuthorized(makeEnv({ ADMIN_SECRET: undefined }), new Request('https://x/'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
      const body = (await result.response.json()) as { error: string };
      expect(body.error).toBe('admin API disabled: ADMIN_SECRET not configured');
    }
  });

  it('rejects a wrong ADMIN_SECRET with 401 and an instructive message', async () => {
    const env = makeEnv({ ADMIN_SECRET: 'real-admin-secret' });
    const result = isAdminAuthorized(env, new Request('https://x/', { headers: { 'x-admin-secret': 'wrong' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = (await result.response.json()) as { error: string; code: string };
      expect(body.code).toBe('ADMIN_SECRET_REQUIRED');
      expect(body.error).toContain('x-admin-secret');
    }
  });

  it('accepts the correct ADMIN_SECRET', () => {
    const env = makeEnv({ ADMIN_SECRET: 'real-admin-secret' });
    expect(isAdminAuthorized(env, new Request('https://x/', { headers: { 'x-admin-secret': 'real-admin-secret' } })).ok).toBe(true);
  });

  it('routes every admin route through isAdminAuthorized: unset -> 503, wrong -> 401, correct -> not-auth-rejected, webhook secret -> rejected', async () => {
    const envShared = makeEnv({ TELEGRAM_WEBHOOK_SECRET: 'webhook-secret' }); // ADMIN_SECRET unset
    const envWrong = makeEnv({ ADMIN_SECRET: 'real-admin-secret', TELEGRAM_WEBHOOK_SECRET: 'webhook-secret' });

    for (const route of adminRoutes) {
      // Unset ADMIN_SECRET -> 503
      let res = await worker.fetch(req(route.path, route.init), envShared, ctx);
      expect(res.status, `${route.name} unset`).toBe(503);

      // Wrong secret -> 401
      res = await worker.fetch(req(route.path, { ...route.init, headers: { 'x-admin-secret': 'nope' } }), envWrong, ctx);
      expect(res.status, `${route.name} wrong`).toBe(401);

      // Correct ADMIN_SECRET passes the auth gate (response may be 200/4xx for body reasons, never 401/503 auth)
      res = await worker.fetch(req(route.path, { ...route.init, headers: { 'x-admin-secret': 'real-admin-secret' } }), envWrong, ctx);
      expect([401, 503].includes(res.status), `${route.name} correct secret`).toBe(false);

      // TELEGRAM_WEBHOOK_SECRET must not authorize any admin route
      res = await worker.fetch(
        req(route.path, { ...route.init, headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' } }),
        envWrong,
        ctx,
      );
      expect(res.status, `${route.name} webhook secret`).toBe(401);

      // ...including via the x-admin-secret header carrying the webhook secret value
      res = await worker.fetch(
        req(route.path, { ...route.init, headers: { 'x-admin-secret': 'webhook-secret' } }),
        envWrong,
        ctx,
      );
      expect(res.status, `${route.name} webhook secret via x-admin-secret`).toBe(401);
    }
  });

  it('admin/users with a correct secret returns the projected list and records an audit entry', async () => {
    const env = makeEnv({ ADMIN_SECRET: 'real-admin-secret', BOT_TOKEN: botToken, REQUIRE_TG_AUTH: 'true' });
    const res = await worker.fetch(req('/api/admin/users', { headers: { 'x-admin-secret': 'real-admin-secret' } }), env, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; users: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.users)).toBe(true);

    const db = (env as { DB: ReturnType<typeof createSqliteD1> }).DB;
    const rows = await db.prepare(`SELECT action, details FROM org_audit_logs WHERE action = 'admin.users.dump'`).all();
    expect(rows.results.length).toBe(1);
    const details = JSON.parse((rows.results[0] as { details: string }).details) as { count: number };
    expect(details.count).toBe(0);
  });

  it('admin/license/generate with a correct secret mints keys and records one audit entry', async () => {
    const store = new Map<string, string>();
    const env = makeEnv({ ADMIN_SECRET: 'real-admin-secret', LUMINARA_KV: kv(store) });
    const res = await worker.fetch(
      req('/api/admin/license/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-secret': 'real-admin-secret' },
        body: JSON.stringify({ plan: 'growth', durationDays: 30, count: 2 }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; count: number; keys: Array<{ key: string }> };
    expect(body.count).toBe(2);
    expect(body.keys[0].key).toMatch(/^LUM-GROWTH-30D-/);
    // One audit record for the mint:
    const db = (env as { DB: ReturnType<typeof createSqliteD1> }).DB;
    const rows = await db.prepare(`SELECT action, details FROM org_audit_logs WHERE action = 'admin.license.generate'`).all();
    expect(rows.results.length).toBe(1);
    const details = JSON.parse((rows.results[0] as { details: string }).details) as { plan: string; count: number };
    expect(details.plan).toBe('growth');
    expect(details.count).toBe(2);
    // Raw key material must never reach the audit log:
    for (const k of body.keys) {
      expect((rows.results[0] as { details: string }).details).not.toContain(k.key);
    }
  });

  it('admin/license/seed with a correct secret imports keys and records one audit entry', async () => {
    const env = makeEnv({ ADMIN_SECRET: 'real-admin-secret' });
    const res = await worker.fetch(
      req('/api/admin/license/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-secret': 'real-admin-secret' },
        body: JSON.stringify({ keys: [{ key: 'LUM-GROWTH-30D-SEED-0001', plan: 'growth', durationDays: 30 }] }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; imported: string[] };
    expect(body.imported).toContain('LUM-GROWTH-30D-SEED-0001');
    const db = (env as { DB: ReturnType<typeof createSqliteD1> }).DB;
    const rows = await db.prepare(`SELECT details FROM org_audit_logs WHERE action = 'admin.license.seed'`).all();
    expect(rows.results.length).toBe(1);
    const details = JSON.parse((rows.results[0] as { details: string }).details) as { requested: number; imported: number };
    expect(details.imported).toBe(1);
    expect((rows.results[0] as { details: string }).details).not.toContain('LUM-GROWTH-30D-SEED-0001');
  });

  it('refund via the admin route records a stars.refund audit entry on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })));
    const env = makeEnv({ ADMIN_SECRET: 'real-admin-secret', BOT_TOKEN: botToken });
    try {
      const res = await worker.fetch(
        req('/api/telegram/refund', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-admin-secret': 'real-admin-secret' },
          body: JSON.stringify({ userId: 555, chargeId: 'chg_audit_1' }),
        }),
        env,
        ctx,
      );
      expect(res.status).toBe(200);
      const db = (env as { DB: ReturnType<typeof createSqliteD1> }).DB;
      const rows = await db.prepare(`SELECT details FROM org_audit_logs WHERE action = 'stars.refund'`).all();
      expect(rows.results.length).toBe(1);
      const details = JSON.parse((rows.results[0] as { details: string }).details) as { chargeId: string };
      expect(details.chargeId).toBe('chg_audit_1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('TELEGRAM_ADMIN_ID users can no longer authorize admin HTTP routes', async () => {
    const env = makeEnv({
      ADMIN_SECRET: 'real-admin-secret',
      TELEGRAM_ADMIN_ID: '999999',
      BOT_TOKEN: botToken,
      REQUIRE_TG_AUTH: 'false',
    });
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 999999, first_name: 'Admin' }),
    });
    const res = await worker.fetch(
      req('/api/admin/license/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ plan: 'growth' }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 2) MCP OAuth token hashing at rest
// ---------------------------------------------------------------------------

describe('P1 MCP OAuth token hashing', () => {
  function tokenEnv(store = new Map<string, string>()) {
    return { env: makeEnv({ LUMINARA_KV: kv(store), REQUIRE_TG_AUTH: 'false', MCP_OAUTH_SECRET: 'test-oauth-secret' }), store };
  }

  const tokenRecordJson = JSON.stringify({
    accountId: 'acct_1',
    userId: 'fb:u1',
    plan: 'growth',
    scope: 'mcp:free',
    createdAt: 1700000000000,
  });

  it('issue path stores under the sha256 of the token, never the raw token', async () => {
    const { env, store } = tokenEnv();
    // Drive the token endpoint directly (PKCE code flow).
    const code = 'oc_test_code_hashing';
    // Pre-place an auth code record the token exchange can consume.
    const challenge = await sha256Base64Url('verifier123');
    await store.set(`mcp_oauth_code:${code}`, JSON.stringify({
      accountId: 'acct_1',
      userId: 'fb:u1',
      plan: 'growth',
      redirectUri: 'http://localhost:8123/callback',
      codeChallenge: challenge,
      scope: 'mcp:free',
      createdAt: Date.now(),
    }));
    const res = await worker.fetch(
      req('/api/oauth/mcp/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: 'http://localhost:8123/callback', code_verifier: 'verifier123' }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string };
    expect(body.access_token).toMatch(/^mcp_/);
    // The raw token must NOT be a KV key; only its sha256 hex may appear.
    expect(store.has(`mcp_oauth_token:${body.access_token}`)).toBe(false);
    const hashedKey = `mcp_oauth_token:${await sha256Hex(body.access_token)}`;
    expect(store.has(hashedKey)).toBe(true);
    // And no KV key contains the raw token anywhere.
    expect([...store.keys()].some((k) => k.includes(body.access_token))).toBe(false);
  });

  it('legacy plaintext token authenticates and migrates to the hashed key', async () => {
    const { env, store } = tokenEnv();
    const legacyToken = 'mcp_tok_legacyabcdef';
    await store.set(`mcp_oauth_token:${legacyToken}`, tokenRecordJson);

    const resolved = await identifyMcpOAuthToken(env, legacyToken);
    expect(resolved).not.toBeNull();
    expect(resolved!.user.accountId).toBe('acct_1');
    expect(resolved!.scope).toBe('mcp:free');

    // Migrated: hashed record exists, plaintext record is gone.
    expect(store.has(`mcp_oauth_token:${legacyToken}`)).toBe(false);
    expect(store.has(`mcp_oauth_token:${await sha256Hex(legacyToken)}`)).toBe(true);
  });

  it('garbage tokens 401 (resolve to null) and never touch legacy paths', async () => {
    const { env, store } = tokenEnv();
    expect(await identifyMcpOAuthToken(env, 'mcp_totally_unknown')).toBeNull();
    expect(await identifyMcpOAuthToken(env, 'lm_live_not_an_mcp_token')).toBeNull();
    // Corrupt JSON in a legacy record resolves to null rather than throwing.
    await store.set('mcp_oauth_token:mcp_corrupt', '{not json');
    expect(await identifyMcpOAuthToken(env, 'mcp_corrupt')).toBeNull();
    expect(store.size).toBe(1); // corrupt record left as-is, not migrated
  });
});

// Local copy of the mcpOAuth base64url helper for building the PKCE challenge.
async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// 3) Audit-log money and admin events
// ---------------------------------------------------------------------------

describe('P1 money/admin audit logging', () => {
  it('license activation writes one license.activate record with a fingerprint, never the raw key', async () => {
    const store = new Map<string, string>();
    const env = makeEnv({ LUMINARA_KV: kv(store), BOT_TOKEN: botToken });
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 4242, first_name: 'Buyer' }),
    });
    // Seed a 30-day key the user can redeem.
    const key = 'LUM-GROWTH-30D-AUDT-0001';
    await store.set(`license:key:${key}`, JSON.stringify({
      key, plan: 'growth', durationDays: 30, isTrial: false, campaign: 'audit_test',
      createdAt: Date.now(), redeemed: false, maxRedemptions: 1, redemptionCount: 0,
    }));

    const res = await worker.fetch(
      req('/api/license/activate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ key }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);

    const db = (env as { DB: ReturnType<typeof createSqliteD1> }).DB;
    const rows = await db.prepare(`SELECT action, actor_id, details FROM org_audit_logs WHERE action = 'license.activate'`).all();
    expect(rows.results.length).toBe(1);
    const row = rows.results[0] as { action: string; actor_id: string; details: string };
    const details = JSON.parse(row.details) as { plan: string; keyFingerprint: string; durationDays: number };
    expect(details.plan).toBe('growth');
    expect(details.durationDays).toBe(30);
    expect(details.keyFingerprint).toBe(await licenseKeyFingerprint(key));
    expect(details.keyFingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(row.details).not.toContain(key);
    // D1 rows for the account's org id:
    expect(row.actor_id).toBe('4242');
  });

  it('TON credit success writes one ton.credit record with order + tx details', async () => {
    const { verifyTonPayment } = await import('../worker/tonPayment');
    const MERCHANT = syntheticTonAddress(0x11, 0x5a);
    const store = new Map<string, string>();
    const env = makeEnv({ LUMINARA_KV: kv(store), TON_RECEIVING_ADDRESS: MERCHANT, ENVIRONMENT: 'production' });

    const order = {
      orderId: 'ton_audit_1', userId: 'user_ton', planId: 'starter',
      amountNano: '15000000000', tonAmount: 15, memo: 'LUM:ton_audit_1:starter',
      recipientAddress: MERCHANT, status: 'pending', createdAt: Date.now(),
    };
    await store.set(`ton:order:${order.orderId}`, JSON.stringify(order));

    const fetcher = async () => new Response(JSON.stringify({
      ok: true,
      result: [{ transaction_id: { hash: 'txhash_audit_1' }, utime: Math.floor(Date.now() / 1000), in_msg: { value: order.amountNano, message: order.memo } }],
    }));

    const result = await verifyTonPayment(env, order.orderId, { expectedUserId: 'user_ton', fetcher: fetcher as never });
    expect(result.ok).toBe(true);

    const db = (env as { DB: ReturnType<typeof createSqliteD1> }).DB;
    const rows = await db.prepare(`SELECT action, details FROM org_audit_logs WHERE action = 'ton.credit'`).all();
    expect(rows.results.length).toBe(1);
    const details = JSON.parse((rows.results[0] as { details: string }).details) as { plan: string; orderId: string; txHash: string; tonAmount: number };
    expect(details.plan).toBe('starter');
    expect(details.orderId).toBe('ton_audit_1');
    expect(details.txHash).toBe('txhash_audit_1');
    expect(details.tonAmount).toBe(15);
  });

  it('recordAuditLogBestEffort swallows audit failures instead of failing money ops', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const throwingEnv = {
        DB: {
          prepare: () => {
            throw new Error('D1 outage');
          },
        } as unknown as D1Database,
      };
      // Must not throw.
      await recordAuditLogBestEffort(throwingEnv, {
        org_id: 'org_x', actor_id: 'u', action: 'ton.credit', details: { plan: 'starter' },
      });
      expect(errors).toHaveBeenCalled();
      expect(errors.mock.calls.flat(2).join(' ')).toContain('ton.credit');
    } finally {
      errors.mockRestore();
    }
  });
});

function syntheticTonAddress(tag: number, fill: number): string {
  const bytes = new Uint8Array(36);
  bytes[0] = tag;
  bytes[1] = 0x00;
  bytes.fill(fill, 2, 34);
  const crc = crc16Xmodem(bytes.subarray(0, 34));
  bytes[34] = crc >> 8;
  bytes[35] = crc & 0xff;
  return Buffer.from(bytes).toString('base64url');
}

// ---------------------------------------------------------------------------
// 4) Salted share-link passwords
// ---------------------------------------------------------------------------

describe('P1 salted share passwords', () => {
  const botTokenShare = '123456:SHARE_TEST';
  function shareEnv(store = new Map<string, string>()) {
    return {
      env: makeEnv({ LUMINARA_KV: kv(store), BOT_TOKEN: botTokenShare }),
      store,
    };
  }
  function shareInitData(id: number): string {
    const dcs = `auth_date=${Math.floor(Date.now() / 1000)}\nuser=${JSON.stringify({ id, first_name: 'Agency' })}`;
    const secret = createHmac('sha256', 'WebAppData').update(botTokenShare).digest();
    const hash = createHmac('sha256', secret).update(dcs).digest('hex');
    return new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id, first_name: 'Agency' }),
      hash,
    }).toString();
  }

  it('new writes use the salted pbkdf2 format with >= 120k iterations', async () => {
    const hash = await hashSharePasswordSalted('correct-horse');
    expect(hash).toMatch(/^pbkdf2\$120000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    const iterations = Number(hash.split('$')[1]);
    expect(iterations).toBeGreaterThanOrEqual(120_000);
    expect(SHARE_PW_ITERATIONS).toBeGreaterThanOrEqual(120_000);
    // Roundtrip: verify with the right password.
    const check = await verifySharePassword('correct-horse', hash);
    expect(check.ok).toBe(true);
    expect(check.upgradedHash).toBeUndefined();
  });

  it('roundtrip through the route: create with password, GET without pw -> 401, wrong pw -> 403, right pw -> 200', async () => {
    const { env } = shareEnv(new Map([['sub:99', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86400_000 })]]));
    const initData = shareInitData(99);
    const createRes = await handleShareRoute(
      new Request('https://luminarasuite.com/api/share/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
        body: JSON.stringify({ markdownText: '# Locked', password: 'correct-horse' }),
      }),
      env,
      '/share/reports',
    );
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { token: string };

    // Stored hash must be salted, not legacy sha256.
    const db = (env as { DB: ReturnType<typeof createSqliteD1> }).DB;
    const row = await db.prepare(`SELECT password_hash FROM shared_reports WHERE token_hash = ?`)
      .bind(await sha256Hex(created.token))
      .first<{ password_hash: string }>();
    expect(row!.password_hash).toMatch(/^pbkdf2\$/);

    expect((await handleShareRoute(new Request(`https://luminarasuite.com/api/share/reports/${created.token}`), env, `/share/reports/${created.token}`)).status).toBe(401);
    const wrong = await handleShareRoute(
      new Request(`https://luminarasuite.com/api/share/reports/${created.token}`, { headers: { 'x-share-password': 'wrong' } }),
      env,
      `/share/reports/${created.token}`,
    );
    expect(wrong.status).toBe(403);
    const right = await handleShareRoute(
      new Request(`https://luminarasuite.com/api/share/reports/${created.token}`, { headers: { 'x-share-password': 'correct-horse' } }),
      env,
      `/share/reports/${created.token}`,
    );
    expect(right.status).toBe(200);
  });

  it('legacy unsalted hash verifies and upgrades to the salted format in D1', async () => {
    const { env } = shareEnv(new Map([['sub:98', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86400_000 })]]));
    const db = (env as { DB: ReturnType<typeof createSqliteD1> }).DB;

    // Insert a share row with a legacy password hash directly.
    const token = 'a'.repeat(64);
    const legacyHash = await hashSharePassword('old-password');
    await db.prepare(
      `INSERT INTO shared_reports (id, token_hash, owner_account_id, report_json, branding_json, password_hash, expires_at, revoked_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, ?)`,
    )
      .bind('shr_legacy_1', await sha256Hex(token), 'acct_98', JSON.stringify({ version: 1, markdownText: '# Legacy', createdAt: Date.now(), expiresAt: null, passwordRequired: true }), legacyHash, Date.now())
      .run();

    // First successful legacy verify upgrades the stored hash.
    const first = await handleShareRoute(
      new Request(`https://luminarasuite.com/api/share/reports/${token}`, { headers: { 'x-share-password': 'old-password' } }),
      env,
      `/share/reports/${token}`,
    );
    expect(first.status).toBe(200);

    const upgraded = await db.prepare(`SELECT password_hash FROM shared_reports WHERE id = 'shr_legacy_1'`).first<{ password_hash: string }>();
    expect(upgraded!.password_hash).toMatch(/^pbkdf2\$/);
    expect(upgraded!.password_hash).not.toBe(legacyHash);

    // Second fetch verifies via the new format with no further upgrade.
    const second = await handleShareRoute(
      new Request(`https://luminarasuite.com/api/share/reports/${token}`, { headers: { 'x-share-password': 'old-password' } }),
      env,
      `/share/reports/${token}`,
    );
    expect(second.status).toBe(200);
  });

  it('rejects tampered pbkdf2 records (iteration downgrades / bad base64)', async () => {
    const real = await hashSharePasswordSalted('pw');
    const parts = real.split('$');
    const weak = `pbkdf2$999$${parts[2]}$${parts[3]}`;
    expect((await verifySharePassword('pw', weak)).ok).toBe(false);
    const badB64 = `pbkdf2$120000$!!!$${parts[3]}`;
    expect((await verifySharePassword('pw', badB64)).ok).toBe(false);
    const wrongPw = await hashSharePasswordSalted('pw');
    expect((await verifySharePassword('other', wrongPw)).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5) License revocation tooling
// ---------------------------------------------------------------------------

describe('P1 license revocation tooling', () => {
  const tmpFiles: string[] = [];
  afterEach(() => {
    for (const f of tmpFiles.splice(0)) {
      try {
        unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  function writeList(keys: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'luminara-keys-'));
    const file = join(dir, 'keys.json');
    writeFileSync(file, JSON.stringify(keys), 'utf8');
    tmpFiles.push(file);
    return file;
  }

  it('loadKeys accepts a valid out-of-band list and normalizes + dedupes', () => {
    const file = writeList(['lum-growth-30d-ab12-cd34', 'LUM-GROWTH-30D-AB12-CD34', ' LUM-STARTER-3D-EF56-GH78 ']);
    const result = loadKeys(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keys).toEqual(['LUM-GROWTH-30D-AB12-CD34', 'LUM-STARTER-3D-EF56-GH78']);
    }
  });

  it('loadKeys rejects malformed lists and never invents keys', () => {
    expect(loadKeys('C:/definitely-missing-file.json').ok).toBe(false);
    const file = writeList(['NOT-A-KEY']);
    const bad = loadKeys(file);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/malformed/);
  });

  it('mergeRevocation preserves record history and sets revoked + revokedAt', () => {
    const existing = JSON.stringify({
      key: 'LUM-GROWTH-30D-KEEP-0001', plan: 'growth', durationDays: 30, isTrial: false,
      campaign: 'ops', createdAt: 123, redeemed: true, redeemedBy: 'acct_9',
      redemptionCount: 1, maxRedemptions: 1,
    });
    const merged = JSON.parse(mergeRevocation(existing, 'LUM-GROWTH-30D-KEEP-0001', 1700000000000));
    expect(merged.revoked).toBe(true);
    expect(merged.revokedAt).toBe(1700000000000);
    // History preserved:
    expect(merged.plan).toBe('growth');
    expect(merged.redeemedBy).toBe('acct_9');
    expect(merged.campaign).toBe('ops');
    expect(merged.key).toBe('LUM-GROWTH-30D-KEEP-0001');
  });

  it('mergeRevocation tombstones a missing record so the key is explicitly revoked', () => {
    const merged = JSON.parse(mergeRevocation(null, 'LUM-GROWTH-30D-NEWK-0002', 1700000000000));
    expect(merged.revoked).toBe(true);
    expect(merged.key).toBe('LUM-GROWTH-30D-NEWK-0002');
  });

  it('revoked keys are rejected by activateLicenseKey (the runbook verification step)', async () => {
    const { activateLicenseKey } = await import('../worker/licenseService');
    const store = new Map<string, string>();
    const key = 'LUM-GROWTH-30D-RVOK-0003';
    await store.set(`license:key:${key}`, JSON.stringify({
      key, plan: 'growth', durationDays: 30, isTrial: false, campaign: 'revoked_test',
      createdAt: Date.now(), redeemed: false, maxRedemptions: 1, redemptionCount: 0,
      revoked: true, revokedAt: 1700000000000,
    }));
    const env = makeEnv({ LUMINARA_KV: kv(store) });
    const res = await activateLicenseKey(env, 'user_rv', key);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/revoked and can no longer be redeemed/i);
  });

  it('the runbook and script contain no key material', () => {
    const runbook = readFileSync('docs/plans/license-rotation-runbook.md', 'utf8');
    const script = readFileSync('scripts/revoke-license-keys.mjs', 'utf8');
    for (const text of [runbook, script]) {
      expect(text).not.toMatch(/LUM-[A-Z0-9]+-\d+D-[A-Z0-9]{4}-[A-Z0-9]{4}/);
    }
    expect(script).not.toMatch(/LUM-[A-Z0-9-]{8,}/);
  });
});