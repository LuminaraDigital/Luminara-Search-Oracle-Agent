import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  ANCHOR_NO_SIGNER_ERROR,
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

  /** Everything the client needs to reach the chain API. There is no key in it. */
  const anchoringEnv = {
    CHAIN_NETWORK: 'testnet',
    CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
    PROOF_ANCHOR_ENABLED: 'true',
    TON_CITATION_CONTRACT_ADDRESS: 'kQC_test_contract_address',
  } as unknown as Env;

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

  it('fails closed, without calling the chain API, when the contract is not configured', async () => {
    const mockFetcher = vi.fn();
    const env: Env = {
      CHAIN_NETWORK: 'testnet',
      CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
      PROOF_ANCHOR_ENABLED: 'true',
    } as unknown as Env;

    const res = await anchorAuditCitation(env, samplePayload, mockFetcher as unknown as typeof fetch);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('TON citation contract not configured');
    expect(res.txHash).toBeUndefined();
    expect(mockFetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['a hash, which the old client stored as anchored', { message_hash: 'b'.repeat(64) }],
    ['no hash, for which the old client made one up', {}],
  ])('with the flag on and a contract set it makes no outbound request (a chain API that would answer 200 with %s)', async (_label, reply) => {
    const mockFetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => reply });
    const globalFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => reply });
    vi.stubGlobal('fetch', globalFetch);
    try {
      const withFetcher = await anchorAuditCitation(anchoringEnv, samplePayload, mockFetcher as unknown as typeof fetch);
      const withDefault = await anchorAuditCitation(anchoringEnv, samplePayload);

      // Exactly this: no hash, no explorer link, no contract, nothing a caller could store as anchored.
      expect(withFetcher).toEqual({ ok: false, error: ANCHOR_NO_SIGNER_ERROR });
      expect(withDefault).toEqual({ ok: false, error: ANCHOR_NO_SIGNER_ERROR });
      expect(mockFetcher).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();

      // Neither the chain API's hash nor the old made-up one (the SHA-256 of the payload) comes back.
      const invented = createHash('sha256').update(await buildCitationPayloadHex(samplePayload)).digest('hex');
      expect(JSON.stringify(withFetcher)).not.toContain(invented);
      expect(JSON.stringify(withFetcher)).not.toContain('b'.repeat(64));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('has no code that posts a message to the chain API', () => {
    const client = readFileSync(resolve(__dirname, '..', 'worker', 'chain', 'ton', 'citationRegistry.ts'), 'utf8');
    expect(client).not.toContain('/message');
    expect(client).not.toMatch(/\bboc\b\s*:/);
    // The one request left is the read of a recorded proof.
    expect(Array.from(client.matchAll(/\bfetcher\(/g))).toHaveLength(1);
    expect(client).toContain('/runGetMethod');
  });

  it('has no slot for a chain signing key, in the Worker environment or the registry client', () => {
    const removed = ['TON', 'MINTER', 'PRIVATE', 'KEY'].join('_');
    const root = resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs|js|jsonc|json|toml)$/.test(entry.name) && readFileSync(full, 'utf8').includes(removed)) {
          offenders.push(relative(root, full));
        }
      }
    };
    for (const dir of ['worker', 'services', 'components', 'scripts', 'tests']) walk(join(root, dir));
    if (readFileSync(join(root, 'wrangler.jsonc'), 'utf8').includes(removed)) offenders.push('wrangler.jsonc');
    expect(offenders).toEqual([]);

    // No other chain key can take its place in the registry client: it reads the contract
    // address, the network, the API base, the API key and the flag, and nothing else.
    const client = readFileSync(join(root, 'worker', 'chain', 'ton', 'citationRegistry.ts'), 'utf8');
    const envNames = [...new Set(Array.from(client.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g), (m) => m[1]))].sort();
    expect(envNames).toEqual(['TON_API_KEY', 'TON_CITATION_CONTRACT_ADDRESS']);
    expect(client).not.toMatch(/PRIVATE_KEY|MNEMONIC|SEED_PHRASE|SECRET_KEY/i);

    // And the Worker environment declares no private key or seed phrase under any name.
    const envTypes = readFileSync(join(root, 'worker', 'env.ts'), 'utf8');
    expect(envTypes.match(/\b[A-Z0-9_]*(PRIVATE_KEY|MNEMONIC|SEED_PHRASE)[A-Z0-9_]*\??\s*:/g) || []).toEqual([]);
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
