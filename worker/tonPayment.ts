/**
 * TON settlement: invoice + on-chain verify via Toncenter v3, then KV subscription.
 * Never trust client BOC alone; confirmation requires a matching on-chain transfer.
 * Crediting is claimed atomically in D1 (worker/paymentLedger.ts) before the subscription is written.
 */
import type { Env } from './index';
import { claimTonTransaction, isTonLedgerReady, releaseTonTransaction } from './paymentLedger';
import { PLANS } from './telegramBot';
import { resolveAccountId, writeSubscriptionRecord } from './userStore';
import { recordAuditLogBestEffort } from './auditLog';
import {
  TON_MAX_OPEN_ORDERS_PER_ACCOUNT,
  closeExpiredTonPendingOrders,
  countOpenTonPendingOrders,
  isTonPendingOrdersReady,
  listOpenTonPendingOrders,
  markTonPendingOrderCredited,
  readTonPendingOrder,
  recordTonPendingOrder,
} from './tonPendingOrders';
import {
  merchantAddressMatchesNetwork,
  normalizeTonTxHash,
  resolveChainNetwork,
  resolveTonApiBases,
  tonExplorerTxUrl,
  tonTxHashAliases,
  type ChainNetwork,
} from './chainNetwork';
import { recordProofAnchorBestEffort } from './proofAnchors';
import {
  findMatchingJettonPayment,
  jettonPriceUnits,
  parseAddressSafe,
  resolveMerchantJettonWallet,
  type JettonAsset,
} from './jettonSettlement';

export const TON_PRICING: Record<string, { ton: number; nanoTon: string }> = {
  starter: { ton: 15, nanoTon: '15000000000' },
  growth: { ton: 45, nanoTon: '45000000000' },
  agency: { ton: 120, nanoTon: '120000000000' },
  single_audit: { ton: 0.05, nanoTon: '50000000' },
  multi_agent_crawl: { ton: 0.15, nanoTon: '150000000' },
};

export const USDT_DECIMALS = 6;
export const LORA_DECIMALS = 9;

export const JETTON_PRICING: Record<string, { amount: number; units: string }> = {
  starter: { amount: 29, units: '29000000' },
  growth: { amount: 79, units: '79000000' },
  agency: { amount: 199, units: '199000000' },
  single_audit: { amount: 1, units: '1000000' },
  multi_agent_crawl: { amount: 3, units: '3000000' },
};

/**
 * Jetton (USDT / $LORA) checkout is OFF.
 *
 * It was switched on before spec 0018's condition was met (one real testnet USDT transfer credited
 * end to end on staging), while the verifier looked for the wrong notification opcode, so a paid
 * USDT order could never be credited. Turning it back on needs that staging credit, a review, and
 * a change to `tests/moneyInvariants.test.ts` in the same pull request.
 */
export const JETTON_CHECKOUT_LIVE = false;

/**
 * $LORA has its own switch. An empty master string must not be the only thing keeping it off
 * (LORA rule J5: no LORA checkout before on-chain verification of real transfers is reviewed).
 * LORA needs both switches on.
 */
export const LORA_CHECKOUT_LIVE = false;

/** Empty string = not configured. Never ship invented addresses. */
export const JETTON_MASTERS: Record<string, { USDT: string; LORA: string }> = {
  mainnet: {
    USDT: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
    LORA: '',
  },
  testnet: {
    USDT: 'kQD5l75tbhYoCcYMAPzlD1GRTAIdJZ9y-fgI-5xTnEeVIitl',
    LORA: '',
  },
};

export const JETTON_UNAVAILABLE_ERROR =
  'USDT and $LORA checkout is not available. Pay with Telegram Stars in the Telegram app.';

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
  asset?: 'TON' | 'USDT' | 'LORA';
  burnAmount?: string;
  jettonMaster?: string;
  userJettonWallet?: string;
}

export type TonFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type TonPaymentMatch = {
  ok: true;
  txHash: string;
  seqno: number | null;
  network: ChainNetwork;
};

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

type TonConfigEnv = Pick<
  Env,
  | 'TON_RECEIVING_ADDRESS'
  | 'TON_CONFIRMED_ADDRESS'
  | 'ENVIRONMENT'
  | 'CHAIN_NETWORK'
  | 'CHAIN_TON_API_BASE'
  | 'CHAIN_TON_API_FALLBACK_BASE'
