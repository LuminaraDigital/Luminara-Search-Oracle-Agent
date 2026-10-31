/**
 * Lumen ledger. A purchase on Stripe, Stars, or TON mints one grant.
 * A metered audit, Oracle turn, or paid MCP call spends 1 when the balance covers it.
 * A short balance does not fail the job: the plan allowance still decides access.
 * Stake pools and a TON receipt mirror are off. There is no chain call here.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from './env';
import { LUMEN_PUBLIC_NOTE } from '../services/lumen/lumenCopy';

export { LUMEN_PUBLIC_NOTE };

export const LUMEN_JOB_COST = 1;

/** Stake pools stay off until an owner turns this on in a later change. */
export const LUMEN_ROUTES_ENABLED = false;

/** Same number as the Stars price of that plan, on every rail. Not a market rate. */
const GRANTS: Record<string, number> = {
  single_audit: 25,
  multi_agent_crawl: 75,
  starter: 2500,
  growth: 7500,
  agency: 18000,
};

const SOURCES = ['stripe', 'stars', 'ton', 'audit', 'agent', 'mcp'] as const;
export type LumenSource = (typeof SOURCES)[number];

type ApplyInput = {
  accountId: string;
  source: LumenSource;
  amount: number;
  idempotencyKey: string;
  refId?: string | null;
  now?: number;
};

type CleanInput = {
  accountId: string;
  source: LumenSource;
  amount: number;
  idempotencyKey: string;
  refId: string | null;
  now: number;
};

export type LumenApplyResult =
  | { applied: true; balance: number }
  | { applied: false; reason: 'duplicate' | 'short' | 'invalid' | 'unavailable'; balance: number };

export type LumenEntryView = {
  id: string;
  movement: 'add' | 'spend';
  amount: number;
  source: LumenSource;
  label: string;
  createdAt: number;
};

export type LumenAccountView = {
  balance: number;
  routesEnabled: false;
  tonMirror: false;
  note: string;
  entries: LumenEntryView[];
};

export function lumenGrantFor(planId: string): number {
  return GRANTS[planId] ?? 0;
}

function isSource(value: string): value is LumenSource {
  return (SOURCES as readonly string[]).includes(value);
}

function clean(input: ApplyInput): CleanInput | null {
  const accountId = input.accountId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const amount = Math.floor(input.amount);
  if (!accountId || accountId.length > 128) return null;
  if (!idempotencyKey || idempotencyKey.length > 180) return null;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000) return null;
  if (!isSource(input.source)) return null;
  const ref = typeof input.refId === 'string' ? input.refId.trim().slice(0, 180) : '';
  return {
    accountId,
    source: input.source,
    amount,
    idempotencyKey,
    refId: ref || null,
    now: input.now ?? Date.now(),
  };
}

