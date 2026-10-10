/**
 * TON orders remembered in D1 for 48 hours (migrations/0025_ton_pending_orders.sql).
 *
 * The KV copy of an order lives 2 hours. A transfer the chain index shows later than that used to
 * be paid and never credited. The row here holds what the verifier reads from the order, so the
 * buyer's own retry and the daily sweep can credit it late instead of never.
 *
 * This file only stores and lists orders. Matching a transfer and granting the plan stay in
 * worker/tonPayment.ts, and the claim in ton_credited_tx is still what stops a second credit.
 */

export const TON_PENDING_ORDERS_MIGRATION = 'migrations/0025_ton_pending_orders.sql';

/** How long an unpaid order can still be credited. */
export const TON_PENDING_ORDER_TTL_MS = 48 * 60 * 60_000;
/** How long a closed order row is kept after that, so support can tie a quoted order id to an account. */
export const TON_PENDING_ORDER_SUPPORT_MS = 30 * 24 * 60 * 60_000;
/** One account cannot hold more open orders than this. Enforced inside the insert itself. */
export const TON_MAX_OPEN_ORDERS_PER_ACCOUNT = 20;
/**
 * A claim in ton_credited_tx younger than this may belong to a verifier that is still writing the
 * plan and can yet fail and release it. Only older claims are taken as proof of a credit.
 */
export const TON_CLAIM_SETTLED_MS = 5 * 60_000;

export type TonPendingOrdersEnv = { DB?: D1Database };

export type TonPendingOrderRow = {
  order_id: string;
  memo: string;
  account_id: string;
  login_id: string;
  plan_id: string;
  asset: string;
  amount_nano: string;
  recipient: string;
  network: string;
  status: 'pending' | 'credited' | 'expired';
  created_at: number;
  expires_at: number;
};

const COLUMNS = 'order_id, memo, account_id, login_id, plan_id, asset, amount_nano, recipient, network, status, created_at, expires_at';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Probe used before a TON invoice is issued, so nobody pays an order that could not be remembered. */
export async function isTonPendingOrdersReady(env: TonPendingOrdersEnv): Promise<boolean> {
  if (!env.DB) {
    console.error(`[TonPendingOrders] D1 binding DB is not configured. Refusing TON invoices. Bind DB and apply ${TON_PENDING_ORDERS_MIGRATION}.`);
    return false;
  }
  try {
    await env.DB.prepare(`SELECT expires_at FROM ton_pending_orders LIMIT 1`).first();
    return true;
  } catch (err) {
    console.error(`[TonPendingOrders] ton_pending_orders cannot be read. Refusing TON invoices. Apply ${TON_PENDING_ORDERS_MIGRATION}: ${errorText(err)}`);
    return false;
  }
}

export type NewTonPendingOrder = {
  orderId: string;
  memo: string;
  accountId: string;
  loginId: string;
  planId: string;
  asset: string;
  amountNano: string;
  recipient: string;
  network: string;
  createdAt: number;
};

/**
 * Writes the order, unless the account already has `maxOpen` open ones. The count is part of the
 * insert, so any number of invoices asked for at the same moment cannot get past it.
 * The invoice is issued only on 'recorded'.
 */
export async function recordTonPendingOrder(
  env: TonPendingOrdersEnv,
  order: NewTonPendingOrder,
  maxOpen: number = TON_MAX_OPEN_ORDERS_PER_ACCOUNT,
): Promise<'recorded' | 'too_many' | 'failed'> {
  if (!env.DB) return 'failed';
  try {
    const inserted = await env.DB.prepare(
      `INSERT INTO ton_pending_orders (order_id, memo, account_id, login_id, plan_id, asset, amount_nano, recipient, network, status, created_at, expires_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?
       WHERE (SELECT COUNT(*) FROM ton_pending_orders WHERE account_id = ? AND status = 'pending' AND expires_at > ?) < ?
       ON CONFLICT DO NOTHING`,
    )
      .bind(
        order.orderId,
        order.memo,
        order.accountId,
        order.loginId,
        order.planId,
        order.asset,
        order.amountNano,
        order.recipient,
        order.network,
        order.createdAt,
        order.createdAt + TON_PENDING_ORDER_TTL_MS,
        order.accountId,
        order.createdAt,
        maxOpen,
      )
      .run();
    return inserted.meta?.changes === 1 ? 'recorded' : 'too_many';
  } catch (err) {
    console.error(`[TonPendingOrders] Order ${order.orderId} could not be recorded: ${errorText(err)}`);
    return 'failed';
  }
}

/** Removes an order that was recorded and then could not be issued. */
export async function deleteTonPendingOrder(env: TonPendingOrdersEnv, orderId: string): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`DELETE FROM ton_pending_orders WHERE order_id = ? AND status = 'pending'`).bind(orderId).run();
  } catch (err) {
    console.error(`[TonPendingOrders] Order ${orderId} was not issued and its row could not be removed: ${errorText(err)}`);
  }
}

