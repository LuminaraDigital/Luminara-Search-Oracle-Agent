import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  computeCanonicalEvidenceHash,
  recordAuditProof,
  verifyAuditProof,
  generateBadgeResponse,
  buildFindingsFingerprint,
} from '../worker/proofService';
import { recordProofAnchorBestEffort } from '../worker/proofAnchors';
import { createSqliteD1, type SqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import worker from '../worker/index';

function createMockKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (val === undefined) return null;
      if (type === 'json') return JSON.parse(val);
      return val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('Proof Service & Verifiable Citation Oracle', () => {
  let db: SqliteD1;
  let kv: ReturnType<typeof createMockKv>;
  let env: Env;

  beforeEach(() => {
    db = createSqliteD1();
    kv = createMockKv();
    env = {
      DB: db as any,
      LUMINARA_KV: kv as any,
      CHAIN_NETWORK: 'testnet',
      CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
      PROOF_ANCHOR_ENABLED: 'true',
      TON_CITATION_CONTRACT_ADDRESS: 'kQC_test_contract_address',
      WEBAPP_URL: 'https://luminarasuite.com',
    } as unknown as Env;
  });

  it('computes tamper-evident canonical evidence hash', async () => {
    const findings = [
      { id: 'f1', severity: 'high', title: 'Missing Schema' },
      { id: 'f2', severity: 'medium', title: 'Low Word Count' },
    ];
    const fingerprint = buildFindingsFingerprint(findings);
    expect(fingerprint).toBe('f1:high:Missing Schema;f2:medium:Low Word Count');

    const hash1 = await computeCanonicalEvidenceHash({
      domain: 'example.com',
      healthScore: 85,
      citationRatePercent: 70,
      findingsCount: 2,
      timestamp: 1710000000000,
      findingsFingerprint: fingerprint,
    });

    const hash2 = await computeCanonicalEvidenceHash({
      domain: 'example.com',
      healthScore: 85,
      citationRatePercent: 70,
      findingsCount: 2,
      timestamp: 1710000000000,
      findingsFingerprint: fingerprint,
    });
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);

    // Tampering healthScore breaks hash
    const tampered = await computeCanonicalEvidenceHash({
      domain: 'example.com',
      healthScore: 86,
      citationRatePercent: 70,
      findingsCount: 2,
      timestamp: 1710000000000,
      findingsFingerprint: fingerprint,
    });
    expect(tampered).not.toBe(hash1);
  });

  it('with anchoring switched on it makes no outbound request and stores nothing as anchored', async () => {
    // beforeEach sets PROOF_ANCHOR_ENABLED to "true" and a contract address. A chain API
    // that would answer 200 with a hash is what the old client stored as "anchored".
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message_hash: 'c'.repeat(64) }),
    });
    const globalFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message_hash: 'c'.repeat(64) }) });
    vi.stubGlobal('fetch', globalFetch);

    let result: Awaited<ReturnType<typeof recordAuditProof>>;
    try {
      result = await recordAuditProof(
        env,
        {
          domain: 'acme.org',
          auditRunId: 'run_abc_123',
          healthScore: 90,
          citationRatePercent: 82,
          findings: [{ id: 'f1', severity: 'low', title: 'Minor schema warning' }],
          actorId: 'usr_789',
        },
        mockFetcher as unknown as typeof fetch,
      );
      // And once more through the default fetcher, as the route calls it.
      await recordAuditProof(env, { domain: 'second.org', auditRunId: 'run_abc_124', healthScore: 60, citationRatePercent: 30 });
      expect(mockFetcher).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(result.ok).toBe(true);
    expect(result.status).toBe('off_chain');
    expect(result.txHash).toBeNull();
    expect(result.explorerUrl).toBeNull();
    expect(result.network).toBe('testnet');
    expect(result.chain).toBe('ton');

    // The proof is recorded in D1, with no hash and not as anchored.
    const d1Row = await db
      .prepare('SELECT domain, status, tx_hash, explorer_url FROM proof_anchors WHERE evidence_hash = ?')
      .bind(result.evidenceHash)
      .first<{ domain: string; status: string; tx_hash: string | null; explorer_url: string | null }>();
    expect(d1Row).toEqual({ domain: 'acme.org', status: 'pending', tx_hash: null, explorer_url: null });
    const anchored = await db
      .prepare(`SELECT COUNT(*) AS n FROM proof_anchors WHERE status = 'anchored' OR tx_hash IS NOT NULL`)
      .first<{ n: number }>();
    expect(anchored?.n).toBe(0);

    // Confirm stored in KV
    const kvVal = await kv.get(`poa:${result.evidenceHash}`, 'json');
    expect(kvVal).not.toBeNull();
    expect(kvVal.domain).toBe('acme.org');

    // So verification never says "on-chain" for it.
    const verify = await verifyAuditProof(env, { evidenceHash: result.evidenceHash });
    expect(verify.source).toBe('off_chain_digest');
    expect(verify.disclosure).toContain('Self-reported, off-chain digest');
    expect(verify.disclosure).not.toContain('on-chain');
  });

  it('records honest off-chain proof in D1 and KV when the TON contract is unconfigured', async () => {
    const unconfiguredEnv = {
      ...env,
      TON_CITATION_CONTRACT_ADDRESS: undefined,
    } as unknown as Env;

    const result = await recordAuditProof(unconfiguredEnv, {
      domain: 'honest-offchain.org',
      auditRunId: 'run_honest_123',
      healthScore: 85,
      citationRatePercent: 75,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('off_chain');
    expect(result.txHash).toBeNull();

    const verify = await verifyAuditProof(unconfiguredEnv, {
      evidenceHash: result.evidenceHash,
    });
    expect(verify.ok).toBe(true);
    expect(verify.verified).toBe(true);
    expect(verify.source).toBe('off_chain_digest');
    expect(verify.disclosure).toContain('Self-reported, off-chain digest');
  });

  it('rejects recording when provided evidenceHash does not match computed digest', async () => {
    const result = await recordAuditProof(env, {
      domain: 'acme.org',
      healthScore: 90,
      citationRatePercent: 82,
      evidenceHash: '0'.repeat(64),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('does not match');
  });

  it('verifies a recorded proof from D1 as an off-chain digest, by hash and by domain and run', async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message_hash: 'd'.repeat(64) }),
    });

    const recorded = await recordAuditProof(
      env,
      {
        domain: 'verify-me.com',
        auditRunId: 'audit_run_999',
        healthScore: 94,
        citationRatePercent: 88,
      },
      mockFetcher as unknown as typeof fetch,
    );

    for (const query of [{ evidenceHash: recorded.evidenceHash }, { domain: 'verify-me.com', auditRunId: 'audit_run_999' }]) {
      const verify = await verifyAuditProof(env, query);
      expect(verify.ok).toBe(true);
      expect(verify.verified).toBe(true);
      expect(verify.domain).toBe('verify-me.com');
      expect(verify.source).toBe('off_chain_digest');
      expect(verify.disclosure).toBe('Recorded by Luminara. Self-reported, off-chain digest.');
      expect(verify.txHash).toBeNull();
      expect(verify.explorerUrl).toBeNull();
    }
  });

  it('never reports an audit citation as on-chain, even a row an older build stored as anchored', async () => {
    // What the old registry client could leave behind: status "anchored", a hash and an explorer link.
    const legacyHash = '1'.repeat(64);
    const legacyTx = '9'.repeat(64);
    const legacyLink = `https://testnet.tonviewer.com/transaction/${legacyTx}`;
    expect(
      await recordProofAnchorBestEffort(env, {
        id: 'pa_legacy_audit_1',
        kind: 'audit_citation',
        auditRunId: 'run_legacy_1',
        domain: 'legacy.org',
        evidenceHash: legacyHash,
        chain: 'ton',
        network: 'testnet',
        contract: 'kQC_test_contract_address',
        txHash: legacyTx,
        explorerUrl: legacyLink,
        status: 'anchored',
      }),
    ).toBe(true);

    const viaRoute = await worker.fetch(new Request(`https://example.com/api/proof/verify?evidenceHash=${legacyHash}`), env);
    expect(viaRoute.status).toBe(200);
    const answers = [
      await verifyAuditProof(env, { evidenceHash: legacyHash }),
      await verifyAuditProof(env, { domain: 'legacy.org', auditRunId: 'run_legacy_1' }),
      (await viaRoute.json()) as Awaited<ReturnType<typeof verifyAuditProof>>,
    ];
    for (const verify of answers) {
      expect(verify.ok).toBe(true);
      expect(verify.domain).toBe('legacy.org');
      expect(verify.source).toBe('off_chain_digest');
      expect(verify.disclosure).toBe('Recorded off-chain. Not anchored on TON.');
      expect(verify.txHash).toBeNull();
      expect(verify.explorerUrl).toBeNull();
      expect(verify.record).toMatchObject({ kind: 'audit_citation', status: 'pending', tx_hash: null, explorer_url: null, anchored_at: null });
      // Nothing in the answer hands out the stored hash, the link, or the old wording.
      const text = JSON.stringify(verify);
      expect(text).not.toContain(legacyTx);
      expect(text).not.toContain('tonviewer');
      expect(text).not.toContain('Verifiable on-chain');
      expect(text).not.toContain('Anchored on TON');
    }

    // Reading it changed nothing in the database.
    const stored = await db
      .prepare('SELECT status, tx_hash, explorer_url FROM proof_anchors WHERE id = ?')
      .bind('pa_legacy_audit_1')
      .first<{ status: string; tx_hash: string; explorer_url: string }>();
    expect(stored).toEqual({ status: 'anchored', tx_hash: legacyTx, explorer_url: legacyLink });
  });

  it('still reports a payment anchor as on-chain, with its transaction hash and explorer link', async () => {
    const paymentDigest = '2'.repeat(64);
    const paymentTx = '8'.repeat(64);
    const paymentLink = `https://testnet.tonviewer.com/transaction/${paymentTx}`;
    expect(
      await recordProofAnchorBestEffort(env, {
        kind: 'ton_payment',
        orderId: 'ord_payment_1',
        evidenceHash: paymentDigest,
        chain: 'ton',
        network: 'testnet',
        txHash: paymentTx,
        explorerUrl: paymentLink,
        status: 'anchored',
      }),
    ).toBe(true);

    const verify = await verifyAuditProof(env, { evidenceHash: paymentDigest });
    expect(verify.ok).toBe(true);
    expect(verify.source).toBe('on_chain');
    expect(verify.disclosure).toBe('Anchored on TON testnet. Verifiable on-chain.');
    expect(verify.txHash).toBe(paymentTx);
    expect(verify.explorerUrl).toBe(paymentLink);
    expect(verify.record).toMatchObject({ kind: 'ton_payment', status: 'anchored', tx_hash: paymentTx, explorer_url: paymentLink });

    // A payment anchor that is not anchored yet reads as before, too.
    await recordProofAnchorBestEffort(env, {
      id: 'pa_payment_pending_1',
      kind: 'ton_payment',
      orderId: 'ord_payment_2',
      evidenceHash: '3'.repeat(64),
      chain: 'ton',
      network: 'testnet',
      status: 'pending',
    });
    const pending = await verifyAuditProof(env, { evidenceHash: '3'.repeat(64) });
    expect(pending.source).toBe('off_chain_digest');
    expect(pending.disclosure).toBe('Recorded by Luminara. Self-reported, off-chain digest.');
    expect(pending.record).toMatchObject({ kind: 'ton_payment', status: 'pending' });
  });

  it('verifies off-chain digest from KV with honest disclosure when D1 row is absent', async () => {
    const digest = 'e'.repeat(64);
    await kv.put(
      `poa:${digest}`,
      JSON.stringify({
        digestHex: digest,
        domain: 'kv-only.org',
        healthScore: 78,
      }),
    );

    const verify = await verifyAuditProof(env, { evidenceHash: digest });
    expect(verify.ok).toBe(true);
    expect(verify.verified).toBe(true);
    expect(verify.source).toBe('off_chain_digest');
    expect(verify.disclosure).toContain('Self-reported, off-chain digest');
  });

  it('generates badge metadata with network-aware labels', async () => {
    const response = generateBadgeResponse({
      domain: 'badgedomain.com',
      evidenceHash: 'f'.repeat(64),
      healthScore: 92,
      source: 'on_chain',
      network: 'testnet',
      explorerUrl: 'https://testnet.tonviewer.com/transaction/abc',
    });

    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.badge.scoreColor).toBe('#10b981');
    expect(data.badge.embedHtml).toContain('TON testnet');
    expect(data.badge.embedHtml).toContain('https://testnet.tonviewer.com/transaction/abc');
  });

  it('routes /api/proof/verify publicly and /api/proof/anchor with auth guard', async () => {
    // 1. /api/proof/verify without auth -> 404 for non-existent proof, not 401
    const unauthVerify = await worker.fetch(
      new Request('https://example.com/api/proof/verify?evidenceHash=missing_hash'),
      env,
    );
    expect(unauthVerify.status).toBe(404);

    // 2. /api/proof/anchor without auth -> 401 Unauthorized
    const unauthAnchor = await worker.fetch(
      new Request('https://example.com/api/proof/anchor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'test.com', healthScore: 80, citationRatePercent: 50 }),
      }),
      env,
    );
    expect(unauthAnchor.status).toBe(401);

    // 3. /api/proof/badge without auth -> 200
    const badgeRes = await worker.fetch(
      new Request('https://example.com/api/proof/badge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'test.com',
          evidenceHash: 'c'.repeat(64),
          healthScore: 85,
          source: 'on_chain',
          network: 'testnet',
        }),
      }),
      env,
    );
    expect(badgeRes.status).toBe(200);
    const badgeJson = await badgeRes.json();
    expect(badgeJson.ok).toBe(true);
  });
});
