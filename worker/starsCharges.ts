/**
 * Ledger for Telegram Stars charges (migrations/0023_stars_charges.sql).
 *
 * The row is the first thing written for a payment. Telegram does not send a paid update again
 * once the webhook has answered 200, so a charge has to be on record before anything that can
 * fail is tried. From then on the row, and the sweep that reads it, own the outcome: a charge
 * always ends credited or refunded.
 *
 *   received -> credited -> refund_due            (a manual refund)
 *   received -> refund_due -> refunded
 *                          \-> refund_failed -> refund_due   (5 attempts; an operator retries it)
 *
 * Every arrow is one conditional UPDATE that must change exactly one row. Whoever settles a
 * `received` or `refund_due` row first takes a lease and names it in each later statement, so the
 * webhook, a redelivery and the sweep can never decide one charge two ways.
 *
 * This file knows nothing about Telegram or plans. The caller passes hooks for "is the grant in
 * place", "drop the stale claim", "send the refund" and "raise an alert".
 */

export const STARS_CHARGES_MIGRATION = 'migrations/0023_stars_charges.sql';

/** Longer than any one handler can run, so a lease is never taken over while its holder still works. */
export const STARS_LEASE_MS = 5 * 60_000;
/** The sweep leaves a `received` row alone until the webhook that wrote it has had time to finish. */
export const STARS_RECEIVED_GRACE_MS = 10 * 60_000;
/** The sweep leaves a `refund_due` row alone until the inline refund attempt has had time to finish. */
export const STARS_REFUND_GRACE_MS = 2 * 60_000;
export const STARS_MAX_REFUND_ATTEMPTS = 5;
/** How far back the daily comparison with Telegram's own transaction list looks. */
export const STARS_RECONCILE_WINDOW_MS = 72 * 60 * 60_000;

export type StarsChargesEnv = { DB?: D1Database };

export type StarsChargeStatus = 'received' | 'credited' | 'refund_due' | 'refunded' | 'refund_failed';
export type StarsChargePurpose = 'plan' | 'job' | 'unknown';

export type StarsChargeRow = {
  charge_id: string;
  payer_tg_id: number;
  account_id: string | null;
  purpose: StarsChargePurpose;
  ref_id: string;
  stars: number;
  status: StarsChargeStatus;
  refund_reason: string | null;
  attempts: number;
  /** 1 once the Stars are known to be back with the payer. */
  stars_returned: number;
  lease_until: number | null;
  created_at: number;
  updated_at: number;
};

const COLUMNS =
  'charge_id, payer_tg_id, account_id, purpose, ref_id, stars, status, refund_reason, attempts, stars_returned, lease_until, created_at, updated_at';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function changedOne(result: { meta?: { changes?: number } }): boolean {
  return result.meta?.changes === 1;
}

/** Probe used at Stars pre-checkout so nobody pays while a charge could not be put on record. */
export async function isStarsChargesReady(env: StarsChargesEnv): Promise<boolean> {
  if (!env.DB) {
    console.error(`[StarsCharges] D1 binding DB is not configured. Refusing Stars checkout. Bind DB and apply ${STARS_CHARGES_MIGRATION}.`);
    return false;
  }
  try {
    await env.DB.prepare(`SELECT 1 AS ready FROM stars_charges LIMIT 1`).first();
    return true;
  } catch (err) {
    console.error(`[StarsCharges] stars_charges cannot be read. Refusing Stars checkout. Apply ${STARS_CHARGES_MIGRATION}: ${errorText(err)}`);
    return false;
  }
}

