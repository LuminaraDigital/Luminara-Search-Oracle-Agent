/**
 * SW0a-15: a receipt cannot be minted from constants.
 *
 *  1. issueTrustReceipt refuses a verified level without a typed verifier result that
 *     matches the receipt, and stores nothing when it refuses.
 *  2. The gateway route (POST /api/gateway/execute) stores no receipt at all.
 *  3. The verified level literal is written only where a verifier result is in hand.
 *  4. revokeGatewayIssuedReceipts revokes only what the gateway route issued, and is
 *     safe to run twice. Real migrations via sqliteD1.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Env } from '../worker/env';
import worker from '../worker/index';
import { GATEWAY_NO_RECEIPT_NOTE } from '../worker/oracleGateway';
import { resetReceiptKeyCacheForTests } from '../worker/receiptSigning';
import {
  GATEWAY_RECEIPT_METHOD,
  GATEWAY_RECEIPT_REVOKED_REASON,
  GATEWAY_REVOKE_BATCH,
  ReceiptNotVerified,
  handleTrustReceiptsRoute,
  issueTrustReceipt,
  revokeGatewayIssuedReceipts,
  type IssueReceiptInput,
  type VerifierResult,
} from '../worker/trustReceipts';
import { canonicalJson } from '../services/trust/receiptCrypto';
import type { TrustReceiptView } from '../services/trust/receiptTypes';
import { createSqliteD1 } from './helpers/sqliteD1';

/** Built from parts so this file never matches the static scan it runs. */
const VERIFIED_LEVEL = ['worker', 'verified'].join('_');
const ADMIN_SECRET = 'test-admin-secret';
const REPO_ROOT = resolve(__dirname, '..');

let SIGNING_KEY = '';

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  SIGNING_KEY = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
});

afterEach(() => {
  resetReceiptKeyCacheForTests();
  principal.accountId = null;
});

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

/** Everything the old gateway code needed to mint: the flag on, a signing key, D1 and KV. */
function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    TRUST_RECEIPTS_ENABLED: 'true',
    RECEIPT_SIGNING_KEY: SIGNING_KEY,
    ...overrides,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

let ipCounter = 0;
function apiRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers || {});
  headers.set('cf-connecting-ip', `10.15.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`);
  if (init.body) headers.set('content-type', 'application/json');
  return new Request(`https://luminarasuite.com${path}`, { ...init, headers });
}

type StoredReceipt = {
  id: string;
  account_id: string;
  level: string;
  visibility: string;
  revoked_at: string | null;
  revoked_reason: string | null;
};

async function storedReceipts(env: Env): Promise<StoredReceipt[]> {
  const { results } = await env.DB!.prepare(
    'SELECT id, account_id, level, visibility, revoked_at, revoked_reason FROM trust_receipts ORDER BY id',
  ).all<StoredReceipt>();
  return results;
}

async function auditCount(env: Env, action: string): Promise<number> {
  const row = await env.DB!.prepare('SELECT COUNT(*) AS n FROM org_audit_logs WHERE action = ?').bind(action).first<{ n: number }>();
  return Number(row?.n || 0);
}

const PROOF_URL = 'dns:TXT:_luminara-verify.example.com';
const PROOF_SHA = 'a'.repeat(64);

/** The result a verifier holds after its check passed. */
function passedCheck(overrides: Record<string, unknown> = {}): VerifierResult {
  return {
    passed: true,
    subject: { kind: 'domain', id: 'example.com' },
    claim: 'domain_control',
    method: 'dns_txt',
    evidenceUrl: PROOF_URL,
    evidenceSha256: PROOF_SHA,
    ...overrides,
  } as VerifierResult;
}

/** A receipt request for example.com. The cast lets a test hand in what the type forbids. */
function receiptInput(level: string, verifierResult: unknown, overrides: Record<string, unknown> = {}): IssueReceiptInput {
  return {
    accountId: 'acct_v',
    subject: { kind: 'domain', id: 'example.com' },
    claim: 'domain_control',
    level,
    verifierResult,
    method: 'dns_txt',
    evidence: [{ ref: 'proof', url: PROOF_URL, sha256: PROOF_SHA }],
    measurementStatus: 'measured',
    ...overrides,
  } as unknown as IssueReceiptInput;
}

