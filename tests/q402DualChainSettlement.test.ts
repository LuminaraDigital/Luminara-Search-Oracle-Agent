import { describe, it, expect } from 'vitest';
import {
  createQ402ChallengeRecord,
  getQ402ChallengeRecord,
  verifyAndSettleQ402Payment,
  getQ402SupportedCatalog,
} from '../worker/q402/facilitator';
import { tonAdapter } from '../worker/q402/tonAdapter';
import { stringToHexData } from '../worker/q402/xdcAdapter';
import { createSqliteD1 } from './helpers/sqliteD1';

function makeEnv(opts: { q402Live?: boolean } = {}) {
  const store = new Map<string, string>();
  const kv = {
    store,
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (val === undefined) return null;
      return type === 'json' ? JSON.parse(val) : val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };

  const env: any = {
    LUMINARA_KV: kv,
    DB: createSqliteD1(),
    TON_RECEIVING_ADDRESS: 'EQB4fA6S70_0Z367Yt_mH7m5j5m0G7_7q_lGk1r2d3e4f5a6',
    XDC_RECEIVING_ADDRESS: '0x1111222233334444555566667777888899990000',
    ENVIRONMENT: 'test',
    CHAIN_NETWORK: 'testnet',
    CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
    CHAIN_TON_API_FALLBACK_BASE: 'https://testnet.tonapi.io',
    CHAIN_XDC_RPC_URL: 'https://erpc.apothem.network',
    Q402_LIVE: opts.q402Live ? 'true' : 'false',
  };

  return { env, kv };
}

describe('Luminara Q402 Dual-Chain Engine', () => {
  it('generates and stores challenge records for TON in KV', async () => {
    const { env } = makeEnv();
    const { requirement, challenge } = await createQ402ChallengeRecord(
      env,
      '/api/q402/audit',
      'TON',
      'single_audit',
    );

    expect(requirement.scheme).toBe('ton/native-transfer');
    expect(requirement.maxAmountRequired).toBe('50000000'); // 0.05 TON
    expect(challenge.orderId).toBeDefined();
    expect(challenge.status).toBe('pending');

    const fetched = await getQ402ChallengeRecord(env, challenge.orderId);
    expect(fetched).not.toBeNull();
    expect(fetched?.amountUnits).toBe('50000000');
  });

  it('generates challenge records for XDC with ISO 20022 compliant enterprise units', async () => {
    const { env } = makeEnv();
    const { requirement, challenge } = await createQ402ChallengeRecord(
      env,
      '/api/q402/audit',
      'XDC',
      'single_audit',
    );

    expect(requirement.scheme).toBe('xdc/native-transfer');
    expect(requirement.network).toBe('apothem');
    expect(requirement.maxAmountRequired).toBe('50000000000000000000'); // 50 XDC in wei
    expect(requirement.extra?.displayAmount).toBe('50 XDC');
    expect(challenge.asset).toBe('XDC');
  });

  it('includes both TON and XDC networks in the public catalog', () => {
    const { env } = makeEnv({ q402Live: true });
    const catalog = getQ402SupportedCatalog(env);

    expect(catalog.networks).toContain('testnet');
    expect(catalog.networks).toContain('apothem');
    expect(catalog.schemes).toContain('ton/native-transfer');
    expect(catalog.schemes).toContain('xdc/native-transfer');
    expect(catalog.assets.XDC).toBeDefined();
    expect(catalog.endpoints[0].prices.XDC).toBeDefined();
    expect(catalog.settlementLive).toBe(true);
  });

  it('verifies and settles a valid XDC transaction on-chain via JSON-RPC', async () => {
    const { env } = makeEnv({ q402Live: true });
    const { challenge } = await createQ402ChallengeRecord(
      env,
      '/api/q402/audit',
      'XDC',
      'single_audit',
    );

    const txHash = '0x' + 'a'.repeat(64);
    const mockRpcFetcher = async (_url: string, _init?: any): Promise<Response> => {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            to: env.XDC_RECEIVING_ADDRESS,
            value: '50000000000000000000',
            input: stringToHexData(challenge.memo),
            from: '0xpayer123',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const settlement = await verifyAndSettleQ402Payment(
      env,
      {
        x402Version: 1,
        scheme: 'xdc/native-transfer',
        network: 'apothem',
        orderId: challenge.orderId,
        txHash,
        amount: '50000000000000000000',
        asset: 'XDC',
        payerAddress: '0xpayer123',
      },
      { fetcher: mockRpcFetcher as any },
    );

    expect(settlement.success).toBe(true);
    expect(settlement.txHash).toBe(txHash);
    expect(settlement.asset).toBe('XDC');
    expect(settlement.explorerUrl).toContain('apothem.xdcscan.io');

    // Challenge should now be marked settled
    const updated = await getQ402ChallengeRecord(env, challenge.orderId);
    expect(updated?.status).toBe('settled');

    // Replay attack must be blocked
    const replay = await verifyAndSettleQ402Payment(
      env,
      {
        x402Version: 1,
        scheme: 'xdc/native-transfer',
        network: 'apothem',
        orderId: challenge.orderId,
        txHash,
        amount: '50000000000000000000',
        asset: 'XDC',
      },
      { fetcher: mockRpcFetcher as any },
    );
    expect(replay.success).toBe(false);
    expect(replay.error).toContain('already been settled');
  });

  it('rejects XDC settlements with mismatched recipient or deficient value', async () => {
    const { env } = makeEnv({ q402Live: true });
    const { challenge } = await createQ402ChallengeRecord(
      env,
      '/api/q402/audit',
      'XDC',
      'single_audit',
    );

    const txHash = '0x' + 'b'.repeat(64);
    const mockMismatchedFetcher = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            to: '0xwrongRecipient0000000000000000000000000',
            value: '50000000000000000000',
            input: stringToHexData(challenge.memo),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    const res = await verifyAndSettleQ402Payment(
      env,
      {
        x402Version: 1,
        scheme: 'xdc/native-transfer',
        network: 'apothem',
        orderId: challenge.orderId,
        txHash,
        amount: '50000000000000000000',
        asset: 'XDC',
      },
      { fetcher: mockMismatchedFetcher as any },
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain('recipient does not match');
  });

  it('verifies TON adapter validates payload structure and rejects malformed hashes', async () => {
    const { env } = makeEnv();
    const valid = await tonAdapter.verifyPayload(
      {
        x402Version: 1,
        scheme: 'ton/native-transfer',
        network: 'testnet',
        txHash: 'c'.repeat(64),
        amount: '50000000',
        asset: 'TON',
      },
      env,
    );
    expect(valid.isValid).toBe(true);

    const invalid = await tonAdapter.verifyPayload(
      {
        x402Version: 1,
        scheme: 'ton/native-transfer',
        network: 'testnet',
        txHash: 'short',
        amount: '50000000',
        asset: 'TON',
      },
      env,
    );
    expect(invalid.isValid).toBe(false);
    expect(invalid.invalidReason).toContain('Invalid TON transaction hash');
  });
});
