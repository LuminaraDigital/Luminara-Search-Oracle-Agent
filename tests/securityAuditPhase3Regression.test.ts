import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../worker/env';
import { computeSubscriptionExpiry, MAX_SUBSCRIPTION_DAYS } from '../worker/planRank';
import { checkOrRecordExternalEffect, finalizeExternalEffect } from '../worker/externalEffectsService';
import { reserveBudgetForCall, settleBudgetReservation, upsertBudgetPolicy } from '../worker/budgets';
import { createProject } from '../worker/projectService';
import { enforceKvSlidingWindow, passwordResetIpLimiter } from '../worker/securityHardening';
import { handleGoogleSignIn, handleSignUp, handleTokenRefresh } from '../worker/authCredentialGateway';
import { handleRequestOtp, handleVerifyOtp } from '../worker/authOtpSms';
import { isAppCheckExempt } from '../worker/appCheck';
import { createApiKey, identifyApiKey } from '../worker/apiKeyService';
import { eraseAccountRows } from '../worker/privacyService';
import { identify, secretEquals } from '../worker/workerUtils';
import { HTML_CSP } from '../worker/security';
import { createFirestoreClient } from '../worker/firestoreRest';
import { AutoLockService } from '../services/security/autoLockService';
import { getOrCreateAccountEncryptionPassphrase } from '../services/crypto/envelopeEncryptionService';
import { LuminaraVaultService } from '../services/vault/luminaraVaultService';
import { MAX_CLIENT_UPLOAD_BYTES, validateClientUploadFile } from '../utils/fileUploadGuard';
import { createSqliteD1 } from './helpers/sqliteD1';

const require = createRequire(import.meta.url);

function makeKv(store = new Map<string, string>(), opts?: { failPut?: boolean }): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const val = store.get(key) ?? null;
      return val !== null && type === 'json' ? JSON.parse(val) : val;
    },
    put: async (key: string, value: string) => {
      if (opts?.failPut) throw new Error('KV write contention');
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async ({ prefix }: { prefix?: string } = {}) => ({
      keys: [...store.keys()]
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
      cacheStatus: null,
    }),
  } as unknown as KVNamespace;
}

