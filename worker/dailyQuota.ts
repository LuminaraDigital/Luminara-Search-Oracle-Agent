import type { Env } from './env';

/** Shown when the meter cannot be reached. Callers fail closed with 503 HOSTED_CAPACITY. */
export const QUOTA_CAPACITY_ERROR = "We're at capacity right now, please try again shortly.";

export const METER_DDL = `CREATE TABLE IF NOT EXISTS meter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  used INTEGER NOT NULL DEFAULT 0,
  refunds INTEGER NOT NULL DEFAULT 0
)`;

export const WINDOW_DDL = `CREATE TABLE IF NOT EXISTS window_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL
)`;

const SPEND_SQL = `INSERT INTO meter (id, used, refunds) VALUES (1, 1, 0)
ON CONFLICT(id) DO UPDATE SET used = used + 1 WHERE used < ?
RETURNING used`;

const REFUND_SQL = `UPDATE meter SET used = used - 1, refunds = refunds + 1
WHERE id = 1 AND used > 0 AND refunds < ?
RETURNING used, refunds`;

const READ_SQL = `SELECT used, refunds FROM meter WHERE id = 1`;

export interface SlidingWindowOutcome {
  ok: boolean;
  count: number;
  oldest: number;
}

export interface MeterRow {
  used: number;
  refunds: number;
}

/** One synchronous statement. Durable Object requests only interleave at an await. */
export interface SqlRunner {
  exec(query: string, ...bindings: number[]): MeterRow[];
}

function cell(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return 0;
}

export function rowsOf(raw: Iterable<unknown>): MeterRow[] {
  const out: MeterRow[] = [];
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue;
    out.push({
      used: cell('used' in row ? row.used : 0),
      refunds: cell('refunds' in row ? row.refunds : 0),
    });
  }
  return out;
}

export function spendMeter(sql: SqlRunner, limit: number): { ok: boolean; used: number } {
  if (!(limit > 0)) return { ok: true, used: 0 };
  const taken = sql.exec(SPEND_SQL, limit);
  if (taken.length > 0) return { ok: true, used: taken[0].used };
  const cur = sql.exec(READ_SQL);
  return { ok: false, used: cur[0]?.used ?? 0 };
}

export function refundMeter(sql: SqlRunner, limit: number): { refunded: boolean; capped: boolean; used: number } {
  const taken = sql.exec(REFUND_SQL, limit);
  if (taken.length > 0) return { refunded: true, capped: false, used: taken[0].used };
  const cur = sql.exec(READ_SQL);
  const refunds = cur[0]?.refunds ?? 0;
  return { refunded: false, capped: limit > 0 && refunds >= limit, used: cur[0]?.used ?? 0 };
}

export function readMeter(sql: SqlRunner): { used: number } {
  const cur = sql.exec(READ_SQL);
  return { used: cur[0]?.used ?? 0 };
}

function runnerFrom(sql: SqlStorage): SqlRunner {
  return {
    exec(query, ...bindings) {
      return rowsOf(sql.exec(query, ...bindings));
    },
  };
}

/**
 * Single writer for one account's free checks on one UTC day.
 * idFromName is `${accountId}:${YYYY-MM-DD}`.
 */
export class DailyQuota {
  private readonly rawSql: SqlStorage;
  private readonly sql: SqlRunner;

  constructor(state: DurableObjectState) {
    this.rawSql = state.storage.sql;
    this.sql = runnerFrom(state.storage.sql);
    void state.blockConcurrencyWhile(async () => {
      state.storage.sql.exec(METER_DDL);
      state.storage.sql.exec(WINDOW_DDL);
    });
  }

  private handleWindow(limit: number, windowMs: number, record: boolean): SlidingWindowOutcome {
    const now = Date.now();
    const cutoff = now - Math.max(1000, windowMs);
    this.rawSql.exec('DELETE FROM window_hits WHERE ts <= ?', cutoff);
    const stats = [...this.rawSql.exec('SELECT COUNT(*) AS cnt, COALESCE(MIN(ts), 0) AS oldest FROM window_hits')][0] as
      | { cnt?: unknown; oldest?: unknown }
      | undefined;
    const count = cell(stats?.cnt ?? 0);
    const oldest = cell(stats?.oldest ?? 0);
    if (limit > 0 && count >= limit) {
      return { ok: false, count, oldest: oldest || now };
    }
    if (record) {
      this.rawSql.exec('INSERT INTO window_hits (ts) VALUES (?)', now);
      return { ok: true, count: count + 1, oldest: oldest || now };
    }
    return { ok: true, count, oldest: oldest || now };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parsed = Number(url.searchParams.get('limit') || '0');
    const limit = Number.isFinite(parsed) ? parsed : 0;
    if (url.pathname === '/spend') return Response.json(spendMeter(this.sql, limit));
    if (url.pathname === '/refund') return Response.json(refundMeter(this.sql, limit));
    if (url.pathname === '/read') return Response.json(readMeter(this.sql));
    if (url.pathname === '/window') {
      const parsedWin = Number(url.searchParams.get('windowMs') || '60000');
      const windowMs = Number.isFinite(parsedWin) && parsedWin > 0 ? parsedWin : 60_000;
      const record = url.searchParams.get('record') !== '0';
      return Response.json(this.handleWindow(limit, windowMs, record));
    }
    if (url.pathname === '/window-clear') {
      this.rawSql.exec('DELETE FROM window_hits');
      return Response.json({ cleared: true });
    }
    return new Response('not found', { status: 404 });
  }
}

export function meterName(quotaKeyId: string, now = new Date()): string {
  return `${quotaKeyId}:${now.toISOString().slice(0, 10)}`;
}

export async function invokeDailyQuota(
  env: Env,
  name: string,
  op: 'spend' | 'refund' | 'read',
  limit: number,
): Promise<unknown | null> {
  const ns = env.DAILY_QUOTA;
  if (!ns) return null;
  try {
    const res = await ns.get(ns.idFromName(name)).fetch(`https://daily-quota.internal/${op}?limit=${limit}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function invokeSlidingWindow(
  env: Env,
  name: string,
  opts: { limit: number; windowMs: number; record?: boolean },
): Promise<SlidingWindowOutcome | null> {
  const ns = env.DAILY_QUOTA;
  if (!ns) return null;
  try {
    const rec = opts.record === false ? '0' : '1';
    const url = `https://daily-quota.internal/window?limit=${Math.max(0, Math.floor(opts.limit))}&windowMs=${Math.max(1000, Math.floor(opts.windowMs))}&record=${rec}`;
    const res = await ns.get(ns.idFromName(name)).fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<SlidingWindowOutcome>;
    if (typeof data.ok !== 'boolean' || typeof data.count !== 'number') return null;
    return { ok: data.ok, count: data.count, oldest: typeof data.oldest === 'number' ? data.oldest : Date.now() };
  } catch {
    return null;
  }
}

export async function clearSlidingWindow(env: Env, name: string): Promise<boolean> {
  const ns = env.DAILY_QUOTA;
  if (!ns) return false;
  try {
    const res = await ns.get(ns.idFromName(name)).fetch('https://daily-quota.internal/window-clear');
    return res.ok;
  } catch {
    return false;
  }
}
