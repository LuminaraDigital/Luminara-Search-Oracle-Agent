/**
 * Jetton (TEP-74) settlement verifier: proves a USDT / $LORA payment reached the merchant.
 *
 * Why this exists: a memo in a plain TON comment is spoofable, so `worker/tonPayment.ts` keeps
 * jetton checkout off (`JETTON_CHECKOUT_LIVE`). This module supplies the missing proof.
 *
 * Pattern borrowed from Trust Wallet Core `tw_ton` (deterministic cell layouts, decode do not
 * guess). A jetton payment is credited only when all of these hold:
 *   1. The inbound message source equals the merchant's canonical jetton wallet, derived by running
 *      `get_wallet_address(owner)` on the configured master. Only the jetton wallet contract deployed
 *      by that master can send from that address, so a forged `transfer_notification` from any other
 *      contract is ignored. Indexer wallet listings are never trusted for this.
 *   2. The body decodes as `transfer_notification` (op 0x7362d09c, the TEP-74 value) with
 *      amount >= price, in elementary units.
 *   3. The forward-payload text comment equals the order memo exactly.
 *   4. The inbound message is not itself a bounce, and the transaction has a hash.
 * Double-credit protection stays with the caller's D1 ledger (`claimTonTransaction`).
 *
 * Fail closed everywhere: any decode, config, or indexer inconsistency returns no match.
 */
import { Address, beginCell, Cell, type Slice } from '@ton/core';
import type { Env } from './env';
import { normalizeTonTxHash, resolveTonApiBases, type ChainNetwork } from './chainNetwork';
import { toElementaryUnits } from '../services/chain/chainRegistry';

/**
 * TEP-74 transfer_notification#7362d09c query_id:uint64 amount:Coins sender:MsgAddress forward_payload:(Either Cell ^Cell)
 *
 * This is the opcode every standard jetton wallet sends, including USDT and the in-repo LORA
 * contract (`contracts/jetton/contracts/messages.tact`). It was 0x7362d096 here until 2026-10-10,
 * which matched no real transfer. `tests/moneyInvariants.test.ts` pins it against the literal.
 */
export const OP_JETTON_TRANSFER_NOTIFICATION = 0x7362d09c;

export const JETTON_WALLET_CACHE_TTL_SEC = 86_400;
const TX_PAGE_LIMIT = 50;

/** Decimals per supported jetton; must match USDT_DECIMALS / LORA_DECIMALS in worker/tonPayment.ts (guarded by test). */
export const JETTON_DECIMALS = Object.freeze({ USDT: 6, LORA: 9 } as const);
export type JettonAsset = keyof typeof JETTON_DECIMALS;

/**
 * Price in elementary units for `asset`, from a human decimal amount (e.g. '79' USDT -> 79000000n).
 * Use this to fill `amountUnits`; never reuse one asset's unit string for another asset.
 */
export function jettonPriceUnits(asset: JettonAsset, amount: string | number): bigint | null {
  if (!Object.prototype.hasOwnProperty.call(JETTON_DECIMALS, asset)) return null;
  const decimals = JETTON_DECIMALS[asset];
  const units = toElementaryUnits(String(amount), decimals);
  return units !== null && units > 0n ? units : null;
}

export interface DecodedJettonNotification {
  queryId: bigint;
  amount: bigint;
  /** Original sender (owner of the source jetton wallet). Null when addr_none / external. */
  sender: Address | null;
  /** Text comment from the forward payload, '' when absent or not a text comment. */
  comment: string;
}

export interface JettonOrderInput {
  orderId: string;
  memo: string;
  /** Price in jetton elementary units (decimal digits only). */
  amountUnits: string;
  /** Merchant owner wallet (the TON_RECEIVING_ADDRESS the invoice was issued against). */
  recipientAddress: string;
  /** Jetton master the invoice was priced in. */
  jettonMaster: string;
  createdAt: number;
}

export interface JettonPaymentMatch {
  ok: true;
  txHash: string;
  seqno: number | null;
  network: ChainNetwork;
  jettonAmount: bigint;
  /** Friendly form of the original sender when decodable, else null. */
  sender: string | null;
}

export type JettonFetch = (url: string, init?: RequestInit) => Promise<Response>;

