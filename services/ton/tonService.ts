/**
 * TON Payment Service (Client-Side Orchestrator).
 * Interfaces with TonConnect UI to dispatch transactions with the unique
 * order memo and verify them against the Luminara Worker.
 */
import { apiBase } from '../apiClient';
import { getInitDataRaw } from '../telegram/tma';
import { getFirebaseIdTokenSync } from '../auth/firebaseAuthService';
import { beginCell } from '@ton/core';
import { planTonPayment } from './transactionPlan';

export interface TonInvoiceResponse {
  ok: boolean;
  order?: {
    orderId: string;
    userId: string;
    planId: string;
    amountNano: string;
    tonAmount: number;
    memo: string;
    recipientAddress: string;
    status: string;
    asset?: 'TON' | 'USDT' | 'LORA';
    jettonMaster?: string;
    userJettonWallet?: string;
  };
  error?: string;
}

export interface TonVerifyResponse {
  ok: boolean;
  plan?: string;
  expiresAt?: number;
  error?: string;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  const initData = getInitDataRaw();
  if (initData) headers['x-telegram-init-data'] = initData;
  const idToken = getFirebaseIdTokenSync();
  if (idToken) headers['authorization'] = `Bearer ${idToken}`;
  return headers;
}

/**
 * Builds a standard TON Bag of Cells (BOC) payload containing a 32-bit zero prefix
 * and UTF-8 comment text (recognized as a text message/memo by all TON wallets).
 * Uses official @ton/core cell serialization.
 */
export function buildCommentBoc(comment: string): string {
  const cell = beginCell()
    .storeUint(0, 32) // 32-bit zero prefix indicates text comment in TON
    .storeStringTail(comment)
    .endCell();
  return cell.toBoc().toString('base64');
}

/**
 * Requests a unique invoice order from the Luminara Edge API.
 */
export async function createTonInvoice(planId: string): Promise<TonInvoiceResponse> {
  const base = apiBase();
  if (!base) {
    return { ok: false, error: 'Worker API is unreachable' };
  }
  const res = await fetch(`${base}/api/ton/invoice`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ planId }),
  });
  return res.json();
}

/**
 * Submits the transaction BOC or order ID to verify settlement on-chain.
 */
