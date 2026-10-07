/**
 * Trust Network TN0 + TN1 + TN2: fork-proof audit chain, Ed25519 receipts that
 * verify offline, and domain control verification. Real migrations via sqliteD1.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import { auditOrgIdFor, getAuditChainEntries, recordAuditLog, verifyAuditChain } from '../worker/auditLog';
import { receiptPublicKeySet, resetReceiptKeyCacheForTests, signReceiptPayload } from '../worker/receiptSigning';
import { handleTrustReceiptsRoute, issueTrustReceipt } from '../worker/trustReceipts';
import {
  checkDomainProof,
  handleDomainVerificationRoute,
  hashDomainToken,
  recheckVerifiedDomains,
  type DomainCheckDeps,
} from '../worker/domainVerification';
import { canonicalJson, verifyReceiptSignature } from '../services/trust/receiptCrypto';
import type { TrustReceiptView } from '../services/trust/receiptTypes';
import { createSqliteD1 } from './helpers/sqliteD1';

let SIGNING_KEY = '';

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  SIGNING_KEY = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
});

afterEach(() => {
  vi.restoreAllMocks();
  resetReceiptKeyCacheForTests();
});

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    RECEIPT_SIGNING_KEY: SIGNING_KEY,
    ...overrides,
  } as Env;
}

/** Signed-in requests go through identify(); a hoisted mock returns the current principal. */
const principal = vi.hoisted(() => ({ accountId: null as string | null }));
vi.mock('../worker/workerUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../worker/workerUtils')>();
  return {
    ...actual,
    identify: async () =>
      principal.accountId
        ? { user: { id: `u_${principal.accountId}`, source: 'firebase', accountId: principal.accountId } }
        : { user: null, error: 'Sign in required' },
  };
});

async function asUser(accountId: string) {
  principal.accountId = accountId;
}

async function asGuest() {
  principal.accountId = null;
}

