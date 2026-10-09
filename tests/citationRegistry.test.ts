import { describe, it, expect, vi } from 'vitest';
import {
  OP_INTERNAL_ANCHOR,
  OP_EXTERNAL_ANCHOR,
  buildCitationPayloadHex,
  domainToBigInt,
  auditIdToBigInt,
  computeCompositeKey,
  anchorAuditCitation,
  queryCitationOnChain,
  type CitationPayload,
} from '../worker/chain/ton/citationRegistry';
import type { Env } from '../worker/env';

describe('TON CitationRegistry', () => {
  const samplePayload: CitationPayload = {
    domain: 'example.com',
    auditRunId: 'audit_test_123',
    evidenceHash: 'a'.repeat(64),
    healthScore: 88,
    citationRatePercent: 75,
    findingsCount: 12,
  };

  it('defines correct 4-byte opcodes', () => {
    expect(OP_INTERNAL_ANCHOR).toBe(0x736e6368); // "snch"
    expect(OP_EXTERNAL_ANCHOR).toBe(0x616e6368); // "anch"
  });

  it('builds canonical citation payload hex', async () => {
    const hex = await buildCitationPayloadHex(samplePayload);
    expect(hex.startsWith('736e6368')).toBe(true); // OP_INTERNAL_ANCHOR
    expect(hex.length).toBe(8 + 64 + 64 + 64 + 2 + 2 + 4); // opcode + 3 hashes + score + rate + count
  });

  it('computes composite keys deterministically', async () => {
    const d1 = await domainToBigInt('example.com');
    const d2 = await domainToBigInt('example.com');
    expect(d1).toBe(d2);

    const a1 = await auditIdToBigInt('audit_1');
    const comp = computeCompositeKey(d1, a1);
    expect(typeof comp).toBe('bigint');
    expect(comp).not.toBe(d1);
  });

  it('fails closed when PROOF_ANCHOR_ENABLED is false', async () => {
    const env: Env = {
      CHAIN_NETWORK: 'testnet',
      CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
      PROOF_ANCHOR_ENABLED: 'false',
    } as unknown as Env;

    const res = await anchorAuditCitation(env, samplePayload);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('PROOF_ANCHOR_ENABLED is false');
  });

  it('fails closed on invalid CHAIN_NETWORK or missing bases', async () => {
    const env: Env = {
      CHAIN_NETWORK: 'invalid_net',
      PROOF_ANCHOR_ENABLED: 'true',
    } as unknown as Env;

    const res = await anchorAuditCitation(env, samplePayload);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Invalid CHAIN_NETWORK');
  });

  it('fails closed when contract or minter key is not configured', async () => {
    const env: Env = {
      CHAIN_NETWORK: 'testnet',
      CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
      PROOF_ANCHOR_ENABLED: 'true',
    } as unknown as Env;

    const res = await anchorAuditCitation(env, samplePayload);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('TON citation contract or minter key not configured');
  });

  it('broadcasts to Toncenter v3 when contract and minter key are configured', async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message_hash: 'b'.repeat(64) }),
    });

    const env: Env = {
      CHAIN_NETWORK: 'testnet',
      CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
      PROOF_ANCHOR_ENABLED: 'true',
      TON_CITATION_CONTRACT_ADDRESS: 'kQC_test_contract_address',
      TON_MINTER_PRIVATE_KEY: 'mock_key',
    } as unknown as Env;

    const res = await anchorAuditCitation(env, samplePayload, mockFetcher as unknown as typeof fetch);
    expect(res.ok).toBe(true);
    expect(mockFetcher).toHaveBeenCalled();
    const calledUrl = mockFetcher.mock.calls[0][0];
    expect(calledUrl).toBe('https://testnet.toncenter.com/api/v3/message');
    expect(res.txHash).toBe('b'.repeat(64));
  });

  it('queries on-chain citation via Toncenter runGetMethod and parses stack', async () => {
    const mockFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          exit_code: 0,
          stack: [
            ['num', '123456789'], // evidenceHash as int
            ['num', '92'], // healthScore
            ['num', '80'], // citationRate
            ['num', '5'],  // findingsCount
            ['num', '1710000000'], // anchoredAt
            ['num', '-1'], // found (-1 is true in TVM boolean)
          ],
        },
      }),
    });

    const env: Env = {
      CHAIN_NETWORK: 'testnet',
      CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
      TON_CITATION_CONTRACT_ADDRESS: 'kQC_test_contract_address',
    } as unknown as Env;

    const record = await queryCitationOnChain(env, 'example.com', 'audit_123', mockFetcher as unknown as typeof fetch);
    expect(record).not.toBeNull();
    expect(record?.healthScore).toBe(92);
    expect(record?.citationRate).toBe(80);
    expect(record?.findingsCount).toBe(5);
    expect(record?.found).toBe(true);
  });
});