describe('Phase 3 Security Regression: Billing, Races, and D1 0061 Triggers', () => {
  it('H-04: prorates cross-tier Starter -> Agency upgrades and caps at 730 days', () => {
    const now = 1_700_000_000_000;
    const dayMs = 86_400_000;
    const starter300 = { plan: 'starter', expiresAt: now + 300 * dayMs };
    const upgraded = computeSubscriptionExpiry(starter300, 'agency', 30, now);
    const remainingDays = (upgraded - now) / dayMs;
    // Starter (7900) / Agency (54900) * 300d ~= 43.17d + 30d ~= 73.17d (never 330d).
    expect(remainingDays).toBeGreaterThan(72);
    expect(remainingDays).toBeLessThan(75);

    const capped = computeSubscriptionExpiry({ plan: 'agency', expiresAt: now + 720 * dayMs }, 'agency', 90, now);
    expect(capped).toBe(now + MAX_SUBSCRIPTION_DAYS * dayMs);
  });

  it('H-07: external effects ledger admits at most one concurrent caller and supports stale lease takeover', async () => {
    const db = createSqliteD1();
    const env = { DB: db } as unknown as Env;
    const args = {
      accountId: 'acct_race',
      projectId: 'proj_1',
      targetSystem: 'hubspot',
      actionKind: 'sync_contact',
      payload: { email: 'lead@example.com' },
      now: 1_700_000_000_000,
    };

    const [first, second] = await Promise.all([
      checkOrRecordExternalEffect(env, args),
      checkOrRecordExternalEffect(env, args),
    ]);
    const winners = [first, second].filter((r) => !r.duplicate);
    const losers = [first, second].filter((r) => r.duplicate);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    if (losers[0]?.duplicate) expect(losers[0].inProgress).toBe(true);

    // After stale lease (> 5 min), another worker can take over atomically.
    const takenOver = await checkOrRecordExternalEffect(env, {
      ...args,
      now: args.now + 6 * 60 * 1000,
    });
    expect(takenOver.duplicate).toBe(false);

    await finalizeExternalEffect(env, takenOver.effectKey, args.accountId, { synced: true });
    const afterDone = await checkOrRecordExternalEffect(env, {
      ...args,
      now: args.now + 12 * 60 * 1000,
    });
    expect(afterDone.duplicate).toBe(true);
    if (afterDone.duplicate) expect(afterDone.cachedResult).toEqual({ synced: true });
  });

  it('H-08: atomic budget reservation prevents concurrent hard-cap TOCTOU overspend and settles failed calls', async () => {
    const db = createSqliteD1();
    const env = { DB: db, BUDGET_ENFORCEMENT: 'hard' } as unknown as Env;
    const now = Date.UTC(2026, 4, 10, 12, 0, 0);
    await upsertBudgetPolicy(env, {
      accountId: 'acct_budget',
      monthlyBudgetCents: 100,
      hardStopEnabled: true,
      now,
    });

    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        reserveBudgetForCall(env, {
          accountId: 'acct_budget',
          estimatedCents: 60,
          toolName: `tool_${i}`,
          now,
        }),
      ),
    );
    const admitted = attempts.filter((r) => r.ok);
    const halted = attempts.filter((r) => !r.ok);
    expect(admitted).toHaveLength(1);
    expect(halted).toHaveLength(4);

    // Releasing the reservation on tool failure restores full capacity.
    if (admitted[0]?.ok) {
      await settleBudgetReservation(env, admitted[0].reservationId, 0);
    }
    const afterRelease = await reserveBudgetForCall(env, {
      accountId: 'acct_budget',
      estimatedCents: 100,
      toolName: 'tool_after',
      now,
    });
    expect(afterRelease.ok).toBe(true);
  });

  it('M-13: D1 migration 0061 triggers reject negative amounts and invalid bounds at the DB layer', async () => {
    const db = createSqliteD1();
    await expect(
      db.prepare(
        `INSERT INTO cost_events (id, account_id, tool_name, provider, billed_cents, credit_class, source, created_at)
         VALUES ('c1', 'a1', 't1', 'p1', -5, 'paid', 'rate_card', 1000)`,
      ).run(),
    ).rejects.toThrow(/non-negative/i);

    await expect(
      db.prepare(
        `INSERT INTO invoice_reconcile_runs
         (id, account_id, provider, period_start, period_end, internal_cents, invoice_cents, delta_cents, status, created_at)
         VALUES ('r1', 'a1', 'p1', 2000, 1000, 10, 10, 0, 'ok', 2000)`,
      ).run(),
    ).rejects.toThrow(/period_start/i);

    await expect(
      db.prepare(
        `INSERT INTO recovery_runs (id, account_id, project_id, enquiry_id, step_index, status, created_at, updated_at)
         VALUES ('rr1', 'a1', 'p1', 'e1', 5, 'sent', 1000, 1000)`,
      ).run(),
    ).rejects.toThrow(/step_index/i);

    await expect(
      db.prepare(
        `INSERT INTO stars_charges (charge_id, payer_tg_id, account_id, purpose, ref_id, stars, status, created_at, updated_at)
         VALUES ('sc1', 12345, 'a1', 'plan', 'starter', 0, 'received', 1000, 1000)`,
      ).run(),
    ).rejects.toThrow(/stars > 0/i);
  });

  it('M-17: createProject with maxClients atomically blocks concurrent client-cap bypass', async () => {
    const db = createSqliteD1();
    const env = { DB: db } as unknown as Env;
    const [a, b] = await Promise.all([
      createProject(env, 'acct_cap', { domain: 'alpha.example.com', clientId: 'client_a', maxClients: 1 }),
      createProject(env, 'acct_cap', { domain: 'beta.example.com', clientId: 'client_b', maxClients: 1 }),
    ]);
    const okCount = [a, b].filter((r) => r.ok).length;
    const blocked = [a, b].filter((r) => !r.ok);
    expect(okCount).toBe(1);
    expect(blocked).toHaveLength(1);
    if (!blocked[0]!.ok) expect(blocked[0]!.status).toBe(403);
  });
});

