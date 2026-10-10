/**
 * Payment support requests (migrations/0026_payment_support.sql).
 *
 * `/paysupport` opens a 10-minute window: an `awaiting` row. The buyer's next message inside it
 * becomes the request, in one conditional update, and the bot forwards it to the admins. For 10
 * minutes after that, further messages from the buyer are added to the same request.
 *
 *   awaiting -> open -> answered
 *                    \-> closed
 *
 * What a buyer writes here is stored and shown to a person. It is never sent to a model and
 * never read into a prompt: the bot hands a message to this file before the chat sees it, and
 * when this file cannot tell whether a window is open it says so instead of guessing.
 *
 * This file knows nothing about Telegram. worker/telegramBot.ts does the talking.
 */

export const PAYMENT_SUPPORT_MIGRATION = 'migrations/0026_payment_support.sql';

/** How long after /paysupport the next message counts, and how long after it more can be added. */
export const SUPPORT_WINDOW_MS = 10 * 60_000;
/** The column's own limit. A longer message is cut, and the admins read that it was. */
export const SUPPORT_MESSAGE_MAX = 2000;
/** Unanswered requests one Telegram account can have at a time. */
export const SUPPORT_MAX_OPEN_PER_PAYER = 5;
/** The daily sweep reminds the admins of requests that have waited longer than this. */
export const SUPPORT_REMIND_AFTER_MS = 24 * 60 * 60_000;

export type PaymentSupportEnv = { DB?: D1Database };

export type SupportStatus = 'awaiting' | 'open' | 'answered' | 'closed';

export type SupportRequestRow = {
  id: string;
  payer_tg_id: number;
  account_id: string | null;
  charge_id: string | null;
  message: string | null;
  status: SupportStatus;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
};

const COLUMNS = 'id, payer_tg_id, account_id, charge_id, message, status, expires_at, created_at, updated_at';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A database from before the migration. The feature is simply not there yet. */
function isMissingTable(err: unknown): boolean {
  return /no such table/i.test(errorText(err));
}

function newRequestId(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return `ps_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** What is stored of a message: trimmed, and cut to the column's limit. */
export function clipSupportMessage(text: string): { text: string; cut: boolean } {
  const trimmed = String(text ?? '').trim();
  return trimmed.length > SUPPORT_MESSAGE_MAX
    ? { text: trimmed.slice(0, SUPPORT_MESSAGE_MAX), cut: true }
    : { text: trimmed, cut: false };
}

export type OpenWindowResult = { ok: true; id: string } | { ok: false; reason: 'unavailable' | 'too_many' };

/**
 * Opens the window: one `awaiting` row for this payer, replacing any earlier one that was never
 * used. Refused when the payer already has SUPPORT_MAX_OPEN_PER_PAYER requests nobody answered.
 */
export async function openSupportWindow(
  env: PaymentSupportEnv,
  input: { payerTgId: number; accountId: string | null; chargeId: string | null },
  now: number = Date.now(),
): Promise<OpenWindowResult> {
  if (!env.DB) return { ok: false, reason: 'unavailable' };
  try {
    const waiting = await env.DB.prepare(`SELECT COUNT(*) AS n FROM payment_support_requests WHERE payer_tg_id = ? AND status = 'open'`)
      .bind(input.payerTgId)
      .first<{ n: number }>();
    if (Number(waiting?.n ?? 0) >= SUPPORT_MAX_OPEN_PER_PAYER) return { ok: false, reason: 'too_many' };

    const id = newRequestId();
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM payment_support_requests WHERE payer_tg_id = ? AND status = 'awaiting'`).bind(input.payerTgId),
      env.DB.prepare(
        `INSERT INTO payment_support_requests (id, payer_tg_id, account_id, charge_id, message, status, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, 'awaiting', ?, ?, ?)`,
      ).bind(id, input.payerTgId, input.accountId, input.chargeId, now + SUPPORT_WINDOW_MS, now, now),
    ]);
    return { ok: true, id };
  } catch (err) {
    if (!isMissingTable(err)) console.error(`[Support] Could not open a support window: ${errorText(err)}`);
    return { ok: false, reason: 'unavailable' };
  }
}

export type TakeMessageResult =
  /** No window is open for this payer: the message is not a support message. */
  | { kind: 'none' }
  /** It could not be told whether a window is open. The caller must not hand the message to the chat. */
  | { kind: 'unavailable' }
  /** `opened`: the message became the request. `added`: it was added to a request opened minutes ago. */
  | { kind: 'opened' | 'added'; row: SupportRequestRow; cut: boolean };

/**
 * Hands one message from a payer to an open window, if there is one. Each change is one
 * conditional update that must change exactly one row, so two messages arriving together
 * cannot both become "the first".
 */
