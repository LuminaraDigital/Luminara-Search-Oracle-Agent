/**
 * Weekly email digest (spec 0031): the opt-in preference route and the daily cron job.
 * Off unless WEEKLY_EMAIL_DIGEST_ENABLED is "true". The email_digest_sends row is the idempotency
 * guard: one claim per user and local ISO week, taken before any data is read and only while
 * consent still holds. A 4xx from Resend deletes the claim so a later fire that week retries.
 * An unknown outcome (no answer, timeout, 5xx) never retries.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { pickPrimaryFinding } from '../services/audit/primaryFinding';
import { firebaseOwnsAccount } from './accountDeletion';
import { verifyFirebaseIdToken } from './firebaseAuth';
import type { HostedIdentity } from './userTypes';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import { json } from './workerUtils';
import {
  appOrigin,
  newUnsubToken,
  sendResendEmail,
  unsubscribeUrl,
  welcomeGreetingName,
  type WelcomeEnv,
} from './welcomeEmail';
import {
  checkReading,
  citationReading,
  digestKind,
  digestSchedule,
  digestTimeZone,
  isValidTimeZone,
  renderDigestEmail,
  type DigestInput,
  type DigestKind,
  type DigestMove,
} from './weeklyDigestContent';

export type DigestEnv = WelcomeEnv & {
  FIREBASE_PROJECT_ID?: string;
  WEEKLY_EMAIL_DIGEST_ENABLED?: string;
  WEEKLY_EMAIL_DIGEST_DAILY_LIMIT?: string;
};

const DAY_MS = 86_400_000;
const WINDOW_MS = 7 * DAY_MS;
/** Longer than Monday to Wednesday of one week, shorter than last Wednesday to this Monday. */
const CLAIM_LOOKBACK_MS = 4 * DAY_MS;
/** One user costs about 8 D1 queries and a fetch, and scheduled() shares a 1,000 query cap with other jobs. */
const DEFAULT_DAILY_LIMIT = 50;
const MAX_CANDIDATES = 2000;
const MAX_DOMAINS = 3;
/** Keeps one run under Resend's default rate limit. */
const SEND_GAP_MS = 600;
const SEND_TIMEOUT_MS = 10_000;

/**
 * Consent for users row `u`: opted in later than any global opt-out, and the account email is still
 * the verified address the user opted in with. The one place this rule lives.
 */
const CONSENTED = `u.weekly_digest_opt_in_at IS NOT NULL
  AND (u.email_opt_out_at IS NULL OR u.weekly_digest_opt_in_at > u.email_opt_out_at)
  AND u.email IS NOT NULL AND u.weekly_digest_email IS NOT NULL
  AND lower(trim(u.email)) = lower(trim(u.weekly_digest_email))`;

export function digestEnabled(env: DigestEnv): boolean {
  return env.WEEKLY_EMAIL_DIGEST_ENABLED === 'true';
}

function dailyLimit(env: DigestEnv): number {
  const parsed = Math.floor(Number(env.WEEKLY_EMAIL_DIGEST_DAILY_LIMIT));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_LIMIT;
}

async function preferenceView(db: D1Database, env: DigestEnv, userId: string) {
  const row = await db.prepare(
    `SELECT u.email, u.weekly_digest_tz, CASE WHEN ${CONSENTED} THEN 1 ELSE 0 END AS consented FROM users u WHERE u.id = ?`,
  ).bind(userId).first<{ email: string | null; weekly_digest_tz: string | null; consented: number }>();
  const email = row?.email?.trim() || null;
  return {
    ok: true,
    available: digestEnabled(env),
    email,
    weeklyDigest: row?.consented === 1,
    timeZone: row?.weekly_digest_tz ?? null,
  };
}

/** The account email, when a fresh Firebase ID token proves the caller owns it and has verified it. */
async function verifiedAccountEmail(env: DigestEnv, user: HostedIdentity, idToken: unknown): Promise<string | Response> {
  if (!env.FIREBASE_PROJECT_ID) {
    return json({ ok: false, error: 'The email check is not configured.', code: 'EMAIL_CHECK_UNAVAILABLE' }, 503);
  }
  const verified = typeof idToken === 'string' && idToken ? await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID) : null;
  if (!verified?.ok || !(await firebaseOwnsAccount(env, user, verified.user.uid))) {
    return json({ ok: false, error: 'Sign in again, then turn on the weekly email.', code: 'REAUTH_REQUIRED' }, 401);
  }
  if (!verified.user.email || !verified.user.emailVerified) {
    return json({ ok: false, error: 'Verify your email address, then turn on the weekly email.', code: 'EMAIL_UNVERIFIED' }, 409);
  }
  return verified.user.email;
}

