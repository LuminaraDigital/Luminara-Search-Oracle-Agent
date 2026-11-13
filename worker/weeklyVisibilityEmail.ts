/**
 * Weekly homepage re-read for accounts that opt in.
 * shortcut: 25 accounts per daily fire, one homepage on the free allowance and three on a paid plan.
 * The browser audit crew does not run here. Rankings and the Google Business Profile API stay Not measured.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { BUSINESS_LOCATION, LEGAL_ABN, LEGAL_ENTITY, PUBLIC_BRAND } from '../services/legal/consumerTerms';
import { htmlToVisibleText, reportPublicProfile } from '../services/audit/publicProfileMatch';
import {
  diffWeekly,
  parseWeeklySnapshot,
  renderWeeklyEmail,
  snapshotFromReport,
  type WeeklyDomainMail,
  type WeeklySnapshot,
} from '../services/audit/weeklyVisibilityCopy';
import { isoWeekKey } from '../services/referrals/rules';
import type { Env } from './env';
import { jsonLdBlocks } from './deployReadback';
import { readPageHead } from './pageHead';
import { readCapped } from './domainVerification';
import { checkHostedQuota, isUserSubscribed, refundMeteredQuota, type QuotaStatus } from './quotaMiddleware';
import { fetchPublicUrl } from './security';
import { identifiedForRequest } from './authMiddleware';
import { identify, json } from './workerUtils';
import type { HostedIdentity } from './userTypes';
import {
  WELCOME_AUDIT_URL,
  WELCOME_FROM,
  WELCOME_REPLY_TO,
  newUnsubToken,
  unsubscribeUrl,
  welcomeGreetingName,
} from './welcomeEmail';

const BATCH = 25;
const FREE_DOMAINS = 1;
const PAID_DOMAINS = 3;
const LEGAL_FOOTER = `${LEGAL_ENTITY}, trading as ${PUBLIC_BRAND}, ABN ${LEGAL_ABN}, ${BUSINESS_LOCATION}`;

type UserRow = {
  id: string;
  account_id: string | null;
  email: string;
  display_name: string | null;
  source: 'telegram' | 'firebase';
  email_unsub_token: string | null;
};

type AuditRow = { domain: string; measured_at: number; entry_json: string };

export type HomepageRead =
  | { ok: true; html: string }
  | { ok: false; reason: string };

async function defaultReadHomepage(url: string): Promise<HomepageRead> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const fetched = await fetchPublicUrl(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html',
        'user-agent': 'LuminaraProbe/1.0 (+https://www.luminarasuite.com/methodology)',
      },
    }, { maxRedirects: 3 });
    if (!fetched.ok) return { ok: false, reason: 'We could not read this homepage.' };
    if (fetched.response.status < 200 || fetched.response.status >= 300) {
      return { ok: false, reason: 'This homepage answered with an error, so it was not compared.' };
    }
    const html = await readCapped(fetched.response, 256_000);
    const type = (fetched.response.headers.get('content-type') || '').toLowerCase();
    if (!type.includes('text/html') && !html.trimStart().startsWith('<')) {
      return { ok: false, reason: 'This homepage did not answer with a web page.' };
    }
    return { ok: true, html };
  } catch {
    return { ok: false, reason: 'We could not read this homepage.' };
  } finally {
    clearTimeout(timer);
  }
}

function fetchTarget(domain: string): string | null {
  const trimmed = domain.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.username || url.password) return null;
    if (!url.hostname.includes('.')) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function snapshotKey(domain: string): string {
  try {
    return new URL(fetchTarget(domain) || 'https://invalid.invalid').hostname.toLowerCase();
  } catch {
    return domain.trim().toLowerCase().slice(0, 253);
  }
}

function savedSummary(entryJson: string): string | null {
  try {
    const parsed: unknown = JSON.parse(entryJson);
    if (!parsed || typeof parsed !== 'object') return null;
    const summary = (parsed as { summary?: unknown }).summary;
    if (typeof summary !== 'string') return null;
    const withoutSection = summary.replace(/#{1,3}\s+Unverified\s*\/\s*Working\s+Hypotheses[\s\S]*$/im, '');
    const filteredLines = withoutSection
      .split(/\r?\n/)
      .filter((line) => !/^\s*(?:[-*+]\s+)?(?:\[?UNVERIFIED:?\]?)/i.test(line))
      .join(' ');
    const clean = filteredLines.replace(/\s+/g, ' ').trim();
    return clean ? clean.slice(0, 240) : null;
  } catch {
    return null;
  }
}

function skippedMail(domain: string, failure: string, savedAt: number | null, summary: string | null): WeeklyDomainMail {
  return {
    domain,
    pageRead: false,
    failure,
    lines: [],
    changes: ['This homepage was not re-read, so a change is not measured.'],
    nextFix: null,
    savedAuditAt: savedAt,
    savedAuditSummary: summary,
  };
}

async function loadPrevious(db: D1Database, accountId: string, domain: string): Promise<WeeklySnapshot | null> {
  const row = await db.prepare(
    `SELECT snapshot_json FROM weekly_visibility_reads WHERE account_id = ? AND domain = ?`,
  ).bind(accountId, snapshotKey(domain)).first<{ snapshot_json: string }>();
  if (!row?.snapshot_json) return null;
  try {
    return parseWeeklySnapshot(JSON.parse(row.snapshot_json));
  } catch {
    return null;
  }
}

async function saveSnapshot(db: D1Database, accountId: string, domain: string, snapshot: WeeklySnapshot): Promise<void> {
  await db.prepare(
    `INSERT INTO weekly_visibility_reads (account_id, domain, read_at, snapshot_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, domain) DO UPDATE SET read_at = excluded.read_at, snapshot_json = excluded.snapshot_json`,
  ).bind(accountId, snapshotKey(domain), snapshot.readAt, JSON.stringify(snapshot)).run();
}

async function readsForUser(
  env: Env,
  accountId: string,
  loginId: string,
  user: HostedIdentity,
  paid: boolean,
  readHomepage: (url: string) => Promise<HomepageRead>,
  now: number,
): Promise<{ mails: WeeklyDomainMail[]; snapshots: WeeklySnapshot[]; spent: QuotaStatus[] } | null> {
  const { results } = await env.DB!.prepare(
    `SELECT domain, measured_at, entry_json FROM audit_history
     WHERE account_id = ? OR account_id = ?
     ORDER BY measured_at DESC
     LIMIT 15`,
  ).bind(accountId, loginId).all<AuditRow>();
  const seen = new Set<string>();
  const audits: Array<{ domain: string; measuredAt: number; summary: string | null }> = [];
  for (const row of results || []) {
    const key = snapshotKey(row.domain);
    if (!row.domain || seen.has(key)) continue;
    seen.add(key);
    audits.push({ domain: row.domain, measuredAt: row.measured_at, summary: savedSummary(row.entry_json) });
  }
  if (!audits.length) return null;
  const max = paid ? PAID_DOMAINS : FREE_DOMAINS;
  const mails: WeeklyDomainMail[] = [];
  const snapshots: WeeklySnapshot[] = [];
  const spent: QuotaStatus[] = [];
  let blocked = false;
  for (const audit of audits.slice(0, max)) {
    const target = fetchTarget(audit.domain);
    if (!target) {
      mails.push(skippedMail(audit.domain, 'The saved address is not a public web address.', audit.measuredAt, audit.summary));
      continue;
    }
    if (blocked) {
      mails.push(skippedMail(audit.domain, "Today's audit allowance was already used, so this homepage was not re-read.", audit.measuredAt, audit.summary));
      continue;
    }
    const quota = await checkHostedQuota(env, user, { bucket: 'audit' });
    if (!quota.ok) {
      blocked = true;
      const failure = quota.error || "Today's audit allowance was already used, so this homepage was not re-read.";
      mails.push(skippedMail(audit.domain, failure, audit.measuredAt, audit.summary));
      continue;
    }
    const read = await readHomepage(target);
    if (!read.ok) {
      await refundMeteredQuota(env, quota);
      mails.push(skippedMail(audit.domain, read.reason, audit.measuredAt, audit.summary));
      continue;
    }
    const visible = htmlToVisibleText(read.html);
    const head = readPageHead(read.html);
    const report = reportPublicProfile({
      pageRead: true,
      textComplete: true,
      title: head.title,
      visibleText: `${visible.text} ${visible.tels.join(' ')}`.trim(),
      jsonLd: jsonLdBlocks(read.html),
    });
    spent.push(quota);
    const snapshot = snapshotFromReport(snapshotKey(audit.domain), now, report);
    const previous = await loadPrevious(env.DB!, accountId, audit.domain);
    snapshots.push(snapshot);
    mails.push({
      domain: audit.domain.replace(/[\r\n]/g, ' ').trim().slice(0, 200),
      pageRead: true,
      failure: null,
      lines: report.checks.map((check) => `${check.label}: ${check.detail}`),
      changes: diffWeekly(previous, snapshot),
      nextFix: report.nextFix,
      savedAuditAt: audit.measuredAt,
      savedAuditSummary: audit.summary,
    });
  }
  const restNote = paid
    ? 'Not measured this week. This read covers three saved audits.'
    : 'Not measured. The free allowance re-reads the latest saved audit.';
  for (const audit of audits.slice(max)) {
    mails.push(skippedMail(audit.domain, restNote, audit.measuredAt, audit.summary));
  }
  return { mails, snapshots, spent };
}

async function claimSend(db: D1Database, accountId: string, weekKey: string, sentAt: number): Promise<boolean> {
  try {
    await db.prepare(
      `INSERT INTO weekly_report_sends (account_id, week_key, sent_at) VALUES (?, ?, ?)`,
    ).bind(accountId, weekKey, sentAt).run();
    return true;
  } catch {
    return false;
  }
}

async function releaseSend(db: D1Database, accountId: string, weekKey: string, sentAt: number): Promise<void> {
  await db.prepare(
    `DELETE FROM weekly_report_sends WHERE account_id = ? AND week_key = ? AND sent_at = ?`,
  ).bind(accountId, weekKey, sentAt).run();
}

async function sendOne(
  env: Env,
  row: UserRow,
  weekKey: string,
  readHomepage: (url: string) => Promise<HomepageRead>,
  now: number,
): Promise<'sent' | 'skipped' | 'failed'> {
  const accountId = row.account_id || row.id;
  const sentAt = now;
  const claimed = await claimSend(env.DB!, accountId, weekKey, sentAt);
  if (!claimed) return 'skipped';
  if (/[\r\n]/.test(row.email) || !row.email.includes('@')) return 'skipped';
  const user: HostedIdentity = {
    id: row.id,
    source: row.source,
    email: row.email,
    name: row.display_name || undefined,
    accountId,
  };
  const paid = await isUserSubscribed(env, user);
  const read = await readsForUser(env, accountId, row.id, user, paid, readHomepage, now);
  if (!read) {
    await releaseSend(env.DB!, accountId, weekKey, sentAt);
    return 'skipped';
  }
  const domains = read.mails;
  let token = row.email_unsub_token;
  if (!token) {
    token = newUnsubToken();
    await env.DB!.prepare(
      `UPDATE users SET email_unsub_token = ? WHERE id = ? AND email_unsub_token IS NULL`,
    ).bind(token, row.id).run();
    const stored = await env.DB!.prepare(
      `SELECT email_unsub_token FROM users WHERE id = ?`,
    ).bind(row.id).first<{ email_unsub_token: string | null }>();
    token = stored?.email_unsub_token || token;
  }
  const unsub = `${unsubscribeUrl(env, token)}&list=weekly`;
  const rendered = renderWeeklyEmail({
    greetingName: welcomeGreetingName(row.display_name, row.email),
    domains,
    unsubscribeHref: unsub,
    legalFooter: LEGAL_FOOTER,
    auditUrl: WELCOME_AUDIT_URL,
  });
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `weekly-${accountId}-${weekKey}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 256),
      },
      body: JSON.stringify({
        from: WELCOME_FROM,
        to: [row.email],
        reply_to: [WELCOME_REPLY_TO],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: {
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (response.ok || response.status === 409) {
      for (const snapshot of read.snapshots) await saveSnapshot(env.DB!, accountId, snapshot.domain, snapshot);
      return 'sent';
    }
    console.warn(JSON.stringify({ event: 'weekly_email_failed', status: response.status }));
  } catch {
    console.warn(JSON.stringify({ event: 'weekly_email_failed', reason: 'network' }));
  }
  for (const quota of read.spent) await refundMeteredQuota(env, quota);
  await releaseSend(env.DB!, accountId, weekKey, sentAt);
  return 'failed';
}

export async function sendWeeklyVisibilityEmails(
  env: Env,
  deps: { readHomepage?: (url: string) => Promise<HomepageRead>; now?: number; limit?: number } = {},
): Promise<{ sent: number; skipped: number }> {
  if (!env.DB || !env.RESEND_API_KEY) return { sent: 0, skipped: 0 };
  const now = deps.now ?? Date.now();
  const weekKey = isoWeekKey(new Date(now));
  const limit = Math.min(deps.limit ?? BATCH, BATCH);
  const readHomepage = deps.readHomepage ?? defaultReadHomepage;
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.account_id, u.email, u.display_name, u.source, u.email_unsub_token
     FROM users u
     WHERE u.weekly_report_opt_in_at IS NOT NULL
       AND u.email_opt_out_at IS NULL
       AND u.email IS NOT NULL AND trim(u.email) != ''
       AND NOT EXISTS (
         SELECT 1 FROM weekly_report_sends s
         WHERE s.account_id = COALESCE(u.account_id, u.id) AND s.week_key = ?
       )
     LIMIT ?`,
  ).bind(weekKey, limit).all<UserRow>();
  let sent = 0;
  let skipped = 0;
  for (const row of results || []) {
    if (row.source !== 'telegram' && row.source !== 'firebase') {
      skipped += 1;
      continue;
    }
    const outcome = await sendOne(env, row, weekKey, readHomepage, now);
    if (outcome === 'sent') sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}

export async function setWeeklyReportOptIn(
  env: { DB?: D1Database },
  user: HostedIdentity,
  enabled: boolean,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Email preferences are unavailable right now.' }, 503);
  const row = await env.DB.prepare(
    `SELECT email FROM users WHERE id = ?`,
  ).bind(user.id).first<{ email: string | null }>();
  if (!row) return json({ ok: false, error: 'Account not found.' }, 404);
  const hasEmail = Boolean(row.email && row.email.trim());
  if (enabled && !hasEmail) {
    return json({ ok: false, error: 'Add an email address on this account first.' }, 400);
  }
  if (enabled) {
    await env.DB.prepare(
      `UPDATE users
       SET weekly_report_opt_in_at = ?, email_unsub_token = COALESCE(email_unsub_token, ?), email_opt_out_at = NULL
       WHERE id = ?`,
    ).bind(Date.now(), newUnsubToken(), user.id).run();
  } else {
    await env.DB.prepare(
      `UPDATE users SET weekly_report_opt_in_at = NULL WHERE id = ?`,
    ).bind(user.id).run();
  }
  return json({ ok: true, enabled, hasEmail });
}

export async function readWeeklyReportOptIn(
  env: { DB?: D1Database },
  user: HostedIdentity,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Email preferences are unavailable right now.' }, 503);
  const row = await env.DB.prepare(
    `SELECT email, weekly_report_opt_in_at FROM users WHERE id = ?`,
  ).bind(user.id).first<{ email: string | null; weekly_report_opt_in_at: number | null }>();
  if (!row) return json({ ok: false, error: 'Account not found.' }, 404);
  return json({
    ok: true,
    enabled: row.weekly_report_opt_in_at != null,
    hasEmail: Boolean(row.email && row.email.trim()),
  });
}

/** GET and POST /api/email/weekly-report. The caller is already signed in. */
export async function handleWeeklyReportRoute(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/email/weekly-report') return null;
  const who = identifiedForRequest(request) ?? await identify(request, env);
  if (!who.user) return json({ ok: false, error: who.error || 'Sign in required.' }, 401);
  if (request.method === 'GET') return readWeeklyReportOptIn(env, who.user);
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  const text = await request.text();
  if (text.length > 200) return json({ ok: false, error: 'Request is too large.' }, 413);
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return json({ ok: false, error: 'Body must be JSON.' }, 400);
  }
  if (!body || typeof body !== 'object' || typeof (body as { enabled?: unknown }).enabled !== 'boolean') {
    return json({ ok: false, error: 'Send { "enabled": true } or { "enabled": false }.' }, 400);
  }
  return setWeeklyReportOptIn(env, who.user, (body as { enabled: boolean }).enabled);
}
