/**
 * Luminara Q402 TON Chain Adapter
 *
 * Implements micro-settlement verification, atomic claim, deflationary burn accounting,
 * and proof anchoring for The Open Network (native TON and TEP-74 Jettons).
 */

import type { Env } from '../env';
import type { ChainAdapter } from './chainAdapter';
import type {
  Q402SignedPayload,
  Q402ChallengeRecord,
  Q402Asset,
  Q402PaymentRequirement,
} from './types';
import type { VerificationResult, SettlementResult } from './facilitator';
import {
  TON_PRICING,
  JETTON_PRICING,
  JETTON_MASTERS,
  USDT_DECIMALS,
  LORA_DECIMALS,
  findMatchingTonPayment,
  type TonOrder,
} from '../tonPayment';
import { claimTonTransaction, isTonLedgerReady } from '../paymentLedger';
import {
  normalizeTonTxHash,
  resolveChainNetwork,
  tonExplorerTxUrl,
  type ChainNetwork,
} from '../chainNetwork';
import { recordProofAnchorBestEffort } from '../proofAnchors';
import { QUBIC_SUPPLY_WATCHER_BURN_RATE_PERCENT } from './facilitator';

export class TonChainAdapter implements ChainAdapter {
  readonly chain = 'ton' as const;

  createPaymentRequirement(
    env: Env,
    orderId: string,
    resource: string,
    asset: Q402Asset = 'TON',
    action = 'single_audit',
  ): Q402PaymentRequirement {
    const network: ChainNetwork = resolveChainNetwork(env) || 'mainnet';
    const recipient = String(env.TON_RECEIVING_ADDRESS || '').trim();
    const memo = `LUM:${orderId}:${action}`;

    if (asset === 'USDT' || asset === 'LORA') {
      const price = action === 'multi_agent_crawl' ? JETTON_PRICING.multi_agent_crawl : JETTON_PRICING.single_audit;
      const decimals = asset === 'USDT' ? USDT_DECIMALS : LORA_DECIMALS;
      const master = JETTON_MASTERS[network]?.[asset] || '';

      return {
        scheme: 'ton/jetton-transfer',
        network,
        maxAmountRequired: price.units,
        resource,
        description: `Luminara ${asset} Audit Settlement (${price.amount} ${asset})`,
        payTo: recipient,
        maxTimeoutSeconds: 900,
        asset,
        extra: {
          orderId,
          memo,
          decimals,
          jettonMaster: master,
          burnRatePercent: asset === 'LORA' ? QUBIC_SUPPLY_WATCHER_BURN_RATE_PERCENT : undefined,
          displayAmount: `${price.amount} ${asset}`,
        },
      };
    }

    const price = action === 'multi_agent_crawl' ? TON_PRICING.multi_agent_crawl : TON_PRICING.single_audit;
    return {
      scheme: 'ton/native-transfer',
      network,
      maxAmountRequired: price.nanoTon,
      resource,
      description: `Luminara Native TON Audit Settlement (${price.ton} TON)`,
      payTo: recipient,
      maxTimeoutSeconds: 900,
      asset: 'TON',
      extra: {
        orderId,
        memo,
        decimals: 9,
        displayAmount: `${price.ton} TON`,
      },
    };
  }

  async verifyPayload(payload: Q402SignedPayload, _env: Env): Promise<VerificationResult> {
    if (!payload || typeof payload !== 'object') {
      return { isValid: false, invalidReason: 'Payload is missing or invalid' };
    }

    if (payload.scheme !== 'ton/native-transfer' && payload.scheme !== 'ton/jetton-transfer') {
      return { isValid: false, invalidReason: `Unsupported TON scheme: ${payload.scheme}` };
    }

    const txHash = normalizeTonTxHash(payload.txHash);
    if (!txHash || txHash.length < 32) {
      return { isValid: false, invalidReason: 'Invalid TON transaction hash' };
    }

    if (!payload.amount || BigInt(payload.amount) <= 0n) {
      return { isValid: false, invalidReason: 'Payment amount must be greater than zero' };
    }

    const validAssets: Q402Asset[] = ['TON', 'USDT', 'LORA'];
    if (!validAssets.includes(payload.asset)) {
      return { isValid: false, invalidReason: `Unsupported TON asset: ${payload.asset}` };
    }

    return {
      isValid: true,
      payer: payload.payerAddress || '0:unknown',
      amount: payload.amount,
      asset: payload.asset,
    };
  }