export async function verifyTonPayment(orderId: string, _boc?: string): Promise<TonVerifyResponse> {
  const base = apiBase();
  if (!base) {
    return { ok: false, error: 'Worker API is unreachable' };
  }
  const res = await fetch(`${base}/api/ton/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ orderId }),
  });
  return res.json();
}

const PENDING_ORDER_KEY = 'luminara_ton_pending_order';
/** As long as the Worker keeps an unpaid order creditable (worker/tonPendingOrders.ts). */
export const TON_PENDING_ORDER_WINDOW_MS = 48 * 60 * 60_000;

export const TON_PENDING_NOTICE =
  'Your transfer was sent, and the network has not shown it yet. If you paid, it will be credited: do not pay again. ' +
  'Use "Check my payment" below, or come back later. We keep checking for 48 hours.';
export const TON_STILL_PENDING_NOTICE = 'Not shown on the network yet. If you paid, it will be credited: do not pay again.';

/** Remembers the order a transfer was sent for, so "Check my payment" survives a closed tab. */
export function rememberPendingTonOrder(orderId: string, now: number = Date.now()): void {
  try {
    localStorage.setItem(PENDING_ORDER_KEY, JSON.stringify({ orderId, at: now }));
  } catch {
    // No storage: the control still shows for this session through the result of executeTonPayment.
  }
}

export function forgetPendingTonOrder(): void {
  try {
    localStorage.removeItem(PENDING_ORDER_KEY);
  } catch {
    // ignore
  }
}

/** The order still waiting for its transfer to show, or null. Forgotten after 48 hours. */
export function readPendingTonOrder(now: number = Date.now()): string | null {
  try {
    const stored = JSON.parse(localStorage.getItem(PENDING_ORDER_KEY) || 'null') as { orderId?: unknown; at?: unknown } | null;
    if (!stored || typeof stored.orderId !== 'string' || !stored.orderId || typeof stored.at !== 'number') return null;
    if (now - stored.at > TON_PENDING_ORDER_WINDOW_MS) {
      forgetPendingTonOrder();
      return null;
    }
    return stored.orderId;
  } catch {
    return null;
  }
}

/**
 * One more look for a transfer that was sent earlier. This is the retry the pending notice names.
 * It never sends anything: it only asks the Worker whether the order has been paid.
 */
export async function checkPendingTonPayment(
  orderId: string,
): Promise<{ ok: boolean; plan?: string; expiresAt?: number; error?: string; closed?: boolean }> {
  const res = await verifyTonPayment(orderId);
  if (res.ok) {
    forgetPendingTonOrder();
    return res;
  }
  if (/not found or expired/i.test(res.error || '')) {
    forgetPendingTonOrder();
    return {
      ok: false,
      closed: true,
      error: `That order is older than 48 hours and is no longer checked. If you paid for it, email support@luminarasuite.com with this order id: ${orderId}`,
    };
  }
  return { ok: false, error: TON_STILL_PENDING_NOTICE };
}

/**
 * Executes a full 1-click TON payment flow using TonConnect UI.
 */
export async function executeTonPayment(
  tonConnectUI: any,
  planId: string,
  onStatusChange?: (status: string) => void,
): Promise<{ ok: boolean; plan?: string; expiresAt?: number; error?: string; pendingOrderId?: string }> {
  if (!tonConnectUI?.wallet) {
    return { ok: false, error: 'Please connect your TON wallet first.' };
  }

  onStatusChange?.('Generating secure payment invoice…');
  const invoiceRes = await createTonInvoice(planId);
  if (!invoiceRes.ok || !invoiceRes.order) {
    return { ok: false, error: invoiceRes.error || 'Failed to create TON invoice.' };
  }

  const { order } = invoiceRes;

  // Pre-flight (wallet-core plan-before-sign): refuse before the wallet prompt when the wallet is
  // on the wrong network or the invoice is malformed, so nothing uncreditable is ever sent.
  const planned = planTonPayment({
    order,
    walletChain: tonConnectUI.wallet?.account?.chain,
    walletConnected: Boolean(tonConnectUI.wallet),
  });
  if (!planned.ok) {
    return { ok: false, error: planned.error };
  }
  const { plan } = planned;
  onStatusChange?.(
    `Please approve ${plan.amountDisplay} TON in your wallet (keep about ${plan.feeReserveDisplay} TON extra for the network fee)…`,
  );

  try {
    const payloadBoc = buildCommentBoc(plan.memo);
    const tx = {
      validUntil: plan.validUntil,
      messages: [
        {
          address: plan.recipient,
          amount: plan.amountNano.toString(),
          payload: payloadBoc,
        },
      ],
    };

    await tonConnectUI.sendTransaction(tx);
    // From here a transfer may be on its way. The order is remembered until it is seen as paid.
    rememberPendingTonOrder(order.orderId);
    onStatusChange?.('Transaction submitted. Verifying payment on TON network…');

    // Poll on-chain verification (Toncenter) up to ~20s
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const verifyRes = await verifyTonPayment(order.orderId);
      if (verifyRes.ok) {
        forgetPendingTonOrder();
        onStatusChange?.('Payment verified! Subscription activated.');
        return verifyRes;
      }
    }

    // The Worker keeps the order creditable for 48 hours and re-checks it on its own.
    return { ok: false, pendingOrderId: order.orderId, error: TON_PENDING_NOTICE };
  } catch (err: any) {
    const msg = err?.message || 'Transaction was rejected or cancelled.';
    return { ok: false, error: msg };
  }
}