describe('issueTrustReceipt needs a typed verifier result for a verified level', () => {
  const notAResult: Array<[string, unknown]> = [
    ['no verifier result', undefined],
    ['a null verifier result', null],
    ['an empty object', {}],
    ['a check that did not pass', passedCheck({ passed: false })],
    ['a truthy value that is not true', passedCheck({ passed: 'true' })],
    ['a result for another domain', passedCheck({ subject: { kind: 'domain', id: 'victim.org' } })],
    ['a result for another kind of subject', passedCheck({ subject: { kind: 'account', id: 'example.com' } })],
    ['a result for another claim', passedCheck({ claim: 'audit_run' })],
    ['a result from another method', passedCheck({ method: 'meta_tag' })],
    ['evidence the receipt does not carry', passedCheck({ evidenceSha256: 'b'.repeat(64) })],
    ['evidence read from somewhere else', passedCheck({ evidenceUrl: 'https://victim.org/' })],
    ['an evidence hash that is not a SHA-256', passedCheck({ evidenceSha256: 'not-a-hash' })],
  ];

  for (const level of [VERIFIED_LEVEL, 'registry_verified']) {
    it.each(notAResult)(`refuses ${level} with %s, and stores nothing`, async (_label, verifierResult) => {
      const env = makeEnv();
      await expect(issueTrustReceipt(env, receiptInput(level, verifierResult))).rejects.toBeInstanceOf(ReceiptNotVerified);
      expect(await storedReceipts(env)).toEqual([]);
      expect(await auditCount(env, 'trust_receipt_issued')).toBe(0);
    });
  }

  it('refuses the exact receipt the gateway route used to build from constants', async () => {
    const env = makeEnv();
    const fromConstants = receiptInput(VERIFIED_LEVEL, undefined, {
      subject: { kind: 'domain', id: 'victim.org' },
      method: GATEWAY_RECEIPT_METHOD,
      evidence: [{ ref: 'target_homepage', url: 'https://victim.org', fetchedAt: new Date().toISOString(), httpStatus: 0 }],
      measurementStatus: 'not_measured',
      visibility: 'public',
    });
    await expect(issueTrustReceipt(env, fromConstants)).rejects.toThrow('no passed verifier result was given');
    expect(await storedReceipts(env)).toEqual([]);
  });

  it('issues the verified level when the verifier result matches the receipt', async () => {
    const env = makeEnv();
    const receipt = await issueTrustReceipt(env, receiptInput(VERIFIED_LEVEL, passedCheck()));
    expect(receipt.payload.level).toBe(VERIFIED_LEVEL);
    expect(receipt.payload.evidence).toEqual([{ ref: 'proof', url: PROOF_URL, sha256: PROOF_SHA }]);
    expect((await storedReceipts(env)).map((r) => r.level)).toEqual([VERIFIED_LEVEL]);
  });

  it('still issues a self_reported receipt without a verifier result', async () => {
    const env = makeEnv();
    const receipt = await issueTrustReceipt(env, receiptInput('self_reported', undefined, { claim: 'self_reported_file', method: 'owner_upload' }));
    expect(receipt.payload.level).toBe('self_reported');
    expect((await storedReceipts(env)).map((r) => r.level)).toEqual(['self_reported']);
  });
});