  async settlePayment(
    env: Env,
    payload: Q402SignedPayload,
    challenge: Q402ChallengeRecord,
    opts: { fetcher?: typeof fetch } = {},
  ): Promise<SettlementResult> {
    const fetcher = opts.fetcher || fetch;
    const normHash = normalizeTonTxHash(payload.txHash);
    const rawNet = resolveChainNetwork(env) || payload.network;
    const network: ChainNetwork = rawNet === 'testnet' ? 'testnet' : 'mainnet';

    // 1. Check ledger ready
    if (!(await isTonLedgerReady(env))) {
      return { success: false, error: 'Payment ledger database is unavailable' };
    }

    // 2. Build TonOrder to verify matching on-chain transaction
    const tonOrder: TonOrder = {
      orderId: challenge.orderId,
      userId: payload.payerAddress || 'q402_agent',
      planId: challenge.resource.includes('multi-agent') ? 'multi_agent_crawl' : 'single_audit',
      amountNano: challenge.amountUnits,
      tonAmount: Number(challenge.amountUnits) / 1e9,
      memo: challenge.memo,
      recipientAddress: challenge.recipientAddress || String(env.TON_RECEIVING_ADDRESS || ''),
      status: 'pending',
      createdAt: challenge.createdAt,
      asset: challenge.asset === 'USDT' || challenge.asset === 'LORA' ? challenge.asset : 'TON',
    };

    // 3. Verify on-chain transfer
    const onChainMatch = await findMatchingTonPayment(tonOrder, env, fetcher);
    if (!onChainMatch.ok) {
      return { success: false, error: `On-chain verification failed: ${onChainMatch.error}` };
    }

    // 4. Atomically claim transaction hash in D1
    const claim = await claimTonTransaction(env, {
      txHash: normHash,
      orderId: challenge.orderId,
      accountId: payload.payerAddress,
    });

    if (!claim.ok) {
      if (claim.reason === 'tx_credited_to_other_order') {
        return { success: false, error: 'Transaction hash has already been redeemed' };
      }
      if (claim.reason === 'order_already_credited') {
        return { success: false, error: 'Order has already been credited' };
      }
      return { success: false, error: 'Failed to claim transaction in payment ledger' };
    }

    // 5. Calculate deflationary burn if LORA Jetton
    let burnAmount: string | undefined;
    if (payload.asset === 'LORA') {
      const rawAmount = BigInt(payload.amount);
      const burnCoins = (rawAmount * BigInt(QUBIC_SUPPLY_WATCHER_BURN_RATE_PERCENT)) / 100n;
      burnAmount = burnCoins.toString();
    }

    // 6. Record proof anchor in D1
    const explorerUrl = tonExplorerTxUrl(network, normHash);
    await recordProofAnchorBestEffort(env, {
      kind: 'ton_payment',
      chain: 'ton',
      network,
      txHash: normHash,
      orderId: challenge.orderId,
      seqno: onChainMatch.seqno,
      explorerUrl,
      status: 'anchored',
    });

    return {
      success: true,
      txHash: normHash,
      payer: payload.payerAddress || '0:unknown',
      amount: payload.amount,
      asset: payload.asset,
      burnAmount,
      explorerUrl,
    };
  }

  getExplorerUrl(network: string, txHash: string): string {
    const net = (network === 'testnet' ? 'testnet' : 'mainnet') as ChainNetwork;
    return tonExplorerTxUrl(net, normalizeTonTxHash(txHash));
  }
}

export const tonAdapter = new TonChainAdapter();
