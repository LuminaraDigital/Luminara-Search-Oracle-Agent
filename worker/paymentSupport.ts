/**
 * Payment support requests (migrations/0026_payment_support.sql).
 *
 * `/paysupport` opens a 10-minute window: an `awaiting` row. The buyer's next message inside it
 * becomes the request, in one conditional update, and the bot forwards it to the admins. For 10
 * minutes after that, a few more messages are added to the same request. When an admin answers,
 * the buyer's next message goes back to the same request, so a reply to a person is never
 * answered by a model.
 *
 *   awaiting -> open -> answered -> open (the buyer wrote back) -> ...
 *                    \-> closed
 *
 * `expires_at` is the end of whichever window the row is in: for `awaiting`, the 10 minutes
 * after /paysupport; for `open`, the time in which more messages are added; for `answered`,
 * the time in which the buyer's next message returns to the request.
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
/** After an admin's answer, the buyer's next message inside this time goes back to the request. */
export const SUPPORT_REPLY_WINDOW_MS = 72 * 60 * 60_000;
/** The column's own limit. A longer message is cut, and the admins read that it was. */
export const SUPPORT_MESSAGE_MAX = 2000;
/** Unanswered requests one Telegram account can have at a time. */
export const SUPPORT_MAX_OPEN_PER_PAYER = 5;
/** Messages added to a request, and forwarded, before an admin answers it. Bounds what one buyer can send the admins. */
export const SUPPORT_MAX_FOLLOW_UPS = 5;
/** The daily sweep reminds the admins of requests that have waited longer than this. */
export const SUPPORT_REMIND_AFTER_MS = 24 * 60 * 60_000;
/** An answered or closed request is removed this long after it was last touched. */
export const SUPPORT_RETENTION_MS = 365 * 24 * 60 * 60_000;

export type PaymentSupportEnv = { DB?: D1Database };

export type SupportStatus = 'awaiting' | 'open' | 'answered' | 'closed';

export type SupportRequestRow = {
  id: string;
  payer_tg_id: number;
  account_id: string | null;
  charge_id: string | null;
  message: string | null;
  status: SupportStatus;
  /** Messages added since the request was opened or last answered. */
  follow_ups: number;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
};

const COLUMNS = 'id, payer_tg_id, account_id, charge_id, message, status, follow_ups, expires_at, created_at, updated_at';

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
        `INSERT INTO payment_support_requests (id, payer_tg_id, account_id, charge_id, message, status, follow_ups, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, 'awaiting', 0, ?, ?, ?)`,
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
  /**
   * `opened`: the message became the request. `added`: it was added to a request opened minutes
   * ago. `reopened`: it came after an admin's answer and put the request back in the queue.
   */
  | { kind: 'opened' | 'added' | 'reopened'; row: SupportRequestRow; cut: boolean }
  /** The request already holds SUPPORT_MAX_FOLLOW_UPS further messages. This one was not stored. */
  | { kind: 'full'; row: SupportRequestRow };

/**
 * Hands one message from a payer to a request, if one is waiting for it. Each change is one
 * conditional update that must change exactly one row, so two messages arriving together
 * cannot both become "the first".
 *
 * `replyTo` is the id of a request whose answer the buyer replied to with Telegram's own reply.
 * It is looked up together with the payer, so naming somebody else's request finds nothing, and
 * it needs no window: the buyer pointed at the answer.
 */
