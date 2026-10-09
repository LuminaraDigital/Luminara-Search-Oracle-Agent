import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  computeCanonicalEvidenceHash,
  recordAuditProof,
  verifyAuditProof,
  generateBadgeResponse,
  buildFindingsFingerprint,
} from '../worker/proofService';
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
      TON_MINTER_PRIVATE_KEY: 'test_minter_key',
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

  it('records proof anchor in D1 and KV with TON on-chain broadcast', async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message_hash: 'c'.repeat(64) }),
    });

    const result = await recordAuditProof(
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

    expect(result.ok).toBe(true);
    expect(result.status).toBe('anchored');
    expect(result.txHash).toBeDefined();
    expect(result.explorerUrl).toContain('testnet.tonviewer.com/transaction/');
    expect(result.network).toBe('testnet');
    expect(result.chain).toBe('ton');

    // Confirm stored in D1
    const d1Row = await db
      .prepare('SELECT * FROM proof_anchors WHERE evidence_hash = ?')
      .bind(result.evidenceHash)
      .first<any>();
    expect(d1Row).not.toBeNull();
    expect(d1Row.domain).toBe('acme.org');
    expect(d1Row.status).toBe('anchored');
    expect(d1Row.tx_hash).toBe(result.txHash);

    // Confirm stored in KV
    const kvVal = await kv.get(`poa:${result.evidenceHash}`, 'json');
    expect(kvVal).not.toBeNull();
    expect(kvVal.domain).toBe('acme.org');
  });

  it('records honest off-chain proof in D1 and KV when TON minter is unconfigured', async () => {
    const unconfiguredEnv = {
      ...env,
      TON_CITATION_CONTRACT_ADDRESS: undefined,
      TON_MINTER_PRIVATE_KEY: undefined,
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

  it('verifies audit proof from D1 with on-chain disclosure', async () => {
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

    const verify = await verifyAuditProof(env, {
      evidenceHash: recorded.evidenceHash,
    });

    expect(verify.ok).toBe(true);
    expect(verify.verified).toBe(true);
    expect(verify.domain).toBe('verify-me.com');
    expect(verify.source).toBe('on_chain');
    expect(verify.disclosure).toContain('Anchored on TON testnet');
    expect(verify.explorerUrl).toContain('testnet.tonviewer.com');
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
