import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppView } from '../types';
import { createSqliteD1 } from './helpers/sqliteD1';
import { resolveTelegramStart } from '../services/telegram/startParam';
import { safePublicHostname } from '../services/security/publicHostname';
import {
  applyModelSketch,
  assessContinuumLink,
  buildIdeaScoutCard,
  continuumAuditStartParam,
  extractPageSample,
  formatNichePulseMessage,
  ideaCardSlot,
  normalizeCompetitorUrl,
  parseCompetitorUrls,
  parseIdeaScoutRequest,
  parseIdeaStartParam,
  validateIdeaScoutCard,
  type IdeaScoutCard,
} from '../services/ideaScout/rules';
import { resolveContinuumIdeaId, takeContinuumLink } from '../services/ideaScout/continuum';
import { claimIdeaCardSlot, completeIdeaSketch, fetchCompetitorSnapshots, handleIdeaScoutRoute, nichePulseReply } from '../worker/ideaScout';
import { handleTelegramUpdate } from '../worker/telegramBot';
import type { Env } from '../worker/env';

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      async get(key: string, type?: string) {
        const val = store.get(key);
        if (val == null) return null;
        if (type === 'json') return JSON.parse(val);
        return val;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
      async delete(key: string) {
        store.delete(key);
      },
    },
  };
}

function envWithDb(store?: Map<string, string>, skipMigrations?: string[]): Env {
  const mem = store ? { store, kv: memoryKvFrom(store) } : memoryKv();
  return {
    ASSETS: {} as Env['ASSETS'],
    DB: createSqliteD1(skipMigrations ? { skipMigrations } : {}),
    LUMINARA_KV: mem.kv as unknown as KVNamespace,
    FREE_DAILY_LIMIT: '10',
    REQUIRE_TG_AUTH: 'true',
    WEBAPP_URL: 'https://luminarasuite.com',
    BOT_TOKEN: '123456:MOCK_TOKEN',
    GROQ_API_KEY: 'hosted-secret-key',
  };
}

