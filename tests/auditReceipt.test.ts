import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../worker/workerUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../worker/workerUtils')>();
  return {
    ...actual,
    identify: async () => ({ user: { id: 'fb:user', source: 'firebase' as const, accountId: 'acct_1' } }),
  };
});
import { checkSignedAuditReceipt, parsePastedAuditReceipt } from '../services/auditReceipt/check';
import { auditReceiptAccountHash } from '../services/auditReceipt/payload';
import { canonicalJson, receiptKeyId, sha256HexOf, verifyReceiptSignature } from '../services/trust/receiptCrypto';
import type { TrustReceiptPayload } from '../services/trust/receiptTypes';
import { handleAuditReceiptRoute, revokeSignedAuditReceipt } from '../worker/auditReceipts';
import { receiptPublicKeySet, resetReceiptKeyCacheForTests, signReceiptPayload } from '../worker/receiptSigning';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';

let SIGNING_KEY = '';

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  SIGNING_KEY = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
});

function mockKv(store: Map<string, string>): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw == null) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

const HMAC_KEY = 'test-hmac-key-0123456789abcdef01';

function envWith(
  key: string,
  opts?: { plan?: string | null; quota?: string; receipts?: boolean; hmac?: string | null; domainVerify?: false; freshDays?: string },
): Env {
  resetReceiptKeyCacheForTests();
  const kv = new Map<string, string>();
  if (opts?.plan) kv.set('sub:acct_1', JSON.stringify({ plan: opts.plan, expiresAt: Date.now() + 86_400_000 }));
  return {
    ASSETS: { fetch: async () => new Response('ok') },
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    RECEIPT_SIGNING_KEY: key,
    AUDIT_RECEIPT_DAILY_QUOTA: opts?.quota,
    AUDIT_RECEIPTS_ENABLED: opts?.receipts === false ? 'false' : 'true',
    AUDIT_RECEIPT_ACCOUNT_HMAC_KEY: opts?.hmac === null ? '' : (opts?.hmac ?? HMAC_KEY),
    DOMAIN_VERIFY_ENABLED: opts?.domainVerify === false ? 'false' : undefined,
    AUDIT_RECEIPT_DOMAIN_FRESH_DAYS: opts?.freshDays,
    LUMINARA_KV: mockKv(kv),
  } as unknown as Env;
}

async function verifyDomain(
  env: Env,
  domain = 'acme.com',
  status = 'verified',
  provedAt?: string | null,
  extras?: { failures?: number; checkedAt?: string | null },
): Promise<void> {
  const proved = provedAt === undefined ? new Date().toISOString() : provedAt;
  const checked = extras?.checkedAt === undefined ? proved : extras.checkedAt;
  await env.DB!.prepare(
    `INSERT INTO domain_verifications (account_id, domain, token_hash, token_hint, status, token_expires_at, consecutive_failures, created_at, updated_at, last_checked_at, last_proved_at, verified_at)
     VALUES ('acct_1', ?, 'hash', 'lv_test', ?, '2099-01-01T00:00:00.000Z', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?, ?, ?)`,
  )
    .bind(domain, status, extras?.failures ?? 0, checked, status === 'verified' ? proved : null, status === 'verified' ? proved : null)
    .run();
}

function post(body: unknown): Request {
  return new Request('https://luminarasuite.com/api/audit-receipts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': '1' },
    body: JSON.stringify(body),
  });
}