/** GET and PUT /api/email/preferences for the signed-in caller. Turning the digest off works even while the flag is off. */
export async function handleEmailPreferences(request: Request, env: DigestEnv, user: HostedIdentity): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  if (request.method === 'GET') return json(await preferenceView(env.DB, env, user.id));
  if (request.method !== 'PUT') return json({ ok: false, error: 'Method not allowed' }, 405);
  const raw = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!raw.ok) return json({ ok: false, error: raw.error }, raw.status);
  const body = (raw.value || {}) as { weeklyDigest?: unknown; timeZone?: unknown; idToken?: unknown };
  if (typeof body.weeklyDigest !== 'boolean') {
    return json({ ok: false, error: 'Send weeklyDigest as true or false.' }, 400);
  }
  if (!body.weeklyDigest) {
    await env.DB.prepare(`UPDATE users SET weekly_digest_opt_in_at = NULL WHERE id = ?`).bind(user.id).run();
    return json(await preferenceView(env.DB, env, user.id));
  }
  if (!digestEnabled(env)) {
    return json({ ok: false, error: 'The weekly email is not available yet.', code: 'DIGEST_UNAVAILABLE' }, 404);
  }
  const email = await verifiedAccountEmail(env, user, body.idToken);
  if (email instanceof Response) return email;
  const timeZone = isValidTimeZone(body.timeZone) ? body.timeZone : null;
  const row = await env.DB.prepare(
    `UPDATE users
     SET weekly_digest_opt_in_at = ?, weekly_digest_email = email, weekly_digest_tz = ?,
         email_unsub_token = COALESCE(email_unsub_token, ?)
     WHERE id = ? AND email IS NOT NULL AND lower(trim(email)) = lower(trim(?))
     RETURNING id`,
  ).bind(Date.now(), timeZone, newUnsubToken(), user.id, email).first<{ id: string }>();
  if (!row) {
    return json({ ok: false, error: 'The weekly email goes to the address on your account. Sign in with that address, then turn it on.', code: 'EMAIL_MISMATCH' }, 409);
  }
  return json(await preferenceView(env.DB, env, user.id));
}

type Candidate = {
  id: string;
  email: string;
  display_name: string | null;
  account_id: string | null;
  email_unsub_token: string;
  weekly_digest_tz: string | null;
  last_kind: DigestKind | null;
};

type FindingRow = { domain: string; title: string; description: string; severity: string; status: string };
type AuditRow = { domain: string; excerpt: string | null };
type RunRow = { watch_id: string; measurement_status: string; cited_count: number | null; prompt_count: number | null };
type WatchRunRow = RunRow & { domain: string; engine: string };

/** Newest audit per domain inside the window, against the newest per domain at or before its start. Two queries. */
async function siteCheckMoves(db: D1Database, accountId: string, from: number, to: number): Promise<DigestMove[]> {
  const recent = await db.prepare(
    `SELECT domain, MAX(measured_at) AS latest, json_extract(entry_json, '$.reportExcerpt') AS excerpt
     FROM audit_history WHERE account_id = ? AND measured_at > ? AND measured_at <= ?
     GROUP BY domain ORDER BY latest DESC LIMIT ?`,
  ).bind(accountId, from, to, MAX_DOMAINS).all<AuditRow>();
  const rows = recent.results ?? [];
  if (!rows.length) return [];
  const earlier = await db.prepare(
    `SELECT domain, MAX(measured_at) AS latest, json_extract(entry_json, '$.reportExcerpt') AS excerpt
     FROM audit_history WHERE account_id = ? AND measured_at <= ? AND domain IN (${rows.map(() => '?').join(', ')})
     GROUP BY domain`,
  ).bind(accountId, from, ...rows.map((row) => row.domain)).all<AuditRow>();
  const before = new Map((earlier.results ?? []).map((row) => [row.domain, row]));
  return rows.map((row) => {
    const prior = before.get(row.domain);
    return {
      kind: 'site_checks' as const,
      domain: row.domain,
      now: checkReading(row.excerpt || ''),
      before: prior ? checkReading(prior.excerpt || '') : null,
    };
  });
}

