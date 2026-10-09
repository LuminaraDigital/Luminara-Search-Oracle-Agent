/**
 * Q402 Middleware for Cloudflare Worker.
 *
 * Emits HTTP 402 Payment Required challenges conforming to x402,
 * and decodes/processes incoming X-PAYMENT headers.
 */

import type { Env } from '../env';
import {
  X402_VERSION,
  type Q402PaymentRequirement,
  type Q402PaymentRequiredResponse,
  type Q402SignedPayload,
  type Q402ExecutionResponse,
} from './types';
import { QUBIC_SUPPLY_WATCHER_BURN_RATE_PERCENT } from './facilitator';
import { TON_PRICING, JETTON_PRICING, JETTON_MASTERS, USDT_DECIMALS, LORA_DECIMALS } from '../tonPayment';
import { resolveChainNetwork } from '../chainNetwork';

/**
 * Creates a standard x402 402 Payment Required response with multi-asset requirements.
 */
export function createQ402Response(
  env: Env,
  endpointPath: string,
  planKey: 'single_audit' | 'multi_agent_crawl' = 'single_audit',
  errorMessage?: string,
): Response {
  const network = resolveChainNetwork(env) || 'mainnet';
  const recipient = String(env.TON_RECEIVING_ADDRESS || '').trim();
  const orderId = `q402_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const nativeTon = TON_PRICING[planKey];
  const jettonPrice = JETTON_PRICING[planKey];

  const accepts: Q402PaymentRequirement[] = [
    // Option 1: Native TON
    {
      scheme: 'ton/native-transfer',
      network,
      maxAmountRequired: nativeTon.nanoTon,
      resource: endpointPath,
      description: `Luminara ${planKey.replace(/_/g, ' ')} execution via TON`,
      payTo: recipient,
      maxTimeoutSeconds: 900,
      asset: 'TON',
      extra: {
        orderId,
        memo: `LUM:${orderId}:${planKey}`,
        decimals: 9,
        displayAmount: `${nativeTon.ton} TON`,
      },
    },
    // Option 2: Tether USDT on TON (TEP-74 Jetton)
    {
      scheme: 'ton/jetton-transfer',
      network,
      maxAmountRequired: jettonPrice.units,
      resource: endpointPath,
      description: `Luminara ${planKey.replace(/_/g, ' ')} execution via USDT Jetton`,
      payTo: recipient,
      maxTimeoutSeconds: 900,
      asset: 'USDT',
      extra: {
        orderId,
        memo: `LUM:${orderId}:${planKey}`,
        decimals: USDT_DECIMALS,
        jettonMaster: JETTON_MASTERS[network]?.USDT,
        displayAmount: `${jettonPrice.amount} USDT`,
      },
    },
    // Option 3: Luminara Oracle Token (TEP-74 Jetton with Qubic Deflationary Burn)
    {
      scheme: 'ton/jetton-transfer',
      network,
      maxAmountRequired: jettonPrice.units,
      resource: endpointPath,
      description: `Luminara ${planKey.replace(/_/g, ' ')} execution via $LORA (15% Deflationary Burn)`,
      payTo: recipient,
      maxTimeoutSeconds: 900,
      asset: 'LORA',
      extra: {
        orderId,
        memo: `LUM:${orderId}:${planKey}`,
        decimals: LORA_DECIMALS,
        jettonMaster: JETTON_MASTERS[network]?.LORA,
        burnRatePercent: QUBIC_SUPPLY_WATCHER_BURN_RATE_PERCENT,
        displayAmount: `${jettonPrice.amount} LORA`,
      },
    },
  ];

  const payload: Q402PaymentRequiredResponse = {
    x402Version: X402_VERSION,
    accepts,
    error: errorMessage || 'Payment Required: Attach X-PAYMENT header with valid transaction proof.',
  };

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-payment-version': String(X402_VERSION),
    'x-payment-order-id': orderId,
  };

  return new Response(JSON.stringify(payload), {
    status: 402,
    headers,
  });
}

/**
 * Decodes the client X-PAYMENT header (supports JSON string or Base64-encoded JSON).
 */
export function parseXPaymentHeader(headerValue: string | null): Q402SignedPayload | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed) return null;

  try {
    // Attempt standard JSON parse
    return JSON.parse(trimmed) as Q402SignedPayload;
  } catch {
    // Attempt base64 decode
    try {
      const decoded = atob(trimmed);
      return JSON.parse(decoded) as Q402SignedPayload;
    } catch {
      return null;
    }
  }
}

/**
 * Encodes execution response into the X-PAYMENT-RESPONSE header format.
 */
export function formatPaymentResponseHeader(result: Q402ExecutionResponse): string {
  try {
    return btoa(JSON.stringify(result));
  } catch {
    return JSON.stringify(result);
  }
}
