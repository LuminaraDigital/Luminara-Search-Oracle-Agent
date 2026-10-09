/**
 * Luminara Q402 XDC Chain Adapter
 *
 * Implements micro-settlement verification and proof anchoring for the XDC Network
 * (Mainnet chainId 50, Apothem testnet chainId 51) via JSON-RPC.
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
import { claimTonTransaction, isTonLedgerReady } from '../paymentLedger';
import { recordProofAnchorBestEffort } from '../proofAnchors';

export const XDC_APOTHEM_RPC = 'https://erpc.apothem.network';
export const XDC_MAINNET_RPC = 'https://erpc.xinfin.network';

export const XDC_PRICING = {
  single_audit: { xdc: 50, wei: '50000000000000000000' }, // 50 XDC
  multi_agent_crawl: { xdc: 150, wei: '150000000000000000000' }, // 150 XDC
};

function normalizeXdcHash(hash: string): string {
  const clean = hash.trim().toLowerCase();
  return clean.startsWith('0x') ? clean : `0x${clean}`;
}

export function xdcExplorerTxUrl(network: string, txHash: string): string {
  const norm = normalizeXdcHash(txHash);
  if (network === 'apothem' || network === 'testnet') {
    return `https://apothem.xdcscan.io/tx/${norm}`;
  }
  return `https://xdcscan.io/tx/${norm}`;
}

export function stringToHexData(str: string): string {
  let hex = '0x';
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexDataToString(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  let str = '';
  for (let i = 0; i < clean.length; i += 2) {
    const code = Number.parseInt(clean.slice(i, i + 2), 16);
    if (!Number.isNaN(code) && code > 0) {
      str += String.fromCharCode(code);
    }
  }
  return str;
}

export class XdcChainAdapter implements ChainAdapter {
  readonly chain = 'xdc' as const;

  createPaymentRequirement(
    env: Env,
    orderId: string,
    resource: string,
    asset: Q402Asset,
    action = 'single_audit',
  ): Q402PaymentRequirement {
    const isTestnet = String(env.CHAIN_NETWORK || '').toLowerCase() === 'testnet';
    const network = isTestnet ? 'apothem' : 'mainnet';
    const recipient = String(env.XDC_RECEIVING_ADDRESS || '').trim() || '0x0000000000000000000000000000000000000000';
    const pricing = action === 'multi_agent_crawl' ? XDC_PRICING.multi_agent_crawl : XDC_PRICING.single_audit;
    const memo = `LUM:${orderId}:${action}`;

    return {
      scheme: 'xdc/native-transfer',
      network,
      maxAmountRequired: pricing.wei,
      resource,
      description: `Luminara XDC Micro-Audit Settlement (${pricing.xdc} XDC)`,
      payTo: recipient,
      maxTimeoutSeconds: 900,
      asset: 'XDC',
      extra: {
        orderId,
        memo,
        decimals: 18,
        displayAmount: `${pricing.xdc} XDC`,
      },
    };
  }

  async verifyPayload(payload: Q402SignedPayload, _env: Env): Promise<VerificationResult> {
    if (!payload || typeof payload !== 'object') {
      return { isValid: false, invalidReason: 'Payload is missing or invalid' };
    }

    if (payload.scheme !== 'xdc/native-transfer' && payload.scheme !== 'xdc/xrc20-transfer') {
      return { isValid: false, invalidReason: `Unsupported XDC scheme: ${payload.scheme}` };
    }

    const norm = normalizeXdcHash(payload.txHash);
    if (!/^0x[0-9a-f]{64}$/.test(norm)) {
      return { isValid: false, invalidReason: 'Invalid XDC transaction hash format (expected 0x + 64 hex chars)' };
    }

    if (!payload.amount || BigInt(payload.amount) <= 0n) {
      return { isValid: false, invalidReason: 'Payment amount must be greater than zero' };
    }

    return {
      isValid: true,
      payer: payload.payerAddress || '0xunknown',
      amount: payload.amount,
      asset: 'XDC',
    };
  }

  async settlePayment(
    env: Env,
    payload: Q402SignedPayload,
    challenge: Q402ChallengeRecord,
    opts: { fetcher?: typeof fetch } = {},
  ): Promise<SettlementResult> {
    const fetcher = opts.fetcher || fetch;
    const normHash = normalizeXdcHash(payload.txHash);
    const network = challenge.scheme.startsWith('xdc')
      ? String(env.CHAIN_NETWORK || '').toLowerCase() === 'testnet'
        ? 'apothem'
        : 'mainnet'
      : 'mainnet';

    // 1. Check ledger ready
    if (!(await isTonLedgerReady(env))) {
      return { success: false, error: 'Payment ledger database is unavailable' };
    }

    // 2. Query XDC RPC for on-chain receipt verification
    const rpcUrl =
      String(env.CHAIN_XDC_RPC_URL || '').trim() ||
      (network === 'apothem' ? XDC_APOTHEM_RPC : XDC_MAINNET_RPC);

    try {
      const rpcRes = await fetcher(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getTransactionByHash',
          params: [normHash],
          id: 1,
        }),
      });

      if (!rpcRes.ok) {
        return { success: false, error: `XDC RPC query failed with HTTP ${rpcRes.status}` };
      }

      const rpcData = (await rpcRes.json()) as {
        result?: {
          to?: string;
          value?: string;
          input?: string;
          from?: string;
        } | null;
      };

      const tx = rpcData.result;
      if (!tx || !tx.to) {
        return { success: false, error: 'XDC transaction not found on-chain or still pending' };
      }

      const expectedRecipient = String(env.XDC_RECEIVING_ADDRESS || '').toLowerCase();
      if (expectedRecipient && tx.to.toLowerCase() !== expectedRecipient) {
        return { success: false, error: 'XDC transaction recipient does not match merchant address' };
      }

      const valueWei = BigInt(tx.value || '0');
      const minRequired = BigInt(challenge.amountUnits);
      if (valueWei < minRequired) {
        return { success: false, error: `XDC transaction value (${valueWei}) is less than required (${minRequired})` };
      }

      // Verify memo in transaction input data
      if (challenge.memo) {
        const decodedInput = hexDataToString(tx.input || '');
        if (!decodedInput.includes(challenge.memo)) {
          return { success: false, error: 'XDC transaction data does not match challenge order memo' };
        }
      }
    } catch (err) {
      return {
        success: false,
        error: `Failed to verify XDC transaction on-chain: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 3. Atomically claim transaction hash in payment ledger (idempotency key)
    const claim = await claimTonTransaction(env, {
      txHash: normHash,
      orderId: challenge.orderId,
      accountId: payload.payerAddress || 'xdc_user',
    });

    if (!claim.ok) {
      return { success: false, error: `XDC transaction already claimed: ${claim.reason}` };
    }

    // 4. Record proof anchor in D1
    const explorerUrl = xdcExplorerTxUrl(network, normHash);
    await recordProofAnchorBestEffort(env, {
      kind: 'ton_payment',
      chain: 'xdc',
      network: network === 'apothem' ? 'testnet' : 'mainnet',
      txHash: normHash,
      orderId: challenge.orderId,
      explorerUrl,
      status: 'anchored',
    });

    return {
      success: true,
      txHash: normHash,
      payer: payload.payerAddress || '0xunknown',
      amount: payload.amount,
      asset: 'XDC',
      explorerUrl,
    };
  }

  getExplorerUrl(network: string, txHash: string): string {
    return xdcExplorerTxUrl(network, txHash);
  }
}

export const xdcAdapter = new XdcChainAdapter();