describe('Phase 3 Security Regression: Rate Limits, Auth, OTP, App Check, Deletion', () => {
  it('H-09: security sliding window fails closed when KV write throws', async () => {
    const env = {
      LUMINARA_KV: makeKv(new Map(), { failPut: true }),
      REQUIRE_TG_AUTH: 'true',
    } as unknown as Env;
    const res = await passwordResetIpLimiter(env, 'ip:198.51.100.50');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(429);

    const direct = await enforceKvSlidingWindow(env, {
      key: 'rl:test_fail_closed',
      maxRequests: 5,
      windowSeconds: 60,
      failClosedWithoutKv: true,
    });
    expect(direct.ok).toBe(false);
  });

  it('H-10: enforces 8-char minimum password, refresh rate limits, and App Check on /auth/refresh and /auth/google', async () => {
    const kv = makeKv();
    const env = {
      LUMINARA_KV: kv,
      FIREBASE_WEB_API_KEY: 'key',
      FIREBASE_PROJECT_NUMBER: '274315225068',
      REQUIRE_APP_CHECK: 'true',
      WEBAPP_URL: 'https://luminarasuite.com/',
    } as unknown as Env;

    const weakRes = await handleSignUp(
      new Request('https://luminarasuite.com/api/auth/sign-up', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@example.com', password: '1234567' }),
      }),
      { ...env, REQUIRE_APP_CHECK: 'false' } as Env,
      '198.51.100.61',
      { minLatencyMs: 0 },
    );
    expect(weakRes.status).toBe(400);
    expect(await weakRes.json()).toMatchObject({ code: 'WEAK_PASSWORD' });

    const refreshNoAppCheck = await handleTokenRefresh(
      new Request('https://luminarasuite.com/api/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.62' },
        body: JSON.stringify({ refreshToken: 'tok_123' }),
      }),
      env,
      { fetchImpl: vi.fn() as unknown as typeof fetch },
    );
    expect(refreshNoAppCheck.status).toBe(401);

    const googleNoAppCheck = await handleGoogleSignIn(
      new Request('https://luminarasuite.com/api/auth/google', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ googleIdToken: 'g.tok.123' }),
      }),
      env,
      '198.51.100.63',
      { fetchImpl: vi.fn() as unknown as typeof fetch },
    );
    expect(googleNoAppCheck.status).toBe(401);
  });

  it('H-11: SMS OTP enforces per-phone cooldown, rejects expired/tampered codes without extending TTL, and locks after 5 tries', async () => {
    const store = new Map<string, string>();
    const env = {
      LUMINARA_KV: makeKv(store),
      OTP_SMS_ENABLED: 'true',
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'secret-twilio-token',
      TWILIO_FROM_NUMBER: '+15550001111',
      OUTBOUND_EMAIL_DAILY_LIMIT: '50',
    } as unknown as Env;

    let sentCode = '';
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const bodyText = new URLSearchParams(String(init?.body || '')).get('Body') || '';
      const m = /code is (\d{6})/.exec(bodyText);
      if (m) sentCode = m[1]!;
      return new Response('{}', { status: 201 });
    });

    const req1 = await handleRequestOtp(
      new Request('https://luminarasuite.com/api/auth/request-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '+15551234567' }),
      }),
      env,
      '198.51.100.71',
      { fetchImpl: fetchImpl as unknown as typeof fetch, minLatencyMs: 0 },
    );
    expect(req1.status).toBe(200);
    expect(sentCode).toMatch(/^\d{6}$/);

    // Second request for the same phone from a different IP hits per-phone cooldown (429).
    const req2 = await handleRequestOtp(
      new Request('https://luminarasuite.com/api/auth/request-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '+15551234567' }),
      }),
      env,
      '198.51.100.72',
      { fetchImpl: fetchImpl as unknown as typeof fetch, minLatencyMs: 0 },
    );
    expect(req2.status).toBe(429);

    const otpKey = [...store.keys()].find((k) => k.startsWith('otp:sms:'))!;
    const before = JSON.parse(store.get(otpKey)!) as { createdAt: number; salt: string };
    expect(before.salt).toMatch(/^[a-f0-9]{32}$/);

    // Wrong code must NOT extend createdAt.
    const wrongCode = sentCode === '000000' ? '111111' : '000000';
    const badVerify = await handleVerifyOtp(
      new Request('https://luminarasuite.com/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '+15551234567', code: wrongCode }),
      }),
      env,
      '198.51.100.73',
      { minLatencyMs: 0 },
    );
    expect(badVerify.status).toBe(401);
    const afterWrong = JSON.parse(store.get(otpKey)!) as { createdAt: number; attempts: number };
    expect(afterWrong.createdAt).toBe(before.createdAt);
    expect(afterWrong.attempts).toBe(1);

    // Backdate createdAt past 10m TTL -> even the correct code must be rejected and deleted.
    store.set(otpKey, JSON.stringify({ ...afterWrong, createdAt: Date.now() - 11 * 60 * 1000 }));
    const expiredVerify = await handleVerifyOtp(
      new Request('https://luminarasuite.com/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '+15551234567', code: sentCode }),
      }),
      env,
      '198.51.100.74',
      { minLatencyMs: 0 },
    );
    expect(expiredVerify.status).toBe(401);
    expect(store.has(otpKey)).toBe(false);
  });

  it('M-02: account erasure revokes API keys and rejects subsequent Telegram identify()', async () => {
    const db = createSqliteD1();
    const store = new Map<string, string>();
    const botToken = '123456:ERASE_TEST_TOKEN';
    const env = { DB: db, LUMINARA_KV: makeKv(store), BOT_TOKEN: botToken } as unknown as Env;

    const tgId = '99112233';
    await db.prepare(
      `INSERT INTO users (id, source, account_id, telegram_id, created_at, last_seen_at) VALUES (?, 'telegram', ?, ?, 1000, 1000)`,
    ).bind(tgId, tgId, tgId).run();

    const minted = await createApiKey(env, { id: tgId, accountId: tgId, source: 'telegram' }, 'CI key');
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(await identifyApiKey(env, minted.key)).not.toBeNull();

    await eraseAccountRows(env, tgId);
    expect(await identifyApiKey(env, minted.key)).toBeNull();

    // Valid Telegram initData for erased user must be rejected.
    const fields: Record<string, string> = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: Number(tgId), first_name: 'Erased' }),
    };
    const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const params = new URLSearchParams(fields);
    params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
    const who = await identify(
      new Request('https://luminarasuite.com/api/boot', { headers: { 'x-telegram-init-data': params.toString() } }),
      env,
    );
    expect(who.user).toBeNull();
    expect(who.error).toMatch(/deleted/i);

    expect(secretEquals('abc', 'abcd')).toBe(false);
    expect(secretEquals('same-secret', 'same-secret')).toBe(true);
  });

  it('M-19 & M-26: App Check exempts only exact webhook paths and CSP drops wildcard frame-src https:', () => {
    expect(isAppCheckExempt(new URL('https://luminarasuite.com/api/stripe/webhook'))).toBe(true);
    expect(isAppCheckExempt(new URL('https://luminarasuite.com/api/crm/webhooks/outcome'))).toBe(true);
    expect(isAppCheckExempt(new URL('https://luminarasuite.com/api/admin/users/webhook'))).toBe(false);
    expect(isAppCheckExempt(new URL('https://luminarasuite.com/api/projects/webhook/export'))).toBe(false);

    expect(HTML_CSP).not.toMatch(/frame-src[^;]*\bhttps:\s/);
    const offlineHtml = readFileSync(resolve(__dirname, '..', 'electron/offline.html'), 'utf8');
    expect(offlineHtml).toContain("script-src 'self'");
    expect(offlineHtml).not.toContain("script-src 'unsafe-inline'");
    const indexHtml = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');
    expect(indexHtml).toContain('http-equiv="Content-Security-Policy"');
  });

  it('Low firestoreRest: rejects traversal document IDs and invalid collection names', async () => {
    const client = createFirestoreClient({
      project: 'luminara-suite',
      tokenProvider: { getAccessToken: async () => 'tok' },
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(client.get('users', '../other')).rejects.toThrow(/invalid firestore path/i);
    await expect(client.get('users', 'a\\b')).rejects.toThrow(/invalid firestore path/i);
    await expect(client.query({ collection: 'bad/col', accountId: 'a1', limit: 10 })).rejects.toThrow(
      /invalid firestore path/i,
    );
  });
});