describe('signed audit receipts', () => {
  it('refuses a free plan, an unverified domain, and a missing key without storing a row', async () => {
    const free = envWith(SIGNING_KEY);
    await verifyDomain(free);
    const unpaid = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), free, '/audit-receipts');
    expect(unpaid?.status).toBe(402);

    const unverified = envWith(SIGNING_KEY, { plan: 'starter' });
    const denied = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), unverified, '/audit-receipts');
    expect(denied?.status).toBe(403);
    expect((await denied!.json()) as { code?: string }).toMatchObject({ code: 'DOMAIN_NOT_VERIFIED' });

    const pending = envWith(SIGNING_KEY, { plan: 'starter' });
    await verifyDomain(pending, 'acme.com', 'pending');
    expect((await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), pending, '/audit-receipts'))?.status).toBe(403);

    const nokey = envWith('', { plan: 'starter' });
    await verifyDomain(nokey);
    const res = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), nokey, '/audit-receipts');
    expect(res?.status).toBe(503);
    expect(await nokey.DB!.prepare(`SELECT COUNT(*) AS n FROM signed_audit_receipts`).first<{ n: number }>()).toEqual({ n: 0 });
    expect(await unverified.DB!.prepare(`SELECT COUNT(*) AS n FROM signed_audit_receipts`).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('signs hashes, leaves an omitted engine response not measured, and rejects a tampered payload', async () => {
    const env = envWith(SIGNING_KEY, { plan: 'growth' });
    await verifyDomain(env);
    const empty = await handleAuditReceiptRoute(post({ domain: 'acme.com' }), env, '/audit-receipts');
    expect(empty?.status).toBe(400);

    const crawl = 'Acme ships widgets.';
    const res = await handleAuditReceiptRoute(
      post({
        domain: 'acme.com',
        crawl,
        prompts: ['what is acme'],
        models: [{ engine: 'chatgpt', modelId: 'gpt-test' }],
        observedAt: '2026-10-01T00:00:00.000Z',
      }),
      env,
      '/audit-receipts',
    );
    expect(res?.status).toBe(201);
    const body = (await res!.json()) as { receipt: { id: string; payloadJson: string; signature: string; kid: string; verifyPath: string } };
    const payload = JSON.parse(body.receipt.payloadJson) as {
      hashes: { crawl: string; engineResponses: null; promptSet: string };
      fieldStatus: { crawl: string; engineResponses: string };
      contentSha256: string;
      domain: string;
      issuedAt: string;
      observedAt: string;
      models: unknown;
      source: string;
      accountHash: string;
      kid: string;
    };
    expect(payload.source).toBe('caller_submitted');
    expect(payload.accountHash).toBe(await auditReceiptAccountHash('acct_1', HMAC_KEY));
    expect(payload.accountHash).not.toBe(await sha256HexOf('luminara:audit-receipt-account:acct_1'));
    expect(payload.kid).toBe(body.receipt.kid);
    expect(payload.hashes.crawl).toBe(await sha256HexOf(crawl));
    expect(payload.hashes.engineResponses).toBeNull();
    expect(payload.fieldStatus.engineResponses).toBe('not_measured');
    expect(payload.fieldStatus.crawl).toBe('measured');
    expect(body.receipt.verifyPath).toBe(`/verify/audit/${body.receipt.id}`);
    const content = {
      domain: payload.domain,
      issuedAt: payload.issuedAt,
      observedAt: payload.observedAt,
      hashes: payload.hashes,
      models: payload.models,
      fieldStatus: payload.fieldStatus,
      source: payload.source,
      accountHash: payload.accountHash,
    };
    expect(payload.contentSha256).toBe(await sha256HexOf(canonicalJson(content)));

    const keys = (await receiptPublicKeySet(env)).keys;
    const ok = await checkSignedAuditReceipt({ ...body.receipt, keys });
    expect(ok.signature).toBe('valid');
    expect(ok.contentHash).toBe('match');
    expect(ok.payload?.fieldStatus.engineResponses).toBe('not_measured');
    expect(ok.payload?.source).toBe('caller_submitted');
    expect(await verifyReceiptSignature(keys[0], JSON.parse(body.receipt.payloadJson), body.receipt.signature)).toBe(false);
    expect(await checkSignedAuditReceipt({ ...body.receipt, keys: [] })).toMatchObject({ signature: 'key_not_published' });

    const tampered = body.receipt.payloadJson.replace(payload.hashes.crawl, 'a'.repeat(64));
    const bad = await checkSignedAuditReceipt({ payloadJson: tampered, signature: body.receipt.signature, kid: body.receipt.kid, keys });
    expect(bad.signature).toBe('invalid');

    const loaded = await handleAuditReceiptRoute(new Request('https://luminarasuite.com/api/audit-receipts/' + body.receipt.id), env, `/audit-receipts/${body.receipt.id}`);
    expect(loaded?.status).toBe(200);
    const pasted = parsePastedAuditReceipt(JSON.stringify({ receipt: body.receipt }));
    expect(pasted).toEqual({ payloadJson: body.receipt.payloadJson, signature: body.receipt.signature, kid: body.receipt.kid });

    const unknown = await handleAuditReceiptRoute(
      new Request('https://luminarasuite.com/api/audit-receipts/sar_' + 'ab'.repeat(16)),
      env,
      `/audit-receipts/sar_${'ab'.repeat(16)}`,
    );
    expect(unknown?.status).toBe(404);
    const badId = await handleAuditReceiptRoute(new Request('https://luminarasuite.com/api/audit-receipts/nope'), env, '/audit-receipts/nope');
    expect(badId?.status).toBe(404);
    const badVerify = await handleAuditReceiptRoute(
      post({ payloadJson: '{', signature: 'nope', kid: 'missing' }),
      env,
      '/audit-receipts/verify',
    );
    expect(badVerify?.status).toBe(200);
    expect(await badVerify!.json()).toMatchObject({ signature: 'key_not_published', revokedAt: null });

    const revoked = await handleAuditReceiptRoute(
      post({ reason: 'Wrong crawl.' }),
      env,
      `/audit-receipts/${body.receipt.id}/revoke`,
    );
    expect(revoked?.status).toBe(200);
    const after = await handleAuditReceiptRoute(
      new Request('https://luminarasuite.com/api/audit-receipts/' + body.receipt.id),
      env,
      `/audit-receipts/${body.receipt.id}`,
    );
    expect(await after!.json()).toMatchObject({ receipt: { revokedReason: 'Wrong crawl.', source: 'caller_submitted' } });
    const remote = await handleAuditReceiptRoute(
      post({ payloadJson: body.receipt.payloadJson, signature: body.receipt.signature, kid: body.receipt.kid }),
      env,
      '/audit-receipts/verify',
    );
    expect(await remote!.json()).toMatchObject({ signature: 'valid', revokedReason: 'Wrong crawl.' });
    expect((await handleAuditReceiptRoute(post({}), env, `/audit-receipts/${body.receipt.id}/revoke`))?.status).toBe(404);

    await env.DB!.prepare(`UPDATE signed_audit_receipts SET account_id = 'other', revoked_at = NULL WHERE id = ?`).bind(body.receipt.id).run();
    expect((await handleAuditReceiptRoute(post({}), env, `/audit-receipts/${body.receipt.id}/revoke`))?.status).toBe(404);
  });

  it('stops at the daily quota and still verifies a receipt signed by a retired key', async () => {
    const env = envWith(SIGNING_KEY, { plan: 'agency', quota: '1' });
    await verifyDomain(env);
    expect((await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), env, '/audit-receipts'))?.status).toBe(201);
    const second = await handleAuditReceiptRoute(post({ domain: 'acme.com', crawl: 'more' }), env, '/audit-receipts');
    expect(second?.status).toBe(429);
    expect(await env.DB!.prepare(`SELECT COUNT(*) AS n FROM signed_audit_receipts`).first<{ n: number }>()).toEqual({ n: 1 });

    const retired = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const current = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const retiredEnv = envWith(JSON.stringify(await crypto.subtle.exportKey('jwk', retired.privateKey)), { plan: 'agency' });
    await verifyDomain(retiredEnv);
    const minted = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['retired key'] }), retiredEnv, '/audit-receipts');
    expect(minted?.status).toBe(201);
    const receipt = ((await minted!.json()) as { receipt: { payloadJson: string; signature: string; kid: string } }).receipt;
    const retiredPub = (await crypto.subtle.exportKey('jwk', retired.publicKey)) as { x: string };
    retiredEnv.RECEIPT_SIGNING_KEY = JSON.stringify(await crypto.subtle.exportKey('jwk', current.privateKey));
    retiredEnv.RECEIPT_RETIRED_PUBLIC_KEYS = JSON.stringify([{ kty: 'OKP', crv: 'Ed25519', x: retiredPub.x }]);
    resetReceiptKeyCacheForTests();
    expect(receipt.kid).toBe(await receiptKeyId(retiredPub.x));
    const keys = (await receiptPublicKeySet(retiredEnv)).keys;
    expect(keys.map((key) => key.kid)).toContain(receipt.kid);
    expect(await checkSignedAuditReceipt({ ...receipt, keys })).toMatchObject({ signature: 'valid', contentHash: 'match' });
  });

  it('returns 503 and stores nothing when the account HMAC secret is unset', async () => {
    const env = envWith(SIGNING_KEY, { plan: 'starter', hmac: null });
    await verifyDomain(env);
    const res = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), env, '/audit-receipts');
    expect(res?.status).toBe(503);
    expect(await res!.json()).toMatchObject({ code: 'AUDIT_RECEIPT_HMAC_UNAVAILABLE' });
    expect(await env.DB!.prepare(`SELECT COUNT(*) AS n FROM signed_audit_receipts`).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('hashes the account with HMAC-SHA256 and keeps the same digest for the same account and key', async () => {
    const first = await auditReceiptAccountHash('acct_1', HMAC_KEY);
    const again = await auditReceiptAccountHash('acct_1', HMAC_KEY);
    const other = await auditReceiptAccountHash('acct_2', HMAC_KEY);
    const otherKey = await auditReceiptAccountHash('acct_1', 'another-hmac-key');
    expect(first).toBe(again);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(other);
    expect(first).not.toBe(otherKey);
    expect(first).not.toBe(await sha256HexOf('luminara:audit-receipt-account:acct_1'));
  });

  it('refuses mint when AUDIT_RECEIPTS_ENABLED is not true, and still lets the owner revoke and verify', async () => {
    const open = envWith(SIGNING_KEY, { plan: 'starter' });
    await verifyDomain(open);
    const minted = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), open, '/audit-receipts');
    expect(minted?.status).toBe(201);
    const receipt = ((await minted!.json()) as { receipt: { id: string; payloadJson: string; signature: string; kid: string } }).receipt;
    open.AUDIT_RECEIPTS_ENABLED = 'false';
    const refused = await handleAuditReceiptRoute(post({ domain: 'acme.com', crawl: 'more' }), open, '/audit-receipts');
    expect(refused?.status).toBe(403);
    expect(await refused!.json()).toMatchObject({ code: 'AUDIT_RECEIPTS_DISABLED' });
    expect((await handleAuditReceiptRoute(post({}), open, `/audit-receipts/${receipt.id}/revoke`))?.status).toBe(200);
    const loaded = await handleAuditReceiptRoute(
      new Request('https://luminarasuite.com/api/audit-receipts/' + receipt.id),
      open,
      `/audit-receipts/${receipt.id}`,
    );
    expect(loaded?.status).toBe(200);
    const keys = await handleAuditReceiptRoute(new Request('https://luminarasuite.com/api/audit-receipts/keys'), open, '/audit-receipts/keys');
    expect(keys?.status).toBe(200);
    const verified = await handleAuditReceiptRoute(
      post({ payloadJson: receipt.payloadJson, signature: receipt.signature, kid: receipt.kid }),
      open,
      '/audit-receipts/verify',
    );
    expect(await verified!.json()).toMatchObject({ signature: 'valid' });
    expect(await open.DB!.prepare(`SELECT revoked_at IS NOT NULL AS revoked FROM signed_audit_receipts WHERE id = ?`).bind(receipt.id).first<{ revoked: number }>()).toEqual({ revoked: 1 });
  });

  it('rejects a lapsed domain, a stale re-check, and minting while domain verification is off', async () => {
    const lapsed = envWith(SIGNING_KEY, { plan: 'starter' });
    await verifyDomain(lapsed, 'acme.com', 'lapsed');
    const lapsedRes = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), lapsed, '/audit-receipts');
    expect(lapsedRes?.status).toBe(403);
    expect(await lapsedRes!.json()).toMatchObject({ code: 'DOMAIN_NOT_VERIFIED' });

    const stale = envWith(SIGNING_KEY, { plan: 'starter' });
    await verifyDomain(stale, 'acme.com', 'verified', new Date(Date.now() - 30 * 86_400_000).toISOString());
    const staleRes = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), stale, '/audit-receipts');
    expect(staleRes?.status).toBe(403);
    expect(await staleRes!.json()).toMatchObject({ code: 'DOMAIN_CHECK_STALE' });

    const off = envWith(SIGNING_KEY, { plan: 'starter', domainVerify: false });
    await verifyDomain(off);
    const offRes = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), off, '/audit-receipts');
    expect(offRes?.status).toBe(403);
    expect(await offRes!.json()).toMatchObject({ code: 'DOMAIN_VERIFY_DISABLED' });
    expect(await off.DB!.prepare(`SELECT COUNT(*) AS n FROM signed_audit_receipts`).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('rejects a Trust Receipt as an audit receipt', async () => {
    const env = envWith(SIGNING_KEY, { plan: 'starter' });
    const kid = (await receiptPublicKeySet(env)).keys[0].kid;
    const trust: TrustReceiptPayload = {
      v: 1,
      id: 'tr_test',
      iss: 'luminarasuite.com',
      kid,
      issuedAt: '2026-10-01T00:00:00.000Z',
      subject: { kind: 'domain', id: 'acme.com' },
      claim: 'domain_control',
      level: 'worker_verified',
      method: 'dns_txt',
      evidence: [],
      measurementStatus: 'not_measured',
    };
    const signed = await signReceiptPayload(env, trust);
    const payloadJson = canonicalJson(trust);
    const keys = (await receiptPublicKeySet(env)).keys;
    const check = await checkSignedAuditReceipt({ payloadJson, signature: signed.signature, kid: signed.kid, keys });
    expect(check).toMatchObject({ signature: 'invalid', contentHash: 'unread', payload: null });
    const remote = await handleAuditReceiptRoute(
      post({ payloadJson, signature: signed.signature, kid: signed.kid }),
      env,
      '/audit-receipts/verify',
    );
    expect(await remote!.json()).toMatchObject({ signature: 'invalid', payload: null });
  });

  it('starts a new quota at 00:00 UTC', async () => {
    const env = envWith(SIGNING_KEY, { plan: 'agency', quota: '1' });
    await verifyDomain(env);
    expect((await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), env, '/audit-receipts'))?.status).toBe(201);
    const now = new Date();
    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    await env.DB!.prepare(`UPDATE signed_audit_receipts SET created_at = ?`).bind(dayStart - 1).run();
    expect((await handleAuditReceiptRoute(post({ domain: 'acme.com', crawl: 'next day' }), env, '/audit-receipts'))?.status).toBe(201);
    expect((await handleAuditReceiptRoute(post({ domain: 'acme.com', crawl: 'same day' }), env, '/audit-receipts'))?.status).toBe(429);
    expect(await env.DB!.prepare(`SELECT COUNT(*) AS n FROM signed_audit_receipts`).first<{ n: number }>()).toEqual({ n: 2 });
  });

  it('signs only a domain proved inside 10 days with no failures', async () => {
    const recentMiss = envWith(SIGNING_KEY, { plan: 'starter' });
    await verifyDomain(recentMiss, 'acme.com', 'verified', new Date(Date.now() - 30 * 86_400_000).toISOString(), {
      checkedAt: new Date().toISOString(),
    });
    const faked = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), recentMiss, '/audit-receipts');
    expect(faked?.status).toBe(403);
    expect(await faked!.json()).toMatchObject({ code: 'DOMAIN_CHECK_STALE' });

    const failed = envWith(SIGNING_KEY, { plan: 'starter' });
    await verifyDomain(failed, 'acme.com', 'verified', new Date().toISOString(), { failures: 1 });
    const withFailure = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), failed, '/audit-receipts');
    expect(withFailure?.status).toBe(403);
    expect(await withFailure!.json()).toMatchObject({ code: 'DOMAIN_CHECK_STALE' });

    const inside = envWith(SIGNING_KEY, { plan: 'starter' });
    await verifyDomain(inside, 'acme.com', 'verified', new Date(Date.now() - 9 * 86_400_000).toISOString());
    expect((await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), inside, '/audit-receipts'))?.status).toBe(201);

    const outside = envWith(SIGNING_KEY, { plan: 'starter' });
    await verifyDomain(outside, 'acme.com', 'verified', new Date(Date.now() - 11 * 86_400_000).toISOString());
    expect((await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), outside, '/audit-receipts'))?.status).toBe(403);
    expect(await recentMiss.DB!.prepare(`SELECT COUNT(*) AS n FROM signed_audit_receipts`).first<{ n: number }>()).toEqual({ n: 0 });
    expect(await failed.DB!.prepare(`SELECT COUNT(*) AS n FROM signed_audit_receipts`).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('refuses a short HMAC key and a key equal to the signing key without storing a row', async () => {
    const short = envWith(SIGNING_KEY, { plan: 'starter', hmac: 'a'.repeat(31) });
    await verifyDomain(short);
    const shortRes = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), short, '/audit-receipts');
    expect(shortRes?.status).toBe(503);
    expect(await shortRes!.json()).toMatchObject({ code: 'AUDIT_RECEIPT_HMAC_UNAVAILABLE' });

    const same = envWith(SIGNING_KEY, { plan: 'starter', hmac: SIGNING_KEY });
    await verifyDomain(same);
    const sameRes = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), same, '/audit-receipts');
    expect(sameRes?.status).toBe(503);
    expect(await same.DB!.prepare(`SELECT COUNT(*) AS n FROM signed_audit_receipts`).first<{ n: number }>()).toEqual({ n: 0 });
    expect(await short.DB!.prepare(`SELECT COUNT(*) AS n FROM signed_audit_receipts`).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('lets an operator revoke another account while minting is off', async () => {
    const env = envWith(SIGNING_KEY, { plan: 'starter' });
    await verifyDomain(env);
    const minted = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), env, '/audit-receipts');
    const id = ((await minted!.json()) as { receipt: { id: string } }).receipt.id;
    env.AUDIT_RECEIPTS_ENABLED = 'false';
    await env.DB!.prepare(`UPDATE signed_audit_receipts SET account_id = 'other' WHERE id = ?`).bind(id).run();
    expect((await handleAuditReceiptRoute(post({}), env, `/audit-receipts/${id}/revoke`))?.status).toBe(404);
    const revoked = await revokeSignedAuditReceipt(env, { id, reason: 'operator', accountId: null });
    expect(revoked.status).toBe(200);
    expect(await env.DB!.prepare(`SELECT revoked_reason FROM signed_audit_receipts WHERE id = ?`).bind(id).first<{ revoked_reason: string }>()).toEqual({
      revoked_reason: 'operator',
    });
  });

  it('lets only one of several parallel mints through a quota of one', async () => {
    const env = envWith(SIGNING_KEY, { plan: 'agency', quota: '1' });
    await verifyDomain(env);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), env, '/audit-receipts')),
    );
    const statuses = results.map((res) => res?.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
    expect(await env.DB!.prepare(`SELECT COUNT(*) AS n FROM signed_audit_receipts`).first<{ n: number }>()).toEqual({ n: 1 });
  });
});
