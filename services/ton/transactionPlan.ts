/**
 * Pre-flight planning for TonConnect payments.
 * Pattern borrowed from Trust Wallet Core `AnySigner.plan()` before `sign()`: validate everything
 * that can be checked offline before the wallet prompt, so a user never approves a transaction
 * that the server could never credit (wrong network, malformed recipient, expired invoice).
 *
 * Pure module: no network, no wallet calls. Safe to unit test and to run before every prompt.
 */
import { Address } from '@ton/core';
import { CHAIN_REGISTRY, formatElementaryUnits, tonNetworkFromConnectChain, type ChainNetworkName } from '../chain/chainRegistry';

/**
 * Network fee headroom shown to the user and kept in the wallet for a plain TON transfer with a
 * short comment. This is guidance only; the wallet computes the real fee. Typical cost is well under
 * 0.01 TON on basechain.
 */
export const TON_FEE_RESERVE_NANO = 10_000_000n; // 0.01 TON

/** A text comment uses one cell: 1023 bits = 127 bytes, minus the 4-byte zero opcode prefix. */
export const MAX_SINGLE_CELL_COMMENT_BYTES = 123;

/** Invoice validity window offered to the wallet (seconds). */
export const DEFAULT_VALID_FOR_SEC = 600;

export interface TonPlanOrderInput {
  orderId: string;
  amountNano: string;
  memo: string;
  recipientAddress: string;
  /** Invoice asset; anything other than TON is refused on the native-transfer path. */
  asset?: 'TON' | 'USDT' | 'LORA';
}

export interface TonPaymentPlan {
  network: ChainNetworkName;
  recipient: string;
  amountNano: bigint;
  feeReserveNano: bigint;
  /** amount + fee reserve: the balance the wallet should hold for the transfer to go through. */
  requiredBalanceNano: bigint;
  amountDisplay: string;
  feeReserveDisplay: string;
  memo: string;
  validUntil: number;
  /** Non-blocking notes the UI may surface. */
  warnings: string[];
}

export type TonPlanErrorCode =
  | 'invalid_amount'
  | 'unsupported_asset'
  | 'invalid_recipient'
  | 'invalid_memo'
  | 'wallet_not_connected'
  | 'wallet_network_unknown'
  | 'network_mismatch';

export type TonPlanResult = { ok: true; plan: TonPaymentPlan } | { ok: false; code: TonPlanErrorCode; error: string };

function fail(code: TonPlanErrorCode, error: string): TonPlanResult {
  return { ok: false, code, error };
}

/** Parses a user-friendly or raw address offline (CRC16 verified for friendly form). */
export function parseTonAddress(
  address: string,
): { ok: true; address: Address; testOnly: boolean | null; bounceable: boolean | null } | { ok: false } {
  const value = String(address || '').trim();
  try {
    if (Address.isFriendly(value)) {
      const parsed = Address.parseFriendly(value);
      return { ok: true, address: parsed.address, testOnly: parsed.isTestOnly, bounceable: parsed.isBounceable };
    }
    if (Address.isRaw(value)) {
      return { ok: true, address: Address.parseRaw(value), testOnly: null, bounceable: null };
    }
  } catch {
    /* fall through */
  }
  return { ok: false };
}

/**
 * Builds a payment plan or explains, in user-facing words, why the payment must not be sent.
 * `walletChain` is TonConnect `wallet.account.chain` ('-239' mainnet, '-3' testnet).
 */
export function planTonPayment(input: {
  order: TonPlanOrderInput;
  walletChain: unknown;
  walletConnected: boolean;
  nowSec?: number;
  validForSec?: number;
}): TonPlanResult {
  const { order } = input;
  if (!input.walletConnected) return fail('wallet_not_connected', 'Please connect your TON wallet first.');

  // amountNano holds jetton units on jetton invoices; sending it as native TON would never be credited.
  if (order.asset !== undefined && order.asset !== 'TON') {
    return fail('unsupported_asset', 'This invoice is payable in a token, not TON. Nothing was sent.');
  }

  const amountRaw = String(order.amountNano ?? '').trim();
  if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) {
    return fail('invalid_amount', 'The invoice amount is invalid. Request a new invoice and try again.');
  }
  const amountNano = BigInt(amountRaw);

  const recipient = parseTonAddress(order.recipientAddress);
  if (!recipient.ok) {
    return fail('invalid_recipient', 'The payment address on this invoice is invalid. Nothing was sent.');
  }
  // Merchant config rejects raw addresses (no network flag), so the plan does too.
  if (recipient.testOnly === null) {
    return fail('invalid_recipient', 'The payment address on this invoice has no network flag. Nothing was sent.');
  }
  const invoiceNetwork: ChainNetworkName = recipient.testOnly ? 'testnet' : 'mainnet';

  const memo = String(order.memo ?? '');
  const memoBytes = new TextEncoder().encode(memo).length;
  const orderId = String(order.orderId ?? '').trim();
  if (!orderId || !memo.startsWith(`LUM:${orderId}:`)) {
    return fail('invalid_memo', 'The invoice memo does not match this order. Request a new invoice.');
  }

  const walletNetwork = tonNetworkFromConnectChain(input.walletChain);
  if (!walletNetwork) {
    return fail('wallet_network_unknown', 'Could not tell which TON network your wallet is on. Reconnect your wallet and try again.');
  }
  if (walletNetwork !== invoiceNetwork) {
    return fail(
      'network_mismatch',
      `Your wallet is on TON ${walletNetwork}, but this invoice is payable on TON ${invoiceNetwork}. Switch networks in your wallet, then try again. Nothing was sent.`,
    );
  }

  const warnings: string[] = [];
  if (memoBytes > MAX_SINGLE_CELL_COMMENT_BYTES) {
    warnings.push('Long memo spans more than one cell; some wallets may not display it in full.');
  }
  if (recipient.bounceable === false) {
    warnings.push('Recipient address is non-bounceable.');
  }

  const decimals = CHAIN_REGISTRY.ton.decimals;
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  return {
    ok: true,
    plan: {
      network: invoiceNetwork,
      recipient: String(order.recipientAddress).trim(),
      amountNano,
      feeReserveNano: TON_FEE_RESERVE_NANO,
      requiredBalanceNano: amountNano + TON_FEE_RESERVE_NANO,
      amountDisplay: formatElementaryUnits(amountNano, decimals),
      feeReserveDisplay: formatElementaryUnits(TON_FEE_RESERVE_NANO, decimals),
      memo,
      validUntil: nowSec + (input.validForSec ?? DEFAULT_VALID_FOR_SEC),
      warnings,
    },
  };
}
