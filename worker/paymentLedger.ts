/**
 * Atomic D1 claims for money paths: license redemption, TON transaction credit, Telegram Stars charge.
 * Claim before granting entitlement. Every helper fails closed when DB is unbound or migration 0004
 * is missing; callers must never fall back to KV-only checks for granting.
 */
import { normalizeTonTxHash, tonTxHashAliases } from './chainNetwork';

export const LEDGER_MIGRATION = 'migrations/0004_payment_atomicity.sql';

export type LedgerEnv = { DB?: D1Database };

type Unavailable = { ok: false; reason: 'unavailable' };
const UNAVAILABLE: Unavailable = { ok: false, reason: 'unavailable' };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isMissingTable(err: unknown): boolean {
  return /no such table/i.test(errorText(err));
}

function isConstraintViolation(err: unknown): boolean {
  return /constraint/i.test(errorText(err));
}

function reportLedgerFault(operation: string, err?: unknown): void {
  if (err === undefined) {
    console.error(
      `[PaymentLedger] ${operation}: D1 binding DB is not configured. Refusing to grant. Bind DB and apply ${LEDGER_MIGRATION}.`,
    );
  } else if (isMissingTable(err)) {
    console.error(
      `[PaymentLedger] ${operation}: payment ledger tables are missing. Refusing to grant. Apply ${LEDGER_MIGRATION} (wrangler d1 migrations apply).`,
    );
  } else {
    console.error(`[PaymentLedger] ${operation} failed. Refusing to grant: ${errorText(err)}`);
  }
}

// ---------------------------------------------------------------------------
// License keys
// ---------------------------------------------------------------------------

export type LicenseClaimInput = {
  key: string;
  accountId: string;
  maxRedemptions: number;
  /** Redemptions already recorded in KV before the ledger existed; seeds the counter on first claim. */
  priorRedemptions: number;
  isTrial: boolean;
  now?: number;
};

export type LicenseClaimResult =
  | { ok: true; redemptionCount: number; maxRedemptions: number }
  | { ok: false; reason: 'exhausted' | 'account_already_redeemed' | 'trial_already_claimed' | 'unavailable' };

export async function claimLicenseRedemption(env: LedgerEnv, input: LicenseClaimInput): Promise<LicenseClaimResult> {
  const db = env.DB;
  if (!db) {
    reportLedgerFault('claimLicenseRedemption');
    return UNAVAILABLE;
  }

  const now = input.now ?? Date.now();
  const max = Math.max(1, Math.floor(Number(input.maxRedemptions)) || 1);
  const prior = Math.min(max, Math.max(0, Math.floor(Number(input.priorRedemptions)) || 0));

  // D1 batches run as one transaction: any constraint failure rolls back every step of the claim.
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO license_key_claims (license_key, claim_count, max_claims, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(license_key) DO NOTHING`,
    ).bind(input.key, prior, max, now),
    db.prepare(
      `UPDATE license_key_claims SET claim_count = claim_count + 1, updated_at = ? WHERE license_key = ?`,
    ).bind(now, input.key),
    db.prepare(
      `INSERT INTO license_redemptions (license_key, account_id, redeemed_at) VALUES (?, ?, ?)`,
    ).bind(input.key, input.accountId, now),
  ];
  if (input.isTrial) {
    statements.push(
      db.prepare(
        `INSERT INTO license_trial_claims (account_id, license_key, claimed_at) VALUES (?, ?, ?)`,
      ).bind(input.accountId, input.key, now),
    );
  }
  statements.push(
    db.prepare(`SELECT claim_count, max_claims FROM license_key_claims WHERE license_key = ?`).bind(input.key),
  );

  try {
    const results = await db.batch<{ claim_count: number; max_claims: number }>(statements);
    const row = results[results.length - 1]?.results?.[0];
    return {
      ok: true,
      redemptionCount: Number(row?.claim_count ?? prior + 1),
      maxRedemptions: Number(row?.max_claims ?? max),
    };
  } catch (err) {
    if (!isConstraintViolation(err)) {
      reportLedgerFault('claimLicenseRedemption', err);
      return UNAVAILABLE;
    }
    return { ok: false, reason: await diagnoseLicenseConflict(db, input) };
  }
}

async function diagnoseLicenseConflict(
  db: D1Database,
  input: LicenseClaimInput,
): Promise<'exhausted' | 'account_already_redeemed' | 'trial_already_claimed' | 'unavailable'> {
  try {
    if (input.isTrial) {
      const trial = await db.prepare(`SELECT 1 AS hit FROM license_trial_claims WHERE account_id = ?`)
        .bind(input.accountId)
        .first();
      if (trial) return 'trial_already_claimed';
    }
    const mine = await db.prepare(
      `SELECT 1 AS hit FROM license_redemptions WHERE license_key = ? AND account_id = ?`,
    )
      .bind(input.key, input.accountId)
      .first();
    return mine ? 'account_already_redeemed' : 'exhausted';
  } catch (err) {
    reportLedgerFault('claimLicenseRedemption (diagnose)', err);
    return 'unavailable';
  }
}

/** Best-effort undo of a successful claim when granting failed afterwards. */
export async function releaseLicenseRedemption(
  env: LedgerEnv,
  input: { key: string; accountId: string; isTrial: boolean },
): Promise<void> {
  const db = env.DB;
  if (!db) return;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE license_key_claims SET claim_count = claim_count - 1
       WHERE license_key = ? AND claim_count > 0
         AND EXISTS (SELECT 1 FROM license_redemptions WHERE license_key = ? AND account_id = ?)`,
    ).bind(input.key, input.key, input.accountId),
    db.prepare(`DELETE FROM license_redemptions WHERE license_key = ? AND account_id = ?`).bind(input.key, input.accountId),
  ];
  if (input.isTrial) {
    statements.push(
      db.prepare(`DELETE FROM license_trial_claims WHERE account_id = ? AND license_key = ?`).bind(input.accountId, input.key),
    );
  }
  try {
    await db.batch(statements);
  } catch (err) {
    console.error(`[PaymentLedger] releaseLicenseRedemption failed; the key stays consumed until an operator clears it: ${errorText(err)}`);
  }
}

