import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';

const verifyFirebaseIdToken = vi.fn();
vi.mock('../worker/firebaseAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../worker/firebaseAuth')>()),
  verifyFirebaseIdToken: (...args: unknown[]) => verifyFirebaseIdToken(...args),
}));

import { DAILY_CRON, jobsForCron } from '../worker/scheduledJobs';
import { handleEmailUnsubscribe, unsubscribeUrl } from '../worker/welcomeEmail';
import { handleEmailPreferences, runWeeklyEmailDigest, type DigestEnv } from '../worker/weeklyDigest';
import {
  checkReading,
  citationReading,
  digestKind,
  digestSchedule,
  digestTimeZone,
  readingText,
  renderDigestEmail,
  type DigestInput,
} from '../worker/weeklyDigestContent';

const DAY = 86_400_000;
/** Monday 2 November 2026, 08:00 UTC: the daily cron fire. 19:00 Monday in Sydney, 22:00 Sunday in Honolulu. */
const MONDAY = Date.UTC(2026, 10, 2, 8, 0, 0);
const TUESDAY = MONDAY + DAY;
const NEXT_MONDAY = MONDAY + 7 * DAY;
const noSleep = async () => {};

type Db = ReturnType<typeof createSqliteD1>;

function dbEnv(extra: Partial<DigestEnv> = {}) {
  const db = createSqliteD1();
  const env: DigestEnv = {
    DB: db,
    RESEND_API_KEY: 'test-key',
    WEBAPP_URL: 'https://staging.luminarasuite.com/',
    WEEKLY_EMAIL_DIGEST_ENABLED: 'true',
    FIREBASE_PROJECT_ID: 'luminara-suite-staging',
    ...extra,
  };
  return { db, env };
}

function tokenFor(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, '').padEnd(43, 'a').slice(0, 43);
}

