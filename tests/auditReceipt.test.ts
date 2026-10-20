import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../worker/workerUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../worker/workerUtils')>();
  return {
    ...actual,
    identify: async () => ({ user: { id: 'fb:user', source: 'firebase' as const, accountId: 'acct_1' } }),
  };
});
import { checkSignedAuditReceipt, parsePastedAuditReceipt } from '../services/auditReceipt/check';
import { canonicalJson, sha256HexOf } from '../services/trust/receiptCrypto';
import { handleAuditReceiptRoute } from '../worker/auditReceipts';
import { receiptPublicKeySet, resetReceiptKeyCacheForTests } from '../worker/receiptSigning';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';

let SIGNING_KEY = '';

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  SIGNING_KEY = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
});

function envWith(key: string): Env {
  resetReceiptKeyCacheForTests();
  return {
    ASSETS: { fetch: async () => new Response('ok') },
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    RECEIPT_SIGNING_KEY: key,
    LUMINARA_KV: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    },
  } as unknown as Env;
}

function post(body: unknown): Request {
  return new Request('https://luminarasuite.com/api/audit-receipts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': '1' },
    body: JSON.stringify(body),
  });
}

describe('signed audit receipts', () => {
  it('refuses to sign when the key is missing and stores nothing', async () => {
    const env = envWith('');
    const res = await handleAuditReceiptRoute(post({ domain: 'acme.com', prompts: ['what is acme'] }), env, '/audit-receipts');
    expect(res?.status).toBe(503);
    expect(await env.DB!.prepare(`SELECT COUNT(*) AS n FROM signed_audit_receipts`).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('signs hashes, leaves an omitted crawl not measured, and rejects a tampered payload', async () => {
    const env = envWith(SIGNING_KEY);
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
    };
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
    };
    expect(payload.contentSha256).toBe(await sha256HexOf(canonicalJson(content)));

    const keys = (await receiptPublicKeySet(env)).keys;
    const ok = await checkSignedAuditReceipt({ ...body.receipt, keys });
    expect(ok.signature).toBe('valid');
    expect(ok.contentHash).toBe('match');
    expect(ok.payload?.fieldStatus.engineResponses).toBe('not_measured');

    const tampered = body.receipt.payloadJson.replace(payload.hashes.crawl, 'a'.repeat(64));
    const bad = await checkSignedAuditReceipt({ payloadJson: tampered, signature: body.receipt.signature, kid: body.receipt.kid, keys });
    expect(bad.signature).toBe('invalid');

    const loaded = await handleAuditReceiptRoute(new Request('https://luminarasuite.com/api/audit-receipts/' + body.receipt.id), env, `/audit-receipts/${body.receipt.id}`);
    expect(loaded?.status).toBe(200);
    const pasted = parsePastedAuditReceipt(JSON.stringify({ receipt: body.receipt }));
    expect(pasted).toEqual({ payloadJson: body.receipt.payloadJson, signature: body.receipt.signature, kid: body.receipt.kid });
  });
});