function memoryKvFrom(store: Map<string, string>) {
  return {
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (val == null) return null;
      if (type === 'json') return JSON.parse(val);
      return val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function signInitData(fields: Record<string, string>, token = '123456:MOCK_TOKEN'): string {
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function initDataFor(id = 4242): string {
  return signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'idea',
    user: JSON.stringify({ id, first_name: 'Ada', username: 'ada' }),
  });
}

function ideaRequest(body: unknown, headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request('https://luminarasuite.com/api/idea-scout', {
    method,
    headers: {
      'content-type': 'application/json',
      'x-telegram-init-data': initDataFor(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const ideaBody = {
  idea: 'A clinic booking tool for after-hours questions.',
  niche: 'dental clinics',
  competitorUrls: [] as string[],
};

function baseCard(): IdeaScoutCard {
  const built = buildIdeaScoutCard({
    idea: ideaBody.idea,
    niche: ideaBody.niche,
    snapshots: [],
  });
  const verdict = validateIdeaScoutCard(built);
  if (!verdict.ok) throw new Error(verdict.error);
  return verdict.card;
}

describe('idea scout card schema', () => {
  it('builds a hypothesis card with no percentages', () => {
    const card = baseCard();
    expect(card.whoAsksAi.label).toBe('model_inference');
    expect(card.contentBets).toHaveLength(3);
    expect(card.contentBets.every((bet) => bet.label === 'hypothesis')).toBe(true);
    expect(card.siteChecklist.every((item) => item.status === 'not_measured')).toBe(true);
    expect(card.competitorCitation.status).toBe('not_measured');
    expect(JSON.stringify(card)).not.toMatch(/\d+(?:\.\d+)?\s*%/);
  });

  it('rejects SERP percentages, score keys, and measured badges', () => {
    const card = baseCard() as unknown as Record<string, unknown>;
    expect(validateIdeaScoutCard({ ...card, serpShare: '42%' }).code).toBe('PERCENT_NOT_ACCEPTED');
    expect(validateIdeaScoutCard({ ...card, citationRatePercent: 12 }).code).toBe('SCORE_NOT_ACCEPTED');
    const measured = structuredClone(baseCard()) as unknown as { competitorCitation: { status: string } };
    measured.competitorCitation.status = 'measured';
    expect(validateIdeaScoutCard(measured).code).toBe('MEASURED_NOT_ALLOWED');
    const badge = structuredClone(baseCard()) as unknown as { siteChecklist: Array<{ status: string }> };
    badge.siteChecklist[0].status = 'measured';
    expect(validateIdeaScoutCard(badge).code).toBe('MEASURED_NOT_ALLOWED');
  });

  it('rejects fetched status without a page sample and keeps a real fetch', () => {
    const card = baseCard();
    card.competitorCitation.status = 'fetched';
    expect(validateIdeaScoutCard(card).code).toBe('BAD_SHAPE');
    const fetched = buildIdeaScoutCard({
      idea: ideaBody.idea,
      niche: null,
      snapshots: [{
        url: 'https://stripe.com/pricing',
        hostname: 'stripe.com',
        title: 'Pricing',
        metaDescription: null,
        headings: ['Plans'],
        fetchStatus: 'fetched',
      }],
    });
    const verdict = validateIdeaScoutCard(fetched);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.card.competitorCitation.status).toBe('fetched');
  });

  it('drops a model sketch that contains percentage theater', () => {
    const card = baseCard();
    const kept = applyModelSketch(card, '{"problem":"Wins 40% of searches","contentBets":[{"label":"hypothesis","hypothesis":"Ship a page."}]}');
    expect(kept.problem).toBe(card.problem);
    expect(JSON.stringify(kept)).not.toContain('40');
    expect(JSON.stringify(kept)).not.toMatch(/%/);
    const measured = applyModelSketch(card, '{"problem":"A tighter signup for clinics.","status":"measured"}');
    expect(measured).toEqual(card);
  });

  it('accepts a clean model sketch without copying competitor scores', () => {
    const card = baseCard();
    const next = applyModelSketch(card, JSON.stringify({
      problem: 'Clinics need a way to answer after hours. This is not a measurement.',
      citationRatePercent: 12,
    }));
    expect(next.problem).toContain('after hours');
    expect(JSON.stringify(next)).not.toContain('citationRatePercent');
    expect(JSON.stringify(next)).not.toContain('12');
  });
});

describe('idea scout hostname guards', () => {
  it('rejects localhost, IP literals, credentials, and special-use suffixes', () => {
    for (const host of [
      'http://localhost/admin',
      'http://127.0.0.1/',
      'https://10.0.0.1/',
      'http://169.254.169.254/latest',
      'https://192.168.1.9/',
      'https://8.8.8.8/',
      'https://printer.local/',
      'https://db.internal/',
      'https://foo.example/',
      'http://[::1]/',
      'https://user:pw@stripe.com/',
      'ftp://stripe.com/',
      'javascript:alert(1)',
    ]) {
      expect(normalizeCompetitorUrl(host), host).toBeNull();
    }
    expect(normalizeCompetitorUrl('https://stripe.com/pricing')).toBe('https://stripe.com/pricing');
    expect(parseCompetitorUrls(['https://stripe.com', 'https://shop.example.org', 'https://a.com', 'https://b.com']).code).toBe('TOO_MANY_COMPETITORS');
    expect(parseIdeaScoutRequest({ idea: 'short', competitorUrls: ['http://localhost'] }).code).toBe('BAD_IDEA');
    expect(parseIdeaScoutRequest({
      idea: ideaBody.idea,
      competitorUrls: ['http://localhost'],
    }).code).toBe('BAD_COMPETITOR');
    expect(parseIdeaScoutRequest({ idea: 'We will win 40% of search.', niche: 'clinics' }).code).toBe('BAD_IDEA');
  });
});

describe('idea scout continuum', () => {
  it('requires a public hostname and refuses a guest measured claim', () => {
    expect(continuumAuditStartParam('stripe.com')).toBe('audit_stripe.com');
    expect(continuumAuditStartParam('https://Stripe.COM/pricing')).toBe('audit_stripe.com');
    expect(continuumAuditStartParam('localhost')).toBeNull();
    expect(assessContinuumLink({ domain: 'localhost' }, safePublicHostname)).toMatchObject({ code: 'BAD_DOMAIN' });
    expect(assessContinuumLink({
      domain: 'stripe.com',
      measurementStatus: 'measured',
      evidencePresent: false,
    }).code).toBe('MEASURED_WITHOUT_EVIDENCE');
    expect(assessContinuumLink({
      domain: 'stripe.com',
      measurementStatus: 'measured',
      evidencePresent: true,
      callerIsGuest: true,
    }).code).toBe('GUEST_CANNOT_CLAIM_MEASURED');
    expect(assessContinuumLink({
      domain: 'stripe.com',
      citationRatePercent: 10,
    }).code).toBe('SCORE_NOT_ACCEPTED');
    const ok = assessContinuumLink({ domain: 'https://stripe.com/pricing', measurementStatus: 'not_measured' });
    expect(ok).toMatchObject({ ok: true, domain: 'stripe.com', auditRunId: null });
  });

  it('opens Idea Scout from startapp=idea and leaves audit_ and ref_ alone', () => {
    expect(resolveTelegramStart('idea')).toEqual({ view: AppView.IDEA_SCOUT });
    expect(parseIdeaStartParam('idea_is_0123456789abcdef')).toEqual({ ideaId: 'is_0123456789abcdef' });
    expect(resolveTelegramStart('idea_is_0123456789abcdef')).toEqual({
      view: AppView.IDEA_SCOUT,
      ideaId: 'is_0123456789abcdef',
    });
    expect(resolveTelegramStart('audit_stripe.com')).toEqual({ view: AppView.INSTANT_AUDIT, auditUrl: 'stripe.com' });
    expect(resolveTelegramStart('ref_abcdefghj2').view).toBe(AppView.INSTANT_AUDIT);
    expect(resolveTelegramStart('idea').auditUrl).toBeUndefined();
    expect(ideaCardSlot({ subscribed: false, byok: false, usedToday: 2 }).code).toBe('IDEA_DAILY_CAP');
    expect(ideaCardSlot({ subscribed: true, byok: false, usedToday: 9 }).ok).toBe(true);
  });

  it('clears the continuum id after one link and when Instant Audit is not a handoff', () => {
    const id = resolveContinuumIdeaId(undefined, { type: 'handoff', ideaId: 'is_0123456789abcdef' });
    expect(id).toBe('is_0123456789abcdef');
    const first = takeContinuumLink(id);
    expect(first).toEqual({ linkId: 'is_0123456789abcdef', next: undefined });
    const second = takeContinuumLink(first.next);
    expect(second.linkId).toBeUndefined();
    expect(resolveContinuumIdeaId(id, { type: 'link_succeeded' })).toBeUndefined();
    expect(resolveContinuumIdeaId(id, { type: 'open_instant_audit' })).toBeUndefined();
    expect(resolveContinuumIdeaId(id, { type: 'leave_idea_scout' })).toBeUndefined();
    expect(resolveContinuumIdeaId(id, { type: 'link_failed' })).toBe(id);
    expect(resolveContinuumIdeaId(undefined, { type: 'handoff' })).toBeUndefined();
  });
});

describe('page sample', () => {
  it('keeps title, meta, and headings and drops the article body and percentages', () => {
    const html = `
      <html><head>
        <title>Grow 40% faster</title>
        <meta name="description" content="Plans for clinics">
      </head>
      <body>
        <h1>After hours</h1>
        <h2>Booking</h2>
        <p>This paragraph must not be stored as a crawl of the whole page. Secret body text stays out.</p>
      </body></html>`;
    const sample = extractPageSample(html);
    expect(sample.title).toBe('Grow faster');
    expect(sample.metaDescription).toBe('Plans for clinics');
    expect(sample.headings).toEqual(['After hours', 'Booking']);
    expect(JSON.stringify(sample)).not.toContain('Secret body');
    expect(JSON.stringify(sample)).not.toMatch(/%/);
  });
});

describe('idea scout routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fetch or mint a card for an anonymous caller', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('hosted burn');
    });
    vi.stubGlobal('fetch', fetchMock);
    const env = envWithDb();
    const res = await handleIdeaScoutRoute(
      new Request('https://luminarasuite.com/api/idea-scout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ideaBody),
      }),
      env,
      '/idea-scout',
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('AUTH_REQUIRED');

    const withKey = await handleIdeaScoutRoute(
      new Request('https://luminarasuite.com/api/idea-scout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-provider-key': 'user-owned-key' },
        body: JSON.stringify(ideaBody),
      }),
      env,
      '/idea-scout',
    );
    expect(withKey.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('meters two free cards per UTC day and refuses percentage theater from the model', async () => {
    const env = envWithDb();
    const deps = { completeModel: async () => '{"problem":"Wins 40% of AI answers"}' };
    const first = await handleIdeaScoutRoute(ideaRequest(ideaBody), env, '/idea-scout', deps);
    expect(first.status).toBe(200);
    const created = await first.json() as { id: string; card: IdeaScoutCard; ideaCardsRemaining: number };
    expect(created.id).toMatch(/^is_[a-f0-9]{16}$/);
    expect(JSON.stringify(created.card)).not.toMatch(/%/);
    expect(JSON.stringify(created.card)).not.toContain('40');
    expect(created.card.problem).toContain('not a market measurement');
    expect(created.ideaCardsRemaining).toBe(1);

    const second = await handleIdeaScoutRoute(ideaRequest(ideaBody), env, '/idea-scout', deps);
    expect(second.status).toBe(200);
    const third = await handleIdeaScoutRoute(ideaRequest(ideaBody), env, '/idea-scout', deps);
    expect(third.status).toBe(429);
    const capped = await third.json() as { code?: string };
    expect(capped.code).toBe('IDEA_DAILY_CAP');
  });

  it('rejects private competitor URLs before fetch and uses a caller key without hosted secrets', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('should not fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    const env = envWithDb();
    const bad = await handleIdeaScoutRoute(
      ideaRequest({ ...ideaBody, competitorUrls: ['http://localhost/admin'] }),
      env,
      '/idea-scout',
    );
    expect(bad.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('authorization') || '';
      expect(String(url)).toContain('groq.com');
      expect(auth).toBe('Bearer user-owned-key');
      expect(auth).not.toContain('hosted-secret-key');
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"problem":"Front desk overflow at night for clinics."}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const byok = await handleIdeaScoutRoute(
      ideaRequest(ideaBody, { 'x-provider-key': 'user-owned-key' }),
      env,
      '/idea-scout',
    );
    expect(byok.status).toBe(200);
    const body = await byok.json() as { hosted: boolean; card: IdeaScoutCard };
    expect(body.hosted).toBe(false);
    expect(body.card.problem).toContain('Front desk overflow');
    expect(JSON.stringify(body.card)).not.toMatch(/%/);
  });

  it('links a public domain to an owned audit run and ignores another account', async () => {
    const env = envWithDb();
    const created = await handleIdeaScoutRoute(
      ideaRequest(ideaBody),
      env,
      '/idea-scout',
      { completeModel: async () => null },
    );
    const { id } = await created.json() as { id: string };
    await env.DB!.prepare(
      `INSERT INTO audit_runs (id, account_id, domain, focus, status, created_at) VALUES (?, ?, ?, 'AEO', 'complete', ?)`,
    ).bind('run_idea_01', '4242', 'stripe.com', Date.now()).run();
    await env.DB!.prepare(
      `INSERT INTO audit_runs (id, account_id, domain, focus, status, created_at) VALUES (?, ?, ?, 'AEO', 'complete', ?)`,
    ).bind('run_other_9', '9999', 'stripe.com', Date.now()).run();

    const hostile = await handleIdeaScoutRoute(
      ideaRequest({ domain: 'http://127.0.0.1' }, {}, 'PATCH'),
      env,
      `/idea-scout/${id}/link`,
    );
    expect(hostile.status).toBe(400);

    const unmeasured = await handleIdeaScoutRoute(
      ideaRequest({ domain: 'stripe.com', measurementStatus: 'measured', evidencePresent: false }, {}, 'PATCH'),
      env,
      `/idea-scout/${id}/link`,
    );
    expect(unmeasured.status).toBe(400);

    const linked = await handleIdeaScoutRoute(
      ideaRequest({ domain: 'https://stripe.com/pricing', auditRunId: 'run_other_9', measurementStatus: 'not_measured' }, {}, 'PATCH'),
      env,
      `/idea-scout/${id}/link`,
    );
    expect(linked.status).toBe(200);
    const body = await linked.json() as { linkedDomain: string; linkedAuditRunId: string; startParam: string };
    expect(body.linkedDomain).toBe('stripe.com');
    expect(body.linkedAuditRunId).toBe('run_idea_01');
    expect(body.startParam).toBe('audit_stripe.com');
    expect(body.linkedAuditRunId).not.toBe('run_other_9');
  });

  it('does not spend a free slot or the hosted meter when storage fails or migration 0013 is missing', async () => {
    const store = new Map<string, string>();
    const missing = envWithDb(store, ['0013']);
    let sketched = false;
    const unmigrated = await handleIdeaScoutRoute(ideaRequest(ideaBody), missing, '/idea-scout', {
      completeModel: async () => {
        sketched = true;
        return null;
      },
    });
    expect(unmigrated.status).toBe(503);
    const unmigratedBody = await unmigrated.json() as { code?: string };
    expect(unmigratedBody.code).toBe('MIGRATION_REQUIRED');
    expect(sketched).toBe(false);
    expect([...store.keys()].some((key) => key.startsWith('quota:'))).toBe(false);

    const env = envWithDb(store);
    const prepare = env.DB!.prepare.bind(env.DB);
    let ideaInserts = 0;
    env.DB!.prepare = ((sql: string) => {
      const stmt = prepare(sql);
      if (!/INSERT INTO idea_scouts/i.test(sql)) return stmt;
      return {
        bind: (...args: unknown[]) => {
          const bound = stmt.bind(...args);
          return {
            ...bound,
            async run() {
              ideaInserts += 1;
              if (ideaInserts === 1) throw new Error('disk full');
              return bound.run();
            },
          };
        },
      };
    }) as typeof env.DB.prepare;
    let modelCalls = 0;
    const failed = await handleIdeaScoutRoute(ideaRequest(ideaBody), env, '/idea-scout', {
      completeModel: async () => {
        modelCalls += 1;
        return null;
      },
    });
    expect(failed.status).toBe(503);
    const failedBody = await failed.json() as { code?: string };
    expect(failedBody.code).toBe('STORE_FAILED');
    expect(modelCalls).toBe(1);
    expect([...store.keys()].some((key) => key.startsWith('quota:'))).toBe(false);
    const used = await env.DB!.prepare('SELECT used FROM idea_scout_daily').first<{ used: number }>();
    expect(used).toBeNull();

    const recovered = await handleIdeaScoutRoute(ideaRequest(ideaBody), env, '/idea-scout', {
      completeModel: async () => null,
    });
    expect(recovered.status).toBe(200);
    const card = await recovered.json() as { ideaCardsRemaining: number };
    expect(card.ideaCardsRemaining).toBe(1);
  });

  it('compare-and-swap keeps concurrent free cards at two', async () => {
    const env = envWithDb();
    const now = Date.now();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimIdeaCardSlot(env, '4242', now)),
    );
    expect(claims.filter((claim) => claim.ok)).toHaveLength(2);
    const counter = await env.DB!.prepare(
      'SELECT used FROM idea_scout_daily WHERE account_id = ?',
    ).bind('4242').first<{ used: number }>();
    expect(Number(counter?.used)).toBe(2);

    const deps = { completeModel: async () => null };
    const created = await Promise.all(
      Array.from({ length: 6 }, () => handleIdeaScoutRoute(ideaRequest(ideaBody), env, '/idea-scout', deps)),
    );
    const statuses = created.map((res) => res.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(0);
    expect(statuses.filter((status) => status === 429)).toHaveLength(6);
    const fresh = envWithDb();
    const raced = await Promise.all(
      Array.from({ length: 6 }, () => handleIdeaScoutRoute(ideaRequest(ideaBody), fresh, '/idea-scout', deps)),
    );
    expect(raced.filter((res) => res.status === 200)).toHaveLength(2);
    expect(raced.filter((res) => res.status === 429)).toHaveLength(4);
    const rows = await fresh.DB!.prepare('SELECT COUNT(*) AS n FROM idea_scouts').first<{ n: number }>();
    const slot = await fresh.DB!.prepare('SELECT used FROM idea_scout_daily').first<{ used: number }>();
    expect(Number(rows?.n)).toBe(2);
    expect(Number(slot?.used)).toBe(2);
  });
});