export async function readStarsCharge(env: StarsChargesEnv, chargeId: string): Promise<StarsChargeRow | null> {
  const id = String(chargeId || '').trim();
  if (!env.DB || !id) return null;
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM stars_charges WHERE charge_id = ?`).bind(id).first<StarsChargeRow>();
  return row ?? null;
}

export type RecordStarsChargeInput = {
  chargeId: string;
  payerTgId: number;
  accountId: string | null;
  purpose: StarsChargePurpose;
  refId: string;
  stars: number;
  /** `refund_due` for a payment nobody can grant; `refunded` for an older charge already sent back. */
  status?: 'received' | 'refund_due' | 'refunded';
  refundReason?: string | null;
  /** The Stars are already back with the payer (a refund sent outside the ledger). */
  starsReturned?: boolean;
  now?: number;
};

export type RecordStarsChargeResult =
  | { ok: true; row: StarsChargeRow; created: boolean }
  /** `retryable` is true when the database did not take the write and trying again could work. */
  | { ok: false; retryable: boolean; error: string };

/**
 * Step 1: put the charge on record. An existing row is left as it is and returned, so a redelivered
 * update sees what was decided before. The caller answers 5xx only when this reports `retryable`.
 */
export async function recordStarsCharge(env: StarsChargesEnv, input: RecordStarsChargeInput): Promise<RecordStarsChargeResult> {
  const db = env.DB;
  if (!db) {
    console.error(`[StarsCharges] recordStarsCharge: D1 binding DB is not configured. Charge ${input.chargeId} is not on record.`);
    return { ok: false, retryable: true, error: 'D1 binding DB is not configured' };
  }
  const now = input.now ?? Date.now();
  try {
    const inserted = await db.prepare(
      `INSERT INTO stars_charges (charge_id, payer_tg_id, account_id, purpose, ref_id, stars, status, refund_reason, stars_returned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(charge_id) DO NOTHING`,
    )
      .bind(
        input.chargeId,
        input.payerTgId,
        input.accountId ?? null,
        input.purpose,
        input.refId,
        input.stars,
        input.status ?? 'received',
        input.refundReason ?? null,
        input.starsReturned ? 1 : 0,
        now,
        now,
      )
      .run();
    const row = await readStarsCharge(env, input.chargeId);
    if (!row) return { ok: false, retryable: true, error: 'the charge row was not found after the insert' };
    return { ok: true, row, created: changedOne(inserted) };
  } catch (err) {
    const text = errorText(err);
    console.error(`[StarsCharges] recordStarsCharge failed for charge ${input.chargeId}: ${text}`);
    // A constraint can never pass on a second try; anything else is the database not answering.
    return { ok: false, retryable: !/constraint/i.test(text), error: text };
  }
}

/**
 * Step 3: take the charge. Returns the lease to name in every later statement, or null when the
 * row is not in `status` or someone else holds it.
 */
export async function leaseStarsCharge(
  env: StarsChargesEnv,
  chargeId: string,
  status: 'received' | 'refund_due',
  now: number = Date.now(),
): Promise<number | null> {
  if (!env.DB) return null;
  const lease = now + STARS_LEASE_MS;
  const result = await env.DB.prepare(
    `UPDATE stars_charges SET lease_until = ?, updated_at = ?
     WHERE charge_id = ? AND status = ? AND (lease_until IS NULL OR lease_until < ?)`,
  )
    .bind(lease, now, chargeId, status, now)
    .run();
  return changedOne(result) ? lease : null;
}

/** Hands a row back undecided, for the sweep to settle, when what is true could not be read. */
export async function releaseStarsLease(env: StarsChargesEnv, chargeId: string, lease: number, now: number = Date.now()): Promise<boolean> {
  if (!env.DB) return false;
  const result = await env.DB.prepare(
    `UPDATE stars_charges SET lease_until = NULL, updated_at = ? WHERE charge_id = ? AND lease_until = ?`,
  )
    .bind(now, chargeId, lease)
    .run();
  return changedOne(result);
}

export async function markStarsChargeCredited(env: StarsChargesEnv, chargeId: string, lease: number, now: number = Date.now()): Promise<boolean> {
  if (!env.DB) return false;
  const result = await env.DB.prepare(
    `UPDATE stars_charges SET status = 'credited', lease_until = NULL, updated_at = ?
     WHERE charge_id = ? AND status = 'received' AND lease_until = ?`,
  )
    .bind(now, chargeId, lease)
    .run();
  return changedOne(result);
}

export async function markStarsChargeRefundDue(
  env: StarsChargesEnv,
  chargeId: string,
  lease: number,
  reason: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!env.DB) return false;
  const result = await env.DB.prepare(
    `UPDATE stars_charges SET status = 'refund_due', refund_reason = ?, lease_until = NULL, updated_at = ?
     WHERE charge_id = ? AND status = 'received' AND lease_until = ?`,
  )
    .bind(reason.slice(0, 200), now, chargeId, lease)
    .run();
  return changedOne(result);
}

/** A manual refund of a charge that was credited, or an operator's retry of one that failed five times. */
export async function requestStarsRefund(env: StarsChargesEnv, chargeId: string, reason: string, now: number = Date.now()): Promise<boolean> {
  if (!env.DB) return false;
  const result = await env.DB.prepare(
    `UPDATE stars_charges SET status = 'refund_due', refund_reason = ?, attempts = 0, lease_until = NULL, updated_at = ?
     WHERE charge_id = ? AND status IN ('credited', 'refund_failed')`,
  )
    .bind(reason.slice(0, 200), now, chargeId)
    .run();
  return changedOne(result);
}

async function markStarsChargeRefunded(env: StarsChargesEnv, chargeId: string, lease: number, now: number): Promise<boolean> {
  if (!env.DB) return false;
  const result = await env.DB.prepare(
    `UPDATE stars_charges SET status = 'refunded', stars_returned = 1, lease_until = NULL, updated_at = ?
     WHERE charge_id = ? AND status = 'refund_due' AND lease_until = ?`,
  )
    .bind(now, chargeId, lease)
    .run();
  return changedOne(result);
}

/** One more failed refund. At the fifth the row stops being retried and becomes `refund_failed`. */
async function noteStarsRefundFailure(env: StarsChargesEnv, chargeId: string, lease: number, now: number): Promise<StarsChargeStatus | null> {
  if (!env.DB) return null;
  await env.DB.prepare(
    `UPDATE stars_charges SET attempts = attempts + 1,
       status = CASE WHEN attempts + 1 >= ? THEN 'refund_failed' ELSE 'refund_due' END,
       lease_until = NULL, updated_at = ?
     WHERE charge_id = ? AND status = 'refund_due' AND lease_until = ?`,
  )
    .bind(STARS_MAX_REFUND_ATTEMPTS, now, chargeId, lease)
    .run();
  return (await readStarsCharge(env, chargeId))?.status ?? null;
}

/** Records the fact that the Stars are back with the payer, whatever state the row is in. */
export async function markStarsReturned(env: StarsChargesEnv, chargeId: string, now: number = Date.now()): Promise<boolean> {
  if (!env.DB) return false;
  const result = await env.DB.prepare(`UPDATE stars_charges SET stars_returned = 1, updated_at = ? WHERE charge_id = ? AND stars_returned = 0`)
    .bind(now, chargeId)
    .run();
  return changedOne(result);
}

/**
 * Telegram itself says the Stars went back (a refunded_payment message, or a refund sent outside
 * this ledger). Whatever the row said before, the money is no longer here.
 */
export async function markStarsChargeRefundedAtTelegram(env: StarsChargesEnv, chargeId: string, now: number = Date.now()): Promise<boolean> {
  if (!env.DB) return false;
  const result = await env.DB.prepare(
    `UPDATE stars_charges SET status = 'refunded', stars_returned = 1, refund_reason = COALESCE(refund_reason, 'refunded_at_telegram'),
       lease_until = NULL, updated_at = ?
     WHERE charge_id = ? AND status <> 'refunded'`,
  )
    .bind(now, chargeId)
    .run();
  return changedOne(result);
}

export type StarsIncomingPayment = { chargeId: string; payerTgId: number; stars: number; paidAt: number };

export type StarsChargeHooks = {
  /** True when what this charge paid for is already in place. Throws when that cannot be read. */
  isGranted(row: StarsChargeRow): Promise<boolean>;
  /** Drops a claim with no grant behind it, so a refunded charge is not left marked credited. */
  releaseClaim(row: StarsChargeRow): Promise<void>;
  /**
   * Sends the Stars back to row.payer_tg_id and takes back what the charge gave. Telegram's
   * "already refunded" must come back as ok. `moneyReturned` with ok false means the Stars went
   * back and the grant is still in place, so the row stays open and is tried again.
   */
  refund(row: StarsChargeRow): Promise<{ ok: boolean; error?: string; moneyReturned?: boolean }>;
  /** Takes back what the charge gave, without touching Telegram. Used once the Stars are known to be back. */
  revoke(row: StarsChargeRow): Promise<{ ok: boolean; error?: string }>;
  alert(text: string, details?: Record<string, unknown>): Promise<void>;
  /** Called by the sweep after it settles a row, so the payer can be told. Must not throw. */
  onSwept?(row: StarsChargeRow, outcome: 'credited' | 'refunded'): Promise<void>;
  /** Telegram's own list of incoming Stars payments since `sinceMs`, for the daily comparison. Throws when it could not be read in full. */
  listIncoming?(sinceMs: number): Promise<StarsIncomingPayment[]>;
};

export type StarsRefundOutcome =
  /** `starsReturnedNow`: the Stars went back to the payer in this very attempt. */
  | { settled: true; row: StarsChargeRow; starsReturnedNow: boolean }
  | {
      settled: false;
      reason: 'busy' | 'refused';
      status: StarsChargeStatus | null;
      error?: string;
      /** The payer has their Stars; what is left is taking back what the charge gave. */
      moneyReturned?: boolean;
      starsReturnedNow: boolean;
      row?: StarsChargeRow;
    };

/**
 * Sends the refund for one `refund_due` row and records what happened. Used inline, straight after
 * a failed grant or a manual refund, and by the sweep for anything the inline attempt left behind.
 */
export async function settleStarsRefund(
  env: StarsChargesEnv,
  hooks: StarsChargeHooks,
  chargeId: string,
  now: number = Date.now(),
): Promise<StarsRefundOutcome> {
  const lease = await leaseStarsCharge(env, chargeId, 'refund_due', now);
  if (lease === null) return { settled: false, reason: 'busy', status: null, starsReturnedNow: false };
  const row = await readStarsCharge(env, chargeId);
  if (!row) return { settled: false, reason: 'busy', status: null, starsReturnedNow: false };

  // Once the Stars are known to be back, only the grant is left to take back. Telegram is not
  // asked again: its answer to a second refund is not something to build on.
  const alreadyBack = row.stars_returned === 1;
  let refund: { ok: boolean; error?: string; moneyReturned?: boolean };
  try {
    refund = alreadyBack ? await hooks.revoke(row) : await hooks.refund(row);
  } catch (err) {
    refund = { ok: false, error: errorText(err) };
  }
  const starsBack = alreadyBack || refund.ok || refund.moneyReturned === true;
  const starsReturnedNow = starsBack && !alreadyBack;

  if (refund.ok) {
    // The Stars are back with the payer and the grant is gone. If this write is lost the lease
    // expires, the sweep tries again, Telegram answers "already refunded", and the row closes then.
    try {
      await markStarsChargeRefunded(env, chargeId, lease, now);
    } catch (err) {
      console.error(`[StarsCharges] Charge ${chargeId} was refunded and could not be marked so; the sweep will close it: ${errorText(err)}`);
    }
    return { settled: true, row, starsReturnedNow };
  }

  let status: StarsChargeStatus | null = null;
  try {
    if (starsReturnedNow) await markStarsReturned(env, chargeId, now);
    status = await noteStarsRefundFailure(env, chargeId, lease, now);
  } catch (err) {
    console.error(`[StarsCharges] Could not record the failed refund of charge ${chargeId}: ${errorText(err)}`);
  }
  console.error(`[StarsCharges] Refund of charge ${chargeId} failed (${refund.error || 'no reason given'}); status is now ${status}.`);
  if (status === 'refund_failed') {
    await hooks.alert(
      starsBack
        ? `A Stars refund went through, and what the charge gave could not be taken back after ${STARS_MAX_REFUND_ATTEMPTS} attempts. The payer has their Stars and may still have the plan.`
        : `A Stars refund failed ${STARS_MAX_REFUND_ATTEMPTS} times and is no longer retried. The payer is still owed their Stars.`,
      { chargeId, payerTgId: row.payer_tg_id, stars: row.stars, lastError: refund.error || null },
    );
  }
  return { settled: false, reason: 'refused', status, error: refund.error, moneyReturned: starsBack, starsReturnedNow, row };
}

export type StarsSweepSummary = {
  examined: number;
  credited: number;
  refundDue: number;
  refunded: number;
  refundFailed: number;
  errors: number;
  /** Charges Telegram lists that this ledger has no record of. */
  unmatched: string[];
};

/**
 * Step 6. Settles what a webhook left undecided, by the same test the webhook uses, and retries
 * refunds that have not gone through. It never grants: a `received` row whose grant is not in
 * place is refunded.
 */
export async function sweepStarsCharges(
  env: StarsChargesEnv,
  hooks: StarsChargeHooks,
  options: { now?: number; limit?: number; reconcile?: boolean } = {},
): Promise<StarsSweepSummary> {
  const summary: StarsSweepSummary = { examined: 0, credited: 0, refundDue: 0, refunded: 0, refundFailed: 0, errors: 0, unmatched: [] };
  const db = env.DB;
  if (!db) {
    console.error('[StarsCharges] sweep skipped: D1 binding DB is not configured.');
    summary.errors += 1;
    return summary;
  }
  const now = options.now ?? Date.now();
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const refundNow: string[] = [];

  let stale: StarsChargeRow[] = [];
  try {
    const found = await db.prepare(
      `SELECT ${COLUMNS} FROM stars_charges
       WHERE status = 'received' AND created_at < ? AND (lease_until IS NULL OR lease_until < ?)
       ORDER BY created_at LIMIT ?`,
    )
      .bind(now - STARS_RECEIVED_GRACE_MS, now, limit)
      .all<StarsChargeRow>();
    stale = found.results ?? [];
  } catch (err) {
    summary.errors += 1;
    console.error(`[StarsCharges] sweep could not list received charges: ${errorText(err)}`);
  }

  for (const row of stale) {
    summary.examined += 1;
    try {
      const lease = await leaseStarsCharge(env, row.charge_id, 'received', now);
      if (lease === null) continue;
      let granted: boolean;
      try {
        // Stars that have already gone back are never credited, whatever is in place: the row goes
        // to refund_due and what the charge gave is taken back.
        granted = row.stars_returned === 1 ? false : await hooks.isGranted(row);
      } catch (err) {
        // What is true could not be read, so nothing is decided. The next sweep tries again.
        await releaseStarsLease(env, row.charge_id, lease, now);
        throw err;
      }
      if (granted) {
        if (await markStarsChargeCredited(env, row.charge_id, lease, now)) {
          summary.credited += 1;
          await hooks.onSwept?.(row, 'credited');
        }
        continue;
      }
      await hooks.releaseClaim(row);
      if (await markStarsChargeRefundDue(env, row.charge_id, lease, row.refund_reason || 'grant_not_found', now)) {
        summary.refundDue += 1;
        refundNow.push(row.charge_id);
      }
    } catch (err) {
      summary.errors += 1;
      console.error(`[StarsCharges] sweep could not settle charge ${row.charge_id}: ${errorText(err)}`);
    }
  }

  let due: string[] = [];
  try {
    const found = await db.prepare(
      `SELECT charge_id FROM stars_charges
       WHERE status = 'refund_due' AND updated_at < ? AND (lease_until IS NULL OR lease_until < ?)
       ORDER BY updated_at LIMIT ?`,
    )
      .bind(now - STARS_REFUND_GRACE_MS, now, limit)
      .all<{ charge_id: string }>();
    due = (found.results ?? []).map((r) => r.charge_id);
  } catch (err) {
    summary.errors += 1;
    console.error(`[StarsCharges] sweep could not list refunds that are due: ${errorText(err)}`);
  }

  // Rows this run has just moved to refund_due have no inline attempt in flight: refund them now.
  for (const chargeId of new Set([...refundNow, ...due])) {
    try {
      const outcome = await settleStarsRefund(env, hooks, chargeId, now);
      if (outcome.settled) summary.refunded += 1;
      else if (outcome.status === 'refund_failed') summary.refundFailed += 1;
      // The payer is told once: at the attempt in which their Stars actually went back.
      if (outcome.starsReturnedNow && outcome.row) await hooks.onSwept?.(outcome.row, 'refunded');
    } catch (err) {
      summary.errors += 1;
      console.error(`[StarsCharges] sweep could not refund charge ${chargeId}: ${errorText(err)}`);
    }
  }

  if (options.reconcile && hooks.listIncoming) {
    try {
      summary.unmatched = await findUnrecordedCharges(db, await hooks.listIncoming(now - STARS_RECONCILE_WINDOW_MS), now);
      if (summary.unmatched.length > 0) {
        await hooks.alert(
          `Telegram lists ${summary.unmatched.length} Stars payment(s) this ledger has no record of. Each one was paid and was neither credited nor refunded here.`,
          { chargeIds: summary.unmatched },
        );
      }
    } catch (err) {
      summary.errors += 1;
      console.error(`[StarsCharges] sweep could not compare with Telegram's transaction list: ${errorText(err)}`);
      // This comparison is the only thing that notices a payment the ledger never saw.
      await hooks.alert("Today's comparison with Telegram's list of Stars payments could not run. A payment this ledger never saw would not be noticed.", {
        error: errorText(err),
      });
    }
  }

  return summary;
}