describe('the gateway route issues no receipt', () => {
  it('POST /api/gateway/execute stores nothing for a signed-in user, with receipts on and a signing key', async () => {
    const env = makeEnv();
    principal.accountId = 'acct_gateway';

    const res = await worker.fetch(
      apiRequest('/api/gateway/execute', { method: 'POST', body: JSON.stringify({ targetDomain: 'victim.org', surface: 'web' }) }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // The request reached the handler and finished as it did before.
    expect(body).toMatchObject({ ok: true, state: 'settled', targetDomain: 'victim.org' });
    // It says no receipt was issued, and why.
    expect(body.receiptIssued).toBe(false);
    expect(body.receiptNote).toBe(GATEWAY_NO_RECEIPT_NOTE);
    expect(body).not.toHaveProperty('receiptId');
    expect(body).not.toHaveProperty('receiptSignature');

    // Nothing was stored: not at the verified level, not at any level.
    const stored = await storedReceipts(env);
    expect(stored.filter((r) => r.level === VERIFIED_LEVEL)).toEqual([]);
    expect(stored).toEqual([]);
    expect(await auditCount(env, 'trust_receipt_issued')).toBe(0);

    // The same environment does sign and store once a verifier result is in hand,
    // so the empty table above is the route's choice and not a broken setup.
    await issueTrustReceipt(env, receiptInput(VERIFIED_LEVEL, passedCheck()));
    expect((await storedReceipts(env)).map((r) => r.level)).toEqual([VERIFIED_LEVEL]);
  });
});

describe('the verified level literal is written only where a verifier result is in hand', () => {
  /** Files that name the level without issuing anything. */
  const READ_ONLY: Record<string, string> = {
    'services/trust/receiptTypes.ts': 'declares the level and its label',
    'services/trust/brandPassport.ts': 'compares the level of a stored receipt',
  };
  /** Files that issue it. Each one must hand issueTrustReceipt a verifier result in the same call. */
  const ISSUERS = ['worker/domainVerification.ts'];
  const SOURCE_DIRS = ['worker', 'services', 'components', 'utils', 'hooks', 'constants', 'electron', 'bin', 'scripts', 'plugins', 'crawler', 'evals'];
  const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

  function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (SOURCE_FILE_RE.test(entry.name)) out.push(full);
      }
    };
    for (const dir of SOURCE_DIRS) if (existsSync(join(REPO_ROOT, dir))) walk(join(REPO_ROOT, dir));
    for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
      if (entry.isFile() && SOURCE_FILE_RE.test(entry.name)) out.push(join(REPO_ROOT, entry.name));
    }
    return out;
  }

  function positions(text: string, needle: string): number[] {
    const found: number[] = [];
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) found.push(at);
    return found;
  }

  /** The text of the issueTrustReceipt(...) call that encloses `at`, or null when there is none. */
  function enclosingIssueCall(text: string, at: number): string | null {
    const opener = 'issueTrustReceipt(';
    const start = text.lastIndexOf(opener, at);
    if (start === -1) return null;
    let depth = 0;
    for (let i = start + opener.length - 1; i < text.length; i++) {
      if (text[i] === '(') depth++;
      if (text[i] === ')') depth--;
      if (depth === 0) return i > at ? text.slice(start, i + 1) : null;
    }
    return null;
  }

  const withLiteral = new Map<string, string>();
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8');
    if (text.includes(VERIFIED_LEVEL)) withLiteral.set(relative(REPO_ROOT, file).split('\\').join('/'), text);
  }

  it('appears in no source file outside the reviewed list', () => {
    expect([...withLiteral.keys()].sort()).toEqual([...Object.keys(READ_ONLY), ...ISSUERS].sort());
  });

  it('the gateway route does not write it', () => {
    expect(readFileSync(join(REPO_ROOT, 'worker', 'oracleGateway.ts'), 'utf8')).not.toContain(VERIFIED_LEVEL);
    expect(readFileSync(join(REPO_ROOT, 'worker', 'oracleGateway.ts'), 'utf8')).not.toContain('issueTrustReceipt');
  });

  it.each(Object.keys(READ_ONLY))('%s names it without issuing a receipt', (file) => {
    const text = withLiteral.get(file) || '';
    expect(text).not.toContain('issueTrustReceipt');
    expect(text).not.toMatch(new RegExp(`\\blevel\\s*[:=]\\s*['"\`]${VERIFIED_LEVEL}`));
  });

  it.each(ISSUERS)('%s writes it only inside an issueTrustReceipt call that passes a verifier result', (file) => {
    const text = withLiteral.get(file) || '';
    const at = positions(text, VERIFIED_LEVEL);
    expect(at.length).toBeGreaterThan(0);
    for (const index of at) {
      const call = enclosingIssueCall(text, index);
      expect(call, `${file} offset ${index} is outside an issueTrustReceipt call`).not.toBeNull();
      expect(call).toMatch(/\bverifierResult\s*:\s*\{/);
      expect(call).toMatch(/\bpassed\s*:\s*true\b/);
    }
  });
});

