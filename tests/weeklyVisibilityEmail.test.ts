import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { handleEmailUnsubscribe } from '../worker/welcomeEmail';
import {
  sendWeeklyVisibilityEmails,
  setWeeklyReportOptIn,
  type HomepageRead,
} from '../worker/weeklyVisibilityEmail';
import { diffWeekly, parseWeeklySnapshot } from '../services/audit/weeklyVisibilityCopy';

const HTML = `<!DOCTYPE html><html><head><title>Harbour and Co</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"RealEstateAgent","name":"Harbour and Co","telephone":"03 9999 8888","address":{"streetAddress":"12 Harbour Street","addressLocality":"Richmond"},"areaServed":"Richmond"}</script>
</head><body><p>Harbour and Co, 12 Harbour Street, Richmond. Call 03 9999 8888.</p></body></html>`;

function envFor(db: ReturnType<typeof createSqliteD1>, extra: Partial<Env> = {}): Env {
  return {
    DB: db,
    RESEND_API_KEY: 'test-key',
    WEBAPP_URL: 'https://www.luminarasuite.com/',
    ...extra,
  } as Env;
}

async function addUser(
  db: ReturnType<typeof createSqliteD1>,
  id: string,
  email: string,
  token: string,
  optIn: number | null,
) {
  await db.prepare(
    `INSERT INTO users (id, source, email, display_name, created_at, last_seen_at, account_id, weekly_report_opt_in_at, email_unsub_token)
     VALUES (?, 'firebase', ?, 'Ada Lovelace', 1, 1, ?, ?, ?)`,
  ).bind(id, email, id, optIn, token).run();
}

async function addAudit(
  db: ReturnType<typeof createSqliteD1>,
  accountId: string,
  domain: string,
  measuredAt: number,
) {
  await db.prepare(
    `INSERT INTO audit_history (account_id, id, domain, measured_at, entry_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(accountId, `${accountId}-${domain}`, domain, measuredAt, JSON.stringify({ summary: 'Ship the suburb page.' }), measuredAt).run();
}

describe('weekly visibility email', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mails only the opted-in account and does not read another account', async () => {
    const db = createSqliteD1();
    await addUser(db, 'fb:ada', 'ada@example.com', 'a'.repeat(43), 10);
    await addUser(db, 'fb:bea', 'bea@example.com', 'b'.repeat(43), null);
    await addAudit(db, 'fb:ada', 'harbour.example', 1_700_000_000_000);
    await addAudit(db, 'fb:bea', 'secret.example', 1_700_000_000_000);
    const seen: string[] = [];
    const readHomepage = async (url: string): Promise<HomepageRead> => {
      seen.push(url);
      return { ok: true, html: HTML };
    };
    const sentTo: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { to: string[]; text: string; headers: Record<string, string> };
      sentTo.push(...body.to);
      expect(body.text).toContain('Measured.');
      expect(body.text).toContain('Not measured.');
      expect(body.text).toContain('Estimated: none');
      expect(body.text).not.toContain('secret.example');
      expect(body.text).toContain('list=weekly');
      expect(body.headers['List-Unsubscribe']).toContain('list=weekly');
      return new Response('{"id":"em_1"}', { status: 200 });
    });
    const first = await sendWeeklyVisibilityEmails(envFor(db), { readHomepage, now: Date.UTC(2026, 0, 5) });
    expect(first.sent).toBe(1);
    expect(seen).toEqual(['https://harbour.example/']);
    expect(sentTo).toEqual(['ada@example.com']);
    const again = await sendWeeklyVisibilityEmails(envFor(db), { readHomepage, now: Date.UTC(2026, 0, 6) });
    expect(again.sent).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it('releases the week when the email send fails so the next fire can try again', async () => {
    const db = createSqliteD1();
    await addUser(db, 'fb:ada', 'ada@example.com', 'a'.repeat(43), 10);
    await addAudit(db, 'fb:ada', 'harbour.example', 1);
    let calls = 0;
    const readHomepage = async (): Promise<HomepageRead> => {
      calls += 1;
      return { ok: true, html: HTML };
    };
    vi.stubGlobal('fetch', async () => new Response('no', { status: 500 }));
    const now = Date.UTC(2026, 0, 5);
    const failed = await sendWeeklyVisibilityEmails(envFor(db), { readHomepage, now });
    expect(failed.sent).toBe(0);
    expect(calls).toBe(1);
    vi.stubGlobal('fetch', async () => new Response('{"id":"em_2"}', { status: 200 }));
    const retried = await sendWeeklyVisibilityEmails(envFor(db), { readHomepage, now });
    expect(retried.sent).toBe(1);
    expect(calls).toBe(2);
  });

  it('does not re-read when the audit allowance is already closed', async () => {
    const db = createSqliteD1();
    await addUser(db, 'fb:ada', 'ada@example.com', 'a'.repeat(43), 10);
    await addAudit(db, 'fb:ada', 'harbour.example', 1);
    const readHomepage = vi.fn(async (): Promise<HomepageRead> => ({ ok: true, html: HTML }));
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      expect(body.text).toContain('Not measured.');
      expect(body.text).not.toContain('RealEstateAgent schema is on the page');
      return new Response('{"id":"em_1"}', { status: 200 });
    });
    const result = await sendWeeklyVisibilityEmails(
      envFor(db, { REQUIRE_TG_AUTH: 'true' }),
      { readHomepage, now: Date.UTC(2026, 0, 5) },
    );
    expect(result.sent).toBe(1);
    expect(readHomepage).not.toHaveBeenCalled();
  });

  it('opts in one account and the weekly unsubscribe leaves other mail alone', async () => {
    const db = createSqliteD1();
    const env = envFor(db);
    await addUser(db, 'fb:ada', 'ada@example.com', 'a'.repeat(43), null);
    const user: HostedIdentity = { id: 'fb:ada', source: 'firebase', email: 'ada@example.com', accountId: 'fb:ada' };
    const turnedOn = await setWeeklyReportOptIn(env, user, true);
    expect(await turnedOn.json()).toMatchObject({ ok: true, enabled: true });
    const page = await handleEmailUnsubscribe(
      new Request('https://www.luminarasuite.com/api/email/unsubscribe?token=' + 'a'.repeat(43) + '&list=weekly'),
      env,
    );
    expect(await page?.text()).toContain('weekly visibility email');
    const row = await db.prepare(
      `SELECT weekly_report_opt_in_at, email_opt_out_at FROM users WHERE id = ?`,
    ).bind('fb:ada').first<{ weekly_report_opt_in_at: number | null; email_opt_out_at: number | null }>();
    expect(row?.weekly_report_opt_in_at).toBeNull();
    expect(row?.email_opt_out_at).toBeNull();
  });

  it('does not treat a missing earlier read as a change', () => {
    const current = parseWeeklySnapshot({
      domain: 'harbour.example',
      readAt: 1,
      pageRead: true,
      hasRealEstateAgent: true,
      name: 'match',
      phone: 'match',
      address: 'match',
      serviceArea: 'match',
      nextFix: null,
    });
    expect(current).not.toBeNull();
    expect(diffWeekly(null, current!)).toEqual(['No earlier weekly read, so a change is not measured.']);
  });
});