type JettonEnv = Pick<Env, 'CHAIN_NETWORK' | 'CHAIN_TON_API_BASE' | 'CHAIN_TON_API_FALLBACK_BASE' | 'TON_API_KEY' | 'LUMINARA_KV'>;

export const JETTON_VERIFY_UNAVAILABLE = 'Payment verification is temporarily unavailable. Please try again in a few minutes.';
export const JETTON_NOT_FOUND = 'Matching token transfer not found yet. Wait a few seconds and retry.';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function parseAddressSafe(value: unknown): Address | null {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return null;
  try {
    return Address.parse(s);
  } catch {
    return null;
  }
}

function readComment(payload: Slice | null): string {
  if (!payload || payload.remainingBits < 32) return '';
  if (payload.loadUint(32) !== 0) return '';
  return payload.loadStringTail();
}

/** Decodes a transfer_notification body cell. Returns null for any other opcode or malformed layout. */
export function decodeJettonNotification(body: Cell): DecodedJettonNotification | null {
  try {
    const s = body.beginParse();
    if (s.remainingBits < 32 || s.loadUint(32) !== OP_JETTON_TRANSFER_NOTIFICATION) return null;
    const queryId = s.loadUintBig(64);
    const amount = s.loadCoins();
    const senderAny = s.loadAddressAny();
    const sender = senderAny instanceof Address ? senderAny : null;

    let comment = '';
    if (s.remainingBits >= 1) {
      const inRef = s.loadBit();
      if (inRef) {
        comment = s.remainingRefs > 0 ? readComment(s.loadRef().beginParse()) : '';
      } else {
        comment = readComment(s);
      }
    }
    return { queryId, amount, sender, comment };
  } catch {
    return null;
  }
}

/** Reads the inbound body from Toncenter v3 (`message_content.body`, base64) or TonAPI v2 (`raw_body`, hex). */
export function inboundBodyCell(inMsg: any): Cell | null {
  try {
    const b64 = inMsg?.message_content?.body;
    if (typeof b64 === 'string' && b64) return Cell.fromBase64(b64);
    const hex = inMsg?.raw_body;
    if (typeof hex === 'string' && /^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      return Cell.fromBoc(Buffer.from(hex, 'hex'))[0] ?? null;
    }
  } catch {
    /* malformed BOC */
  }
  return null;
}

function inboundSource(inMsg: any): Address | null {
  const raw = typeof inMsg?.source === 'string' ? inMsg.source : inMsg?.source?.address;
  return parseAddressSafe(raw);
}

function txHashOf(tx: any): string {
  if (typeof tx?.hash === 'string' && tx.hash) return tx.hash;
  if (typeof tx?.transaction_id?.hash === 'string') return tx.transaction_id.hash;
  return '';
}