// ---------------------------------------------------------------------------
// TON transactions
// ---------------------------------------------------------------------------

export type TonCreditClaimResult =
  | { ok: true }
  | { ok: false; reason: 'tx_credited_to_other_order' | 'order_already_credited' | 'unavailable' };

async function isLedgerTableReady(env: LedgerEnv, table: 'ton_credited_tx' | 'stars_credited_charges', operation: string): Promise<boolean> {
  if (!env.DB) {
    reportLedgerFault(operation);
    return false;
  }
  try {
    await env.DB.prepare(`SELECT 1 AS ready FROM ${table} LIMIT 1`).first();
    return true;
  } catch (err) {
    reportLedgerFault(operation, err);
    return false;
  }
}

/** Probe used before issuing an invoice so nobody pays while crediting is impossible. */
export function isTonLedgerReady(env: LedgerEnv): Promise<boolean> {
  return isLedgerTableReady(env, 'ton_credited_tx', 'isTonLedgerReady');
}

/** Probe used at Stars pre-checkout so nobody pays while crediting is impossible. */
export function isStarsLedgerReady(env: LedgerEnv): Promise<boolean> {
  return isLedgerTableReady(env, 'stars_credited_charges', 'isStarsLedgerReady');
}

export async function claimTonTransaction(
  env: LedgerEnv,
  input: { txHash: string; orderId: string; accountId?: string; now?: number },
): Promise<TonCreditClaimResult> {
  const db = env.DB;
  if (!db) {
    reportLedgerFault('claimTonTransaction');
    return UNAVAILABLE;
  }
  const txHash = normalizeTonTxHash(input.txHash);
  const orderId = String(input.orderId || '').trim();
  if (!txHash || !orderId) {
    console.error('[PaymentLedger] claimTonTransaction called without a tx hash or order id. Refusing to grant.');
    return UNAVAILABLE;
  }

  // Rows credited before hashes were normalised hold the provider's encoding (Toncenter base64,
  // TonAPI hex). The insert is skipped, in the same statement, when any encoding of this hash is
  // already claimed, so one transaction cannot be credited again under a second spelling.
  const aliases = tonTxHashAliases(txHash);
  const aliasMarks = aliases.map(() => '?').join(', ');

  try {
    const inserted = await db.prepare(
      `INSERT INTO ton_credited_tx (tx_hash, order_id, account_id, credited_at)
       SELECT ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM ton_credited_tx WHERE tx_hash IN (${aliasMarks}))
       ON CONFLICT DO NOTHING`,
    )
      .bind(txHash, orderId, input.accountId ?? null, input.now ?? Date.now(), ...aliases)
      .run();
    if (inserted.meta?.changes === 1) return { ok: true };

    const existing = await db.prepare(
      `SELECT tx_hash, order_id FROM ton_credited_tx WHERE tx_hash IN (${aliasMarks}) OR order_id = ?`,
    )
      .bind(...aliases, orderId)
      .all<{ tx_hash: string; order_id: string }>();
    const rows = existing.results || [];
    if (rows.some((row) => aliases.includes(row.tx_hash) && row.order_id !== orderId)) {
      return { ok: false, reason: 'tx_credited_to_other_order' };
    }
    if (rows.some((row) => row.order_id === orderId)) {
      return { ok: false, reason: 'order_already_credited' };
    }
    reportLedgerFault('claimTonTransaction', new Error('insert changed no rows and no conflicting row was found'));
    return UNAVAILABLE;
  } catch (err) {
    reportLedgerFault('claimTonTransaction', err);
    return UNAVAILABLE;
  }
}

