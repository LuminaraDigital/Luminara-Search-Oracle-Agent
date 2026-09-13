/**
 * Atomic D1 claims for money paths: license redemption, TON transaction credit, Telegram Stars charge.
 * Claim before granting entitlement. Every helper fails closed when DB is unbound or migration 0004
 * is missing; callers must never fall back to KV-only checks for granting.
 */

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
  const txHash = String(input.txHash || '').trim();
  const orderId = String(input.orderId || '').trim();
  if (!txHash || !orderId) {
    console.error('[PaymentLedger] claimTonTransaction called without a tx hash or order id. Refusing to grant.');
    return UNAVAILABLE;
  }

  try {
    const inserted = await db.prepare(
      `INSERT INTO ton_credited_tx (tx_hash, order_id, account_id, credited_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
      .bind(txHash, orderId, input.accountId ?? null, input.now ?? Date.now())
      .run();
    if (inserted.meta?.changes === 1) return { ok: true };

    const existing = await db.prepare(
      `SELECT tx_hash, order_id FROM ton_credited_tx WHERE tx_hash = ? OR order_id = ?`,
    )
      .bind(txHash, orderId)
      .all<{ tx_hash: string; order_id: string }>();
    const rows = existing.results || [];
    if (rows.some((row) => row.tx_hash === txHash && row.order_id !== orderId)) {
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
    await env.DB.prepare(`DELETE FROM ton_credited_tx WHERE tx_hash = ? AND order_id = ?`).bind(txHash, orderId).run();
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