>;

function diagnoseTonConfig(env: TonConfigEnv): { ok: true; network: ChainNetwork } | { ok: false; reason: string } {
  const network = resolveChainNetwork(env);
  if (!network) return { ok: false, reason: 'CHAIN_NETWORK must be testnet or mainnet' };
  if (isProductionEnv(env) && network !== 'mainnet') {
    return { ok: false, reason: 'ENVIRONMENT=production requires CHAIN_NETWORK=mainnet' };
  }
  const bases = resolveTonApiBases(env);
  if (!bases) return { ok: false, reason: 'CHAIN_TON_API_BASE / fallback host does not match CHAIN_NETWORK' };

  const addressCheck = validateTonAddress(env.TON_RECEIVING_ADDRESS, { production: isProductionEnv(env) });
  const merchant = merchantAddressMatchesNetwork(addressCheck, network);
  if (!merchant.ok) return { ok: false, reason: merchant.reason };
  return { ok: true, network };
}

export function isTonPaymentConfigured(env: TonConfigEnv): boolean {
  return diagnoseTonConfig(env).ok;
}

/**
 * The owner has confirmed, in their own wallet app, that TON_RECEIVING_ADDRESS is their address.
 * TON_CONFIRMED_ADDRESS holds the address they confirmed, and the two must be the same string.
 * A bare yes/no would let a later edit of the receiving address inherit the old confirmation;
 * this way a changed address is unconfirmed until the owner confirms it again.
 *
 * A valid-looking address nobody has confirmed must not take money: on 2026-10-10 the production
 * address had never had a transaction on any network.
 */
export function isTonAddressConfirmed(env: Pick<Env, 'TON_CONFIRMED_ADDRESS' | 'TON_RECEIVING_ADDRESS'>): boolean {
  const confirmed = String(env.TON_CONFIRMED_ADDRESS ?? '').trim();
  const receiving = String(env.TON_RECEIVING_ADDRESS ?? '').trim();
  return confirmed !== '' && confirmed === receiving;
}

/**
 * New TON invoices are issued only when the config is valid and the address is confirmed.
 * Verification of orders that already exist does not use this, so an order created before a
 * switch-off can still be credited.
 */
export function isTonCheckoutOpen(env: TonConfigEnv): boolean {
  return isTonAddressConfirmed(env) && diagnoseTonConfig(env).ok;
}

/** Telegram requires digital goods inside a bot or Mini App to be sold for Stars. */
export const TON_IN_TELEGRAM_ERROR = 'Inside Telegram, plans are paid with Telegram Stars.';
export const TON_TOO_MANY_OPEN_ORDERS_ERROR =
  'You have several unpaid TON orders open. Pay one of them, or use "Check my payment" if you already did. They close by themselves after 48 hours.';

// ---------------------------------------------------------------------------
// Invoice + verification
// ---------------------------------------------------------------------------

