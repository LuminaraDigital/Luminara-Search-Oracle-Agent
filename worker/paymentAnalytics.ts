/**
 * Server-written `payment_completed` event for the free-to-paid metric.
 *
 * The browser can never emit this event: worker/productAnalytics.ts leaves it off its allow-list,
 * so a forged or buggy client cannot inflate the payer count. The only writer is
 * writeSubscriptionRecord, which runs after each rail's idempotent claim (Stripe session, Stars
 * charge, TON order, license key).
 *
 * `rail` is the record's paymentMethod. Cohort queries that count paid accounts should exclude
 * `license_key`, which covers comp and invoice grants as well as purchases.
 */
import type { UserStoreEnv } from './userStore';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable per-payment key. Hashed because license order ids embed the key itself. */
async function paymentEventId(record: Record<string, unknown>): Promise<string> {
  const ref = [record.orderId, record.chargeId, record.sessionId].find((v): v is string => typeof v === 'string' && v !== '');
  if (!ref) return crypto.randomUUID();
  return `pay_${(await sha256Hex(ref)).slice(0, 32)}`;
}

/**
 * Best effort and idempotent (same payment reference, same row). Never throws: analytics must not
 * undo or delay a grant that has already been written.
 */
export async function recordPaymentCompleted(
  env: Pick<UserStoreEnv, 'DB'>,
  accountId: string,
  record: Record<string, unknown>,
): Promise<void> {
  if (!env.DB) return;
  try {
    const payload = {
      plan: typeof record.plan === 'string' ? record.plan : null,
      rail: typeof record.paymentMethod === 'string' ? record.paymentMethod : null,
    };
    await env.DB.prepare(
      `INSERT OR IGNORE INTO product_analytics_events
        (id, account_id, session_id, event_type, path, payload_json, created_at)
       VALUES (?, ?, NULL, 'payment_completed', NULL, ?, ?)`,
    )
      .bind(await paymentEventId(record), accountId, JSON.stringify(payload), Date.now())
      .run();
  } catch (err) {
    console.error(`[PaymentAnalytics] payment_completed not recorded: ${err instanceof Error ? err.message : err}`);
  }
}