async function balanceOf(db: D1Database, accountId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT balance FROM lumen_balances WHERE account_id = ?`)
    .bind(accountId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

async function applyMint(db: D1Database, input: CleanInput): Promise<LumenApplyResult> {
  const id = crypto.randomUUID();
  const inserted = await db.batch([
    db.prepare(
      `INSERT INTO lumen_entries (id, account_id, direction, amount, source, idempotency_key, ref_id, created_at)
       SELECT ?, ?, 'mint', ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM lumen_entries WHERE idempotency_key = ?)`,
    ).bind(id, input.accountId, input.amount, input.source, input.idempotencyKey, input.refId, input.now, input.idempotencyKey),
    db.prepare(
      `INSERT INTO lumen_balances (account_id, balance, updated_at)
       SELECT ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM lumen_entries WHERE id = ?)
       ON CONFLICT(account_id) DO UPDATE SET
         balance = lumen_balances.balance + excluded.balance,
         updated_at = excluded.updated_at`,
    ).bind(input.accountId, input.amount, input.now, id),
  ]);
  const applied = Number(inserted[1]?.meta?.changes ?? 0) > 0;
  const balance = await balanceOf(db, input.accountId);
  if (applied) return { applied: true, balance };
  const prior = await db
    .prepare(`SELECT 1 AS hit FROM lumen_entries WHERE idempotency_key = ?`)
    .bind(input.idempotencyKey)
    .first();
  return { applied: false, reason: prior ? 'duplicate' : 'unavailable', balance };
}

async function applyBurn(db: D1Database, input: CleanInput): Promise<LumenApplyResult> {
  const id = crypto.randomUUID();
  const burned = await db.batch([
    db.prepare(
      `INSERT INTO lumen_entries (id, account_id, direction, amount, source, idempotency_key, ref_id, created_at)
       SELECT ?, ?, 'burn', ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM lumen_balances WHERE account_id = ? AND balance >= ?)
         AND NOT EXISTS (SELECT 1 FROM lumen_entries WHERE idempotency_key = ?)`,
    ).bind(
      id,
      input.accountId,
      input.amount,
      input.source,
      input.idempotencyKey,
      input.refId,
      input.now,
      input.accountId,
      input.amount,
      input.idempotencyKey,
    ),
    db.prepare(
      `UPDATE lumen_balances SET balance = balance - ?, updated_at = ?
       WHERE account_id = ? AND EXISTS (SELECT 1 FROM lumen_entries WHERE id = ?)`,
    ).bind(input.amount, input.now, input.accountId, id),
  ]);
  const balance = await balanceOf(db, input.accountId);
  if (Number(burned[1]?.meta?.changes ?? 0) === 1) return { applied: true, balance };
  const prior = await db
    .prepare(`SELECT 1 AS hit FROM lumen_entries WHERE idempotency_key = ?`)
    .bind(input.idempotencyKey)
    .first();
  return { applied: false, reason: prior ? 'duplicate' : 'short', balance };
}

async function applyEntry(env: Env, direction: 'mint' | 'burn', input: ApplyInput): Promise<LumenApplyResult> {
  const ready = clean(input);
  if (!ready) return { applied: false, reason: 'invalid', balance: 0 };
  const db = env.DB;
  if (!db) return { applied: false, reason: 'unavailable', balance: 0 };
  try {
    return direction === 'mint' ? await applyMint(db, ready) : await applyBurn(db, ready);
  } catch (err) {
    console.error(`[Lumen] ${direction} failed: ${err instanceof Error ? err.message : String(err)}`);
    return { applied: false, reason: 'unavailable', balance: 0 };
  }
}

export function mintLumen(env: Env, input: ApplyInput): Promise<LumenApplyResult> {
  return applyEntry(env, 'mint', input);
}

/** Spends LUMEN_JOB_COST. A short balance returns applied: false and does not go negative. */
export function spendLumen(
  env: Env,
  input: Omit<ApplyInput, 'amount'> & { amount?: number },
): Promise<LumenApplyResult> {
  return applyEntry(env, 'burn', { ...input, amount: input.amount ?? LUMEN_JOB_COST });
}

/**
 * Takes back an unspent purchase grant. If some of it was already used, only the remainder
 * comes off. A second call is a no-op.
 */
export async function clawbackLumen(
  env: Env,
  input: { accountId: string; mintKey: string; voidKey: string; now?: number },
): Promise<LumenApplyResult> {
  const db = env.DB;
  if (!db) return { applied: false, reason: 'unavailable', balance: 0 };
  try {
    const mint = await db
      .prepare(`SELECT amount, source FROM lumen_entries WHERE idempotency_key = ? AND direction = 'mint'`)
      .bind(input.mintKey)
      .first<{ amount: number; source: string }>();
    if (!mint || !isSource(mint.source)) {
      return { applied: false, reason: 'short', balance: await balanceOf(db, input.accountId).catch(() => 0) };
    }
    const prior = await db
      .prepare(`SELECT 1 AS hit FROM lumen_entries WHERE idempotency_key = ?`)
      .bind(input.voidKey)
      .first();
    if (prior) {
      return { applied: false, reason: 'duplicate', balance: await balanceOf(db, input.accountId) };
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const balance = await balanceOf(db, input.accountId);
      const amount = Math.min(balance, Number(mint.amount));
      if (amount <= 0) {
        await db.prepare(
          `INSERT INTO lumen_entries (id, account_id, direction, amount, source, idempotency_key, ref_id, created_at)
           SELECT ?, ?, 'void', 0, ?, ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM lumen_entries WHERE idempotency_key = ?)`,
        )
          .bind(crypto.randomUUID(), input.accountId, mint.source, input.voidKey, input.mintKey, input.now ?? Date.now(), input.voidKey)
          .run();
        return { applied: false, reason: 'short', balance };
      }
      const result = await applyBurn(db, {
        accountId: input.accountId,
        source: mint.source,
        amount,
        idempotencyKey: input.voidKey,
        refId: input.mintKey,
        now: input.now ?? Date.now(),
      });
      if (result.applied || result.reason === 'duplicate') return result;
    }
    return { applied: false, reason: 'short', balance: await balanceOf(db, input.accountId) };
  } catch (err) {
    console.error(`[Lumen] clawback failed: ${err instanceof Error ? err.message : String(err)}`);
    return { applied: false, reason: 'unavailable', balance: 0 };
  }
}

export function lumenEntryLabel(entry: {
  direction: string;
  amount: number;
  source: string;
  idempotencyKey: string;
}): string {
  const n = entry.amount;
  if (entry.direction === 'void') return 'Refund recorded. Nothing left to reverse.';
  if (entry.direction === 'mint' && entry.source === 'audit') return `Returned ${n} from an unfinished audit`;
  if (entry.direction === 'mint') return `Added ${n} from a purchase`;
  if (entry.idempotencyKey.startsWith('void:')) return `Reversed ${n} from a refund`;
  if (entry.source === 'audit') return `Used ${n} on an audit`;
  if (entry.source === 'agent') return `Used ${n} on Oracle`;
  if (entry.source === 'mcp') return `Used ${n} on a paid MCP call`;
  return `Used ${n}`;
}

export async function readLumenAccount(env: Env, accountId: string): Promise<LumenAccountView> {
  const empty: LumenAccountView = {
    balance: 0,
    routesEnabled: LUMEN_ROUTES_ENABLED,
    tonMirror: false,
    note: LUMEN_PUBLIC_NOTE,
    entries: [],
  };
  if (!env.DB || !accountId.trim()) return empty;
  try {
    const balance = await balanceOf(env.DB, accountId);
    const rows = await env.DB.prepare(
      `SELECT id, direction, amount, source, idempotency_key, created_at
       FROM lumen_entries WHERE account_id = ? ORDER BY created_at DESC LIMIT 8`,
    )
      .bind(accountId)
      .all<{
        id: string;
        direction: string;
        amount: number;
        source: string;
        idempotency_key: string;
        created_at: number;
      }>();
    const entries: LumenEntryView[] = [];
    for (const row of rows.results ?? []) {
      if (!isSource(row.source) || row.direction === 'void') continue;
      entries.push({
        id: row.id,
        movement: row.direction === 'mint' ? 'add' : 'spend',
        amount: Number(row.amount),
        source: row.source,
        label: lumenEntryLabel({
          direction: row.direction,
          amount: Number(row.amount),
          source: row.source,
          idempotencyKey: row.idempotency_key,
        }),
        createdAt: Number(row.created_at),
      });
    }
    return { ...empty, balance, entries };
  } catch (err) {
    if (!/no such table/i.test(err instanceof Error ? err.message : String(err))) {
      console.error(`[Lumen] read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return empty;
  }
}