export async function createTonInvoice(
  env: Env,
  userId: string,
  planId: string,
  opts: { asset?: 'TON' | 'USDT' | 'LORA'; userWalletAddress?: string } = {},
): Promise<{ ok: true; order: TonOrder } | { ok: false; error: string }> {
  const plan = PLANS[planId];
  const price = TON_PRICING[planId];
  if (!plan || !price) {
    return { ok: false, error: `Invalid plan "${planId}". Available: ${Object.keys(PLANS).join(', ')}` };
  }

  const requestedAsset = opts.asset ?? 'TON';
  if (requestedAsset !== 'TON' && requestedAsset !== 'USDT' && requestedAsset !== 'LORA') {
    return { ok: false, error: 'Invalid asset. Use TON.' };
  }
  if (requestedAsset !== 'TON' && !JETTON_CHECKOUT_LIVE) {
    return { ok: false, error: JETTON_UNAVAILABLE_ERROR };
  }
  if (requestedAsset === 'LORA' && !LORA_CHECKOUT_LIVE) {
    return { ok: false, error: JETTON_UNAVAILABLE_ERROR };
  }

  const recipient = String(env.TON_RECEIVING_ADDRESS || '').trim();
  const cfg = diagnoseTonConfig(env);
  if (!cfg.ok) {
    console.error(
      `[TON] Invoice refused: ${cfg.reason}. TON_RECEIVING_ADDRESS ${addressForLog(recipient)} ENVIRONMENT=${env.ENVIRONMENT || 'unset'} CHAIN_NETWORK=${env.CHAIN_NETWORK || 'unset'}.`,
    );
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }
  if (!isTonAddressConfirmed(env)) {
    console.error(
      `[TON] Invoice refused: TON_CONFIRMED_ADDRESS does not equal TON_RECEIVING_ADDRESS. The owner has not confirmed that ${addressForLog(recipient)} is their wallet.`,
    );
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  if (!env.LUMINARA_KV) {
    console.error('[TON] Invoice refused: LUMINARA_KV is not bound, so the order could never be verified.');
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }
  if (!(await isTonLedgerReady(env)) || !(await isTonPendingOrdersReady(env))) {
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  const accountId = await resolveAccountId(env, userId);
  try {
    if ((await countOpenTonPendingOrders(env, accountId, Date.now())) >= TON_MAX_OPEN_ORDERS_PER_ACCOUNT) {
      return { ok: false, error: TON_TOO_MANY_OPEN_ORDERS_ERROR };
    }
  } catch (err) {
    console.error(`[TON] Invoice refused: open orders could not be counted: ${err instanceof Error ? err.message : err}`);
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  const orderId = `ton_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const memo = `LUM:${orderId}:${planId}`;
  const asset = requestedAsset;

  let amountNano = price.nanoTon;
  let tonAmount = price.ton;
  let jettonMaster: string | undefined;
  let userJettonWallet: string | undefined;

  if (asset !== 'TON') {
    jettonMaster = JETTON_MASTERS[cfg.network]?.[asset as 'USDT' | 'LORA'];
    if (!jettonMaster) {
      return { ok: false, error: `${asset} checkout is not available on ${cfg.network}.` };
    }
    const jettonPrice = JETTON_PRICING[planId];
    if (!jettonPrice) {
      return { ok: false, error: `Invalid plan "${planId}". Available: ${Object.keys(PLANS).join(', ')}` };
    }
    const unitsBigInt = jettonPriceUnits(asset as JettonAsset, jettonPrice.amount);
    if (!unitsBigInt) {
      return { ok: false, error: `Failed to calculate pricing for ${asset}.` };
    }
    amountNano = unitsBigInt.toString();
    tonAmount = jettonPrice.amount;

    if (opts.userWalletAddress) {
      const bases = resolveTonApiBases(env);
      if (bases) {
        const parsedMaster = parseAddressSafe(jettonMaster);
        const parsedUser = parseAddressSafe(opts.userWalletAddress);
        if (parsedMaster && parsedUser) {
          const resolved = await resolveMerchantJettonWallet(
            env,
            { master: parsedMaster, owner: parsedUser, network: bases.network, toncenter: bases.toncenter, tonapi: bases.tonapi },
          );
          if (resolved.ok) {
            userJettonWallet = resolved.wallet.toString({ bounceable: true, testOnly: bases.network === 'testnet' });
          }
        }
      }
    }
  }

  const order: TonOrder = {
    orderId,
    userId,
    planId,
    amountNano,
    tonAmount,
    memo,
    recipientAddress: recipient,
    status: 'pending',
    createdAt: Date.now(),
    asset,
    jettonMaster,
    userJettonWallet,
  };

  await env.LUMINARA_KV.put(`ton:order:${orderId}`, JSON.stringify(order), { expirationTtl: 7200 });

  // The KV copy lasts 2 hours. The D1 row keeps the order creditable for 48, by the buyer's own
  // retry or by the sweep. No row, no invoice: an order nobody remembers must not be paid.
  const remembered = await recordTonPendingOrder(env, {
    orderId,
    memo,
    accountId,
    loginId: userId,
    planId,
    asset,
    amountNano,
    recipient,
    network: cfg.network,
    createdAt: order.createdAt,
  });
  if (!remembered) {
    await env.LUMINARA_KV.delete(`ton:order:${orderId}`).catch(() => undefined);
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  return { ok: true, order };
}

/** Extract comment text from Toncenter v3 / TonAPI / legacy v2 shaped messages. */
export function extractTonComment(msg: any): string {
  if (!msg) return '';
  if (typeof msg.message === 'string' && msg.message) return msg.message;
  if (typeof msg.decoded_body?.text === 'string' && msg.decoded_body.text) return msg.decoded_body.text;

  const decoded = msg.message_content?.decoded;
  if (decoded && typeof decoded === 'object') {
    if (typeof decoded.text === 'string' && decoded.text) return decoded.text;
    if (typeof decoded.comment === 'string' && decoded.comment) return decoded.comment;
  }

  const rawText = msg.msg_data?.text;
  if (typeof rawText === 'string' && rawText) {
    if (rawText.startsWith('LUM:')) return rawText;
    try {
      if (typeof atob === 'function') {
        const decodedText = atob(rawText);
        if (decodedText && (decodedText.includes('LUM:') || /^[\x20-\x7E]+$/.test(decodedText))) {
          return decodedText;
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

function parseSeqno(tx: any): number | null {
  const candidates = [tx?.mc_block_seqno, tx?.mc_seqno, tx?.block_ref?.seqno];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

function phasePresent(phase: unknown): boolean {
  return typeof phase === 'string' ? phase.trim() !== '' : Boolean(phase) && typeof phase === 'object';
}

/**
 * True when the inbound value did not stay with the merchant: the inbound message is itself a
 * bounce, or the transaction has a bounce phase (Toncenter v3 `description.bounce` object,
 * TonAPI v2 `bounce_phase` string such as `TrPhaseBounceOk`).
 * `aborted`, `success: false` and a skipped or failed compute/action phase are deliberately not
 * grounds to reject: a non-bounceable transfer to an uninitialised wallet is aborted with the
 * compute phase skipped, yet the credit phase keeps the funds.
 * An aborted transaction whose inbound message was bounceable is also refused, so a provider
 * that omits the bounce phase cannot fail open.
 */
function inboundValueWasReturned(tx: any): boolean {
  if (tx.in_msg?.bounced === true) return true;
  if (phasePresent(tx.bounce_phase)) return true;
  if (phasePresent(tx.description?.bounce)) return true;
  return (tx.description?.aborted === true || tx.aborted === true) && tx.in_msg?.bounce === true;
}

function matchInboundTransfer(
  txs: any[],
  order: TonOrder,
  minValue: bigint,
  minTimeSec: number,
  network: ChainNetwork,
): TonPaymentMatch | null {
  for (const tx of txs) {
    const utime = Number(tx.utime ?? tx.now ?? 0);
    if (utime && utime < minTimeSec) continue;
    const inMsg = tx.in_msg;
    if (!inMsg) continue;
    const comment = extractTonComment(inMsg);
    const value = BigInt(String(inMsg.value || '0'));
    // Jetton orders cannot be proven from a native inbound message (memo text is spoofable and
    // `value` is TON, not jetton units). Never credit them here; see JETTON_CHECKOUT_LIVE.
    if (order.asset && order.asset !== 'TON') return null;
    // The comment must be this order's memo and nothing else. A comment that merely contains it
    // (another order's memo with this one appended, say) is not a payment for this order.
    if (comment.trim() !== order.memo) continue;
    if (value < minValue) continue;
    if (inboundValueWasReturned(tx)) {
      console.warn(`[TON] Transfer matching order ${order.orderId} bounced (value returned to sender); not crediting.`);
      continue;
    }
    const hash =
      typeof tx.hash === 'string'
        ? tx.hash
        : typeof tx.transaction_id?.hash === 'string'
          ? tx.transaction_id.hash
          : '';
    if (!hash) {
      reportHashlessMatch(order);
      continue;
    }
    // Toncenter returns base64, TonAPI hex: one canonical form feeds the claim, the anchor and the explorer URL.
    return { ok: true, txHash: normalizeTonTxHash(hash), seqno: parseSeqno(tx), network };
  }
  return null;
}

const TON_TX_PAGE = 100;
/** Bounds one read of a wallet's history: 500 transfers since the oldest order being checked. */
const TON_TX_MAX_PAGES = 5;
/** A chain index that does not answer inside this long counts as not answering. */
const TON_INDEX_TIMEOUT_MS = 8_000;

function txTimeSec(tx: any): number {
  return Number(tx?.utime ?? tx?.now ?? 0);
}

function indexFetchInit(headers: Record<string, string>): RequestInit {
  return { headers, signal: AbortSignal.timeout(TON_INDEX_TIMEOUT_MS) };
}

type TonIndexRead = { txs: any[] | null; truncated: boolean };

/**
 * Toncenter v3: every transfer to `recipient` since `sinceSec`, oldest first, in pages, so a
 * transfer is not missed because newer ones pushed it off the first page. `txs` is null when the
 * index did not answer; `truncated` is true when the wallet has more history than the bound.
 */
async function readToncenterSince(
  env: Env,
  toncenterBase: string,
  recipient: string,
  sinceSec: number,
  fetcher: TonFetch,
): Promise<TonIndexRead> {
  const apiKey = String(env.TON_API_KEY || '').trim();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;
  const txs: any[] = [];
  try {
    for (let page = 0; page < TON_TX_MAX_PAGES; page += 1) {
      const url =
        `${toncenterBase}/transactions?account=${encodeURIComponent(recipient)}` +
        `&limit=${TON_TX_PAGE}&offset=${page * TON_TX_PAGE}&start_utime=${sinceSec}&sort=asc`;
      const res = await fetcher(url, indexFetchInit(headers));
      if (!res.ok) return { txs: null, truncated: false };
      const data = (await res.json()) as { transactions?: any[]; result?: any[] };
      const batch = Array.isArray(data.transactions) ? data.transactions : Array.isArray(data.result) ? data.result : [];
      txs.push(...batch);
      if (batch.length < TON_TX_PAGE) return { txs, truncated: false };
    }
    return { txs, truncated: true };
  } catch {
    return { txs: null, truncated: false };
  }
}

/** TonAPI: newest first, paged back by logical time until a page reaches `sinceSec`. */
async function readTonapiSince(tonapiBase: string, recipient: string, sinceSec: number, fetcher: TonFetch): Promise<TonIndexRead> {
  const txs: any[] = [];
  try {
    let beforeLt = '';
    for (let page = 0; page < TON_TX_MAX_PAGES; page += 1) {
      const url =
        `${tonapiBase}/v2/blockchain/accounts/${encodeURIComponent(recipient)}/transactions?limit=${TON_TX_PAGE}` +
        (beforeLt ? `&before_lt=${encodeURIComponent(beforeLt)}` : '');
      const res = await fetcher(url, indexFetchInit({ Accept: 'application/json' }));
      if (!res.ok) return { txs: page === 0 ? null : txs, truncated: false };
      const data = (await res.json()) as { transactions?: any[] };
      const batch = Array.isArray(data.transactions) ? data.transactions : [];
      txs.push(...batch);
      const last = batch[batch.length - 1];
      const lastLt = last?.lt === undefined || last?.lt === null ? '' : String(last.lt);
      const reachedStart = Boolean(txTimeSec(last)) && txTimeSec(last) < sinceSec;
      if (batch.length < TON_TX_PAGE || !lastLt || lastLt === beforeLt || reachedStart) return { txs, truncated: false };
      beforeLt = lastLt;
    }
    return { txs, truncated: true };
  } catch {
    return { txs: txs.length > 0 ? txs : null, truncated: false };
  }
}

/** What both chain indexes showed for one wallet since a point in time. `null` means that index did not answer. */
export type TonInboundHistory = { toncenter: any[] | null; tonapi: any[] | null; truncated: boolean };

/** One read of both indexes for one wallet. The sweep uses it to check every open order without a call per order. */
export async function readTonInboundHistory(
  env: Env,
  recipient: string,
  sinceSec: number,
  fetcher: TonFetch = fetch,
): Promise<TonInboundHistory | null> {
  const bases = resolveTonApiBases(env);
  if (!bases) return null;
  const toncenter = await readToncenterSince(env, bases.toncenter, recipient, sinceSec, fetcher);
  const tonapi = await readTonapiSince(bases.tonapi, recipient, sinceSec, fetcher);
  return { toncenter: toncenter.txs, tonapi: tonapi.txs, truncated: toncenter.truncated || tonapi.truncated };
}

/**
 * Finds the inbound transfer that pays this order: comment equal to the memo, at least the price,
 * not bounced. Primary: Toncenter Index API v3. Fallback: TonAPI for the same CHAIN_NETWORK, asked
 * only when Toncenter showed no match. `known` is a history already read for this wallet.
 */
export async function findMatchingTonPayment(
  order: TonOrder,
  env: Env,
  fetcher: TonFetch = fetch,
  known?: TonInboundHistory,
): Promise<TonPaymentMatch | { ok: false; error: string }> {
  const bases = resolveTonApiBases(env);
  if (!bases) {
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  const minValue = BigInt(order.amountNano);
  const minTimeSec = Math.floor((order.createdAt - 60_000) / 1000);

  const toncenter = known ? known.toncenter : (await readToncenterSince(env, bases.toncenter, order.recipientAddress, minTimeSec, fetcher)).txs;
  if (toncenter) {
    const match = matchInboundTransfer(toncenter, order, minValue, minTimeSec, bases.network);
    if (match) return match;
  }

  const tonapi = known ? known.tonapi : (await readTonapiSince(bases.tonapi, order.recipientAddress, minTimeSec, fetcher)).txs;
  if (tonapi) {
    const match = matchInboundTransfer(tonapi, order, minValue, minTimeSec, bases.network);
    if (match) return match;
  }

  if (toncenter === null) {
    return { ok: false, error: 'Could not reach TON network to verify payment. Retrying shortly.' };
  }

  return { ok: false, error: 'Matching on-chain transfer not found yet. Wait a few seconds and retry.' };
}

/**
 * The order as the verifier needs it: from KV while that copy lasts (2 hours), and from the D1
 * row for the rest of its 48 hours. `network` is set when the order came from the row.
 * Returns 'unavailable' when the row could not be read: that is not the same as "no such order",
 * and the buyer must not be told their order has expired because the database blinked.
 */
async function loadTonOrder(env: Env, kv: KVNamespace, orderId: string): Promise<{ order: TonOrder; network?: string } | 'unavailable' | null> {
  const raw = await kv.get(`ton:order:${orderId}`, 'json');
  if (raw) return { order: raw as TonOrder };
  let row: Awaited<ReturnType<typeof readTonPendingOrder>> = null;
  try {
    row = await readTonPendingOrder(env, orderId);
  } catch (err) {
    console.error(`[TON] Could not read the remembered order ${orderId}: ${err instanceof Error ? err.message : err}`);
    return 'unavailable';
  }
  if (!row || row.status === 'expired' || row.expires_at <= Date.now()) return null;
  return {
    network: row.network,
    order: {
      orderId: row.order_id,
      userId: row.login_id,
      planId: row.plan_id,
      amountNano: row.amount_nano,
      tonAmount: TON_PRICING[row.plan_id]?.ton ?? 0,
      memo: row.memo,
      recipientAddress: row.recipient,
      status: row.status === 'credited' ? 'confirmed' : 'pending',
      createdAt: row.created_at,
      asset: row.asset as TonOrder['asset'],
    },
  };
}

/** An order younger than this is left to the buyer's own polling. */
const TON_SWEEP_MIN_AGE_MS = 2 * 60_000;
/** Every open order is looked at in one run; this only bounds a table that has grown beyond reason. */
const TON_SWEEP_MAX_ORDERS = 500;

export type TonPendingSweepSummary = {
  examined: number;
  credited: number;
  stillPending: number;
  errors: number;
  /** Orders that passed 48 hours unpaid in this run, and rows removed after their support window. */
  expired: number;
  deleted: number;
  /** True when a wallet had more history than one bounded read covers. */
  truncated: boolean;
};

/**
 * Re-checks unpaid orders that are still inside their 48 hours, so a transfer the chain index
 * shows late is credited without the buyer doing anything.
 *
 * Each wallet's transfers are read once and matched against every open order, so one run costs a
 * few calls to the index however many orders are open, and old unpaid orders cannot keep a paid
 * one from being looked at. Crediting goes through verifyTonPayment, so the ton_credited_tx claim
 * still stops a second credit.
 */
export async function sweepTonPendingOrders(
  env: Env,
  opts: { now?: number; limit?: number; fetcher?: TonFetch } = {},
): Promise<TonPendingSweepSummary> {
  const summary: TonPendingSweepSummary = { examined: 0, credited: 0, stillPending: 0, errors: 0, expired: 0, deleted: 0, truncated: false };
  if (!env.DB) {
    console.error('[TON] pending-order sweep skipped: D1 binding DB is not configured.');
    summary.errors += 1;
    return summary;
  }
  const now = opts.now ?? Date.now();
  try {
    const closed = await closeExpiredTonPendingOrders(env, now);
    summary.expired = closed.expired;
    summary.deleted = closed.deleted;
  } catch (err) {
    summary.errors += 1;
    console.error(`[TON] pending-order sweep could not close expired orders: ${err instanceof Error ? err.message : err}`);
  }

  let rows: Awaited<ReturnType<typeof listOpenTonPendingOrders>> = [];
  try {
    rows = await listOpenTonPendingOrders(env, {
      now,
      minAgeMs: TON_SWEEP_MIN_AGE_MS,
      limit: Math.max(1, Math.min(opts.limit ?? TON_SWEEP_MAX_ORDERS, TON_SWEEP_MAX_ORDERS)),
    });
  } catch (err) {
    summary.errors += 1;
    console.error(`[TON] pending-order sweep could not list open orders: ${err instanceof Error ? err.message : err}`);
  }

  // One read per wallet, from just before its oldest open order.
  const byRecipient = new Map<string, typeof rows>();
  for (const row of rows) byRecipient.set(row.recipient, [...(byRecipient.get(row.recipient) ?? []), row]);
  for (const [recipient, orders] of byRecipient) {
    const sinceSec = Math.floor((Math.min(...orders.map((o) => o.created_at)) - 60_000) / 1000);
    let history: TonInboundHistory | null = null;
    try {
      history = await readTonInboundHistory(env, recipient, sinceSec, opts.fetcher || fetch);
    } catch (err) {
      console.error(`[TON] pending-order sweep could not read the wallet history: ${err instanceof Error ? err.message : err}`);
    }
    if (!history || (history.toncenter === null && history.tonapi === null)) {
      // Neither index answered. Nothing is decided; the next run looks again.
      summary.errors += 1;
      summary.examined += orders.length;
      summary.stillPending += orders.length;
      continue;
    }
    if (history.truncated) {
      summary.truncated = true;
      console.error(`[TON] pending-order sweep: the wallet has more than ${TON_TX_PAGE * TON_TX_MAX_PAGES} transfers since its oldest open order; older ones were not read.`);
    }
    for (const row of orders) {
      summary.examined += 1;
      try {
        const result = await verifyTonPayment(env, row.order_id, { fetcher: opts.fetcher, known: history });
        if (result.ok) summary.credited += 1;
        else summary.stillPending += 1;
      } catch (err) {
        summary.errors += 1;
        console.error(`[TON] pending-order sweep could not check order ${row.order_id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  console.log(`[TON] pending-order sweep: ${JSON.stringify(summary)}`);
  return summary;
}

export async function verifyTonPayment(
  env: Env,
  orderId: string,
  opts: { expectedUserId?: string; fetcher?: TonFetch; known?: TonInboundHistory } = {},
): Promise<{ ok: true; plan: string; expiresAt: number } | { ok: false; error: string }> {
  if (!env.LUMINARA_KV) {
    console.error('[TON] Verify refused: LUMINARA_KV is not bound.');
    return { ok: false, error: TON_VERIFY_UNAVAILABLE_ERROR };
  }
  const kv = env.LUMINARA_KV;

  const loaded = await loadTonOrder(env, kv, orderId);
  if (loaded === 'unavailable') {
    return { ok: false, error: TON_VERIFY_UNAVAILABLE_ERROR };
  }
  if (!loaded) {
    return { ok: false, error: 'Order not found or expired' };
  }
  const { order } = loaded;

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

  const cfg = diagnoseTonConfig(env);
  if (!cfg.ok) {
    console.error(`[TON] Verify refused for order ${order.orderId}: ${cfg.reason}.`);
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  // An order remembered for one network is never verified against another.
  if (loaded.network && loaded.network !== cfg.network) {
    return { ok: false, error: 'Order not found or expired' };
  }

  // An order is payable only to the wallet this Worker is configured with now. If the address
  // was replaced after the invoice, a transfer to the old one grants nothing here; the owner
  // settles it by hand.
  if (String(env.TON_RECEIVING_ADDRESS || '').trim() !== order.recipientAddress) {
    console.error(`[TON] Verify refused for order ${order.orderId}: its recipient is no longer the configured merchant address.`);
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  const recipientCheck = validateTonAddress(order.recipientAddress, { production: isProductionEnv(env) });
  const merchant = merchantAddressMatchesNetwork(recipientCheck, cfg.network);
  if (!merchant.ok) {
    console.error(
      `[TON] Verify refused for order ${order.orderId}: recipient ${addressForLog(String(order.recipientAddress || ''))} (${merchant.reason}).`,
    );
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  const match = await (async () => {
    if (order.asset && order.asset !== 'TON') {
      const expectedMaster = JETTON_MASTERS[cfg.network]?.[order.asset as 'USDT' | 'LORA'];
      if (!expectedMaster) {
        return { ok: false as const, error: `${order.asset} master not configured for ${cfg.network}.` };
      }
      return findMatchingJettonPayment(
        {
          orderId: order.orderId,
          memo: order.memo,
          amountUnits: order.amountNano,
          recipientAddress: order.recipientAddress,
          jettonMaster: order.jettonMaster || expectedMaster,
          createdAt: order.createdAt,
        },
        env,
        { expectedMaster, fetcher: opts.fetcher || fetch },
      );
    }
    return findMatchingTonPayment(order, env, opts.fetcher || fetch, opts.known);
  })();

  if (!match.ok) return match;

  const txGuardKey = `ton:tx:${match.txHash}`;
  // Guards written before hash normalisation are keyed by the provider's own encoding.
  const guardOwners = await Promise.all(tonTxHashAliases(match.txHash).map((alias) => kv.get(`ton:tx:${alias}`)));
  if (guardOwners.some((owner) => owner && owner !== orderId)) {
    return { ok: false, error: 'This on-chain transaction has already been credited to another order.' };
  }

  const accountId = await resolveAccountId(env, order.userId);
  const claim = await claimTonTransaction(env, { txHash: match.txHash, orderId, accountId });
  if (!claim.ok) {
    if (claim.reason === 'tx_credited_to_other_order') {
      return { ok: false, error: 'This on-chain transaction has already been credited to another order.' };
    }
    if (claim.reason === 'order_already_credited') {
      // Not marked credited here: the verifier that holds the claim may still fail and release it.
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
    await releaseTonTransaction(env, match.txHash, orderId);
    console.error(`[TON] Subscription write failed after claim for order ${orderId}; claim released: ${err instanceof Error ? err.message : err}`);
    return { ok: false, error: TON_VERIFY_UNAVAILABLE_ERROR };
  }

  await markTonPendingOrderCredited(env, orderId);

  try {
    order.status = 'confirmed';
    order.confirmedAt = now;
    order.txHash = match.txHash;
    await kv.put(`ton:order:${orderId}`, JSON.stringify(order));
    await kv.put(txGuardKey, orderId, { expirationTtl: 86400 * 60 });
  } catch (err) {
    console.error(`[TON] KV cache update failed after crediting order ${orderId}: ${err instanceof Error ? err.message : err}`);
  }

  // The credit above stands whether or not the anchor row lands; a lost anchor is logged as
  // `[Proof] anchor_write_failed` with the tx hash, order id and network by the writer itself.
  await recordProofAnchorBestEffort(env, {
    kind: 'ton_payment',
    orderId,
    chain: 'ton',
    contract: order.jettonMaster || null,
    network: match.network,
    txHash: match.txHash,
    seqno: match.seqno,
    explorerUrl: tonExplorerTxUrl(match.network, match.txHash),
    status: 'anchored',
  });

  await recordAuditLogBestEffort(env, {
    org_id: `org_${accountId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    actor_id: order.userId,
    action: order.asset && order.asset !== 'TON' ? 'ton.jetton.credit' : 'ton.credit',
    details: {
      plan: order.planId,
      tonAmount: order.tonAmount,
      asset: order.asset || 'TON',
      orderId,
      txHash: match.txHash,
      seqno: match.seqno,
      network: match.network,
      expiresAt,
    },
  });

  return { ok: true, plan: order.planId, expiresAt };
}
