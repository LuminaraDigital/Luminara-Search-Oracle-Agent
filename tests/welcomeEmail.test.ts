import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';
import { withAccountId } from '../worker/userStore';
import {
  deliverWelcome,
  freeChecksLine,
  handleEmailUnsubscribe,
  renderWelcomeEmail,
  runWithWaitUntil,
  unsubscribeUrl,
  welcomeGreetingName,
  WELCOME_AUDIT_URL,
  WELCOME_FROM,
  WELCOME_PRIVACY_URL,
  WELCOME_REPLY_TO,
  WELCOME_TERMS_URL,
  type WelcomeEnv,
} from '../worker/welcomeEmail';

function dbEnv(extra: Partial<WelcomeEnv> = {}) {
  const db = createSqliteD1();
  const env: WelcomeEnv = {
    DB: db,
    RESEND_API_KEY: 'test-key',
    WEBAPP_URL: 'https://staging.luminarasuite.com/',
    FREE_DAILY_LIMIT: '3',
    ...extra,
  };
  return { db, env };
}

async function insertUser(
  db: ReturnType<typeof createSqliteD1>,
  id: string,
  email: string,
  name: string,
  welcomeSentAt: number | null = null,
) {
  await db.prepare(
    `INSERT INTO users (id, source, email, display_name, created_at, last_seen_at, account_id, welcome_sent_at)
     VALUES (?, 'firebase', ?, ?, 1, 1, ?, ?)`,
  ).bind(id, email, name, id, welcomeSentAt).run();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('welcome email template', () => {
  it('renders HTML and text with the name, the free line, and the legal footer', () => {
    const href = 'https://staging.luminarasuite.com/api/email/unsubscribe?token=abc';
    const { html, text, subject } = renderWelcomeEmail({
      greetingName: 'Ada',
      checksLine: freeChecksLine(3),
      unsubscribeHref: href,
    });
    expect(subject).toBe('Welcome to Luminara Suite');
    expect(welcomeGreetingName('Ada Lovelace', 'ada@example.com')).toBe('Ada');
    expect(welcomeGreetingName('ada@example.com', 'ada@example.com')).toBeNull();
    for (const body of [html, text]) {
      expect(body).toContain('Hello Ada,');
      expect(body).toContain('Free includes 3 Instant Audit checks a day.');
      expect(body).toContain('Anything we did not measure is marked not measured.');
      expect(body).toContain('Run your first audit');
      expect(body).toContain(WELCOME_AUDIT_URL);
      expect(body).toContain('LUMINARA DIGITAL PTY LTD');
      expect(body).toContain('trading as Luminara Digital');
      expect(body).toContain('ABN 90 693 125 281');
      expect(body).toContain('Victoria 3128, Australia');
      expect(body).not.toContain('Melbourne');
      expect(body).toContain(href);
      expect(body).toContain(WELCOME_PRIVACY_URL);
      expect(body).toContain(WELCOME_TERMS_URL);
      expect(body).not.toContain('\u2014');
    }
    expect(html).toContain('<table');
    expect(html).toContain('bgcolor="#0a0a0a"');
    expect(html).toContain('v:roundrect');
    expect(html).toContain('Welcome.');
    expect(text.startsWith('Welcome to Luminara Suite')).toBe(true);
  });

  it('states an unlimited plan without inventing a cap', () => {
    expect(freeChecksLine(0)).toBe('Your plan has no daily cap on Instant Audit checks.');
    expect(freeChecksLine(1)).toBe('Free includes 1 Instant Audit check a day.');
  });
});

describe('welcome delivery', () => {
  it('sends once for two concurrent claims, and a later call does not send again', async () => {
    const { db, env } = dbEnv();
    await insertUser(db, 'fb:ada', 'ada@example.com', 'Ada Lovelace');
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const seen: Array<{ headers: Record<string, string>; body: { from: string; to: string[]; reply_to: string[]; headers: Record<string, string> } }> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls += 1;
      seen.push({
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)),
      });
      await gate;
      return new Response('{"id":"em_1"}', { status: 200 });
    });

    const first = deliverWelcome(env, 'fb:ada');
    const second = deliverWelcome(env, 'fb:ada');
    await new Promise((done) => setTimeout(done, 40));
    expect(calls).toBe(1);
    release();
    await Promise.all([first, second]);
    await deliverWelcome(env, 'fb:ada');

    expect(calls).toBe(1);
    expect(seen[0].body.from).toBe(WELCOME_FROM);
    expect(seen[0].body.to).toEqual(['ada@example.com']);
    expect(seen[0].body.reply_to).toEqual([WELCOME_REPLY_TO]);
    expect(seen[0].body.headers['List-Unsubscribe']).toMatch(/^<https:\/\/staging\.luminarasuite\.com\/api\/email\/unsubscribe\?token=/);
    expect(seen[0].body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(seen[0].headers.Authorization).toBe('Bearer test-key');
    expect(seen[0].headers['Idempotency-Key']).toBe('welcome-fb-ada');
    const row = await db.prepare('SELECT welcome_sent_at, email_unsub_token FROM users WHERE id = ?').bind('fb:ada').first<{
      welcome_sent_at: number;
      email_unsub_token: string;
    }>();
    expect(row?.welcome_sent_at).toBeGreaterThan(0);
    expect(row?.email_unsub_token).toHaveLength(43);
  });

  it('does not mail an account the migration already stamped', async () => {
    const { db, env } = dbEnv();
    await insertUser(db, 'fb:old', 'old@example.com', 'Old', 100);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await deliverWelcome(env, 'fb:old');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears the claim when Resend fails, and sign-in still returns the account', async () => {
    const { db, env } = dbEnv();
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      if (calls === 1) return new Response('no', { status: 500 });
      return new Response('{"id":"em_2"}', { status: 200 });
    });
    const tasks: Promise<unknown>[] = [];
    const identity = await runWithWaitUntil(
      { waitUntil(task) { tasks.push(task); } },
      () => withAccountId(env, { id: 'fb:ada', source: 'firebase', email: 'ada@example.com', name: 'Ada Lovelace' }),
    );
    await Promise.all(tasks);
    expect(identity).toMatchObject({ id: 'fb:ada', accountId: 'fb:ada', email: 'ada@example.com' });
    const cleared = await db.prepare('SELECT welcome_sent_at FROM users WHERE id = ?').bind('fb:ada').first<{ welcome_sent_at: number | null }>();
    expect(cleared?.welcome_sent_at).toBeNull();

    await deliverWelcome(env, 'fb:ada');
    const sent = await db.prepare('SELECT welcome_sent_at FROM users WHERE id = ?').bind('fb:ada').first<{ welcome_sent_at: number | null }>();
    expect(sent?.welcome_sent_at).toBeGreaterThan(0);
    expect(calls).toBe(2);

    await withAccountId(env, { id: 'fb:ada', source: 'firebase', email: 'ada@example.com', name: 'Ada Lovelace' });
    expect(calls).toBe(2);
  });

  it('does not call Resend when the key is missing', async () => {
    const { db, env } = dbEnv({ RESEND_API_KEY: undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await withAccountId(env, { id: 'fb:ada', source: 'firebase', email: 'ada@example.com', name: 'Ada' });
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await db.prepare('SELECT welcome_sent_at FROM users WHERE id = ?').bind('fb:ada').first<{ welcome_sent_at: number | null }>();
    expect(row?.welcome_sent_at).toBeNull();
  });
});