export async function releaseTonTransaction(env: LedgerEnv, txHash: string, orderId: string): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`DELETE FROM ton_credited_tx WHERE tx_hash = ? AND order_id = ?`).bind(normalizeTonTxHash(txHash), orderId).run();
  } catch (err) {
    console.error(`[PaymentLedger] releaseTonTransaction failed; order stays marked credited until an operator clears it: ${errorText(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Telegram Stars charges
// ---------------------------------------------------------------------------

export type StarsChargeClaimResult =
  | { ok: true }
  | { ok: false; reason: 'duplicate' | 'missing_charge_id' | 'unavailable' };

export async function claimStarsCharge(
  env: LedgerEnv,
  chargeId: string,
  accountId?: string,
): Promise<StarsChargeClaimResult> {
  const id = String(chargeId || '').trim();
  if (!id) {
    console.error('[PaymentLedger] claimStarsCharge called without telegram_payment_charge_id. Refusing to grant.');
    return { ok: false, reason: 'missing_charge_id' };
  }
  const db = env.DB;
  if (!db) {
    reportLedgerFault('claimStarsCharge');
    return UNAVAILABLE;
  }
  try {
    const inserted = await db.prepare(
      `INSERT INTO stars_credited_charges (charge_id, account_id, credited_at)
       VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
      .bind(id, accountId ?? null, Date.now())
      .run();
    return inserted.meta?.changes === 1 ? { ok: true } : { ok: false, reason: 'duplicate' };
  } catch (err) {
    reportLedgerFault('claimStarsCharge', err);
    return UNAVAILABLE;
  }
}