async function insertUser(
  db: Db,
  id: string,
  opts: { email?: string | null; name?: string; optInAt?: number | null; optOutAt?: number | null; tz?: string | null } = {},
) {
  const email = opts.email === undefined ? `${id.replace(/^fb:/, '')}@example.com` : opts.email;
  const optInAt = opts.optInAt === undefined ? 1 : opts.optInAt;
  await db.prepare(
    `INSERT INTO users (id, source, email, display_name, created_at, last_seen_at, account_id, welcome_sent_at,
       email_opt_out_at, email_unsub_token, weekly_digest_opt_in_at, weekly_digest_email, weekly_digest_tz)
     VALUES (?, 'firebase', ?, ?, 1, 1, ?, 1, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    email,
    opts.name ?? 'Ada Lovelace',
    id,
    opts.optOutAt ?? null,
    tokenFor(id),
    optInAt,
    optInAt == null ? null : email,
    opts.tz === undefined ? 'Australia/Sydney' : opts.tz,
  ).run();
}

async function addFinding(db: Db, accountId: string, title: string, severity = 'high', status = 'open') {
  await db.prepare(
    `INSERT INTO audit_findings (id, audit_run_id, account_id, domain, stable_key, category, severity, title, description, status, created_at, updated_at)
     VALUES (?, 'run_1', ?, 'harbourrealty.com.au', ?, 'schema', ?, ?, 'The home page has no RealEstateAgent JSON-LD.', ?, 1, 1)`,
  ).bind(`fnd_${accountId}_${title.length}_${severity}`, accountId, `key-${title}`, severity, title, status).run();
}

async function addAudit(db: Db, accountId: string, measuredAt: number, reportExcerpt: string) {
  await db.prepare(
    `INSERT INTO audit_history (account_id, id, domain, measured_at, entry_json, updated_at) VALUES (?, ?, 'harbourrealty.com.au', ?, ?, ?)`,
  ).bind(accountId, `a_${measuredAt}`, measuredAt, JSON.stringify({ reportExcerpt }), measuredAt).run();
}

type Sent = { headers: Record<string, string>; body: { to: string[]; subject: string; text: string; html: string; headers: Record<string, string> } };

function captureResend(respond: (call: number) => Response | Promise<Response> = () => new Response('{"id":"em_1"}', { status: 200 })) {
  const seen: Sent[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    seen.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return respond(seen.length);
  });
  return seen;
}

async function sendRow(db: Db, userId: string, weekKey = '2026-W45') {
  return db.prepare(`SELECT status, kind, sent_at FROM email_digest_sends WHERE user_id = ? AND week_key = ?`)
    .bind(userId, weekKey)
    .first<{ status: string; kind: string | null; sent_at: number | null }>();
}

beforeEach(() => {
  verifyFirebaseIdToken.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('digest content', () => {
  it('labels every reading and never prints a clean pass it cannot prove', () => {
    expect(readingText(checkReading('Site checks: 6 of 8 checks passed, 2 failed.'))).toBe('6 of 8 checks passed, 2 failed (Measured)');
    expect(readingText(checkReading('5 of 8 checks passed, 2 failed, 1 not measured'))).toBe('5 of 8 checks passed, 2 failed (Measured), 1 not measured');
    expect(readingText(checkReading('8 of 8 checks passed'))).toBe('Not measured');
    expect(readingText(checkReading('Health Score 82/100'))).toBe('Not measured');
    expect(readingText(citationReading({ measurement_status: 'measured', cited_count: 3, prompt_count: 10 }))).toBe('cited in 3 of 10 prompts (Measured)');
    expect(readingText(citationReading({ measurement_status: 'not_measured', cited_count: null, prompt_count: null }))).toBe('Not measured');
    expect(readingText(citationReading({ measurement_status: 'measured', cited_count: 11, prompt_count: 10 }))).toBe('Not measured');
    expect(readingText({ status: 'estimated', phrase: 'about 4 listings' })).toBe('about 4 listings (Estimated)');
  });

  it('renders the next fix and what moved, with a label on every number', () => {
    const input: DigestInput = {
      greetingName: 'Ada',
      fix: { domain: 'harbourrealty.com.au', title: 'Add RealEstateAgent schema <script>' },
      moves: [
        { kind: 'site_checks', domain: 'harbourrealty.com.au', now: checkReading('6 of 8 checks passed, 2 failed'), before: checkReading('5 of 8 checks passed, 3 failed') },
        { kind: 'citations', domain: 'harbourrealty.com.au', engine: 'chatgpt', now: citationReading({ measurement_status: 'not_measured', cited_count: null, prompt_count: null }), before: citationReading({ measurement_status: 'measured', cited_count: 2, prompt_count: 8 }) },
        { kind: 'citations', domain: 'harbourrealty.com.au', engine: 'perplexity', now: citationReading({ measurement_status: 'measured', cited_count: 4, prompt_count: 8 }), before: null },
      ],
      lastSentKind: null,
    };
    const unsubscribeHref = 'https://staging.luminarasuite.com/api/email/unsubscribe?token=abc&list=weekly';
    const { html, text, subject } = renderDigestEmail(input, 'update', { unsubscribeHref, fixBoardHref: 'https://staging.luminarasuite.com/#instant_audit' });

    expect(subject).toBe('Your week in AI search: what moved and your next fix');
    expect(text).toContain('Hello Ada,');
    expect(text).toContain('Add RealEstateAgent schema <script> on harbourrealty.com.au.');
    expect(html).toContain('Add RealEstateAgent schema &lt;script&gt; on harbourrealty.com.au.');
    expect(html).not.toContain('<script>');
    expect(text).toContain('Site checks on harbourrealty.com.au: 6 of 8 checks passed, 2 failed (Measured). Before this week: 5 of 8 checks passed, 3 failed (Measured).');
    expect(text).toContain('ChatGPT citations for harbourrealty.com.au: Not measured. Before this week: cited in 2 of 8 prompts (Measured).');
    expect(text).toContain('Perplexity citations for harbourrealty.com.au: cited in 4 of 8 prompts (Measured). Nothing earlier to compare.');
    for (const body of [html, text]) {
      expect(body).toContain('Your next fix');
      expect(body).toContain('What moved');
      expect(body).toContain('Measured, Estimated, or Not measured');
      expect(body).toContain('Open your Fix Board');
      expect(body).toContain('ABN 90 693 125 281');
      expect(body).not.toContain('—');
    }
    expect(html).toContain('Your week.');
    expect(html).toContain('v:roundrect');
    expect(text).toContain(`Unsubscribe: ${unsubscribeHref}`);

    const lines = text.split('\n');
    const moved = lines.slice(lines.indexOf('What moved') + 1, lines.findIndex((line) => line.startsWith('Every number here')));
    const withDigits = moved.filter((line) => /\d/.test(line));
    expect(withDigits.length).toBe(3);
    for (const line of withDigits) {
      const figures = line.split(/(?<=\.)\s/).filter((part) => /\d/.test(part));
      for (const part of figures) expect(part).toMatch(/\((Measured|Estimated)\)/);
    }
    const fixLine = lines[lines.indexOf('Your next fix') + 2];
    expect(fixLine).not.toMatch(/\d/);
  });

  it('does not quote a fix title that carries an unlabelled figure', () => {
    const fix = { domain: 'harbourrealty.com.au', title: 'None of the 3 results name your business' };
    const { text, html } = renderDigestEmail({ greetingName: null, fix, moves: [], lastSentKind: null }, 'quiet', { unsubscribeHref: 'u', fixBoardHref: 'f' });
    for (const body of [text, html]) {
      expect(body).toContain('Your top fix for harbourrealty.com.au is waiting on your Fix Board.');
      expect(body).not.toContain('None of the 3 results');
    }
  });

  it('sends one quiet email for a waiting fix, then skips until something moves', () => {
    const fix = { domain: 'harbourrealty.com.au', title: 'Publish llms.txt' };
    const move = { kind: 'site_checks' as const, domain: 'harbourrealty.com.au', now: checkReading('1 of 2 checks passed, 1 failed'), before: null };
    expect(digestKind({ greetingName: null, fix, moves: [], lastSentKind: null })).toBe('quiet');
    expect(digestKind({ greetingName: null, fix, moves: [], lastSentKind: 'update' })).toBe('quiet');
    expect(digestKind({ greetingName: null, fix, moves: [], lastSentKind: 'quiet' })).toBeNull();
    expect(digestKind({ greetingName: null, fix: null, moves: [], lastSentKind: null })).toBeNull();
    expect(digestKind({ greetingName: null, fix, moves: [move], lastSentKind: 'quiet' })).toBe('update');

    const quiet = renderDigestEmail({ greetingName: null, fix, moves: [], lastSentKind: null }, 'quiet', { unsubscribeHref: 'u', fixBoardHref: 'f' });
    expect(quiet.subject).toBe('Your week in AI search: nothing new recorded, one fix waiting');
    expect(quiet.text).toContain('Hello, here is your weekly Luminara Suite digest');
    expect(quiet.text).toContain('Nothing new was recorded on your account this week: no saved audit and no active Citation Watch run in the last seven days.');
    expect(quiet.text).toContain('Publish llms.txt on harbourrealty.com.au.');
  });
});

describe('weekly digest send window', () => {
  it('mails on the local Monday, with Tuesday and Wednesday as catch-up days', () => {
    expect(digestSchedule(MONDAY, 'Australia/Sydney')).toEqual({ due: true, weekKey: '2026-W45' });
    expect(digestSchedule(MONDAY, 'America/Los_Angeles')).toEqual({ due: true, weekKey: '2026-W45' });
    expect(digestSchedule(MONDAY, 'Pacific/Honolulu')).toEqual({ due: false, weekKey: '2026-W44' });
    expect(digestSchedule(TUESDAY, 'Pacific/Honolulu')).toEqual({ due: true, weekKey: '2026-W45' });
    expect(digestSchedule(MONDAY + 2 * DAY, 'Asia/Singapore').due).toBe(true);
    expect(digestSchedule(MONDAY + 3 * DAY, 'Asia/Singapore').due).toBe(false);
    expect(digestTimeZone('Mars/Olympus_Mons')).toBe('Australia/Sydney');
    expect(digestTimeZone(null)).toBe('Australia/Sydney');
    expect(digestTimeZone('Pacific/Auckland')).toBe('Pacific/Auckland');
  });

  it('runs on the existing daily trigger', () => {
    expect(jobsForCron(DAILY_CRON)).toContain('weekly_email_digest');
  });

  it('selects only opted-in users with an email whose local day is a send day', async () => {
    const { db, env } = dbEnv();
    await insertUser(db, 'fb:ada');
    await insertUser(db, 'fb:hana', { tz: 'Pacific/Honolulu' });
    await insertUser(db, 'fb:mars', { tz: 'Mars/Olympus_Mons' });
    await insertUser(db, 'fb:left', { optInAt: 10, optOutAt: 20 });
    await insertUser(db, 'fb:back', { optInAt: 20, optOutAt: 10 });
    await insertUser(db, 'fb:never', { optInAt: null });
    await insertUser(db, 'fb:noemail', { email: null });
    for (const id of ['fb:ada', 'fb:hana', 'fb:mars', 'fb:left', 'fb:back', 'fb:never', 'fb:noemail']) {
      await addFinding(db, id, 'Add RealEstateAgent schema');
    }
    const seen = captureResend();

    expect(await runWeeklyEmailDigest({ ...env, WEEKLY_EMAIL_DIGEST_ENABLED: 'false' }, { scheduledAt: MONDAY, sleep: noSleep }))
      .toEqual({ sent: 0, skipped: 0, failed: 0, unknown: 0 });
    expect(seen).toHaveLength(0);

    const monday = await runWeeklyEmailDigest(env, { scheduledAt: MONDAY, sleep: noSleep });
    expect(monday.sent).toBe(3);
    expect(seen.map((call) => call.body.to[0]).sort()).toEqual(['ada@example.com', 'back@example.com', 'mars@example.com']);

    await runWeeklyEmailDigest(env, { scheduledAt: TUESDAY, sleep: noSleep });
    expect(seen.map((call) => call.body.to[0])).toContain('hana@example.com');
    expect(seen).toHaveLength(4);
  });

  it('stops at the daily limit and picks the rest up on the next fire', async () => {
    const { db, env } = dbEnv({ WEEKLY_EMAIL_DIGEST_DAILY_LIMIT: '1' });
    await insertUser(db, 'fb:ada');
    await insertUser(db, 'fb:bea');
    await addFinding(db, 'fb:ada', 'Add RealEstateAgent schema');
    await addFinding(db, 'fb:bea', 'Add RealEstateAgent schema');
    const seen = captureResend();
    expect((await runWeeklyEmailDigest(env, { scheduledAt: MONDAY, sleep: noSleep })).sent).toBe(1);
    expect((await runWeeklyEmailDigest(env, { scheduledAt: TUESDAY, sleep: noSleep })).sent).toBe(1);
    expect(new Set(seen.map((call) => call.body.to[0])).size).toBe(2);
  });
});

describe('idempotent send', () => {
  it('claims the week once, so concurrent and repeated runs send one email', async () => {
    const { db, env } = dbEnv();
    await insertUser(db, 'fb:ada');
    await addFinding(db, 'fb:ada', 'Add RealEstateAgent schema', 'medium');
    await addFinding(db, 'fb:ada', 'Publish llms.txt', 'critical');
    await addAudit(db, 'fb:ada', MONDAY - DAY, 'Site checks: 6 of 8 checks passed, 2 failed.');
    await addAudit(db, 'fb:ada', MONDAY - 10 * DAY, 'Site checks: 5 of 8 checks passed, 3 failed.');
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const seen = captureResend(async () => {
      await gate;
      return new Response('{"id":"em_1"}', { status: 200 });
    });

    const first = runWeeklyEmailDigest(env, { scheduledAt: MONDAY, sleep: noSleep });
    const second = runWeeklyEmailDigest(env, { scheduledAt: MONDAY, sleep: noSleep });
    await new Promise((done) => setTimeout(done, 40));
    release();
    await Promise.all([first, second]);
    await runWeeklyEmailDigest(env, { scheduledAt: TUESDAY, sleep: noSleep });

    expect(seen).toHaveLength(1);
    expect(seen[0].headers['Idempotency-Key']).toBe('digest-fb-ada-2026-W45');
    expect(seen[0].body.headers['List-Unsubscribe']).toBe(`<${unsubscribeUrl(env, tokenFor('fb:ada'), 'weekly')}>`);
    expect(seen[0].body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(seen[0].body.text).toContain('Publish llms.txt on harbourrealty.com.au.');
    expect(seen[0].body.text).toContain('Site checks on harbourrealty.com.au: 6 of 8 checks passed, 2 failed (Measured). Before this week: 5 of 8 checks passed, 3 failed (Measured).');
    expect(await sendRow(db, 'fb:ada')).toMatchObject({ status: 'sent', kind: 'update' });
  });

  it('retries a 4xx on a catch-up day, and never retries a lost answer or a 5xx', async () => {
    const rejected = dbEnv();
    await insertUser(rejected.db, 'fb:ada');
    await addFinding(rejected.db, 'fb:ada', 'Add RealEstateAgent schema');
    const seen = captureResend((call) => new Response(call === 1 ? 'rate limited' : '{"id":"em_2"}', { status: call === 1 ? 429 : 200 }));
    expect((await runWeeklyEmailDigest(rejected.env, { scheduledAt: MONDAY, sleep: noSleep })).failed).toBe(1);
    expect(await sendRow(rejected.db, 'fb:ada')).toBeNull();
    expect((await runWeeklyEmailDigest(rejected.env, { scheduledAt: TUESDAY, sleep: noSleep })).sent).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[1].headers['Idempotency-Key']).toBe(seen[0].headers['Idempotency-Key']);

    const lost = dbEnv();
    await insertUser(lost.db, 'fb:bea');
    await addFinding(lost.db, 'fb:bea', 'Add RealEstateAgent schema');
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      throw new TypeError('network connection lost');
    });
    expect((await runWeeklyEmailDigest(lost.env, { scheduledAt: MONDAY, sleep: noSleep })).unknown).toBe(1);
    expect(await sendRow(lost.db, 'fb:bea')).toMatchObject({ status: 'unknown', kind: 'quiet' });
    await runWeeklyEmailDigest(lost.env, { scheduledAt: TUESDAY, sleep: noSleep });
    expect(calls).toBe(1);

    const failing = dbEnv();
    await insertUser(failing.db, 'fb:cy');
    await addFinding(failing.db, 'fb:cy', 'Add RealEstateAgent schema');
    const served = captureResend(() => new Response('upstream error', { status: 503 }));
    expect((await runWeeklyEmailDigest(failing.env, { scheduledAt: MONDAY, sleep: noSleep })).unknown).toBe(1);
    await runWeeklyEmailDigest(failing.env, { scheduledAt: TUESDAY, sleep: noSleep });
    expect(served).toHaveLength(1);
    expect(await sendRow(failing.db, 'fb:cy')).toMatchObject({ status: 'unknown' });
  });

  it('re-checks consent at claim time, so an unsubscribe during a run is honoured', async () => {
    const { db, env } = dbEnv();
    await insertUser(db, 'fb:ada', { optInAt: 1 });
    await insertUser(db, 'fb:bea', { optInAt: 2 });
    await addFinding(db, 'fb:ada', 'Add RealEstateAgent schema');
    await addFinding(db, 'fb:bea', 'Add RealEstateAgent schema');
    const seen = captureResend(async () => {
      await handleEmailUnsubscribe(new Request(unsubscribeUrl(env, tokenFor('fb:bea'), 'weekly'), { method: 'POST' }), env);
      return new Response('{"id":"em_1"}', { status: 200 });
    });
    await runWeeklyEmailDigest(env, { scheduledAt: MONDAY, sleep: noSleep });
    expect(seen.map((call) => call.body.to[0])).toEqual(['ada@example.com']);
    expect(await sendRow(db, 'fb:bea')).toBeNull();
  });

  it('skips a week with nothing to say, and sends one quiet email in a row at most', async () => {
    const { db, env } = dbEnv();
    await insertUser(db, 'fb:empty');
    await insertUser(db, 'fb:ada');
    await addFinding(db, 'fb:ada', 'Publish llms.txt');
    const seen = captureResend();

    await runWeeklyEmailDigest(env, { scheduledAt: MONDAY, sleep: noSleep });
    expect(await sendRow(db, 'fb:empty')).toMatchObject({ status: 'skipped', kind: null });
    expect(await sendRow(db, 'fb:ada')).toMatchObject({ status: 'sent', kind: 'quiet' });
    expect(seen.map((call) => call.body.to[0])).toEqual(['ada@example.com']);
    expect(seen[0].body.subject).toBe('Your week in AI search: nothing new recorded, one fix waiting');

    await runWeeklyEmailDigest(env, { scheduledAt: NEXT_MONDAY, sleep: noSleep });
    expect(await sendRow(db, 'fb:ada', '2026-W46')).toMatchObject({ status: 'skipped' });
    expect(seen).toHaveLength(1);

    await addAudit(db, 'fb:ada', NEXT_MONDAY + 2 * DAY, 'Site checks: 7 of 8 checks passed, 1 failed.');
    await runWeeklyEmailDigest(env, { scheduledAt: NEXT_MONDAY + 7 * DAY, sleep: noSleep });
    expect(seen).toHaveLength(2);
    expect(seen[1].body.text).toContain('7 of 8 checks passed, 1 failed (Measured). Nothing earlier to compare.');
  });
});

describe('unsubscribe and stored preference', () => {
  it('the digest link stops only the digest, and the global link stops both', async () => {
    const { db, env } = dbEnv();
    await insertUser(db, 'fb:ada');
    await insertUser(db, 'fb:bea');

    const weekly = await handleEmailUnsubscribe(new Request(unsubscribeUrl(env, tokenFor('fb:ada'), 'weekly'), { method: 'POST', body: 'List-Unsubscribe=One-Click' }), env);
    expect(weekly?.status).toBe(200);
    expect(await weekly?.text()).toContain('You will not get the weekly digest');
    const ada = await db.prepare('SELECT weekly_digest_opt_in_at, email_opt_out_at FROM users WHERE id = ?').bind('fb:ada').first();
    expect(ada).toEqual({ weekly_digest_opt_in_at: null, email_opt_out_at: null });

    const all = await handleEmailUnsubscribe(new Request(unsubscribeUrl(env, tokenFor('fb:bea'))), env);
    expect(await all?.text()).toContain('You are unsubscribed from Luminara Suite emails.');
    const bea = await db.prepare('SELECT weekly_digest_opt_in_at, email_opt_out_at FROM users WHERE id = ?').bind('fb:bea').first<{ weekly_digest_opt_in_at: number | null; email_opt_out_at: number | null }>();
    expect(bea?.weekly_digest_opt_in_at).toBeNull();
    expect(bea?.email_opt_out_at).toBeGreaterThan(0);

    await addFinding(db, 'fb:ada', 'Add RealEstateAgent schema');
    await addFinding(db, 'fb:bea', 'Add RealEstateAgent schema');
    const seen = captureResend();
    await runWeeklyEmailDigest(env, { scheduledAt: MONDAY, sleep: noSleep });
    expect(seen).toHaveLength(0);
  });

  it('turns on only for the verified account address, and turning off always works', async () => {
    const { db, env } = dbEnv();
    await insertUser(db, 'fb:ada', { optInAt: null, optOutAt: 10, tz: null });
    await db.prepare('UPDATE users SET email_unsub_token = NULL WHERE id = ?').bind('fb:ada').run();
    const ada = { id: 'fb:ada', source: 'firebase' as const };
    const put = (body: unknown, target = env) =>
      handleEmailPreferences(new Request('https://staging.luminarasuite.com/api/email/preferences', { method: 'PUT', body: JSON.stringify(body) }), target, ada);
    const get = async (target = env) =>
      (await handleEmailPreferences(new Request('https://staging.luminarasuite.com/api/email/preferences'), target, ada)).json();
    const token = (email: string, emailVerified = true, uid = 'ada') =>
      verifyFirebaseIdToken.mockResolvedValue({ ok: true, user: { uid, email, emailVerified } });

    const off = { ...env, WEEKLY_EMAIL_DIGEST_ENABLED: undefined };
    expect(await get(off)).toMatchObject({ ok: true, available: false, weeklyDigest: false, email: 'ada@example.com' });
    expect((await put({ weeklyDigest: true, idToken: 't' }, off)).status).toBe(404);
    expect((await put({ weeklyDigest: false }, off)).status).toBe(200);

    expect(await get()).toMatchObject({ available: true, weeklyDigest: false });
    expect((await put({ weeklyDigest: 'yes' })).status).toBe(400);
    expect(await (await put({ weeklyDigest: true })).json()).toMatchObject({ code: 'REAUTH_REQUIRED' });
    token('ada@example.com', true, 'someone-else');
    expect(await (await put({ weeklyDigest: true, idToken: 't' })).json()).toMatchObject({ code: 'REAUTH_REQUIRED' });
    token('ada@example.com', false);
    expect(await (await put({ weeklyDigest: true, idToken: 't' })).json()).toMatchObject({ code: 'EMAIL_UNVERIFIED' });
    token('other@example.com');
    expect(await (await put({ weeklyDigest: true, idToken: 't' })).json()).toMatchObject({ code: 'EMAIL_MISMATCH' });

    token('Ada@Example.com');
    const on = await put({ weeklyDigest: true, timeZone: 'Asia/Singapore', idToken: 't' });
    expect(await on.json()).toMatchObject({ ok: true, weeklyDigest: true, timeZone: 'Asia/Singapore' });
    const row = await db.prepare('SELECT weekly_digest_opt_in_at, weekly_digest_email, email_unsub_token FROM users WHERE id = ?').bind('fb:ada')
      .first<{ weekly_digest_opt_in_at: number; weekly_digest_email: string; email_unsub_token: string }>();
    expect(row?.weekly_digest_opt_in_at).toBeGreaterThan(10);
    expect(row?.weekly_digest_email).toBe('ada@example.com');
    expect(row?.email_unsub_token).toHaveLength(43);
    expect(await (await put({ weeklyDigest: true, timeZone: 'Mars/Olympus_Mons', idToken: 't' })).json()).toMatchObject({ weeklyDigest: true, timeZone: null });

    await db.prepare('UPDATE users SET email = ? WHERE id = ?').bind('ada.new@example.com', 'fb:ada').run();
    expect(await get()).toMatchObject({ weeklyDigest: false, email: 'ada.new@example.com' });
    await addFinding(db, 'fb:ada', 'Add RealEstateAgent schema');
    const seen = captureResend();
    await runWeeklyEmailDigest(env, { scheduledAt: MONDAY, sleep: noSleep });
    expect(seen).toHaveLength(0);

    expect(await (await put({ weeklyDigest: false })).json()).toMatchObject({ weeklyDigest: false });
  });
});