describe('revokeGatewayIssuedReceipts', () => {
  let seq = 0;

  /** A row as the old gateway route stored it: verified level, public, built from constants. */
  async function seedGatewayReceipt(
    env: Env,
    opts: { accountId?: string; visibility?: 'public' | 'private'; revokedAt?: string; revokedReason?: string; method?: string; evidenceUrl?: string } = {},
  ): Promise<string> {
    const n = ++seq;
    const id = `rcpt_${n.toString(16).padStart(24, '0')}`;
    const issuedAt = new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString();
    const domain = `victim${n}.org`;
    const payload = {
      v: 1,
      id,
      iss: 'luminarasuite.com',
      kid: 'kid_old',
      issuedAt,
      subject: { kind: 'domain', id: domain },
      claim: 'domain_control',
      level: VERIFIED_LEVEL,
      method: opts.method ?? GATEWAY_RECEIPT_METHOD,
      evidence: [{ ref: 'target_homepage', url: opts.evidenceUrl ?? `https://${domain}`, fetchedAt: issuedAt, httpStatus: 0 }],
      measurementStatus: 'not_measured',
    };
    await env.DB!.prepare(
      `INSERT INTO trust_receipts (id, account_id, subject_kind, subject_id, claim, level, payload_json, signature, kid, visibility, expires_at, revoked_at, revoked_reason, created_at)
       VALUES (?, ?, 'domain', ?, 'domain_control', ?, ?, 'sig', 'kid_old', ?, NULL, ?, ?, ?)`,
    )
      .bind(
        id,
        opts.accountId ?? 'acct_a',
        domain,
        VERIFIED_LEVEL,
        canonicalJson(payload),
        opts.visibility ?? 'public',
        opts.revokedAt ?? null,
        opts.revokedReason ?? null,
        issuedAt,
      )
      .run();
    return id;
  }

  const byId = (rows: StoredReceipt[], id: string) => rows.find((r) => r.id === id)!;

  it('revokes only the receipts the gateway route issued', async () => {
    const env = makeEnv();
    const gateway = [
      await seedGatewayReceipt(env, { accountId: 'acct_a' }),
      await seedGatewayReceipt(env, { accountId: 'acct_a', visibility: 'private' }),
      await seedGatewayReceipt(env, { accountId: 'acct_b' }),
    ];
    // Receipts that must survive: a real verifier's, a self-reported one, and two that
    // only mention the gateway method somewhere other than as their exact method.
    const real = await issueTrustReceipt(env, receiptInput(VERIFIED_LEVEL, passedCheck(), { accountId: 'acct_a', visibility: 'public' }));
    const selfReported = await issueTrustReceipt(
      env,
      receiptInput('self_reported', undefined, { accountId: 'acct_b', claim: 'self_reported_file', method: 'owner_upload' }),
    );
    const nearName = await seedGatewayReceipt(env, { method: `${GATEWAY_RECEIPT_METHOD}_checked` });
    const inEvidence = await seedGatewayReceipt(env, { method: 'dns_txt', evidenceUrl: `https://example.org/${GATEWAY_RECEIPT_METHOD}` });

    expect(await revokeGatewayIssuedReceipts(env)).toEqual({ revoked: 3, remaining: 0 });

    const rows = await storedReceipts(env);
    for (const id of gateway) {
      const row = byId(rows, id);
      expect(row.revoked_at, id).toBeTruthy();
      expect(row.revoked_reason, id).toBe(GATEWAY_RECEIPT_REVOKED_REASON);
      expect(row.visibility, id).toBe('private');
      expect(row.level, id).toBe(VERIFIED_LEVEL);
    }
    for (const id of [real.id, selfReported.id, nearName, inEvidence]) {
      const row = byId(rows, id);
      expect(row.revoked_at, id).toBeNull();
      expect(row.revoked_reason, id).toBeNull();
    }
    expect(byId(rows, real.id).visibility).toBe('public');
    expect(rows).toHaveLength(7);

    // One entry per revoked receipt, in its owner's audit chain, attributed to the admin.
    const { results: logs } = await env.DB!.prepare(
      `SELECT actor_id, target_id FROM org_audit_logs WHERE action = 'trust_receipt_revoked' ORDER BY target_id`,
    ).all<{ actor_id: string; target_id: string }>();
    expect(logs).toEqual([...gateway].sort().map((id) => ({ actor_id: 'admin', target_id: id })));
  });

  it('is safe to run twice: the second run changes nothing', async () => {
    const env = makeEnv();
    await seedGatewayReceipt(env);
    await seedGatewayReceipt(env, { accountId: 'acct_b' });
    const real = await issueTrustReceipt(env, receiptInput(VERIFIED_LEVEL, passedCheck()));

    expect(await revokeGatewayIssuedReceipts(env)).toEqual({ revoked: 2, remaining: 0 });
    const afterFirst = await storedReceipts(env);
    const logsAfterFirst = await auditCount(env, 'trust_receipt_revoked');

    // Let the clock move so a second write would leave a different timestamp.
    await new Promise((done) => setTimeout(done, 5));
    expect(await revokeGatewayIssuedReceipts(env)).toEqual({ revoked: 0, remaining: 0 });
    expect(await revokeGatewayIssuedReceipts(env)).toEqual({ revoked: 0, remaining: 0 });

    expect(await storedReceipts(env)).toEqual(afterFirst);
    expect(await auditCount(env, 'trust_receipt_revoked')).toBe(logsAfterFirst);
    expect(byId(afterFirst, real.id).revoked_at).toBeNull();
  });

  it('keeps the reason and time of a gateway receipt its owner had already revoked', async () => {
    const env = makeEnv();
    const earlier = await seedGatewayReceipt(env, {
      visibility: 'private',
      revokedAt: '2026-10-02T00:00:00.000Z',
      revokedReason: 'revoked by owner',
    });
    const live = await seedGatewayReceipt(env);

    expect(await revokeGatewayIssuedReceipts(env)).toEqual({ revoked: 1, remaining: 0 });

    const rows = await storedReceipts(env);
    expect(byId(rows, earlier)).toMatchObject({ revoked_at: '2026-10-02T00:00:00.000Z', revoked_reason: 'revoked by owner' });
    expect(byId(rows, live).revoked_reason).toBe(GATEWAY_RECEIPT_REVOKED_REASON);
  });

  it('works in batches and reports what is left', async () => {
    const env = makeEnv();
    for (let i = 0; i < GATEWAY_REVOKE_BATCH + 2; i++) await seedGatewayReceipt(env);

    expect(await revokeGatewayIssuedReceipts(env)).toEqual({ revoked: GATEWAY_REVOKE_BATCH, remaining: 2 });
    expect(await revokeGatewayIssuedReceipts(env)).toEqual({ revoked: 2, remaining: 0 });
    expect(await revokeGatewayIssuedReceipts(env)).toEqual({ revoked: 0, remaining: 0 });
    expect((await storedReceipts(env)).every((r) => r.revoked_at && r.revoked_reason === GATEWAY_RECEIPT_REVOKED_REASON)).toBe(true);
  });

  it('a link to a public gateway receipt shows it as revoked afterwards, not as missing', async () => {
    const env = makeEnv();
    const id = await seedGatewayReceipt(env);
    const read = async () => handleTrustReceiptsRoute(apiRequest(`/api/trust/receipts/${id}`), env, `/trust/receipts/${id}`);

    const before = await read();
    expect(before!.status).toBe(200);
    expect(((await before!.json()) as { receipt: TrustReceiptView }).receipt.revokedAt).toBeNull();

    await revokeGatewayIssuedReceipts(env);

    const after = await read();
    expect(after!.status).toBe(200);
    const { receipt } = (await after!.json()) as { receipt: TrustReceiptView };
    expect(receipt.revokedAt).toBeTruthy();
    expect(receipt.revokedReason).toBe(GATEWAY_RECEIPT_REVOKED_REASON);
    expect(receipt.visibility).toBe('private');
  });

  describe('POST /api/admin/trust/revoke-gateway-receipts', () => {
    const call = (env: Env, init: RequestInit = { method: 'POST' }) =>
      worker.fetch(apiRequest('/api/admin/trust/revoke-gateway-receipts', init), env, ctx);
    const asAdmin = { method: 'POST', headers: { 'x-admin-secret': ADMIN_SECRET } };

    it('refuses a caller without the admin secret and revokes nothing', async () => {
      const env = makeEnv({ ADMIN_SECRET });
      const id = await seedGatewayReceipt(env);
      principal.accountId = 'acct_a'; // a signed-in user is not an admin

      expect((await call(env)).status).toBe(401);
      expect((await call(env, { method: 'POST', headers: { 'x-admin-secret': 'wrong' } })).status).toBe(401);
      expect((await call(makeEnv({ ADMIN_SECRET: undefined }), asAdmin)).status).toBe(503);
      expect(byId(await storedReceipts(env), id).revoked_at).toBeNull();
    });

    it('revokes for the admin, also while receipts are switched off, and can be repeated', async () => {
      const env = makeEnv({ ADMIN_SECRET, ENVIRONMENT: 'production', TRUST_RECEIPTS_ENABLED: 'false' });
      const id = await seedGatewayReceipt(env);
      const real = await issueTrustReceipt(env, receiptInput(VERIFIED_LEVEL, passedCheck()));

      const first = await call(env, asAdmin);
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ ok: true, revoked: 1, remaining: 0 });

      const second = await call(env, asAdmin);
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({ ok: true, revoked: 0, remaining: 0 });

      const rows = await storedReceipts(env);
      expect(byId(rows, id).revoked_reason).toBe(GATEWAY_RECEIPT_REVOKED_REASON);
      expect(byId(rows, real.id).revoked_at).toBeNull();
    });

    it('answers 405 to a GET and 503 without D1', async () => {
      const env = makeEnv({ ADMIN_SECRET });
      expect((await call(env, { method: 'GET', headers: { 'x-admin-secret': ADMIN_SECRET } })).status).toBe(405);
      expect((await call(makeEnv({ ADMIN_SECRET, DB: undefined }), asAdmin)).status).toBe(503);
    });
  });
});