export async function releaseStarsCharge(env: LedgerEnv, chargeId: string): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`DELETE FROM stars_credited_charges WHERE charge_id = ?`).bind(String(chargeId || '').trim()).run();
  } catch (err) {
    console.error(`[PaymentLedger] releaseStarsCharge failed; charge stays marked credited until an operator clears it: ${errorText(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Stripe checkout sessions
// ---------------------------------------------------------------------------

export const STRIPE_LEDGER_MIGRATIONS = 'migrations/0021_stripe_payments.sql and migrations/0024_stripe_payment_intent.sql';

export type StripeReversalReason = 'refund' | 'dispute' | 'lower_plan_refused';

export type StripeSessionClaimInput = {
  sessionId: string;
  /** The id refund and dispute events carry. A session without one is never credited. */
  paymentIntent: string;
  customerId?: string | null;
  accountId?: string | null;
  /** Login id that paid. Reversal rewrites the subscription through it. */
  userId: string;
  planId: string;
  amountTotal: number;
  currency: string;
  /** Days this charge adds. 0 for a payment that is refused and sent back. */
  grantedDays: number;
  /** Plan expiry right after this grant: the end of the days this charge paid for. */
  grantedUntil?: number | null;
  /** Plan the account held before its current run of card purchases began, if any. */
  prevPlan?: string | null;
  /** Set when the row is born already reversed (a refused lower plan), so a later refund event removes nothing. */
  reversal?: StripeReversalReason | null;
  now?: number;
};

export type StripeSessionClaimResult =
  | { ok: true }
  | { ok: false; reason: 'duplicate' | 'missing_session_id' | 'missing_payment_intent' | 'unavailable' };

/**
 * Probe used before a checkout session is created so nobody pays while crediting is impossible.
 * It selects the columns of migration 0024, so a database that has 0021 but not 0024 is not ready.
 */
export async function isStripeLedgerReady(env: LedgerEnv): Promise<boolean> {
  if (!env.DB) {
    reportLedgerFault('isStripeLedgerReady');
    return false;
  }
  try {
    await env.DB.prepare(
      `SELECT session_id, payment_intent, user_id, granted_days, granted_until, prev_plan, reversed_at, reversal_reason
       FROM stripe_credited_sessions LIMIT 1`,
    ).first();
    return true;
  } catch (err) {
    console.error(
      `[PaymentLedger] isStripeLedgerReady: the Stripe ledger is not ready. Refusing to take card payments. Apply ${STRIPE_LEDGER_MIGRATIONS}: ${errorText(err)}`,
    );
    return false;
  }
}

export async function claimStripeSession(
  env: LedgerEnv,
  input: StripeSessionClaimInput,
): Promise<StripeSessionClaimResult> {
  const sessionId = String(input.sessionId || '').trim();
  if (!sessionId) {
    console.error('[PaymentLedger] claimStripeSession called without sessionId. Refusing to grant.');
    return { ok: false, reason: 'missing_session_id' };
  }
  const paymentIntent = String(input.paymentIntent || '').trim();
  if (!paymentIntent) {
    console.error('[PaymentLedger] claimStripeSession called without payment_intent. Refusing to grant.');
    return { ok: false, reason: 'missing_payment_intent' };
  }
  const db = env.DB;
  if (!db) {
    reportLedgerFault('claimStripeSession');
    return UNAVAILABLE;
  }
  const now = input.now ?? Date.now();
  try {
    // ON CONFLICT DO NOTHING covers both keys. A redelivered session is a duplicate, and so is a
    // session whose payment intent is already on a row: that is how a refund or dispute that
    // arrived first (claimStripeReversal's marker row) stops the late session from being credited.
    const inserted = await db.prepare(
      `INSERT INTO stripe_credited_sessions
         (session_id, customer_id, account_id, plan_id, amount_total, currency, credited_at,
          payment_intent, user_id, granted_days, granted_until, prev_plan, reversed_at, reversal_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
      .bind(
        sessionId,
        input.customerId ?? null,
        input.accountId ?? null,
        input.planId,
        input.amountTotal,
        input.currency,
        now,
        paymentIntent,
        input.userId,
        Math.max(0, Math.floor(Number(input.grantedDays)) || 0),
        input.grantedUntil ?? null,
        input.prevPlan ?? null,
        input.reversal ? now : null,
        input.reversal ?? null,
      )
      .run();
    return inserted.meta?.changes === 1 ? { ok: true } : { ok: false, reason: 'duplicate' };
  } catch (err) {
    reportLedgerFault('claimStripeSession', err);
    return UNAVAILABLE;
  }
}

export async function releaseStripeSession(env: LedgerEnv, sessionId: string): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`DELETE FROM stripe_credited_sessions WHERE session_id = ?`).bind(String(sessionId || '').trim()).run();
  } catch (err) {
    console.error(`[PaymentLedger] releaseStripeSession failed; session stays marked credited until an operator clears it: ${errorText(err)}`);
  }
}

export type StripeCreditedSession = {
  sessionId: string;
  userId: string | null;
  accountId: string | null;
  planId: string;
  grantedDays: number;
  grantedUntil: number | null;
  prevPlan: string | null;
};

export type StripeReversalClaimResult =
  | { ok: true; session: StripeCreditedSession }
  | { ok: false; reason: 'not_found' | 'already_reversed' | 'unavailable' };

type StripeSessionRow = {
  session_id: string;
  user_id: string | null;
  account_id: string | null;
  plan_id: string;
  granted_days: number | null;
  granted_until: number | null;
  prev_plan: string | null;
};