/** Newest run per active watch inside the window, against the newest run per watch at or before its start. Two queries. */
async function citationMoves(db: D1Database, accountId: string, from: number, to: number): Promise<DigestMove[]> {
  const recent = await db.prepare(
    `SELECT r.watch_id, w.domain, w.engine, r.measurement_status, r.cited_count, r.prompt_count, MAX(r.ran_at) AS latest
     FROM citation_watch_runs r JOIN citation_watches w ON w.id = r.watch_id
     WHERE r.account_id = ? AND w.active = 1 AND r.ran_at > ? AND r.ran_at <= ?
     GROUP BY r.watch_id ORDER BY latest DESC LIMIT ?`,
  ).bind(accountId, from, to, MAX_DOMAINS).all<WatchRunRow>();
  const rows = recent.results ?? [];
  if (!rows.length) return [];
  const earlier = await db.prepare(
    `SELECT watch_id, measurement_status, cited_count, prompt_count, MAX(ran_at) AS latest
     FROM citation_watch_runs WHERE account_id = ? AND ran_at <= ? AND watch_id IN (${rows.map(() => '?').join(', ')})
     GROUP BY watch_id`,
  ).bind(accountId, from, ...rows.map((row) => row.watch_id)).all<RunRow>();
  const before = new Map((earlier.results ?? []).map((row) => [row.watch_id, row]));
  return rows.map((row) => {
    const prior = before.get(row.watch_id);
    return {
      kind: 'citations' as const,
      domain: row.domain,
      engine: row.engine,
      now: citationReading(row),
      before: prior ? citationReading(prior) : null,
    };
  });
}

/** Everything the email says, read from D1 for the window (now - 7 days, now]. */
async function loadDigestInput(db: D1Database, user: Candidate, now: number): Promise<DigestInput> {
  const accountId = user.account_id || user.id;
  const from = now - WINDOW_MS;
  const findings = await db.prepare(
    `SELECT domain, title, description, severity, status FROM audit_findings
     WHERE account_id = ? AND status IN ('open', 'in_progress')
     ORDER BY updated_at DESC LIMIT 200`,
  ).bind(accountId).all<FindingRow>();
  const primary = pickPrimaryFinding(findings.results ?? []);
  return {
    greetingName: welcomeGreetingName(user.display_name, user.email),
    fix: primary ? { domain: primary.domain, title: primary.title } : null,
    moves: [
      ...(await siteCheckMoves(db, accountId, from, now)),
      ...(await citationMoves(db, accountId, from, now)),
    ],
    lastSentKind: user.last_kind,
  };
}

/** Takes this week's claim only while consent still holds, so an unsubscribe during a run is honoured. */
async function claimWeek(db: D1Database, userId: string, weekKey: string, now: number): Promise<boolean> {
  const row = await db.prepare(
    `INSERT INTO email_digest_sends (user_id, week_key, status, claimed_at)
     SELECT u.id, ?, 'claimed', ? FROM users u WHERE u.id = ? AND ${CONSENTED}
     ON CONFLICT(user_id, week_key) DO NOTHING RETURNING user_id`,
  ).bind(weekKey, now, userId).first<{ user_id: string }>();
  return Boolean(row);
}

async function settleWeek(
  db: D1Database,
  userId: string,
  weekKey: string,
  status: 'sent' | 'skipped' | 'unknown',
  kind: DigestKind | null,
): Promise<void> {
  await db.prepare(
    `UPDATE email_digest_sends SET status = ?, kind = ?, sent_at = ? WHERE user_id = ? AND week_key = ?`,
  ).bind(status, kind, status === 'sent' ? Date.now() : null, userId, weekKey).run();
}

async function releaseWeek(db: D1Database, userId: string, weekKey: string): Promise<void> {
  await db.prepare(
    `DELETE FROM email_digest_sends WHERE user_id = ? AND week_key = ? AND status = 'claimed'`,
  ).bind(userId, weekKey).run();
}

