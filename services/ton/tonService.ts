/**
 * TON Payment Service (Client-Side Orchestrator).
 * Interfaces with TonConnect UI to dispatch transactions with the unique
 * order memo and verify them against the Luminara Worker.
 */
import { apiBase } from '../apiClient';
import { getInitDataRaw } from '../telegram/tma';
import { getFirebaseIdTokenSync } from '../auth/firebaseAuthService';

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
 */
export function buildCommentBoc(comment: string): string {
  const enc = new TextEncoder().encode(comment);
  const data = new Uint8Array(4 + enc.length);
  // 4 zero bytes: 0x00 0x00 0x00 0x00 indicates a text comment
  data.set(enc, 4);
  const len = data.length;
  // Standard single-cell BOC header
  const header = [0xb5, 0xee, 0x9c, 0x72, 0x01, 0x01, 0x01, 0x01, 0x00, 2 + len, 0x00, 0x00, len];
  const boc = new Uint8Array(header.length + len);
  boc.set(header, 0);
  boc.set(data, header.length);
  return btoa(String.fromCharCode(...boc));
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

/**
 * Executes a full 1-click TON payment flow using TonConnect UI.
 */
export async function executeTonPayment(
  tonConnectUI: any,
  planId: string,
  onStatusChange?: (status: string) => void,
): Promise<{ ok: boolean; plan?: string; expiresAt?: number; error?: string }> {
  if (!tonConnectUI?.wallet) {
    return { ok: false, error: 'Please connect your TON wallet first.' };
  }

  onStatusChange?.('Generating secure payment invoice…');
  const invoiceRes = await createTonInvoice(planId);
  if (!invoiceRes.ok || !invoiceRes.order) {
    return { ok: false, error: invoiceRes.error || 'Failed to create TON invoice.' };
  }

  const { order } = invoiceRes;
  onStatusChange?.(`Please approve ${order.tonAmount} TON transaction in your wallet…`);

  try {
    const payloadBoc = buildCommentBoc(order.memo);
    const tx = {
      validUntil: Math.floor(Date.now() / 1000) + 600, // 10 minutes
      messages: [
        {
          address: order.recipientAddress,
          amount: order.amountNano,
          payload: payloadBoc,
        },
      ],
    };

    await tonConnectUI.sendTransaction(tx);
    onStatusChange?.('Transaction submitted. Verifying payment on TON network…');

    // Poll on-chain verification (Toncenter) up to ~20s
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const verifyRes = await verifyTonPayment(order.orderId);
      if (verifyRes.ok) {
        onStatusChange?.('Payment verified! Subscription activated.');
        return verifyRes;
      }
    }

    return {
      ok: false,
      error: 'Transaction sent, but on-chain confirmation is still pending. Retry Verify from Pricing in a minute.',
    };
  } catch (err: any) {
    const msg = err?.message || 'Transaction was rejected or cancelled.';
    return { ok: false, error: msg };
  }
}