/**
 * Claims the one reversal a charge can have. A refund and a dispute for the same payment, or one
 * event delivered twice, remove the granted days once: only the first caller gets ok.
 *
 * Stripe does not promise event order. When the payment intent is not on the ledger yet, a marker
 * row is written for it, so a checkout.session.completed that is delivered later finds its
 * payment intent taken and credits nothing.
 */
export async function claimStripeReversal(
  env: LedgerEnv,
  input: { paymentIntent: string; reason: StripeReversalReason; now?: number },
): Promise<StripeReversalClaimResult> {
  const paymentIntent = String(input.paymentIntent || '').trim();
  if (!paymentIntent) return { ok: false, reason: 'not_found' };
  const db = env.DB;
  if (!db) {
    reportLedgerFault('claimStripeReversal');
    return UNAVAILABLE;
  }
  const now = input.now ?? Date.now();
  try {
    // Two passes: if a credit lands between the first look and the marker insert, the second
    // pass claims that row instead of losing the reversal.
    for (let pass = 0; pass < 2; pass++) {
      const row = await db.prepare(
        `UPDATE stripe_credited_sessions SET reversed_at = ?, reversal_reason = ?
         WHERE payment_intent = ? AND reversed_at IS NULL
         RETURNING session_id, user_id, account_id, plan_id, granted_days, granted_until, prev_plan`,
      )
        .bind(now, input.reason, paymentIntent)
        .first<StripeSessionRow>();
      if (row) {
        return {
          ok: true,
          session: {
            sessionId: row.session_id,
            userId: row.user_id,
            accountId: row.account_id,
            planId: row.plan_id,
            grantedDays: Number(row.granted_days) || 0,
            grantedUntil: row.granted_until === null ? null : Number(row.granted_until),
            prevPlan: row.prev_plan,
          },
        };
      }
      const known = await db.prepare(`SELECT 1 AS hit FROM stripe_credited_sessions WHERE payment_intent = ?`)
        .bind(paymentIntent)
        .first();
      if (known) return { ok: false, reason: 'already_reversed' };

      const marker = await db.prepare(
        `INSERT INTO stripe_credited_sessions
           (session_id, plan_id, amount_total, currency, credited_at, payment_intent, granted_days, reversed_at, reversal_reason)
         VALUES (?, 'none', 0, '', ?, ?, 0, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
        .bind(`reversed:${paymentIntent}`, now, paymentIntent, now, input.reason)
        .run();
      if (marker.meta?.changes === 1) return { ok: false, reason: 'not_found' };
    }
    reportLedgerFault('claimStripeReversal', new Error('the payment intent row kept changing between passes'));
    return UNAVAILABLE;
  } catch (err) {
    reportLedgerFault('claimStripeReversal', err);
    return UNAVAILABLE;
  }
}

/** Undo of a reversal claim when the subscription write failed afterwards, so the event can be retried. */
export async function releaseStripeReversal(env: LedgerEnv, sessionId: string): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `UPDATE stripe_credited_sessions SET reversed_at = NULL, reversal_reason = NULL WHERE session_id = ?`,
    )
      .bind(String(sessionId || '').trim())
      .run();
  } catch (err) {
    console.error(`[PaymentLedger] releaseStripeReversal failed; the charge stays marked reversed although its days were not removed: ${errorText(err)}`);
  }
}

/**
 * Plans of the account's other card charges that are still standing: not reversed, and with
 * paid days still ahead. A fault throws: the caller is deciding which plan a reversal leaves.
 */
export async function liveStripePlans(
  env: LedgerEnv,
  input: { userId: string; accountId: string; exceptSessionId: string; now?: number },
): Promise<string[]> {
  if (!env.DB) throw new Error('D1 binding DB is not configured');
  const rows = await env.DB.prepare(
    `SELECT plan_id FROM stripe_credited_sessions
     WHERE (user_id = ? OR account_id = ?) AND session_id != ?
       AND reversed_at IS NULL AND granted_days > 0 AND granted_until > ?`,
  )
    .bind(input.userId, input.accountId, input.exceptSessionId, input.now ?? Date.now())
    .all<{ plan_id: string }>();
  return (rows.results || []).map((row) => row.plan_id);
}