describe('niche pulse', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('formats a hypothesis and does not send on a schedule', () => {
    const text = formatNichePulseMessage({ niche: 'dental clinics', tip: 'Write one FAQ a buyer might paste into an assistant.' });
    expect(text).toContain('Niche Pulse');
    expect(text).toContain('dental clinics');
    expect(text).toContain('not a ranking');
    expect(text).toContain('does not send it on a schedule');
    expect(text).not.toMatch(/%/);
  });

  it('answers /pulse with storage and does not call the model', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWithDb();
    await handleTelegramUpdate(
      { message: { chat: { id: 5 }, from: { id: 5 }, text: '/pulse dental clinics' } },
      env,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent.text).toContain('Niche Pulse');
    expect(sent.text).toContain('dental clinics');
    expect(sent.text).toContain('does not send it on a schedule');
    expect(sent.reply_markup.inline_keyboard[0][0].web_app.url).toContain('startapp=idea');
    const stored = await nichePulseReply(env, '5', '');
    expect(stored).toContain('dental clinics');
  });
});

describe('competitor fetch depth', () => {
  it('does not fetch HTML for a private address and does not follow redirects', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).includes('dns-query')) {
        const parsed = new URL(String(url));
        const name = parsed.searchParams.get('name');
        const type = parsed.searchParams.get('type');
        if (type === 'AAAA') return new Response(JSON.stringify({ Status: 0, Answer: [] }));
        const ip = name === 'private-test.com' ? '10.1.2.3' : '1.1.1.1';
        return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: ip }] }));
      }
      if (String(url).includes('stripe.com')) {
        return new Response('<html><title>Pricing</title><h1>Plans</h1><p>long body that must stay out</p></html>', {
          status: 302,
          headers: { 'content-type': 'text/html', location: 'https://10.0.0.1/secret' },
        });
      }
      return new Response('no', { status: 500 });
    });
    const rows = await fetchCompetitorSnapshots(
      ['https://private-test.com/admin', 'https://stripe.com/pricing'],
      fetcher as unknown as typeof fetch,
    );
    expect(rows[0]).toMatchObject({ hostname: 'private-test.com', fetchStatus: 'not_measured', title: null });
    expect(rows[1]).toMatchObject({ hostname: 'stripe.com', fetchStatus: 'not_measured', title: null });
    expect(calls.some((url) => url.startsWith('https://private-test.com'))).toBe(false);
    expect(calls.some((url) => url.startsWith('https://10.0.0.1'))).toBe(false);
    expect(calls.some((url) => url.startsWith('https://stripe.com'))).toBe(true);
  });

  it('stores title and headings from a public 200 and drops the body', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (String(url).includes('dns-query')) {
        const type = new URL(String(url)).searchParams.get('type');
        if (type === 'AAAA') return new Response(JSON.stringify({ Status: 0, Answer: [] }));
        return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] }));
      }
      return new Response('<html><title>Pricing</title><h1>Plans</h1><p>long body that must stay out</p></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });
    const rows = await fetchCompetitorSnapshots(['https://stripe.com/pricing'], fetcher as unknown as typeof fetch);
    expect(rows[0].fetchStatus).toBe('fetched');
    expect(rows[0].title).toBe('Pricing');
    expect(rows[0].headings).toEqual(['Plans']);
    expect(JSON.stringify(rows)).not.toContain('long body');
  });
});

describe('hosted idea sketch', () => {
  it('does not fall through to a hosted key when the caller key fails', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(new Headers(init?.headers).get('authorization') || '');
      return new Response('no', { status: 401 });
    });
    const text = await completeIdeaSketch(
      { GROQ_API_KEY: 'hosted-secret-key', WEBAPP_URL: 'https://luminarasuite.com' } as Env,
      'idea',
      'user-owned-key',
      fetcher as unknown as typeof fetch,
    );
    expect(text).toBeNull();
    expect(calls).toEqual(['Bearer user-owned-key']);
  });
});
