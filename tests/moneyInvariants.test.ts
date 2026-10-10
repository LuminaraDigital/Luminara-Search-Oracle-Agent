import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { OP_JETTON_TRANSFER_NOTIFICATION } from '../worker/jettonSettlement';
import {
  createTonInvoice,
  crc16Xmodem,
  JETTON_CHECKOUT_LIVE,
  JETTON_UNAVAILABLE_ERROR,
  LORA_CHECKOUT_LIVE,
} from '../worker/tonPayment';
import { createSqliteD1 } from './helpers/sqliteD1';

/**
 * Money invariants. Each value here decides whether the app takes a payment it can credit.
 *
 * On 2026-10-10 the Jetton switch was found on, inside a commit about something else, while the
 * verifier looked for an opcode no real transfer carries. Changing one of these now means changing
 * this file in the same pull request, so the change is visible in review.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
    TON_RECEIVING_ADDRESS: syntheticTonAddress(0x11, 0x5a),
    ENVIRONMENT: 'production',
    CHAIN_NETWORK: 'mainnet',
    CHAIN_TON_API_BASE: 'https://toncenter.com/api/v3',
    CHAIN_TON_API_FALLBACK_BASE: 'https://tonapi.io',
  };
  return { env, kv };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

describe('money invariants', () => {
  it('Jetton checkout is off', () => {
    expect(JETTON_CHECKOUT_LIVE).toBe(false);
  });

  it('LORA checkout has its own switch and it is off', () => {
    expect(LORA_CHECKOUT_LIVE).toBe(false);
  });

  it('the Jetton verifier looks for the TEP-74 transfer_notification opcode', () => {
    expect(OP_JETTON_TRANSFER_NOTIFICATION).toBe(0x7362d09c);
  });

  it('the in-repo LORA contract sends the same opcode the verifier looks for', () => {
    const tact = readFileSync(join(ROOT, 'contracts/jetton/contracts/messages.tact'), 'utf8');
    expect(tact).toMatch(/message\(0x7362d09c\)\s+JettonNotification/);
  });

  it.each(['USDT', 'LORA'] as const)('no %s invoice is issued and no order is stored', async (asset) => {
    const { env, kv } = makeEnv();
    const inv = await createTonInvoice(env, 'user_1', 'starter', { asset });
    expect(inv.ok).toBe(false);
    expect((inv as { error: string }).error).toBe(JETTON_UNAVAILABLE_ERROR);
    expect(kv.store.size).toBe(0);
  });

  it('public health does not report a Jetton checkout, even with TON configured', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(new Request('https://luminarasuite.com/api/health'), env, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; ton?: boolean; jettonCheckout?: boolean };
    expect(body.ok).toBe(true);
    expect(body.jettonCheckout).toBe(false);
  });
});
