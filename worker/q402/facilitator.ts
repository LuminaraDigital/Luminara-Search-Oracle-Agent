/**
 * Q402 Facilitator for TON & XDC Dual-Chain Payments.
 *
 * Provides challenge generation, on-chain verification, and atomic single-use
 * settlement in D1.
 */

import type { Env } from '../env';
import type {
  Q402SignedPayload,
  Q402Asset,
  Q402ChallengeRecord,
  Q402PaymentRequirement,
} from './types';
import { claimTonTransaction, isTonLedgerReady } from '../paymentLedger';
import {
  normalizeTonTxHash,
  resolveChainNetwork,
  tonExplorerTxUrl,
  type ChainNetwork,
} from '../chainNetwork';
import { TON_PRICING, JETTON_PRICING, JETTON_MASTERS, USDT_DECIMALS, LORA_DECIMALS } from '../tonPayment';
import { tonAdapter } from './tonAdapter';
import { xdcAdapter, XDC_PRICING } from './xdcAdapter';

export interface VerificationResult {
  isValid: boolean;
  payer?: string;
  invalidReason?: string;
  amount?: string;
  asset?: Q402Asset;
}

export interface SettlementResult {
  success: boolean;
  txHash?: string;
  payer?: string;
  amount?: string;
  asset?: Q402Asset;
  error?: string;
  explorerUrl?: string;
  chain?: 'ton' | 'xdc';
}

/**
 * Q402 pay-per-call settlement default flag (fail closed unless enabled via Q402_LIVE).
 */
export const Q402_SETTLEMENT_LIVE = false;

export function isQ402SettlementLive(env?: Pick<Env, 'Q402_LIVE'>): boolean {
  if (Q402_SETTLEMENT_LIVE) return true;
  return String(env?.Q402_LIVE || '').trim().toLowerCase() === 'true';
}

export const Q402_NOT_LIVE_ERROR =
  'Q402 pay-per-call settlement is not live yet. Use a Growth or Agency plan, or BYOK.';

/**
 * Stores a new challenge order in Cloudflare KV with a 15-minute TTL.
 */
export async function createQ402ChallengeRecord(
  env: Env,
  resource: string,
  asset: Q402Asset = 'TON',
  action = 'single_audit',
): Promise<{ requirement: Q402PaymentRequirement; challenge: Q402ChallengeRecord }> {
  const orderId = `q402_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const expiresAt = now + 900_000;

  const adapter = asset === 'XDC' ? xdcAdapter : tonAdapter;
  const requirement = adapter.createPaymentRequirement(env, orderId, resource, asset, action);

  const challenge: Q402ChallengeRecord = {
    orderId,
    resource,
    scheme: requirement.scheme,
    asset,
    amountUnits: requirement.maxAmountRequired,
    memo: requirement.extra?.memo || `LUM:${orderId}:${action}`,
    recipientAddress: requirement.payTo,
    createdAt: now,
    expiresAt,
    status: 'pending',
  };

  if (env.LUMINARA_KV) {
    await env.LUMINARA_KV.put(`q402_order:${orderId}`, JSON.stringify(challenge), {
      expirationTtl: 900,
    });
  }

  return { requirement, challenge };
}

/**
 * Retrieves a challenge order from Cloudflare KV.
 */
export async function getQ402ChallengeRecord(
  env: Env,
  orderId: string,
): Promise<Q402ChallengeRecord | null> {
  if (!env.LUMINARA_KV || !orderId) return null;
  const raw = await env.LUMINARA_KV.get(`q402_order:${orderId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Q402ChallengeRecord;
  } catch {
    return null;
  }
}

/**
 * Validates a signed Q402 payment payload against network and format constraints.
 */
export async function verifyQ402Payment(
  payload: Q402SignedPayload,
  env: Env,
): Promise<VerificationResult> {
  if (!payload || typeof payload !== 'object') {
    return { isValid: false, invalidReason: 'Payload is missing or invalid' };
  }

  if (payload.x402Version !== 1) {
    return { isValid: false, invalidReason: `Unsupported x402Version: ${payload.x402Version}` };
  }

  if (payload.scheme?.startsWith('xdc')) {
    return xdcAdapter.verifyPayload(payload, env);
  }

  return tonAdapter.verifyPayload(payload, env);
}

/**
 * Verified on-chain settlement for Q402 payments (TON + XDC).
 * Resolves challenge order from KV, verifies on-chain evidence, claims in D1, and anchors proof.
 */
