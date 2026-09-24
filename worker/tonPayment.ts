/**
 * TON settlement: invoice + on-chain verify via Toncenter, then KV subscription.
 * Never trust client BOC alone; confirmation requires a matching on-chain transfer.
 * Crediting is claimed atomically in D1 (worker/paymentLedger.ts) before the subscription is written.
 */
import type { Env } from './index';
import { claimTonTransaction, isTonLedgerReady, releaseTonTransaction } from './paymentLedger';
import { PLANS } from './telegramBot';
import { resolveAccountId, writeSubscriptionRecord } from './userStore';
import { recordAuditLogBestEffort } from './auditLog';

export const TON_PRICING: Record<string, { ton: number; nanoTon: string }> = {
  starter: { ton: 15, nanoTon: '15000000000' },
  growth: { ton: 45, nanoTon: '45000000000' },
  agency: { ton: 120, nanoTon: '120000000000' },
  single_audit: { ton: 0.05, nanoTon: '50000000' },
  multi_agent_crawl: { ton: 0.15, nanoTon: '150000000' },
};

export const TON_UNAVAILABLE_ERROR =
  'TON payments are not available right now. Use Telegram Stars in the Telegram app or a license key.';
const TON_VERIFY_UNAVAILABLE_ERROR = 'Payment verification is temporarily unavailable. Please try again in a few minutes.';

export interface TonOrder {
  orderId: string;
  userId: string;
  planId: string;
  amountNano: string;
  tonAmount: number;
  memo: string;
  recipientAddress: string;
  status: 'pending' | 'confirmed' | 'expired';
  createdAt: number;
  confirmedAt?: number;
  txHash?: string;
}