function parseSeqno(tx: any): number | null {
  for (const c of [tx?.mc_block_seqno, tx?.mc_seqno, tx?.block_ref?.seqno]) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

/**
 * Scans merchant-wallet transactions for a transfer_notification that satisfies every credit rule.
 * Transactions from any source other than `merchantJettonWallet` are ignored outright.
 */
export function matchJettonNotification(
  txs: unknown[],
  criteria: { memo: string; minUnits: bigint; merchantJettonWallet: Address; minTimeSec: number; network: ChainNetwork },
): JettonPaymentMatch | null {
  if (!criteria.memo || criteria.minUnits <= 0n) return null;
  for (const tx of txs as any[]) {
    const utime = Number(tx?.utime ?? tx?.now ?? 0);
    if (utime && utime < criteria.minTimeSec) continue;
    const inMsg = tx?.in_msg;
    if (!inMsg) continue;

    const source = inboundSource(inMsg);
    if (!source || !source.equals(criteria.merchantJettonWallet)) continue;
    if (inMsg.bounced === true) continue;

    const body = inboundBodyCell(inMsg);
    if (!body) continue;
    const decoded = decodeJettonNotification(body);
    if (!decoded) continue;
    if (decoded.amount < criteria.minUnits) continue;
    // Exact match, not substring: a comment carrying several memos must not shadow a victim's real payment.
    if (decoded.comment.trim() !== criteria.memo) continue;

    const hash = txHashOf(tx);
    if (!hash) {
      console.error(`[Jetton] Notification matching memo ${criteria.memo} has no transaction hash; not crediting without a dedupe key.`);
      continue;
    }
    return {
      ok: true,
      txHash: normalizeTonTxHash(hash),
      seqno: parseSeqno(tx),
      network: criteria.network,
      jettonAmount: decoded.amount,
      sender: decoded.sender ? decoded.sender.toString({ bounceable: false, testOnly: criteria.network === 'testnet' }) : null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Network: canonical jetton wallet resolution + transaction scan
// ---------------------------------------------------------------------------

function apiHeaders(env: JettonEnv): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const apiKey = String(env.TON_API_KEY || '').trim();
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Reads a MsgAddress from a get-method stack item: Toncenter v3 `{type, value: base64 BOC}` or TonAPI `{type, cell|slice: hex BOC}`. */
export function addressFromStackItem(item: any): Address | null {
  try {
    let cell: Cell | null = null;
    const hex = typeof item?.cell === 'string' ? item.cell : typeof item?.slice === 'string' ? item.slice : '';
    if (typeof item?.value === 'string' && item.value) cell = Cell.fromBase64(item.value);
    else if (hex && /^[0-9a-fA-F]+$/.test(hex)) cell = Cell.fromBoc(Buffer.from(hex, 'hex'))[0] ?? null;
    if (!cell) return null;
    const a = cell.beginParse().loadAddressAny();
    return a instanceof Address ? a : null;
  } catch {
    return null;
  }
}

async function walletViaToncenter(env: JettonEnv, toncenter: string, master: Address, ownerSlice: string, fetcher: JettonFetch): Promise<Address | null> {
  try {
    const res = await fetcher(`${toncenter}/runGetMethod`, {
      method: 'POST',
      headers: { ...apiHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: master.toRawString(), method: 'get_wallet_address', stack: [{ type: 'slice', value: ownerSlice }] }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { exit_code?: number; stack?: unknown[] };
    if (data.exit_code !== 0 || !Array.isArray(data.stack) || data.stack.length < 1) return null;
    return addressFromStackItem(data.stack[0]);
  } catch {
    return null;
  }
}

async function walletViaTonapi(tonapi: string, master: Address, owner: Address, fetcher: JettonFetch): Promise<Address | null> {
  try {
    const url = `${tonapi}/v2/blockchain/accounts/${encodeURIComponent(master.toRawString())}/methods/get_wallet_address?args=${encodeURIComponent(owner.toRawString())}`;
    const res = await fetcher(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as { success?: boolean; exit_code?: number; stack?: unknown[] };
    if (data.success === false || data.exit_code !== 0 || !Array.isArray(data.stack) || data.stack.length < 1) return null;
    return addressFromStackItem(data.stack[0]);
  } catch {
    return null;
  }
}

/**
 * Derives the merchant's jetton wallet by running `get_wallet_address(owner)` on the master
 * contract itself (Toncenter v3 `/runGetMethod`, TonAPI fallback). Indexer wallet listings are
 * deliberately not used: any contract can claim owner=merchant via its own `get_wallet_data`.
 * If both providers answer they must agree, or it fails closed.
 * Cached in KV for 24 h (the address is deterministic for owner + master code).
 */
export async function resolveMerchantJettonWallet(
  env: JettonEnv,
  input: { master: Address; owner: Address; network: ChainNetwork; toncenter: string; tonapi: string },
  fetcher: JettonFetch = fetch,
): Promise<{ ok: true; wallet: Address } | { ok: false; reason: string }> {
  const cacheKey = `jetton:wallet:v2:${input.network}:${input.master.toRawString()}:${input.owner.toRawString()}`;
  const kv = env.LUMINARA_KV;
  if (kv) {
    try {
      const cached = parseAddressSafe(await kv.get(cacheKey));
      if (cached) return { ok: true, wallet: cached };
    } catch {
      /* cache read is best-effort */
    }
  }

  const ownerSlice = bytesToBase64(beginCell().storeAddress(input.owner).endCell().toBoc());
  const [viaToncenter, viaTonapi] = await Promise.all([
    walletViaToncenter(env, input.toncenter, input.master, ownerSlice, fetcher),
    walletViaTonapi(input.tonapi, input.master, input.owner, fetcher),
  ]);
  if (viaToncenter && viaTonapi && !viaToncenter.equals(viaTonapi)) {
    return { ok: false, reason: 'providers disagree on get_wallet_address result' };
  }
  const wallet = viaToncenter ?? viaTonapi;
  if (!wallet) return { ok: false, reason: 'get_wallet_address on the jetton master failed on all providers' };

  if (kv) {
    try {
      await kv.put(cacheKey, wallet.toRawString(), { expirationTtl: JETTON_WALLET_CACHE_TTL_SEC });
    } catch {
      /* cache write is best-effort */
    }
  }
  return { ok: true, wallet };
}

/**
 * Finds a jetton payment for `order`. Primary: Toncenter v3 transactions. Fallback: TonAPI v2.
 * `expectedMaster` is the server-configured master for the order's asset and network; the order's
 * own `jettonMaster` must equal it (defence against a tampered or stale order record).
 */
export async function findMatchingJettonPayment(
  order: JettonOrderInput,
  env: JettonEnv,
  opts: { expectedMaster: string; fetcher?: JettonFetch },
): Promise<JettonPaymentMatch | { ok: false; error: string }> {
  const fetcher = opts.fetcher ?? fetch;
  const bases = resolveTonApiBases(env);
  if (!bases) return { ok: false, error: JETTON_VERIFY_UNAVAILABLE };

  const expected = parseAddressSafe(opts.expectedMaster);
  const orderMaster = parseAddressSafe(order.jettonMaster);
  const owner = parseAddressSafe(order.recipientAddress);
  const units = String(order.amountUnits ?? '').trim();
  if (!expected || !orderMaster || !owner || !expected.equals(orderMaster) || !/^\d+$/.test(units) || BigInt(units) <= 0n) {
    console.error(`[Jetton] Verify refused for order ${order.orderId}: master, owner, or amount is missing or mismatched.`);
    return { ok: false, error: JETTON_VERIFY_UNAVAILABLE };
  }

  const resolved = await resolveMerchantJettonWallet(
    env,
    { master: expected, owner, network: bases.network, toncenter: bases.toncenter, tonapi: bases.tonapi },
    fetcher,
  );
  if (!resolved.ok) {
    console.warn(`[Jetton] Merchant jetton wallet unresolved for order ${order.orderId}: ${resolved.reason}`);
    return { ok: false, error: JETTON_NOT_FOUND };
  }

  const minTimeSec = Math.floor((order.createdAt - 60_000) / 1000);
  const criteria = {
    memo: order.memo,
    minUnits: BigInt(units),
    merchantJettonWallet: resolved.wallet,
    minTimeSec,
    network: bases.network,
  };
  const ownerRaw = owner.toRawString();

  let primaryFailed = false;
  try {
    // Oldest-first from the order window, so later traffic on a busy wallet cannot page the match out.
    const url = `${bases.toncenter}/transactions?account=${encodeURIComponent(ownerRaw)}&limit=${TX_PAGE_LIMIT}&start_utime=${minTimeSec}&sort=asc`;
    const res = await fetcher(url, { headers: apiHeaders(env) });
    if (res.ok) {
      const data = (await res.json()) as { transactions?: unknown[] };
      const match = matchJettonNotification(Array.isArray(data.transactions) ? data.transactions : [], criteria);
      if (match) return match;
    } else {
      primaryFailed = true;
    }
  } catch {
    primaryFailed = true;
  }

  try {
    const url = `${bases.tonapi}/v2/blockchain/accounts/${encodeURIComponent(ownerRaw)}/transactions?limit=${TX_PAGE_LIMIT}`;
    const res = await fetcher(url, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = (await res.json()) as { transactions?: unknown[] };
      const match = matchJettonNotification(Array.isArray(data.transactions) ? data.transactions : [], criteria);
      if (match) return match;
    }
  } catch {
    /* fallback is best-effort */
  }

  if (primaryFailed) return { ok: false, error: 'Could not reach TON network to verify payment. Retrying shortly.' };
  return { ok: false, error: JETTON_NOT_FOUND };
}