describe('unsubscribe', () => {
  it('records the opt-out for GET and POST and ignores a bad token', async () => {
    const { db, env } = dbEnv();
    await insertUser(db, 'fb:ada', 'ada@example.com', 'Ada Lovelace', 10);
    const token = 'a'.repeat(43);
    await db.prepare('UPDATE users SET email_unsub_token = ? WHERE id = ?').bind(token, 'fb:ada').run();
    const url = unsubscribeUrl(env, token);

    const first = await handleEmailUnsubscribe(new Request(url), env);
    const again = await handleEmailUnsubscribe(new Request(url, { method: 'POST', body: 'List-Unsubscribe=One-Click' }), env);
    const bad = await handleEmailUnsubscribe(new Request('https://staging.luminarasuite.com/api/email/unsubscribe?token=short'), env);
    const other = await handleEmailUnsubscribe(new Request('https://staging.luminarasuite.com/api/health'), env);

    const page = await first?.text();
    expect(first?.status).toBe(200);
    expect(page).toContain('You are unsubscribed');
    expect(page).not.toContain('ada@example.com');
    expect(again?.status).toBe(200);
    expect(bad?.status).toBe(400);
    expect(other).toBeNull();
    const row = await db.prepare('SELECT email_opt_out_at FROM users WHERE id = ?').bind('fb:ada').first<{ email_opt_out_at: number }>();
    expect(row?.email_opt_out_at).toBeGreaterThan(0);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await db.prepare('UPDATE users SET welcome_sent_at = NULL WHERE id = ?').bind('fb:ada').run();
    await deliverWelcome(env, 'fb:ada');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
