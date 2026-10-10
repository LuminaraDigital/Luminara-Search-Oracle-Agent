/**
 * Client-Side Jetton Payment Orchestrator (TEP-74 & Q402).
 *
 * Constructs compliant TEP-74 Jetton transfer messages for TonConnect UI
 * to transfer USDT or $LORA tokens with forward memos.
 */

import { beginCell, toNano, Address, Cell } from '@ton/core';
import { apiBase } from '../apiClient';
import { getInitDataRaw } from '../telegram/tma';
import { getFirebaseIdTokenSync } from '../auth/firebaseAuthService';
import { verifyTonPayment, type TonInvoiceResponse } from './tonService';

export const OP_JETTON_TRANSFER = 0x0f8a7ea5;
export const OP_JETTON_BURN = 0x595f07bc;

export interface JettonTransferParams {
  queryId?: bigint;
  jettonAmount: bigint; // Token amount in smallest units
  toAddress: Address;
  responseAddress: Address;
  forwardTonAmount?: bigint; // Default 0.05 TON for notification & memo forwarding
  memoText: string;
}

/**
 * Builds a standard TEP-74 TokenTransfer payload cell.
 */
export function buildJettonTransferPayload(params: JettonTransferParams): Cell {
  const forwardPayload = beginCell()
    .storeUint(0, 32) // text comment prefix
    .storeStringTail(params.memoText)
    .endCell();

  return beginCell()
    .storeUint(OP_JETTON_TRANSFER, 32)
    .storeUint(params.queryId ?? 0n, 64)
    .storeCoins(params.jettonAmount)
    .storeAddress(params.toAddress)
    .storeAddress(params.responseAddress)
    .storeMaybeRef(null) // custom_payload
    .storeCoins(params.forwardTonAmount ?? toNano('0.05'))
    .storeBit(1) // 1 = forward_payload stored as reference cell
    .storeRef(forwardPayload)
    .endCell();
}

/**
 * Builds a standard TEP-74 TokenBurn payload cell: a holder burning their own tokens. Nothing
 * in the app sends one on a payment.
 */
export function buildJettonBurnPayload(amount: bigint, responseAddress: Address, queryId = 0n): Cell {
  return beginCell()
    .storeUint(OP_JETTON_BURN, 32)
    .storeUint(queryId, 64)
    .storeCoins(amount)
    .storeAddress(responseAddress)
    .storeMaybeRef(null)
    .endCell();
}

/**
 * Requests a unique Jetton invoice order from the Luminara Worker API.
 */
export async function createJettonInvoice(
  planId: string,
  asset: 'USDT' | 'LORA' = 'USDT',
  userWalletAddress?: string,
): Promise<TonInvoiceResponse> {
  const base = apiBase();
  if (!base) {
    return { ok: false, error: 'Worker API is unreachable' };
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  const initData = getInitDataRaw();
  if (initData) headers['x-telegram-init-data'] = initData;
  const idToken = getFirebaseIdTokenSync();
  if (idToken) headers['authorization'] = `Bearer ${idToken}`;

  const res = await fetch(`${base}/api/ton/invoice`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ planId, asset, userWalletAddress }),
  });
  return res.json();
}

/**
 * Dispatches a TEP-74 Jetton payment using TonConnect UI.
 */
export async function executeJettonPayment(
  tonConnectUI: any,
  userJettonWalletAddress: string,
  planId: string,
  asset: 'USDT' | 'LORA' = 'USDT',
  onStatusChange?: (status: string) => void,
): Promise<{ ok: boolean; plan?: string; expiresAt?: number; txHash?: string; error?: string }> {
  if (!tonConnectUI?.wallet) {
    return { ok: false, error: 'Please connect your TON wallet first.' };
  }

  const userAccount = tonConnectUI.wallet.account.address;
  if (!userAccount) {
    return { ok: false, error: 'Could not read wallet address.' };
  }

  onStatusChange?.('Generating invoice...');
  const inv = await createJettonInvoice(planId, asset, userAccount);
  if (!inv.ok || !inv.order) {
    return { ok: false, error: inv.error || 'Failed to create Jetton invoice.' };
  }

  const order = inv.order;

  // The destination of a TEP-74 transfer is the USER'S Jetton wallet contract.
  // Never fall back to order.recipientAddress (the merchant), which accepts TON and fails to transfer tokens.
  const targetJettonWallet = userJettonWalletAddress || order.userJettonWallet;
  if (!targetJettonWallet) {
    return {
      ok: false,
      error: `Could not resolve ${asset} token wallet for your account. Please ensure your wallet holds ${asset} and try again.`,
    };
  }

  onStatusChange?.('Building transaction...');

  try {
    const jettonPayload = buildJettonTransferPayload({
      jettonAmount: BigInt(order.amountNano),
      toAddress: Address.parse(order.recipientAddress),
      responseAddress: Address.parse(userAccount),
      forwardTonAmount: toNano('0.05'),
      memoText: order.memo,
    });

    const payloadBoc = jettonPayload.toBoc().toString('base64');

    onStatusChange?.('Please approve the Jetton transfer in your wallet...');
    const result = await tonConnectUI.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 600,
      messages: [
        {
          address: targetJettonWallet,
          amount: toNano('0.08').toString(), // 0.08 TON covers Jetton gas and forward notification
          payload: payloadBoc,
        },
      ],
    });

    onStatusChange?.('Verifying payment on TON network...');
    for (let attempt = 1; attempt <= 15; attempt++) {
      await new Promise((r) => setTimeout(r, 2500));
      const verifyRes = await verifyTonPayment(order.orderId, result?.boc);
      if (verifyRes.ok) {
        onStatusChange?.('Payment verified! Subscribed.');
        return { ok: true, plan: verifyRes.plan, expiresAt: verifyRes.expiresAt };
      }
    }

    return {
      ok: false,
      error: 'Transaction sent, but verification timed out. If your wallet confirmed, please refresh in 30 seconds.',
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes('reject') || msg.includes('Canceled') || msg.includes('User declined')) {
      return { ok: false, error: 'Transaction canceled.' };
    }
    return { ok: false, error: `Transfer failed: ${msg}` };
  }
}

/**
 * Creates an X-PAYMENT header payload for programmatic Q402 requests.
 */
export function createQ402PaymentHeader(params: {
  scheme: 'ton/native-transfer' | 'ton/jetton-transfer';
  network: 'mainnet' | 'testnet';
  orderId?: string;
  txHash: string;
  payerAddress: string;
  amount: string;
  asset: 'TON' | 'USDT' | 'LORA';
}): string {
  const payload = {
    x402Version: 1,
    scheme: params.scheme,
    network: params.network,
    orderId: params.orderId,
    txHash: params.txHash,
    payerAddress: params.payerAddress,
    amount: params.amount,
    asset: params.asset,
  };
  return btoa(JSON.stringify(payload));
}