export type TonFetch = (url: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Merchant address validation (mirrored in scripts/lib/tonAddress.mjs)
// ---------------------------------------------------------------------------

export type TonAddressValidation =
  | { ok: true; format: 'friendly' | 'raw'; testnet: boolean }
  | { ok: false; reason: string };

const RAW_ADDRESS_RE = /^(0|-1):[0-9a-fA-F]{64}$/;
const FRIENDLY_ADDRESS_RE = /^[A-Za-z0-9+/_-]{48}$/;
const TAG_BOUNCEABLE = 0x11;
const TAG_NON_BOUNCEABLE = 0x51;
const TESTNET_FLAG = 0x80;

export function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Accepts mainnet user-friendly EQ/UQ addresses (CRC16 verified) and raw `0:`/`-1:` + 64 hex.
 * Testnet-flagged kQ/0Q addresses are rejected when `production` is true.
 */
export function validateTonAddress(address: unknown, opts: { production: boolean }): TonAddressValidation {
  const value = typeof address === 'string' ? address.trim() : '';
  if (!value) return { ok: false, reason: 'address is missing' };

  if (RAW_ADDRESS_RE.test(value)) return { ok: true, format: 'raw', testnet: false };
  if (value.includes(':')) {
    return { ok: false, reason: 'raw address must be 0: or -1: followed by 64 hex characters' };
  }
  if (!FRIENDLY_ADDRESS_RE.test(value)) {
    return { ok: false, reason: 'user-friendly address must be 48 base64url characters' };
  }

  const bytes = decodeBase64(value);
  if (!bytes || bytes.length !== 36) return { ok: false, reason: 'user-friendly address does not decode to 36 bytes' };

  const tag = bytes[0];
  const testnet = (tag & TESTNET_FLAG) !== 0;
  const baseTag = tag & ~TESTNET_FLAG;
  if (baseTag !== TAG_BOUNCEABLE && baseTag !== TAG_NON_BOUNCEABLE) {
    return { ok: false, reason: 'unknown address flag byte' };
  }
  if (bytes[1] !== 0x00) {
    return { ok: false, reason: 'user-friendly address must be on the basechain (EQ/UQ prefix)' };
  }
  const expected = (bytes[34] << 8) | bytes[35];
  if (crc16Xmodem(bytes.subarray(0, 34)) !== expected) {
    return { ok: false, reason: 'address checksum mismatch' };
  }
  if (testnet && opts.production) {
    return { ok: false, reason: 'testnet address (kQ/0Q) is not allowed in production' };
  }
  return { ok: true, format: 'friendly', testnet };
}

function isProductionEnv(env: Pick<Env, 'ENVIRONMENT'>): boolean {
  return String(env.ENVIRONMENT || '').trim().toLowerCase() === 'production';
}

function addressForLog(value: string): string {
  return value ? `"${value.slice(0, 4)}…" (${value.length} chars)` : '(unset)';
}

export function isTonPaymentConfigured(env: Pick<Env, 'TON_RECEIVING_ADDRESS' | 'ENVIRONMENT'>): boolean {
  return validateTonAddress(env.TON_RECEIVING_ADDRESS, { production: isProductionEnv(env) }).ok;
}

// ---------------------------------------------------------------------------
// Invoice + verification
// ---------------------------------------------------------------------------

export async function createTonInvoice(
  env: Env,
  userId: string,
  planId: string,
): Promise<{ ok: true; order: TonOrder } | { ok: false; error: string }> {
  const plan = PLANS[planId];
  const price = TON_PRICING[planId];
  if (!plan || !price) {
    return { ok: false, error: `Invalid plan "${planId}". Available: ${Object.keys(PLANS).join(', ')}` };
  }

  const recipient = String(env.TON_RECEIVING_ADDRESS || '').trim();
  const addressCheck = validateTonAddress(recipient, { production: isProductionEnv(env) });
  if (!addressCheck.ok) {
    console.error(
      `[TON] Invoice refused: TON_RECEIVING_ADDRESS ${addressForLog(recipient)} is not valid for ENVIRONMENT=${env.ENVIRONMENT || 'unset'} (${addressCheck.reason}).`,
    );
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  if (!env.LUMINARA_KV) {
    console.error('[TON] Invoice refused: LUMINARA_KV is not bound, so the order could never be verified.');
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }
  if (!(await isTonLedgerReady(env))) {
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  const orderId = `ton_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const memo = `LUM:${orderId}:${planId}`;

  const order: TonOrder = {
    orderId,
    userId,
    planId,
    amountNano: price.nanoTon,
    tonAmount: price.ton,
    memo,
    recipientAddress: recipient,
    status: 'pending',
    createdAt: Date.now(),
  };

  await env.LUMINARA_KV.put(`ton:order:${orderId}`, JSON.stringify(order), { expirationTtl: 7200 });

  return { ok: true, order };
}

/** Extract comment text from Toncenter / TonAPI shaped messages. */
export function extractTonComment(msg: any): string {
  if (!msg) return '';
  if (typeof msg.message === 'string' && msg.message) return msg.message;
  if (typeof msg.decoded_body?.text === 'string' && msg.decoded_body.text) return msg.decoded_body.text;
  const rawText = msg.msg_data?.text;
  if (typeof rawText === 'string' && rawText) {
    if (rawText.startsWith('LUM:')) return rawText;
    // Handle base64 encoded text in Toncenter v2
    try {
      if (typeof atob === 'function') {
        const decoded = atob(rawText);
        if (decoded && (decoded.includes('LUM:') || /^[\x20-\x7E]+$/.test(decoded))) {
          return decoded;
        }
      }
    } catch {
      /* non-base64 fallback */
    }
    return rawText;
  }
  return '';
}

function reportHashlessMatch(order: TonOrder): void {
  console.error(`[TON] Transfer matching order ${order.orderId} has no transaction hash; not crediting without a dedupe key.`);
}

/**
 * Looks up recent inbound transfers to the merchant wallet and matches memo + amount.
 * Queries Toncenter v2 with seamless fallback to TonAPI for high availability.
 */
export async function findMatchingTonPayment(
  order: TonOrder,
  env: Env,
  fetcher: TonFetch = fetch,
): Promise<{ ok: true; txHash: string } | { ok: false; error: string }> {
  const apiKey = String(env.TON_API_KEY || '').trim();
  const minValue = BigInt(order.amountNano);
  const minTimeSec = Math.floor((order.createdAt - 60_000) / 1000); // 1-minute clock skew allowance

  // 1. Primary on-chain provider: Toncenter v2
  const toncenterUrl =
    `https://toncenter.com/api/v2/getTransactions` +
    `?address=${encodeURIComponent(order.recipientAddress)}&limit=30`;
  const toncenterHeaders: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) toncenterHeaders['X-API-Key'] = apiKey;

  let toncenterFailed = false;
  try {
    const res = await fetcher(toncenterUrl, { headers: toncenterHeaders });
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean; result?: any[] };
      const txs = Array.isArray(data.result) ? data.result : [];
      for (const tx of txs) {
        const utime = Number(tx.utime || 0);
        if (utime && utime < minTimeSec) continue;
        const inMsg = tx.in_msg;
        if (!inMsg) continue;
        const comment = extractTonComment(inMsg);
        const value = BigInt(String(inMsg.value || '0'));
        if (comment.includes(order.memo) && value >= minValue) {
          const hash = typeof tx.transaction_id?.hash === 'string' ? tx.transaction_id.hash : typeof tx.hash === 'string' ? tx.hash : '';
          if (!hash) {
            reportHashlessMatch(order);
            continue;
          }
          return { ok: true, txHash: hash };
        }
      }
    } else {
      toncenterFailed = true;
    }
  } catch {
    toncenterFailed = true;
  }

  // 2. High-availability secondary provider: TonAPI (tonapi.io)
  try {
    const tonapiUrl = `https://tonapi.io/v2/blockchain/accounts/${encodeURIComponent(order.recipientAddress)}/transactions?limit=30`;
    const tonapiRes = await fetcher(tonapiUrl, { headers: { Accept: 'application/json' } });
    if (tonapiRes.ok) {
      const data = (await tonapiRes.json()) as { transactions?: any[] };
      const txs = Array.isArray(data.transactions) ? data.transactions : [];
      for (const tx of txs) {
        const utime = Number(tx.utime || 0);
        if (utime && utime < minTimeSec) continue;
        const inMsg = tx.in_msg;
        if (!inMsg) continue;
        const comment = extractTonComment(inMsg);
        const value = BigInt(String(inMsg.value || '0'));
        if (comment.includes(order.memo) && value >= minValue) {
          const hash = typeof tx.hash === 'string' ? tx.hash : '';
          if (!hash) {
            reportHashlessMatch(order);
            continue;
          }
          return { ok: true, txHash: hash };
        }
      }
    }
  } catch {
    /* ignore fallback network errors */
  }

  if (toncenterFailed) {
    return { ok: false, error: 'Could not reach TON network to verify payment. Retrying shortly.' };
  }

  return { ok: false, error: 'Matching on-chain transfer not found yet. Wait a few seconds and retry.' };
}