export async function takeSupportMessage(
  env: PaymentSupportEnv,
  payerTgId: number,
  text: string,
  now: number = Date.now(),
): Promise<TakeMessageResult> {
  if (!env.DB) return { kind: 'none' };
  const clipped = clipSupportMessage(text);
  if (!clipped.text) return { kind: 'none' };
  try {
    // Twice: the row found may be taken by another message, or removed by the sweep, before the update.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const found = await env.DB.prepare(
        `SELECT ${COLUMNS} FROM payment_support_requests
         WHERE payer_tg_id = ? AND status IN ('awaiting','open') AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(payerTgId, now)
        .first<SupportRequestRow>();
      if (!found) return { kind: 'none' };

      if (found.status === 'awaiting') {
        const opened = await env.DB.prepare(
          `UPDATE payment_support_requests SET message = ?, status = 'open', expires_at = ?, updated_at = ?
           WHERE id = ? AND status = 'awaiting' AND expires_at > ?`,
        )
          .bind(clipped.text, now + SUPPORT_WINDOW_MS, now, found.id, now)
          .run();
        if (Number(opened.meta?.changes ?? 0) === 1) {
          return {
            kind: 'opened',
            cut: clipped.cut,
            row: { ...found, message: clipped.text, status: 'open', expires_at: now + SUPPORT_WINDOW_MS, updated_at: now },
          };
        }
        continue;
      }

      const added = await env.DB.prepare(
        `UPDATE payment_support_requests SET message = substr(message || char(10) || ?, 1, ${SUPPORT_MESSAGE_MAX}), updated_at = ?
         WHERE id = ? AND status = 'open' AND expires_at > ?`,
      )
        .bind(clipped.text, now, found.id, now)
        .run();
      if (Number(added.meta?.changes ?? 0) === 1) {
        const whole = `${found.message ?? ''}\n${clipped.text}`;
        return {
          kind: 'added',
          cut: clipped.cut || whole.length > SUPPORT_MESSAGE_MAX,
          row: { ...found, message: whole.slice(0, SUPPORT_MESSAGE_MAX), updated_at: now },
        };
      }
    }
    return { kind: 'unavailable' };
  } catch (err) {
    if (isMissingTable(err)) return { kind: 'none' };
    console.error(`[Support] Could not check for an open support window: ${errorText(err)}`);
    return { kind: 'unavailable' };
  }
}

/** Throws when the database cannot be read, so a caller never mistakes an outage for "no such request". */
export async function readSupportRequest(env: PaymentSupportEnv, id: string): Promise<SupportRequestRow | null> {
  if (!env.DB) return null;
  return (await env.DB.prepare(`SELECT ${COLUMNS} FROM payment_support_requests WHERE id = ?`).bind(id).first<SupportRequestRow>()) ?? null;
}

/** After an admin's answer has reached the buyer. A request can be answered more than once. */
export async function markSupportAnswered(env: PaymentSupportEnv, id: string, now: number = Date.now()): Promise<boolean> {
  if (!env.DB) return false;
  const res = await env.DB.prepare(
    `UPDATE payment_support_requests SET status = 'answered', updated_at = ? WHERE id = ? AND status IN ('open','answered')`,
  )
    .bind(now, id)
    .run();
  return Number(res.meta?.changes ?? 0) === 1;
}

/** Closes a request without messaging the buyer. */
export async function closeSupportRequest(env: PaymentSupportEnv, id: string, now: number = Date.now()): Promise<boolean> {
  if (!env.DB) return false;
  const res = await env.DB.prepare(
    `UPDATE payment_support_requests SET status = 'closed', updated_at = ? WHERE id = ? AND status IN ('open','answered')`,
  )
    .bind(now, id)
    .run();
  return Number(res.meta?.changes ?? 0) === 1;
}

/** Requests in one state, oldest first. `awaiting` rows hold no message and are never listed. */
export async function listSupportRequests(
  env: PaymentSupportEnv,
  opts: { status?: Exclude<SupportStatus, 'awaiting'>; limit?: number } = {},
): Promise<SupportRequestRow[]> {
  if (!env.DB) return [];
  const status = opts.status ?? 'open';
  const limit = Math.min(200, Math.max(1, Math.floor(opts.limit ?? 50)));
  const found = await env.DB.prepare(`SELECT ${COLUMNS} FROM payment_support_requests WHERE status = ? ORDER BY created_at LIMIT ?`)
    .bind(status, limit)
    .all<SupportRequestRow>();
  return found.results ?? [];
}

/**
 * The payer's most recent Stars charge, for the admin who reads the request. `null` when there
 * is none or it cannot be read: a request is never held up for it.
 */
export async function latestStarsChargeId(env: PaymentSupportEnv, payerTgId: number): Promise<string | null> {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(`SELECT charge_id FROM stars_charges WHERE payer_tg_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(payerTgId)
      .first<{ charge_id: string }>();
    return row?.charge_id ?? null;
  } catch {
    return null;
  }
}

export type SupportSweepSummary = {
  /** Windows nobody wrote into, removed. */
  deleted: number;
  /** Requests nobody has answered, and how many of them have waited longer than a day. */
  open: number;
  overdue: number;
};

/** Removes windows that ran out unused, and counts what is waiting for an answer. */
export async function sweepSupportRequests(env: PaymentSupportEnv, now: number = Date.now()): Promise<SupportSweepSummary> {
  const summary: SupportSweepSummary = { deleted: 0, open: 0, overdue: 0 };
  if (!env.DB) return summary;
  const deleted = await env.DB.prepare(`DELETE FROM payment_support_requests WHERE status = 'awaiting' AND expires_at <= ?`).bind(now).run();
  summary.deleted = Number(deleted.meta?.changes ?? 0);
  const counted = await env.DB.prepare(
    `SELECT COUNT(*) AS open, COALESCE(SUM(CASE WHEN created_at < ? THEN 1 ELSE 0 END), 0) AS overdue
     FROM payment_support_requests WHERE status = 'open'`,
  )
    .bind(now - SUPPORT_REMIND_AFTER_MS)
    .first<{ open: number; overdue: number }>();
  summary.open = Number(counted?.open ?? 0);
  summary.overdue = Number(counted?.overdue ?? 0);
  return summary;
}