/** D1 allows 100 bound values per statement. */
const IN_LIST_CHUNK = 90;

/**
 * Charges Telegram has that neither this table nor the older claim table knows. Payments younger
 * than the webhook's grace period are left out: their update may still be on its way.
 */
async function findUnrecordedCharges(db: D1Database, incoming: StarsIncomingPayment[], now: number): Promise<string[]> {
  const candidates = [
    ...new Set(
      incoming
        .filter((p) => p.chargeId && p.paidAt < now - STARS_RECEIVED_GRACE_MS && p.paidAt > now - STARS_RECONCILE_WINDOW_MS)
        .map((p) => p.chargeId),
    ),
  ];
  const known = new Set<string>();
  for (let i = 0; i < candidates.length; i += IN_LIST_CHUNK) {
    const chunk = candidates.slice(i, i + IN_LIST_CHUNK);
    const marks = chunk.map(() => '?').join(', ');
    for (const table of ['stars_charges', 'stars_credited_charges'] as const) {
      const found = await db.prepare(`SELECT charge_id FROM ${table} WHERE charge_id IN (${marks})`).bind(...chunk).all<{ charge_id: string }>();
      for (const r of found.results ?? []) known.add(r.charge_id);
    }
  }
  return candidates.filter((id) => !known.has(id));
}