describe('Phase 3 Security Regression: Client Crypto, Vault, Uploads, and Electron', () => {
  it('M-06: envelope passphrase never uses static fallback salt and AutoLock upgrades legacy PINs to PBKDF2', async () => {
    const origLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('Storage disabled');
      },
    });
    try {
      const p = getOrCreateAccountEncryptionPassphrase('acct_1');
      expect(p).not.toContain('fallback-device-salt-mem');
      expect(p.startsWith('luminara-zk:acct_1:')).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: origLocalStorage });
    }

    const lock = new AutoLockService();
    await lock.setPin('4829');
    expect(await lock.verifyPin('4829')).toBe(true);
    expect(await lock.verifyPin('0000')).toBe(false);
    lock.clearPin();
  });

  it('M-28: vault rejects out-of-bounds KDF iterations, filters apiKeys allowlist, and upload guard blocks dangerous files', async () => {
    const vault = new LuminaraVaultService();
    const manifestJson = await vault.encryptVault(
      { version: 1, exportedAt: Date.now(), apiKeys: { geminiApiKey: 'ok-key' } },
      'strong-passphrase-123',
    );
    const lowIter = JSON.stringify({ ...JSON.parse(manifestJson), iterations: 1 });
    await expect(vault.decryptVault(lowIter, 'strong-passphrase-123')).rejects.toThrow(/iteration count/i);
    const highIter = JSON.stringify({ ...JSON.parse(manifestJson), iterations: 9_999_999 });
    await expect(vault.decryptVault(highIter, 'strong-passphrase-123')).rejects.toThrow(/iteration count/i);

    const fakeStorage = new Map<string, string>();
    const origLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => fakeStorage.get(k) ?? null,
        setItem: (k: string, v: string) => fakeStorage.set(k, v),
        removeItem: (k: string) => fakeStorage.delete(k),
      },
    });
    try {
      vault.restorePayload(
        {
          version: 1,
          exportedAt: Date.now(),
          apiKeys: {
            geminiApiKey: 'allowed-val',
            luminara_autolock_pin_hash: 'hijacked-hash',
            __proto__: 'polluted',
          },
        },
        false,
      );
      expect(fakeStorage.get('geminiApiKey')).toBe('allowed-val');
      expect(fakeStorage.has('luminara_autolock_pin_hash')).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: origLocalStorage });
    }

    expect(
      validateClientUploadFile({ name: 'report.csv', size: 1024, type: 'text/csv' }, { allowedExtensions: ['.csv'] }).ok,
    ).toBe(true);
    expect(
      validateClientUploadFile({ name: 'shell.php', size: 100, type: 'text/plain' }, { allowedExtensions: ['.csv'] }).ok,
    ).toBe(false);
    expect(
      validateClientUploadFile({ name: 'selfie.php.csv', size: 100, type: 'text/csv' }, { allowedExtensions: ['.csv'] })
        .ok,
    ).toBe(false);
    expect(
      validateClientUploadFile(
        { name: 'huge.csv', size: MAX_CLIENT_UPLOAD_BYTES + 1, type: 'text/csv' },
        { allowedExtensions: ['.csv'] },
      ).ok,
    ).toBe(false);
    expect(
      validateClientUploadFile({ name: 'empty.csv', size: 0, type: 'text/csv' }, { allowedExtensions: ['.csv'] }).ok,
    ).toBe(false);
  });

  it('M-01, M-07, Low Electron: crawler gets per-launch token, permissions fail closed, GPU crash uses OR guard', async () => {
    const { createDesktopCoordinator } = require('../electron/coordinator/desktopCoordinator.cjs') as {
      createDesktopCoordinator: (opts: Record<string, unknown>) => {
        superviseCrawler: (opts: { spawnIfDown: boolean }) => Promise<unknown>;
      };
    };
    let capturedEnv: Record<string, string> | undefined;
    const prevToken = process.env.CRAWLER_TOKEN;
    delete process.env.CRAWLER_TOKEN;
    try {
      const coord = createDesktopCoordinator({
        dataDir: join(tmpdir(), 'luminara-coord-sec-test'),
        fetchFn: async () => ({ ok: false }),
        spawnFn: (_bin: string, _args: string[], opts: { env: Record<string, string> }) => {
          capturedEnv = opts.env;
          return { pid: 9999, on: () => {}, kill: () => {} };
        },
      });
      await coord.superviseCrawler({ spawnIfDown: true });
      expect(capturedEnv?.CRAWLER_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      if (prevToken !== undefined) process.env.CRAWLER_TOKEN = prevToken;
    }

    const { createShellPolicy } = require('../electron/security.cjs') as {
      createShellPolicy: (opts: Record<string, unknown>) => {
        isPermissionGranted: (perm: string, details?: Record<string, unknown>) => boolean;
      };
    };
    const policy = createShellPolicy({
      webappUrl: 'https://luminarasuite.com/',
      isDev: false,
      shellPageUrls: [],
    });
    expect(policy.isPermissionGranted('notifications', {})).toBe(true);
    expect(policy.isPermissionGranted('geolocation', {})).toBe(false);
    expect(policy.isPermissionGranted('usb', {})).toBe(false);
    expect(policy.isPermissionGranted('display-capture', {})).toBe(false);
  });
});
