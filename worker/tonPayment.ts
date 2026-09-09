/**
 * TON settlement: invoice + on-chain verify via Toncenter, then KV subscription.
 * Never trust client BOC alone; confirmation requires a matching on-chain transfer.
 */
import type { Env } from './index';
import { PLANS } from './telegramBot';
import { resolveAccountId, writeSubscriptionRecord } from './userStore';

export const TON_PRICING: Record<string, { ton: number; nanoTon: string }> = {
  starter: { ton: 15, nanoTon: '15000000000' },
  growth: { ton: 45, nanoTon: '45000000000' },
};

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
  if (!recipient) {
    return { ok: false, error: 'TON_RECEIVING_ADDRESS is not configured on the Worker' };
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

  if (env.LUMINARA_KV) {
    await env.LUMINARA_KV.put(`ton:order:${orderId}`, JSON.stringify(order), { expirationTtl: 7200 });
  }

  return { ok: true, order };
}

/** Extract comment text from Toncenter / TonAPI shaped messages. */
export function extractTonComment(msg: any): string {
  if (!msg) return '';
  if (typeof msg.message === 'string') return msg.message;
  if (typeof msg.msg_data?.text === 'string') return msg.msg_data.text;
  if (typeof msg.decoded_body?.text === 'string') return msg.decoded_body.text;
  return '';
}

/**
 * Looks up recent inbound transfers to the merchant wallet and matches memo + amount.
 */
export async function findMatchingTonPayment(
  order: TonOrder,
  env: Env,
  fetcher: TonFetch = fetch,
): Promise<{ ok: true; txHash: string } | { ok: false; error: string }> {
  const apiKey = String(env.TON_API_KEY || '').trim();
  const url =
    `https://toncenter.com/api/v2/getTransactions` +
    `?address=${encodeURIComponent(order.recipientAddress)}&limit=30`;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;

  let res: Response;
  try {
    res = await fetcher(url, { headers });
  } catch {
    return { ok: false, error: 'Could not reach Toncenter to verify payment' };
  }
  if (!res.ok) {
    return { ok: false, error: `Toncenter returned ${res.status}` };
  }

  const data = (await res.json()) as { ok?: boolean; result?: any[] };
  const txs = Array.isArray(data.result) ? data.result : [];
  const minValue = BigInt(order.amountNano);

  for (const tx of txs) {
    const inMsg = tx.in_msg;
    if (!inMsg) continue;
    const comment = extractTonComment(inMsg);
    const value = BigInt(String(inMsg.value || '0'));
    if (comment.includes(order.memo) && value >= minValue) {
      const hash = String(tx.transaction_id?.hash || tx.hash || tx.transaction_id || 'onchain');
      return { ok: true, txHash: hash };
    }
  }

  return { ok: false, error: 'Matching on-chain transfer not found yet. Wait a few seconds and retry.' };
}

export async function verifyTonPayment(
  env: Env,
  orderId: string,
  opts: { expectedUserId?: string; fetcher?: TonFetch } = {},
): Promise<{ ok: true; plan: string; expiresAt: number } | { ok: false; error: string }> {
  if (!env.LUMINARA_KV) {
    return { ok: false, error: 'Storage KV not configured' };
  }

  const raw = await env.LUMINARA_KV.get(`ton:order:${orderId}`, 'json');
  if (!raw) {
    return { ok: false, error: 'Order not found or expired' };
  }
  const order = raw as TonOrder;

  if (opts.expectedUserId && order.userId !== opts.expectedUserId) {
    return { ok: false, error: 'Order does not belong to this account' };
  }

  if (order.status === 'confirmed') {
    const accountId = await resolveAccountId(env, order.userId);
    const existingSub = (await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as { expiresAt?: number } | null;
    return { ok: true, plan: order.planId, expiresAt: existingSub?.expiresAt || Date.now() };
  }

  const plan = PLANS[order.planId];
  if (!plan) return { ok: false, error: 'Invalid plan on order' };

  const match = await findMatchingTonPayment(order, env, opts.fetcher || fetch);
  if (!match.ok) return match;

  const now = Date.now();
  order.status = 'confirmed';
  order.confirmedAt = now;
  order.txHash = match.txHash;
  await env.LUMINARA_KV.put(`ton:order:${orderId}`, JSON.stringify(order));

  const accountId = await resolveAccountId(env, order.userId);
  const existingSub = (await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as { expiresAt?: number } | null;
  const baseTime = existingSub?.expiresAt && existingSub.expiresAt > now ? existingSub.expiresAt : now;
  const expiresAt = baseTime + plan.days * 86400_000;

  await writeSubscriptionRecord(env, order.userId, {
    plan: order.planId,
    paymentMethod: 'ton',
    orderId,
    startedAt: now,
    expiresAt,
  });

  return { ok: true, plan: order.planId, expiresAt };
}
