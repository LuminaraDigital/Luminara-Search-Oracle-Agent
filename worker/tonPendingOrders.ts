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
/** One account cannot hold more open orders than this, so unpaid ones cannot crowd the table. */
export const TON_MAX_OPEN_ORDERS_PER_ACCOUNT = 10;

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

/** True only when the row is in the table. The invoice is refused otherwise. */
export async function recordTonPendingOrder(env: TonPendingOrdersEnv, order: NewTonPendingOrder): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const inserted = await env.DB.prepare(
      `INSERT INTO ton_pending_orders (order_id, memo, account_id, login_id, plan_id, asset, amount_nano, recipient, network, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
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
      )
      .run();
    return inserted.meta?.changes === 1;
  } catch (err) {
    console.error(`[TonPendingOrders] Order ${order.orderId} could not be recorded: ${errorText(err)}`);
    return false;
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
    console.error(`[TonPendingOrders] Order ${orderId} was credited and could not be marked so; the sweep will find it credited: ${errorText(err)}`);
  }
}

/** Unpaid orders still inside their 48 hours, oldest first, that have had `minAgeMs` to be paid. */
export async function listOpenTonPendingOrders(
  env: TonPendingOrdersEnv,
  opts: { now: number; minAgeMs: number; limit: number },
): Promise<TonPendingOrderRow[]> {
  if (!env.DB) return [];
  const found = await env.DB.prepare(
    `SELECT ${COLUMNS} FROM ton_pending_orders
     WHERE status = 'pending' AND expires_at > ? AND created_at < ?
     ORDER BY created_at LIMIT ?`,
  )
    .bind(opts.now, opts.now - opts.minAgeMs, opts.limit)
    .all<TonPendingOrderRow>();
  return found.results ?? [];
}

/** How many orders this account has open (unpaid and inside their 48 hours). */
export async function countOpenTonPendingOrders(env: TonPendingOrdersEnv, accountId: string, now: number): Promise<number> {
  if (!env.DB) return 0;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ton_pending_orders WHERE account_id = ? AND status = 'pending' AND expires_at > ?`,
  )
    .bind(accountId, now)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/**
 * Closes what has run out: an unpaid order past its 48 hours becomes 'expired' and can no longer
 * be credited, and a row 30 days past its 48 hours is removed.
 */
export async function closeExpiredTonPendingOrders(env: TonPendingOrdersEnv, now: number): Promise<{ expired: number; deleted: number }> {
  if (!env.DB) return { expired: 0, deleted: 0 };
  const expired = await env.DB.prepare(`UPDATE ton_pending_orders SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`).bind(now).run();
  const deleted = await env.DB.prepare(`DELETE FROM ton_pending_orders WHERE expires_at <= ?`).bind(now - TON_PENDING_ORDER_SUPPORT_MS).run();
  return { expired: Number(expired.meta?.changes ?? 0), deleted: Number(deleted.meta?.changes ?? 0) };
}