function req(path: string, method = 'GET', body?: unknown): Request {
  return new Request(`https://luminarasuite.com/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('TN0-1 audit chain', () => {
  it('stays linear under concurrent writers and verifies', async () => {
    const env = makeEnv();
    const org = auditOrgIdFor('acct_chain');
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => recordAuditLog(env, { org_id: org, actor_id: 'a', action: `act_${i}` })),
    );
    const { entries, truncated } = await getAuditChainEntries(env, org);
    expect(truncated).toBe(false);
    expect(entries).toHaveLength(12);
    const result = await verifyAuditChain(entries);
    expect(result).toMatchObject({ verified: true, length: 12 });
  });

  it('reports an edited row and a fork', async () => {
    const env = makeEnv();
    const org = auditOrgIdFor('acct_tamper');
    for (let i = 0; i < 3; i++) await recordAuditLog(env, { org_id: org, actor_id: 'a', action: `act_${i}` });
    const { entries } = await getAuditChainEntries(env, org);

    const edited = entries.map((e, i) => (i === 1 ? { ...e, action: 'forged' } : e));
    expect(await verifyAuditChain(edited)).toMatchObject({ verified: false, reason: 'hash_mismatch', brokenAtId: entries[1].id });

    const fork = { ...entries[2], id: 'log_fork', created_at: entries[2].created_at + 1 };
    expect(await verifyAuditChain([...entries, fork])).toMatchObject({ verified: false, reason: 'fork' });
  });
});

describe('TN0-3 receipt signing', () => {
  it('signs in the Worker and verifies with only the published key', async () => {
    const env = makeEnv();
    const payload = { b: 2, a: [1, { y: 'x', x: null }], c: 'ü' };
    const { signature, kid } = await signReceiptPayload(env, payload);
    const { keys } = await receiptPublicKeySet(env);
    expect(keys[0].kid).toBe(kid);
    expect(keys[0]).not.toHaveProperty('d');
    expect(await verifyReceiptSignature(keys[0], payload, signature)).toBe(true);
    expect(await verifyReceiptSignature(keys[0], { ...payload, b: 3 }, signature)).toBe(false);
    expect(await verifyReceiptSignature(keys[0], payload, 'not-a-signature')).toBe(false);
  });

  it('canonical JSON is order-independent and rejects non-finite numbers', () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
  });
});

async function issueSample(env: Env, accountId = 'acct_r'): Promise<TrustReceiptView> {
  return issueTrustReceipt(env, {
    accountId,
    subject: { kind: 'domain', id: 'example.com' },
    claim: 'domain_control',
    level: 'worker_verified',
    method: 'dns_txt',
    evidence: [{ ref: 'proof', url: 'dns:TXT:_luminara-verify.example.com', sha256: 'a'.repeat(64) }],
    measurementStatus: 'measured',
  });
}

describe('TN1 trust receipts', () => {
  it('stored payload verifies offline; private receipts do not leak; revoke shows revoked', async () => {
    const env = makeEnv();
    const receipt = await issueSample(env);
    const { keys } = await receiptPublicKeySet(env);
    expect(await verifyReceiptSignature(keys[0], JSON.parse(receipt.payloadJson), receipt.signature)).toBe(true);

    await asGuest();
    expect((await handleTrustReceiptsRoute(req(`/trust/receipts/${receipt.id}`), env, `/trust/receipts/${receipt.id}`))!.status).toBe(404);

    vi.restoreAllMocks();
    await asUser('acct_r');
    const pub = await handleTrustReceiptsRoute(
      req(`/trust/receipts/${receipt.id}/visibility`, 'POST', { visibility: 'public' }),
      env,
      `/trust/receipts/${receipt.id}/visibility`,
    );
    expect(pub!.status).toBe(200);
    const rev = await handleTrustReceiptsRoute(
      req(`/trust/receipts/${receipt.id}/revoke`, 'POST', { reason: 'test' }),
      env,
      `/trust/receipts/${receipt.id}/revoke`,
    );
    expect(rev!.status).toBe(200);

    vi.restoreAllMocks();
    await asGuest();
    const after = await handleTrustReceiptsRoute(req(`/trust/receipts/${receipt.id}`), env, `/trust/receipts/${receipt.id}`);
    expect(after!.status).toBe(200);
    const body = (await after!.json()) as { receipt: TrustReceiptView };
    expect(body.receipt.revokedAt).toBeTruthy();
  });

  it('another account cannot change visibility', async () => {
    const env = makeEnv();
    const receipt = await issueSample(env, 'acct_owner');
    await asUser('acct_other');
    const res = await handleTrustReceiptsRoute(
      req(`/trust/receipts/${receipt.id}/visibility`, 'POST', { visibility: 'public' }),
      env,
      `/trust/receipts/${receipt.id}/visibility`,
    );
    expect(res!.status).toBe(404);
  });

  it('returns 404 when the flag is off', async () => {
    const env = makeEnv({ ENVIRONMENT: 'production', TRUST_RECEIPTS_ENABLED: 'false' } as Partial<Env>);
    expect((await handleTrustReceiptsRoute(req('/trust/keys'), env, '/trust/keys'))!.status).toBe(404);
  });
});

/** Fake DNS + web for one domain. */
function fakeNet(opts: { txt?: Record<string, string[]>; files?: Record<string, string>; dnsDown?: boolean; webDown?: boolean }): DomainCheckDeps {
  const fetcher = async (input: string) => {
    const url = new URL(input);
    if (url.hostname === 'cloudflare-dns.com') {
      if (opts.dnsDown) throw new Error('dns down');
      const name = url.searchParams.get('name') || '';
      const type = url.searchParams.get('type');
      if (type === 'A') return Response.json({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] });
      if (type === 'AAAA') return Response.json({ Status: 0, Answer: [] });
      const values = opts.txt?.[name];
      if (!values) return Response.json({ Status: 3 });
      return Response.json({ Status: 0, Answer: values.map((v) => ({ type: 16, data: `"${v}"` })) });
    }
    if (opts.webDown) throw new Error('web down');
    const body = opts.files?.[url.toString()];
    return body === undefined ? new Response('nope', { status: 404 }) : new Response(body, { status: 200 });
  };
  return { fetcher, dohFetcher: fetcher };
}

describe('TN2 domain verification', () => {
  const token = 'lv_0123456789abcdef0123456789abcdef';

  it('finds the token by DNS TXT, well-known file, or meta tag', async () => {
    const hash = await hashDomainToken(token);
    const dns = await checkDomainProof('example.com', hash, fakeNet({ txt: { '_luminara-verify.example.com': [`luminara-verify=${token}`] } }));
    expect(dns).toMatchObject({ status: 'found', method: 'dns_txt' });

    const file = await checkDomainProof('example.com', hash, fakeNet({ files: { 'https://example.com/.well-known/luminara-verify.txt': `${token}\n` } }));
    expect(file).toMatchObject({ status: 'found', method: 'well_known' });

    const meta = await checkDomainProof(
      'example.com',
      hash,
      fakeNet({ files: { 'https://example.com/': `<html><head><meta name="luminara-verify" content="${token}"></head></html>` } }),
    );
    expect(meta).toMatchObject({ status: 'found', method: 'meta_tag' });
  });

  it("another account's token does not verify", async () => {
    const other = await hashDomainToken('lv_ffffffffffffffffffffffffffffffff');
    const res = await checkDomainProof('example.com', other, fakeNet({ txt: { '_luminara-verify.example.com': [`luminara-verify=${token}`] } }));
    expect(res.status).toBe('not_found');
  });

  it('network failure is unreachable, not a failed check', async () => {
    const res = await checkDomainProof('example.com', await hashDomainToken(token), fakeNet({ dnsDown: true, webDown: true }));
    expect(res.status).toBe('unreachable');
  });

  it('end to end: start, check, receipt issued, lapse after two misses revokes it', async () => {
    const env = makeEnv();
    await asUser('acct_d');
    const start = await handleDomainVerificationRoute(req('/trust/domains', 'POST', { domain: 'https://Example.com/path' }), env, '/trust/domains');
    const started = (await start!.json()) as { domain: string; token: string; instructions: { dns_txt: { name: string; value: string } } };
    expect(started.domain).toBe('example.com');
    expect(started.instructions.dns_txt.name).toBe('_luminara-verify.example.com');

    const net = fakeNet({ txt: { '_luminara-verify.example.com': [started.instructions.dns_txt.value] } });
    const check = await handleDomainVerificationRoute(req('/trust/domains/example.com/check', 'POST'), env, '/trust/domains/example.com/check', net);
    const checked = (await check!.json()) as { status: string; receiptId: string; receiptIssued: boolean };
    expect(checked).toMatchObject({ status: 'verified', receiptIssued: true });

    // Make it due for re-check, then remove the record: two misses lapse it.
    const db = env.DB as unknown as { sqlite: { exec: (s: string) => void } };
    const gone = fakeNet({});
    for (let i = 0; i < 2; i++) {
      db.sqlite.exec(`UPDATE domain_verifications SET last_checked_at = '2000-01-01T00:00:00.000Z'`);
      await recheckVerifiedDomains(env, gone);
    }
    const row = await env.DB!.prepare(`SELECT status FROM domain_verifications WHERE domain = 'example.com'`).first<{ status: string }>();
    expect(row?.status).toBe('lapsed');
    const receipt = await env.DB!.prepare(`SELECT revoked_at FROM trust_receipts WHERE id = ?`).bind(checked.receiptId).first<{ revoked_at: string | null }>();
    expect(receipt?.revoked_at).toBeTruthy();
  });

  it('verifies without a signing key but says no receipt was issued', async () => {
    const env = makeEnv({ RECEIPT_SIGNING_KEY: '' } as Partial<Env>);
    await asUser('acct_nokey');
    const start = await handleDomainVerificationRoute(req('/trust/domains', 'POST', { domain: 'example.com' }), env, '/trust/domains');
    const started = (await start!.json()) as { instructions: { dns_txt: { value: string } } };
    const net = fakeNet({ txt: { '_luminara-verify.example.com': [started.instructions.dns_txt.value] } });
    const check = await handleDomainVerificationRoute(req('/trust/domains/example.com/check', 'POST'), env, '/trust/domains/example.com/check', net);
    expect(await check!.json()).toMatchObject({ status: 'verified', receiptIssued: false });
  });

  it('rejects private and malformed domains', async () => {
    const env = makeEnv();
    await asUser('acct_bad');
    for (const domain of ['localhost', '10.0.0.1', 'intranet.corp', '']) {
      const res = await handleDomainVerificationRoute(req('/trust/domains', 'POST', { domain }), env, '/trust/domains');
      expect(res!.status).toBe(400);
    }
  });
});
