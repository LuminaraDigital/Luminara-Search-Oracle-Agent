import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import {
  createTonInvoice,
  verifyTonPayment,
  crc16Xmodem,
  JETTON_CHECKOUT_LIVE,
  JETTON_MASTERS,
  JETTON_UNAVAILABLE_ERROR,
  type TonOrder,
} from '../worker/tonPayment';
import { getQ402SupportedCatalog, Q402_SETTLEMENT_LIVE } from '../worker/q402';
import { isJettonCheckoutAvailable } from '../components/paywall/paymentOptions';
import { createSqliteD1 } from './helpers/sqliteD1';

/**
 * Regression guards for the Q402 / Jetton integration. Each test pins a hole that existed
 * before this file: Jetton orders credited on memo text alone, Q402 settling without any
 * on-chain proof, invented contract addresses, and UI rails that could not settle.
 */

function syntheticTonAddress(tag: number, fill: number): string {
  const bytes = new Uint8Array(36);
  bytes[0] = tag;
  bytes[1] = 0x00;
  bytes.fill(fill, 2, 34);
  const crc = crc16Xmodem(bytes.subarray(0, 34));
  bytes[34] = crc >> 8;
  bytes[35] = crc & 0xff;
  return Buffer.from(bytes).toString('base64url');
}

const MERCHANT = syntheticTonAddress(0x11, 0x5a);

function makeEnv() {
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
    TON_RECEIVING_ADDRESS: MERCHANT,
    ENVIRONMENT: 'production',
    CHAIN_NETWORK: 'mainnet',
    CHAIN_TON_API_BASE: 'https://toncenter.com/api/v3',
    CHAIN_TON_API_FALLBACK_BASE: 'https://tonapi.io',
    CHAIN_XDC_RPC_URL: 'https://erpc.xinfin.network',
  };
  return { env, kv };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

describe('Jetton checkout fails closed', () => {
  it('ships with Jetton checkout live backed by on-chain verifier', () => {
    expect(JETTON_CHECKOUT_LIVE).toBe(true);
  });

  it('refuses unconfigured Jetton masters and stores no order', async () => {
    const { env, kv } = makeEnv();
    const inv = await createTonInvoice(env, 'user_1', 'starter', { asset: 'LORA' });
    expect(inv.ok).toBe(false);
    expect(inv.error).toContain('checkout is not available');
    expect(kv.store.size).toBe(0);
  });

  it('rejects unknown asset values from untrusted input', async () => {
    const { env } = makeEnv();
    const inv = await createTonInvoice(env, 'user_1', 'starter', { asset: 'BTC' as any });
    expect(inv.ok).toBe(false);
  });

  it('still issues native TON invoices', async () => {
    const { env } = makeEnv();
    const inv = await createTonInvoice(env, 'user_1', 'starter');
    expect(inv.ok).toBe(true);
  });

  it('never credits a Jetton order from a spoofed native comment carrying the memo', async () => {
    const { env, kv } = makeEnv();
    const orderId = 'ton_1_spoof';
    const order: TonOrder = {
      orderId,
      userId: 'attacker',
      planId: 'agency',
      amountNano: '199000000',
      tonAmount: 199,
      memo: `LUM:${orderId}:agency`,
      recipientAddress: MERCHANT,
      status: 'pending',
      createdAt: Date.now(),
      asset: 'USDT',
    };
    await kv.put(`ton:order:${orderId}`, JSON.stringify(order));

    // 1 nanoTON plain comment containing the memo: previously enough to unlock Agency.
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          transactions: [
            {
              hash: 'spoofhash000000000000000000000000000000000000000000000000000000',
              now: Math.floor(Date.now() / 1000),
              mc_block_seqno: 1,
              in_msg: { value: '1', message_content: { decoded: { text: order.memo } } },
            },
          ],
        }),
        { status: 200 },
      );

    const res = await verifyTonPayment(env, orderId, { fetcher: fetcher as any });
    expect(res.ok).toBe(false);
  });

  it('ships no invented Jetton master addresses', () => {
    for (const net of Object.values(JETTON_MASTERS)) {
      for (const addr of Object.values(net)) {
        expect(addr === '' || /^[EU0k]Q[A-Za-z0-9_-]{46}$/.test(addr)).toBe(true);
        expect(addr).not.toMatch(/LUMINARA|8888/);
      }
    }
  });
});

describe('Q402 settlement fails closed', () => {
  it('ships with settlement disabled and says so in discovery', () => {
    const { env } = makeEnv();
    expect(Q402_SETTLEMENT_LIVE).toBe(false);
    expect(getQ402SupportedCatalog(env).settlementLive).toBe(false);
  });

  it.each(['/api/q402/verify', '/api/q402/settle', '/api/q402/audit'])('%s returns 503 Q402_NOT_LIVE', async (route) => {
    const { env } = makeEnv();
    const payment = JSON.stringify({
      x402Version: 1,
      scheme: 'ton/native-transfer',
      network: 'mainnet',
      asset: 'TON',
      amount: '50000000',
      txHash: 'a'.repeat(64),
    });
    const res = await worker.fetch(
      new Request(`https://luminarasuite.com${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-PAYMENT': payment },
        body: payment,
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code?: string; audit?: unknown };
    expect(body.code).toBe('Q402_NOT_LIVE');
    expect(body.audit).toBeUndefined();
  });
});

describe('Paywall Jetton rail visibility', () => {
  it('hides Jetton rails unless the server reports them live', () => {
    expect(isJettonCheckoutAvailable(null)).toBe(false);
    expect(isJettonCheckoutAvailable({ ok: true, ton: true })).toBe(false);
    expect(isJettonCheckoutAvailable({ ok: true, ton: true, jettonCheckout: false })).toBe(false);
    expect(isJettonCheckoutAvailable({ ok: true, ton: false, jettonCheckout: true })).toBe(false);
    expect(isJettonCheckoutAvailable({ ok: true, ton: true, jettonCheckout: true })).toBe(true);
  });
});