type Outcome = 'sent' | 'skipped' | 'failed' | 'unknown';

async function deliverDigest(env: DigestEnv, db: D1Database, user: Candidate, weekKey: string, now: number): Promise<Outcome> {
  let input: DigestInput;
  try {
    input = await loadDigestInput(db, user, now);
  } catch {
    console.warn(JSON.stringify({ event: 'weekly_digest_failed', reason: 'load' }));
    await releaseWeek(db, user.id, weekKey);
    return 'failed';
  }
  const kind = digestKind(input);
  if (!kind) {
    await settleWeek(db, user.id, weekKey, 'skipped', null);
    return 'skipped';
  }
  const unsubscribeHref = unsubscribeUrl(env, user.email_unsub_token, 'weekly');
  const rendered = renderDigestEmail(input, kind, { unsubscribeHref, fixBoardHref: `${appOrigin(env)}/#instant_audit` });
  const sent = await sendResendEmail(env, {
    to: user.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    unsubscribeHref,
    idempotencyKey: `digest-${user.id}-${weekKey}`,
    timeoutMs: SEND_TIMEOUT_MS,
  });
  if (sent.outcome === 'sent') {
    await settleWeek(db, user.id, weekKey, 'sent', kind);
    return 'sent';
  }
  if (sent.outcome === 'rejected') {
    console.warn(JSON.stringify({ event: 'weekly_digest_failed', status: sent.status }));
    await releaseWeek(db, user.id, weekKey);
    return 'failed';
  }
  console.warn(JSON.stringify({ event: 'weekly_digest_failed', reason: 'unknown', status: sent.status ?? null }));
  await settleWeek(db, user.id, weekKey, 'unknown', kind);
  return 'unknown';
}

export type DigestRunResult = Record<Outcome, number>;

/**
 * Daily cron job. Mails consenting users whose local day is a send day, up to the daily limit of
 * claims. Users who waited longest since their last claim go first, so nobody is starved.
 */
export async function runWeeklyEmailDigest(
  env: DigestEnv,
  opts: { scheduledAt: number; sleep?: (ms: number) => Promise<void> },
): Promise<DigestRunResult> {
  const result: DigestRunResult = { sent: 0, skipped: 0, failed: 0, unknown: 0 };
  if (!digestEnabled(env) || !env.DB || !env.RESEND_API_KEY) return result;
  const db = env.DB;
  const now = opts.scheduledAt;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const { results } = await db.prepare(
    `SELECT u.id, u.email, u.display_name, u.account_id, u.email_unsub_token, u.weekly_digest_tz,
       (SELECT s.kind FROM email_digest_sends s WHERE s.user_id = u.id AND s.status = 'sent'
        ORDER BY s.claimed_at DESC LIMIT 1) AS last_kind,
       (SELECT MAX(s.claimed_at) FROM email_digest_sends s WHERE s.user_id = u.id) AS last_claimed_at
     FROM users u
     WHERE ${CONSENTED} AND u.email_unsub_token IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM email_digest_sends s WHERE s.user_id = u.id AND s.claimed_at > ?)
     ORDER BY last_claimed_at ASC, u.weekly_digest_opt_in_at ASC LIMIT ?`,
  ).bind(now - CLAIM_LOOKBACK_MS, MAX_CANDIDATES).all<Candidate>();
  const limit = dailyLimit(env);
  let claims = 0;
  for (const user of results ?? []) {
    if (claims >= limit) break;
    const schedule = digestSchedule(now, digestTimeZone(user.weekly_digest_tz));
    if (!schedule.due) continue;
    try {
      if (!(await claimWeek(db, user.id, schedule.weekKey, now))) continue;
      claims += 1;
      const outcome = await deliverDigest(env, db, user, schedule.weekKey, now);
      result[outcome] += 1;
      if (outcome !== 'skipped') await sleep(SEND_GAP_MS);
    } catch {
      console.warn(JSON.stringify({ event: 'weekly_digest_failed', reason: 'd1' }));
      result.failed += 1;
    }
  }
  console.log(JSON.stringify({ event: 'weekly_digest_run', ...result }));
  return result;
}