export async function readTonPendingOrder(env: TonPendingOrdersEnv, orderId: string): Promise<TonPendingOrderRow | null> {
  const id = String(orderId || '').trim();
  if (!env.DB || !id) return null;
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM ton_pending_orders WHERE order_id = ?`).bind(id).first<TonPendingOrderRow>();
  return row ?? null;
}

/** Best effort: the claim in ton_credited_tx is the record of the credit; this only stops re-checks. */
export async function markTonPendingOrderCredited(env: TonPendingOrdersEnv, orderId: string): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`UPDATE ton_pending_orders SET status = 'credited' WHERE order_id = ? AND status = 'pending'`).bind(orderId).run();
  } catch (err) {
    console.error(`[TonPendingOrders] Order ${orderId} was credited and could not be marked so; the sweep will mark it: ${errorText(err)}`);
  }
}

export type TonOpenOrdersByWallet = { recipient: string; oldest: number; open: number };

/** For each wallet: how many unpaid orders are inside their 48 hours and old enough to check, and the oldest. */
export async function summarizeOpenTonPendingOrders(
  env: TonPendingOrdersEnv,
  opts: { now: number; minAgeMs: number },
): Promise<TonOpenOrdersByWallet[]> {
  if (!env.DB) return [];
  const found = await env.DB.prepare(
    `SELECT recipient, MIN(created_at) AS oldest, COUNT(*) AS open FROM ton_pending_orders
     WHERE status = 'pending' AND expires_at > ? AND created_at < ?
     GROUP BY recipient`,
  )
    .bind(opts.now, opts.now - opts.minAgeMs)
    .all<TonOpenOrdersByWallet>();
  return (found.results ?? []).map((r) => ({ recipient: r.recipient, oldest: Number(r.oldest), open: Number(r.open) }));
}

/** D1 allows 100 bound values per statement. */
const MEMO_CHUNK = 80;

/**
 * The open orders, for one wallet, whose memo is among `memos`. The sweep passes the memos it saw
 * on transfers to that wallet, so only orders somebody may have paid are read, however many
 * unpaid ones are open.
 */
export async function findOpenTonPendingOrdersByMemo(
  env: TonPendingOrdersEnv,
  opts: { recipient: string; memos: string[]; now: number; minAgeMs: number },
): Promise<TonPendingOrderRow[]> {
  if (!env.DB) return [];
  const memos = [...new Set(opts.memos)];
  const rows: TonPendingOrderRow[] = [];
  for (let i = 0; i < memos.length; i += MEMO_CHUNK) {
    const chunk = memos.slice(i, i + MEMO_CHUNK);
    const found = await env.DB.prepare(
      `SELECT ${COLUMNS} FROM ton_pending_orders
       WHERE status = 'pending' AND recipient = ? AND expires_at > ? AND created_at < ? AND memo IN (${chunk.map(() => '?').join(', ')})
       ORDER BY created_at`,
    )
      .bind(opts.recipient, opts.now, opts.now - opts.minAgeMs, ...chunk)
      .all<TonPendingOrderRow>();
    rows.push(...(found.results ?? []));
  }
  return rows;
}

/**
 * Brings the rows in step with what has run out and what the ledger says:
 * - an order with a settled claim in ton_credited_tx is credited, whether or not its row was marked
 *   at the time (a claim younger than TON_CLAIM_SETTLED_MS is left alone: its verifier may still fail);
 * - an unpaid order past its 48 hours becomes 'expired' and can no longer be credited;
 * - a row 30 days past its 48 hours is removed.
 */
export async function closeExpiredTonPendingOrders(
  env: TonPendingOrdersEnv,
  now: number,
): Promise<{ reconciled: number; expired: number; deleted: number }> {
  if (!env.DB) return { reconciled: 0, expired: 0, deleted: 0 };
  const reconciled = await env.DB.prepare(
    `UPDATE ton_pending_orders SET status = 'credited'
     WHERE status = 'pending' AND order_id IN (SELECT order_id FROM ton_credited_tx WHERE credited_at < ?)`,
  )
    .bind(now - TON_CLAIM_SETTLED_MS)
    .run();
  const expired = await env.DB.prepare(`UPDATE ton_pending_orders SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`).bind(now).run();
  const deleted = await env.DB.prepare(`DELETE FROM ton_pending_orders WHERE expires_at <= ?`).bind(now - TON_PENDING_ORDER_SUPPORT_MS).run();
  return {
    reconciled: Number(reconciled.meta?.changes ?? 0),
    expired: Number(expired.meta?.changes ?? 0),
    deleted: Number(deleted.meta?.changes ?? 0),
  };
}