export async function verifyTonPayment(
  env: Env,
  orderId: string,
  opts: { expectedUserId?: string; fetcher?: TonFetch } = {},
): Promise<{ ok: true; plan: string; expiresAt: number } | { ok: false; error: string }> {
  if (!env.LUMINARA_KV) {
    console.error('[TON] Verify refused: LUMINARA_KV is not bound.');
    return { ok: false, error: TON_VERIFY_UNAVAILABLE_ERROR };
  }
  const kv = env.LUMINARA_KV;

  const raw = await kv.get(`ton:order:${orderId}`, 'json');
  if (!raw) {
    return { ok: false, error: 'Order not found or expired' };
  }
  const order = raw as TonOrder;

  if (opts.expectedUserId && order.userId !== opts.expectedUserId) {
    return { ok: false, error: 'Order does not belong to this account' };
  }

  const currentExpiry = async (): Promise<number> => {
    const accountId = await resolveAccountId(env, order.userId);
    const existingSub = (await kv.get(`sub:${accountId}`, 'json')) as { expiresAt?: number } | null;
    return existingSub?.expiresAt || Date.now();
  };

  if (order.status === 'confirmed') {
    return { ok: true, plan: order.planId, expiresAt: await currentExpiry() };
  }

  const plan = PLANS[order.planId];
  if (!plan) return { ok: false, error: 'Invalid plan on order' };

  const recipientCheck = validateTonAddress(order.recipientAddress, { production: isProductionEnv(env) });
  if (!recipientCheck.ok) {
    console.error(
      `[TON] Verify refused for order ${order.orderId}: recipient ${addressForLog(String(order.recipientAddress || ''))} is not valid (${recipientCheck.reason}).`,
    );
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  const match = await findMatchingTonPayment(order, env, opts.fetcher || fetch);
  if (!match.ok) return match;

  // Legacy KV guard for transactions credited before the D1 ledger existed.
  const txGuardKey = `ton:tx:${match.txHash}`;
  const alreadyClaimed = await kv.get(txGuardKey);
  if (alreadyClaimed && alreadyClaimed !== orderId) {
    return { ok: false, error: 'This on-chain transaction has already been credited to another order.' };
  }

  const accountId = await resolveAccountId(env, order.userId);
  const claim = await claimTonTransaction(env, { txHash: match.txHash, orderId, accountId });
  if (!claim.ok) {
    if (claim.reason === 'tx_credited_to_other_order') {
      return { ok: false, error: 'This on-chain transaction has already been credited to another order.' };
    }
    if (claim.reason === 'order_already_credited') {
      return { ok: true, plan: order.planId, expiresAt: await currentExpiry() };
    }
    return { ok: false, error: TON_VERIFY_UNAVAILABLE_ERROR };
  }

  const now = Date.now();
  let expiresAt: number;
  try {
    const existingSub = (await kv.get(`sub:${accountId}`, 'json')) as { expiresAt?: number } | null;
    const baseTime = existingSub?.expiresAt && existingSub.expiresAt > now ? existingSub.expiresAt : now;
    expiresAt = baseTime + plan.days * 86400_000;

    await writeSubscriptionRecord(env, order.userId, {
      plan: order.planId,
      paymentMethod: 'ton',
      orderId,
      startedAt: now,
      expiresAt,
    });
  } catch (err) {
    // Release so the buyer can retry verify; if the write partly landed, a retry may extend twice, which beats an uncredited payment.
    await releaseTonTransaction(env, match.txHash, orderId);
    console.error(`[TON] Subscription write failed after claim for order ${orderId}; claim released: ${err instanceof Error ? err.message : err}`);
    return { ok: false, error: TON_VERIFY_UNAVAILABLE_ERROR };
  }

  try {
    order.status = 'confirmed';
    order.confirmedAt = now;
    order.txHash = match.txHash;
    await kv.put(`ton:order:${orderId}`, JSON.stringify(order));
    await kv.put(txGuardKey, orderId, { expirationTtl: 86400 * 60 });
  } catch (err) {
    console.error(`[TON] KV cache update failed after crediting order ${orderId}: ${err instanceof Error ? err.message : err}`);
  }

  // Money event: plan credited via on-chain TON. Best-effort audit; the claim and
  // subscription write above already committed, so a logging blip must not unwind them.
  await recordAuditLogBestEffort(env, {
    org_id: `org_${accountId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    actor_id: order.userId,
    action: 'ton.credit',
    details: {
      plan: order.planId,
      tonAmount: order.tonAmount,
      orderId,
      txHash: match.txHash,
      expiresAt,
    },
  });

  return { ok: true, plan: order.planId, expiresAt };
}