export async function verifyAndSettleQ402Payment(
  env: Env,
  payload: Q402SignedPayload,
  opts: { fetcher?: typeof fetch } = {},
): Promise<SettlementResult> {
  if (!payload.orderId) {
    return { success: false, error: 'Payment payload is missing orderId' };
  }

  const challenge = await getQ402ChallengeRecord(env, payload.orderId);
  if (!challenge) {
    return { success: false, error: 'Challenge order not found or expired' };
  }

  if (challenge.status === 'settled') {
    return { success: false, error: 'Challenge order has already been settled' };
  }

  let result: SettlementResult;
  if (payload.scheme?.startsWith('xdc') || payload.asset === 'XDC') {
    result = await xdcAdapter.settlePayment(env, payload, challenge, opts);
  } else {
    result = await tonAdapter.settlePayment(env, payload, challenge, opts);
  }

  if (result.success && env.LUMINARA_KV) {
    challenge.status = 'settled';
    await env.LUMINARA_KV.put(`q402_order:${payload.orderId}`, JSON.stringify(challenge), {
      expirationTtl: 900,
    });
  }

  return result;
}

/**
 * Backwards-compatible single-use claim helper.
 */
export async function settleQ402Payment(
  env: Env,
  payload: Q402SignedPayload,
  _targetAction = 'q402_action',
): Promise<SettlementResult> {
  const normHash = normalizeTonTxHash(payload.txHash);
  const orderId = payload.orderId || `q402_${Date.now()}_${normHash.slice(0, 8)}`;
  const network = resolveChainNetwork(env) || payload.network || 'mainnet';

  if (!(await isTonLedgerReady(env))) {
    return {
      success: false,
      error: 'Payment ledger is not ready or database is unavailable',
    };
  }

  const claim = await claimTonTransaction(env, {
    txHash: normHash,
    orderId,
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

  const tonNet: ChainNetwork = network === 'testnet' ? 'testnet' : 'mainnet';
  const explorerUrl = tonExplorerTxUrl(tonNet, normHash);

  return {
    success: true,
    txHash: normHash,
    payer: payload.payerAddress || '0:unknown',
    amount: payload.amount,
    asset: payload.asset,
    explorerUrl,
    chain: 'ton',
  };
}

/**
 * Returns the catalogue of supported Q402 networks, schemes, and pricing for Luminara endpoints.
 */
export function getQ402SupportedCatalog(env: Env) {
  const network = resolveChainNetwork(env) || 'mainnet';
  const recipient = String(env.TON_RECEIVING_ADDRESS || '').trim();
  const xdcRecipient = String(env.XDC_RECEIVING_ADDRESS || '').trim();

  return {
    x402Version: 1,
    settlementLive: isQ402SettlementLive(env),
    networks: [network, 'apothem'],
    schemes: [
      'ton/native-transfer',
      'ton/jetton-transfer',
      'xdc/native-transfer',
      'xdc/xrc20-transfer',
    ],
    assets: {
      TON: {
        symbol: 'TON',
        name: 'The Open Network Native',
        decimals: 9,
      },
      USDT: {
        symbol: 'USDT',
        name: 'Tether USD (TON Jetton)',
        decimals: USDT_DECIMALS,
        master: JETTON_MASTERS[network]?.USDT || '',
      },
      LORA: {
        symbol: 'LORA',
        name: 'Luminara Oracle Token',
        decimals: LORA_DECIMALS,
        master: JETTON_MASTERS[network]?.LORA || '',
      },
      XDC: {
        symbol: 'XDC',
        name: 'XinFin XDC Network Native',
        decimals: 18,
      },
    },
    endpoints: [
      {
        path: '/api/q402/audit',
        description: 'Single Instant AI Search & Citability Audit (Programmatic Pay-Per-Run)',
        prices: {
          TON: {
            amount: TON_PRICING.single_audit.nanoTon,
            display: `${TON_PRICING.single_audit.ton} TON`,
          },
          USDT: {
            amount: JETTON_PRICING.single_audit.units,
            display: `${JETTON_PRICING.single_audit.amount} USDT`,
          },
          LORA: {
            amount: JETTON_PRICING.single_audit.units,
            display: `${JETTON_PRICING.single_audit.amount} LORA`,
          },
          XDC: {
            amount: XDC_PRICING.single_audit.wei,
            display: `${XDC_PRICING.single_audit.xdc} XDC`,
          },
        },
      },
      {
        path: '/api/q402/multi-agent-crawl',
        description: 'Deep Multi-Agent Crawler & Competitor Citability Analysis',
        prices: {
          TON: {
            amount: TON_PRICING.multi_agent_crawl.nanoTon,
            display: `${TON_PRICING.multi_agent_crawl.ton} TON`,
          },
          USDT: {
            amount: JETTON_PRICING.multi_agent_crawl.units,
            display: `${JETTON_PRICING.multi_agent_crawl.amount} USDT`,
          },
          LORA: {
            amount: JETTON_PRICING.multi_agent_crawl.units,
            display: `${JETTON_PRICING.multi_agent_crawl.amount} LORA`,
          },
          XDC: {
            amount: XDC_PRICING.multi_agent_crawl.wei,
            display: `${XDC_PRICING.multi_agent_crawl.xdc} XDC`,
          },
        },
      },
    ],
    merchantAddress: recipient,
    xdcMerchantAddress: xdcRecipient,
  };
}
