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
import { handleAuditReceiptRoute } from '../worker/auditReceipts';
import { receiptPublicKeySet, resetReceiptKeyCacheForTests } from '../worker/receiptSigning';
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

function envWith(key: string, opts?: { plan?: string | null; quota?: string }): Env {
  resetReceiptKeyCacheForTests();
  const kv = new Map<string, string>();
  if (opts?.plan) kv.set('sub:acct_1', JSON.stringify({ plan: opts.plan, expiresAt: Date.now() + 86_400_000 }));
  return {
    ASSETS: { fetch: async () => new Response('ok') },
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    RECEIPT_SIGNING_KEY: key,
    AUDIT_RECEIPT_DAILY_QUOTA: opts?.quota,
    LUMINARA_KV: mockKv(kv),
  } as unknown as Env;
}

async function verifyDomain(env: Env, domain = 'acme.com', status = 'verified'): Promise<void> {
  await env.DB!.prepare(
    `INSERT INTO domain_verifications (account_id, domain, token_hash, token_hint, status, token_expires_at, consecutive_failures, created_at, updated_at)
     VALUES ('acct_1', ?, 'hash', 'lv_test', ?, '2099-01-01T00:00:00.000Z', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  )
    .bind(domain, status)
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
    expect(payload.accountHash).toBe(await auditReceiptAccountHash('acct_1'));
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
});
