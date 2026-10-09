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
 * Jetton (USDT / $LORA) checkout is live backed by the TEP-74 verifier in ./jettonSettlement.ts.
 * The verifier derives the merchant's canonical jetton wallet on-chain via get_wallet_address,
 * decodes transfer_notification (op 0x7362d096), checks exact memo match, and enforces decimals.
 */
export const JETTON_CHECKOUT_LIVE = true;

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
  'USDT and $LORA checkout is not available yet. Pay with TON or Telegram Stars.';

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

  const recipient = String(env.TON_RECEIVING_ADDRESS || '').trim();
  const cfg = diagnoseTonConfig(env);
  if (!cfg.ok) {
    console.error(
      `[TON] Invoice refused: ${cfg.reason}. TON_RECEIVING_ADDRESS ${addressForLog(recipient)} ENVIRONMENT=${env.ENVIRONMENT || 'unset'} CHAIN_NETWORK=${env.CHAIN_NETWORK || 'unset'}.`,
    );
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  if (!env.LUMINARA_KV) {
    console.error('[TON] Invoice refused: LUMINARA_KV is not bound, so the order could never be verified.');
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }
  if (!(await isTonLedgerReady(env))) {
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
    if (!comment.includes(order.memo)) continue;
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

/**
 * Looks up recent inbound transfers to the merchant wallet and matches memo + amount.
 * Primary: Toncenter Index API v3. Fallback: TonAPI for the same CHAIN_NETWORK.
 */
export async function findMatchingTonPayment(
  order: TonOrder,
  env: Env,
  fetcher: TonFetch = fetch,
): Promise<TonPaymentMatch | { ok: false; error: string }> {
  const bases = resolveTonApiBases(env);
  if (!bases) {
    return { ok: false, error: TON_UNAVAILABLE_ERROR };
  }

  const apiKey = String(env.TON_API_KEY || '').trim();
  const minValue = BigInt(order.amountNano);
  const minTimeSec = Math.floor((order.createdAt - 60_000) / 1000);

  const toncenterUrl =
    `${bases.toncenter}/transactions` +
    `?account=${encodeURIComponent(order.recipientAddress)}` +
    `&limit=30&start_utime=${minTimeSec}`;
  const toncenterHeaders: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) toncenterHeaders['X-API-Key'] = apiKey;

  let toncenterFailed = false;
  try {
    const res = await fetcher(toncenterUrl, { headers: toncenterHeaders });
    if (res.ok) {
      const data = (await res.json()) as { transactions?: any[]; result?: any[]; ok?: boolean };
      const txs = Array.isArray(data.transactions)
        ? data.transactions
        : Array.isArray(data.result)
          ? data.result
          : [];
      const match = matchInboundTransfer(txs, order, minValue, minTimeSec, bases.network);
      if (match) return match;
    } else {
      toncenterFailed = true;
    }
  } catch {
    toncenterFailed = true;
  }

  try {
    const tonapiUrl =
      `${bases.tonapi}/v2/blockchain/accounts/${encodeURIComponent(order.recipientAddress)}/transactions?limit=30`;
    const tonapiRes = await fetcher(tonapiUrl, { headers: { Accept: 'application/json' } });
    if (tonapiRes.ok) {
      const data = (await tonapiRes.json()) as { transactions?: any[] };
      const txs = Array.isArray(data.transactions) ? data.transactions : [];
      const match = matchInboundTransfer(txs, order, minValue, minTimeSec, bases.network);
      if (match) return match;
    }
  } catch {
    /* ignore fallback network errors */
  }

  if (toncenterFailed) {
    return { ok: false, error: 'Could not reach TON network to verify payment. Retrying shortly.' };
  }

  return { ok: false, error: 'Matching on-chain transfer not found yet. Wait a few seconds and retry.' };
}

export async function verifyTonPayment(
  env: Env,
  orderId: string,
  opts: { expectedUserId?: string; fetcher?: TonFetch } = {},
): Promise<{ ok: true; plan: string; expiresAt: number } | { ok: false; error: string }> {
  if (!env.LUMINARA_KV) {
    console.error('[TON] Verify refused: LUMINARA_KV is not bound.');
    return { ok: false, error: TON_VERIFY_UNAVAILABLE_ERROR };
  }
  const kv = env.LUMINARA_KV;

  const raw = await kv.get(`ton:order:${orderId}`, 'json');
  if (!raw) {
    return { ok: false, error: 'Order not found or expired' };
  }
  const order = raw as TonOrder;

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
    return findMatchingTonPayment(order, env, opts.fetcher || fetch);
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