export async function takeSupportMessage(
  env: PaymentSupportEnv,
  payerTgId: number,
  text: string,
  now: number = Date.now(),
  opts: { replyTo?: string } = {},
): Promise<TakeMessageResult> {
  if (!env.DB) return { kind: 'none' };
  const clipped = clipSupportMessage(text);
  if (!clipped.text) return { kind: 'none' };
  try {
    // Twice: the row found may be taken by another message, or removed by the sweep, before the update.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let found: SupportRequestRow | null = null;
      let pointedAt = false;
      if (opts.replyTo) {
        found = await env.DB.prepare(
          `SELECT ${COLUMNS} FROM payment_support_requests WHERE id = ? AND payer_tg_id = ? AND status IN ('open','answered')`,
        )
          .bind(opts.replyTo, payerTgId)
          .first<SupportRequestRow>();
        pointedAt = Boolean(found);
      }
      if (!found) {
        found = await env.DB.prepare(
          `SELECT ${COLUMNS} FROM payment_support_requests
           WHERE payer_tg_id = ? AND status IN ('awaiting','open','answered') AND expires_at > ?
           ORDER BY updated_at DESC, id DESC LIMIT 1`,
        )
          .bind(payerTgId, now)
          .first<SupportRequestRow>();
      }
      if (!found) return { kind: 'none' };
      // A request the buyer pointed at needs no window; any other row has to be inside its own.
      const inWindow = pointedAt ? '' : ' AND expires_at > ?';
      const windowBind = pointedAt ? [] : [now];

      if (found.status === 'awaiting') {
        const opened = await env.DB.prepare(
          `UPDATE payment_support_requests SET message = ?, status = 'open', follow_ups = 0, expires_at = ?, updated_at = ?
           WHERE id = ? AND status = 'awaiting' AND expires_at > ?`,
        )
          .bind(clipped.text, now + SUPPORT_WINDOW_MS, now, found.id, now)
          .run();
        if (Number(opened.meta?.changes ?? 0) === 1) {
          return {
            kind: 'opened',
            cut: clipped.cut,
            row: { ...found, message: clipped.text, status: 'open', follow_ups: 0, expires_at: now + SUPPORT_WINDOW_MS, updated_at: now },
          };
        }
        continue;
      }

      const whole = `${found.message ?? ''}\n${clipped.text}`;
      const stored = whole.slice(0, SUPPORT_MESSAGE_MAX);
      const cut = clipped.cut || whole.length > SUPPORT_MESSAGE_MAX;

      if (found.status === 'open') {
        if (found.follow_ups >= SUPPORT_MAX_FOLLOW_UPS) return { kind: 'full', row: found };
        const added = await env.DB.prepare(
          `UPDATE payment_support_requests
           SET message = substr(message || char(10) || ?, 1, ${SUPPORT_MESSAGE_MAX}), follow_ups = follow_ups + 1, updated_at = ?
           WHERE id = ? AND status = 'open' AND follow_ups < ?${inWindow}`,
        )
          .bind(clipped.text, now, found.id, SUPPORT_MAX_FOLLOW_UPS, ...windowBind)
          .run();
        if (Number(added.meta?.changes ?? 0) === 1) {
          return { kind: 'added', cut, row: { ...found, message: stored, follow_ups: found.follow_ups + 1, updated_at: now } };
        }
        continue;
      }

      // Answered: the buyer wrote back. The request returns to the queue, and its window closes
      // with this message, so what the buyer sends after it is ordinary chat again.
      const reopened = await env.DB.prepare(
        `UPDATE payment_support_requests
         SET message = substr(message || char(10) || ?, 1, ${SUPPORT_MESSAGE_MAX}), status = 'open', follow_ups = follow_ups + 1, expires_at = ?, updated_at = ?
         WHERE id = ? AND status = 'answered'${inWindow}`,
      )
        .bind(clipped.text, now, now, found.id, ...windowBind)
        .run();
      if (Number(reopened.meta?.changes ?? 0) === 1) {
        // The buyer is about to read that what they send next goes to the assistant. Another
        // answered request with a live window would take it instead, so those windows end here.
        // Each can still be reached with Telegram's reply, or with /paysupport.
        await env.DB.prepare(
          `UPDATE payment_support_requests SET expires_at = ? WHERE payer_tg_id = ? AND status = 'answered' AND id != ? AND expires_at > ?`,
        )
          .bind(now, payerTgId, found.id, now)
          .run()
          .catch((err) => console.error(`[Support] Could not end the other reply windows of a payer: ${errorText(err)}`));
        return {
          kind: 'reopened',
          cut,
          row: { ...found, message: stored, status: 'open', follow_ups: found.follow_ups + 1, expires_at: now, updated_at: now },
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

/**
 * After an admin's answer has reached the buyer. A request can be answered more than once. The
 * buyer's next message inside SUPPORT_REPLY_WINDOW_MS returns to this request.
 */
export async function markSupportAnswered(env: PaymentSupportEnv, id: string, now: number = Date.now()): Promise<boolean> {
  if (!env.DB) return false;
  const res = await env.DB.prepare(
    `UPDATE payment_support_requests SET status = 'answered', follow_ups = 0, expires_at = ?, updated_at = ?
     WHERE id = ? AND status IN ('open','answered')`,
  )
    .bind(now + SUPPORT_REPLY_WINDOW_MS, now, id)
    .run();
  return Number(res.meta?.changes ?? 0) === 1;
}

/** Closes a request without messaging the buyer. Nothing the buyer sends later returns to it. */
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
  /** Answered and closed requests past their retention, removed. */
  purged: number;
  /** Requests nobody has answered, and how many of them have waited longer than a day. */
  open: number;
  overdue: number;
};

/**
 * Removes windows that ran out unused and finished requests past their retention, and counts
 * what is waiting for an answer. A request nobody has answered is never removed here.
 */
export async function sweepSupportRequests(env: PaymentSupportEnv, now: number = Date.now()): Promise<SupportSweepSummary> {
  const summary: SupportSweepSummary = { deleted: 0, purged: 0, open: 0, overdue: 0 };
  if (!env.DB) return summary;
  const deleted = await env.DB.prepare(`DELETE FROM payment_support_requests WHERE status = 'awaiting' AND expires_at <= ?`).bind(now).run();
  summary.deleted = Number(deleted.meta?.changes ?? 0);
  const purged = await env.DB.prepare(`DELETE FROM payment_support_requests WHERE status IN ('answered','closed') AND updated_at < ?`)
    .bind(now - SUPPORT_RETENTION_MS)
    .run();
  summary.purged = Number(purged.meta?.changes ?? 0);
  const counted = await env.DB.prepare(
    `SELECT COUNT(*) AS open, COALESCE(SUM(CASE WHEN updated_at < ? THEN 1 ELSE 0 END), 0) AS overdue
     FROM payment_support_requests WHERE status = 'open'`,
  )
    .bind(now - SUPPORT_REMIND_AFTER_MS)
    .first<{ open: number; overdue: number }>();
  summary.open = Number(counted?.open ?? 0);
  summary.overdue = Number(counted?.overdue ?? 0);
  return summary;
}
