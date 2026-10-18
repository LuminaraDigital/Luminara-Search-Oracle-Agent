import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Env } from '../worker/env';
import { FEED_SHARES_PER_UTC_DAY, handleIdeaScoutRoute } from '../worker/ideaScout';
import { createPrivacyJob } from '../worker/privacyService';
import { linkTelegramAndFirebase } from '../worker/userStore';
import type { HostedIdentity } from '../worker/userTypes';
import { billingId, identify } from '../worker/workerUtils';
import { buildIdeaScoutCard } from '../services/ideaScout/rules';
import { createSqliteD1, type SqliteD1 } from './helpers/sqliteD1';

/**
 * Track SW, SW0a-9: the community idea feed in D1. These tests run with COMMUNITY_FEED_ENABLED on;
 * tests/featureSwitches.test.ts covers it off, which is how it ships.
 */

const TOKEN = '123456:MOCK_TOKEN';
const NOON = Date.UTC(2026, 9, 11, 12);
const DAY = 24 * 60 * 60_000;
const ALICE = 5550001;
const BOB = 5550002;
const CAROL = 5550003;
const IDEA = 'Appointment reminders by text message for independent repair shops';

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (val == null) return null;
      return type === 'json' ? JSON.parse(val) : val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function makeEnv(options: { skipMigrations?: string[] } = {}) {
  const kv = memoryKv();
  const db = createSqliteD1(options);
  const env = {
    ASSETS: {} as Env['ASSETS'],
    DB: db as D1Database,
    LUMINARA_KV: kv as unknown as KVNamespace,
    FREE_DAILY_LIMIT: '10',
    REQUIRE_TG_AUTH: 'true',
    WEBAPP_URL: 'https://luminarasuite.com',
    BOT_TOKEN: TOKEN,
    COMMUNITY_FEED_ENABLED: 'true',
  } as Env;
  return { env, kv, db: db as SqliteD1 };
}

function authHeaders(id: number): Record<string, string> {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Builder', username: `builder${id}` }),
  };
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const params = new URLSearchParams(fields);
  params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return { 'content-type': 'application/json', 'x-telegram-init-data': params.toString() };
}

type CallOptions = { tgId?: number; body?: unknown; query?: string; now?: number; ip?: string };

function call(env: Env, path: string, method: string, opts: CallOptions = {}) {
  const headers: Record<string, string> = opts.tgId ? authHeaders(opts.tgId) : { 'content-type': 'application/json' };
  if (opts.ip) headers['cf-connecting-ip'] = opts.ip;
  const request = new Request(`https://luminarasuite.com/api${path}${opts.query ?? ''}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return handleIdeaScoutRoute(request, env, path, { now: () => opts.now ?? NOON });
}

const feed = (env: Env, opts: CallOptions = {}) => call(env, '/idea-scout/feed', 'GET', opts);
const share = (env: Env, tgId: number, ideaId: string, now?: number) => call(env, '/idea-scout/share', 'POST', { tgId, body: { ideaId }, now });
const vote = (env: Env, tgId: number, cardId: string) => call(env, '/idea-scout/vote', 'POST', { tgId, body: { id: cardId } });

async function accountOf(env: Env, tgId: number): Promise<string> {
  const who = await identify(new Request('https://luminarasuite.com/api/idea-scout', { headers: authHeaders(tgId) }), env);
  return billingId(who.user!);
}

let ideaSeq = 0;
/** Stores an idea card the way POST /idea-scout does, owned by the Telegram user's account. */
async function ownIdea(env: Env, db: SqliteD1, tgId: number, cardJson?: string): Promise<string> {
  const id = `is_${String(++ideaSeq).padStart(16, '0')}`;
  const card = cardJson ?? JSON.stringify(buildIdeaScoutCard({ idea: IDEA, niche: 'Auto repair', snapshots: [] }));
  db.sqlite
    .prepare(
      `INSERT INTO idea_scouts (id, account_id, idea_text, niche, competitor_urls_json, card_json, status, created_at)
       VALUES (?, ?, ?, 'Auto repair', '[]', ?, 'ready', ?)`,
    )
    .run(id, await accountOf(env, tgId), IDEA, card, NOON);
  return id;
}

async function sharedCard(env: Env, db: SqliteD1, tgId: number): Promise<string> {
  const res = await share(env, tgId, await ownIdea(env, db, tgId));
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

const count = (db: SqliteD1, table: 'community_feed_cards' | 'community_feed_votes') =>
  Number(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
const votes = (db: SqliteD1) =>
  db.sqlite.prepare(`SELECT card_id, account_id FROM community_feed_votes ORDER BY card_id, account_id`).all().map((r: object) => ({ ...r }));
const cards = (db: SqliteD1) =>
  db.sqlite.prepare(`SELECT id, account_id FROM community_feed_cards ORDER BY id`).all().map((r: object) => ({ ...r }));

/** Every key in a JSON body, at any depth. */
function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

/** The same database, with `change` applied to every statement whose SQL matches `pattern`. */
function withStatements(db: SqliteD1, pattern: RegExp, change: (stmt: any) => object): D1Database {
  const wrap = (stmt: any, sql: string): any => {
    const bound = { ...stmt, bind: (...args: unknown[]) => wrap(stmt.bind(...args), sql) };
    return pattern.test(sql) ? { ...bound, ...change(stmt) } : bound;
  };
  return { ...db, prepare: (sql: string) => wrap(db.prepare(sql), sql) } as unknown as D1Database;
}

/** Any statement whose SQL matches `pattern` fails when it runs, alone or inside a batch. */
function failingOn(db: SqliteD1, pattern: RegExp): D1Database {
  const fail = () => {
    throw new Error('D1_ERROR: Network connection lost.');
  };
  return withStatements(db, pattern, () => ({ execute: fail, run: async () => fail() }));
}

describe('the community feed in D1', () => {
  it('an empty feed returns an empty list, and the old KV feed is not served', async () => {
    const { env, kv } = makeEnv();
    kv.store.set('idea_scout:community_feed', JSON.stringify([{ id: 'is_seed_offline_crm', ideaText: 'x', upvotes: 12, accountId: 'acct_old' }]));
    const res = await feed(env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cards: [] });
  });

  it('no feed response, success or refusal, contains an account id or an idea id', async () => {
    const { env, db } = makeEnv();
    const bodies: string[] = [];
    const seen = async (pending: Promise<Response>) => {
      const res = await pending;
      bodies.push(await res.clone().text());
      return res;
    };

    const ideaId = await ownIdea(env, db, ALICE);
    const { id: cardId } = (await (await seen(share(env, ALICE, ideaId))).json()) as { id: string };
    await seen(share(env, ALICE, ideaId));
    await seen(share(env, BOB, ideaId));
    for (let i = 1; i < FEED_SHARES_PER_UTC_DAY; i++) await seen(share(env, ALICE, await ownIdea(env, db, ALICE)));
    expect((await seen(share(env, ALICE, await ownIdea(env, db, ALICE)))).status).toBe(429);
    await seen(vote(env, BOB, cardId));
    await seen(vote(env, BOB, cardId));
    await seen(vote(env, BOB, ideaId));
    await seen(call(env, '/idea-scout/vote', 'POST', { body: { id: cardId } }));
    await seen(feed(env));
    await seen(feed(env, { tgId: ALICE }));
    await seen(feed(env, { tgId: BOB, query: '?sort=top' }));

    expect(cardId).toMatch(/^cf_[a-f0-9]{16}$/);
    const forbidden = [await accountOf(env, ALICE), await accountOf(env, BOB), ideaId];
    for (const text of bodies) {
      for (const value of forbidden) expect(text, text).not.toContain(value);
      expect(keysOf(JSON.parse(text)).filter((k) => /account|owner|user/i.test(k)), text).toEqual([]);
    }
  });

  it('sharing another account\'s card id returns 404 and adds nothing', async () => {
    const { env, db } = makeEnv();
    const alicesIdea = await ownIdea(env, db, ALICE);
    const res = await share(env, BOB, alicesIdea);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'Unknown idea card.', code: 'NOT_FOUND' });
    expect(count(db, 'community_feed_cards')).toBe(0);
    expect((await (await feed(env)).json()) as unknown).toEqual({ ok: true, cards: [] });
  });

  it.each([
    ['deleted', `DELETE FROM idea_scouts WHERE id = ?`],
    ['moved to another account', `UPDATE idea_scouts SET account_id = 'acct_other' WHERE id = ?`],
  ])('ownership is checked again inside the insert: a card %s after the lookup is not published', async (_, change) => {
    const { env, db } = makeEnv();
    const ideaId = await ownIdea(env, db, ALICE);
    env.DB = withStatements(db, /SELECT card_json FROM idea_scouts/, (stmt) => ({
      first: async (column?: string) => {
        const row = await stmt.first(column);
        db.sqlite.prepare(change).run(ideaId);
        return row;
      },
    }));
    const res = await share(env, ALICE, ideaId);
    expect(res.status).toBe(404);
    expect(count(db, 'community_feed_cards')).toBe(0);
  });

  it('sharing one card twice keeps one row and answers with the same feed id', async () => {
    const { env, db } = makeEnv();
    const ideaId = await ownIdea(env, db, ALICE);
    const first = (await (await share(env, ALICE, ideaId)).json()) as { id: string; alreadyShared: boolean };
    const again = (await (await share(env, ALICE, ideaId)).json()) as { id: string; alreadyShared: boolean };
    expect(first.alreadyShared).toBe(false);
    expect(again).toEqual({ ok: true, id: first.id, alreadyShared: true });
    expect(count(db, 'community_feed_cards')).toBe(1);
  });

  it('one account voting twice counts once', async () => {
    const { env, db } = makeEnv();
    const cardId = await sharedCard(env, db, ALICE);
    expect(await (await vote(env, BOB, cardId)).json()).toEqual({ ok: true, id: cardId, upvotes: 1, alreadyVoted: false });
    expect(await (await vote(env, BOB, cardId)).json()).toEqual({ ok: true, id: cardId, upvotes: 1, alreadyVoted: true });
    expect(await (await vote(env, CAROL, cardId)).json()).toEqual({ ok: true, id: cardId, upvotes: 2, alreadyVoted: false });
    expect(count(db, 'community_feed_votes')).toBe(2);
  });

  it('a vote names a visible feed card, nothing else', async () => {
    const { env, db } = makeEnv();
    const ideaId = await ownIdea(env, db, ALICE);
    const { id: cardId } = (await (await share(env, ALICE, ideaId)).json()) as { id: string };
    for (const id of [ideaId, 'cf_0000000000000000', '', [cardId]]) {
      expect((await call(env, '/idea-scout/vote', 'POST', { tgId: BOB, body: { id } })).status, JSON.stringify(id)).toBe(404);
    }
    expect(count(db, 'community_feed_votes')).toBe(0);
  });

  it('the daily share cap is counted inside the insert, so shares sent together cannot pass it', async () => {
    const { env, db } = makeEnv();
    // Eight shares in all from one account, under the share rate limit of 10 a minute.
    expect(FEED_SHARES_PER_UTC_DAY + 3).toBeLessThanOrEqual(10);
    const ideas: string[] = [];
    for (let i = 0; i < FEED_SHARES_PER_UTC_DAY + 2; i++) ideas.push(await ownIdea(env, db, ALICE));
    // Hold every share at its idea lookup until all of them are there, so they reach the insert together.
    let waiting = 0;
    let release!: () => void;
    const together = new Promise<void>((done) => (release = done));
    const fallback = setTimeout(release, 2_000);
    env.DB = withStatements(db, /SELECT card_json FROM idea_scouts/, (stmt) => ({
      first: async (column?: string) => {
        if (++waiting === ideas.length) release();
        await together;
        return stmt.first(column);
      },
    }));

    const results = await Promise.all(ideas.map((id) => share(env, ALICE, id))).finally(() => clearTimeout(fallback));
    expect(waiting, 'every share was held at the lookup').toBe(ideas.length);
    const statuses = results.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([...Array(FEED_SHARES_PER_UTC_DAY).fill(200), 429, 429]);
    const refused = await results.find((r) => r.status === 429)!.json();
    expect(refused).toMatchObject({ ok: false, code: 'SHARE_DAILY_CAP', limit: FEED_SHARES_PER_UTC_DAY });
    expect(count(db, 'community_feed_cards')).toBe(FEED_SHARES_PER_UTC_DAY);

    env.DB = db;
    const unshared = ideas.find((id) => !db.sqlite.prepare(`SELECT 1 FROM community_feed_cards WHERE idea_id = ?`).get(id))!;
    expect((await share(env, ALICE, unshared, NOON + DAY)).status).toBe(200);
  });

  it('a hidden card leaves the feed, keeps its row and takes no votes', async () => {
    const { env, db } = makeEnv();
    const ideaId = await ownIdea(env, db, ALICE);
    const { id } = (await (await share(env, ALICE, ideaId)).json()) as { id: string };
    db.sqlite.prepare(`UPDATE community_feed_cards SET status = 'hidden' WHERE id = ?`).run(id);

    expect(await (await feed(env)).json()).toEqual({ ok: true, cards: [] });
    expect((await vote(env, BOB, id)).status).toBe(404);
    expect(await (await share(env, ALICE, ideaId)).json()).toEqual({ ok: true, id, alreadyShared: true });
    expect(db.sqlite.prepare(`SELECT status FROM community_feed_cards WHERE id = ?`).get(id).status).toBe('hidden');
    expect(count(db, 'community_feed_votes')).toBe(0);
  });

  it('the public card is the problem, prompts and hypotheses: no competitor URL or scraped page text', async () => {
    const { env, db } = makeEnv();
    const withCompetitor = buildIdeaScoutCard({
      idea: IDEA,
      niche: 'Auto repair',
      snapshots: [{
        url: 'https://acme-tools.com/pricing?token=private',
        hostname: 'acme-tools.com',
        title: 'Acme pricing page',
        metaDescription: 'Scraped description',
        headings: ['Scraped heading'],
        fetchStatus: 'fetched',
      }],
    });
    // A field the card schema does not name, nested where the public card copies from.
    const stored = {
      ...withCompetitor,
      whoAsksAi: { ...withCompetitor.whoAsksAi, internal: 'Private note' },
      contentBets: withCompetitor.contentBets.map((bet) => ({ ...bet, internal: 'Private note' })),
    };
    expect((await share(env, ALICE, await ownIdea(env, db, ALICE, JSON.stringify(stored)))).status).toBe(200);

    const text = await (await feed(env)).text();
    const body = JSON.parse(text) as { cards: Array<{ card: { whoAsksAi: object; contentBets: object[] } }> };
    const card = body.cards[0].card;
    expect(Object.keys(card).sort()).toEqual(['contentBets', 'problem', 'whoAsksAi']);
    expect(Object.keys(card.whoAsksAi).sort()).toEqual(['label', 'persona', 'promptPatterns']);
    for (const bet of card.contentBets) expect(Object.keys(bet).sort()).toEqual(['hypothesis', 'label']);
    for (const leaked of ['acme-tools', 'token=private', 'Scraped', 'Acme pricing', 'Private note']) expect(text).not.toContain(leaked);
    expect(text).not.toMatch(/\d+(?:\.\d+)?\s*%/);
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });

  it('a stored card that fails the honesty checks is neither shared nor shown', async () => {
    const { env, db } = makeEnv();
    const percent = JSON.stringify({ ...buildIdeaScoutCard({ idea: IDEA, niche: null, snapshots: [] }), problem: 'Repair shops lose 40% of bookings to no-shows' });
    const res = await share(env, ALICE, await ownIdea(env, db, ALICE, percent));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe('CARD_REJECTED');
    expect(count(db, 'community_feed_cards')).toBe(0);

    db.sqlite
      .prepare(
        `INSERT INTO community_feed_cards (id, account_id, idea_id, idea_text, niche, card_json, utc_day, shared_at)
         VALUES ('cf_00000000000000aa', 'acct_other', 'is_00000000000000aa', 'An idea', NULL, ?, '2026-10-11', 1)`,
      )
      .run(percent);
    expect(await (await feed(env)).json()).toEqual({ ok: true, cards: [] });
  });

  it('sort=top orders by votes, the default by newest first', async () => {
    const { env, db } = makeEnv();
    const older = await sharedCard(env, db, ALICE);
    const newer = (await (await share(env, BOB, await ownIdea(env, db, BOB), NOON + 1)).json()) as { id: string };
    await vote(env, CAROL, older);
    const ids = async (query?: string) => ((await (await feed(env, { query })).json()) as { cards: Array<{ id: string }> }).cards.map((c) => c.id);
    expect(await ids()).toEqual([newer.id, older]);
    expect(await ids('?sort=top')).toEqual([older, newer.id]);
  });

  it.each([
    ['/idea-scout/vote', 30, { id: 'cf_0000000000000000' }],
    ['/idea-scout/share', 10, { ideaId: 'is_ffffffffffffffff' }],
  ] as const)('%s allows %i a minute per account, from any address', async (path, limit, body) => {
    const { env } = makeEnv();
    for (let i = 0; i < limit; i++) {
      expect((await call(env, path, 'POST', { tgId: ALICE, body, ip: `10.0.0.${i + 1}` })).status).not.toBe(429);
    }
    const over = await call(env, path, 'POST', { tgId: ALICE, body, ip: '10.0.1.1' });
    expect(over.status).toBe(429);
    expect(((await over.json()) as { code: string }).code).toBe('RATE_LIMITED');
    expect((await call(env, path, 'POST', { tgId: BOB, body, ip: '10.0.1.1' })).status).not.toBe(429);
  });

  it.each([
    ['/idea-scout/feed', 'GET', 60, undefined],
    ['/idea-scout/vote', 'POST', 30, { id: 'cf_0000000000000000' }],
    ['/idea-scout/share', 'POST', 10, { ideaId: 'is_ffffffffffffffff' }],
  ] as const)('%s %s allows %i a minute per address, across accounts', async (path, method, limit, body) => {
    const { env } = makeEnv();
    for (let i = 0; i < limit; i++) {
      expect((await call(env, path, method, { tgId: 6_000_000 + i, body, ip: '10.9.9.9' })).status).not.toBe(429);
    }
    const over = await call(env, path, method, { tgId: 7_000_000, body, ip: '10.9.9.9' });
    expect(over.status).toBe(429);
    expect(((await over.json()) as { code: string }).code).toBe('RATE_LIMITED');
  });
});

describe('the feed and the account behind it', () => {
  const userOf = async (env: Env, tgId: number) => {
    const accountId = await accountOf(env, tgId);
    return { id: String(tgId), accountId, source: 'telegram' } as HostedIdentity;
  };

  it('deleting an account removes its cards, its votes, and other accounts\' votes on its cards', async () => {
    const { env, db } = makeEnv();
    const a = await sharedCard(env, db, ALICE);
    const hidden = await sharedCard(env, db, ALICE);
    const b = await sharedCard(env, db, BOB);
    const c = await sharedCard(env, db, CAROL);
    for (const [who, card] of [[ALICE, b], [ALICE, c], [BOB, a], [BOB, hidden], [BOB, c], [CAROL, a]] as const) {
      expect((await vote(env, who, card)).status).toBe(200);
    }
    db.sqlite.prepare(`UPDATE community_feed_cards SET status = 'hidden' WHERE id = ?`).run(hidden);

    expect((await createPrivacyJob(env, await userOf(env, ALICE), 'delete')).status).toBe(200);

    expect(cards(db).map((r: { id: string }) => r.id).sort()).toEqual([b, c].sort());
    expect(votes(db)).toEqual([{ card_id: c, account_id: await accountOf(env, BOB) }]);
  });

  it('the deletion is one batch: when a statement in it fails, no card or vote is deleted', async () => {
    const { env, db } = makeEnv();
    const a = await sharedCard(env, db, ALICE);
    const b = await sharedCard(env, db, BOB);
    await vote(env, BOB, a);
    await vote(env, ALICE, b);
    const before = { cards: cards(db), votes: votes(db) };

    env.DB = failingOn(db, /DELETE FROM community_feed_cards WHERE account_id/);
    expect((await createPrivacyJob(env, await userOf(env, ALICE), 'delete')).status).toBe(500);
    expect({ cards: cards(db), votes: votes(db) }).toEqual(before);
  });

  it('the export carries both tables, and not who voted on the account\'s cards', async () => {
    const { env, kv, db } = makeEnv();
    const a = await sharedCard(env, db, ALICE);
    const b = await sharedCard(env, db, BOB);
    await vote(env, BOB, a);
    await vote(env, CAROL, a);
    await vote(env, ALICE, b);

    const exported = await createPrivacyJob(env, await userOf(env, ALICE), 'export');
    const { jobId } = (await exported.json()) as { jobId: string };
    const raw = (await kv.get(`privacy:export:${jobId}`)) as string;
    const body = JSON.parse(raw);
    expect(body.processors).toEqual(expect.arrayContaining(['community_feed_cards', 'community_feed_votes']));
    expect(body.communityFeedCards).toEqual([
      expect.objectContaining({ id: a, status: 'visible', utc_day: '2026-10-11', upvotes: 2, card_json: expect.any(String) }),
    ]);
    expect(body.communityFeedVotes).toEqual([{ card_id: b, created_at: NOON }]);
    for (const voter of [BOB, CAROL]) expect(raw).not.toContain(await accountOf(env, voter));
  });

  const insertCard = (db: SqliteD1, id: string, accountId: string, ideaId: string) =>
    db.sqlite
      .prepare(
        `INSERT INTO community_feed_cards (id, account_id, idea_id, idea_text, niche, card_json, utc_day, shared_at)
         VALUES (?, ?, ?, 'An idea', NULL, '{}', '2026-10-11', 1)`,
      )
      .run(id, accountId, ideaId);
  const insertVote = (db: SqliteD1, cardId: string, accountId: string) =>
    db.sqlite.prepare(`INSERT INTO community_feed_votes (card_id, account_id, created_at) VALUES (?, ?, 1)`).run(cardId, accountId);

  it('cards and votes follow the surviving account on a link; a collision keeps the survivor\'s row', async () => {
    const { env, kv, db } = makeEnv();
    insertCard(db, 'cf_tg_only', '777', 'is_a');
    insertCard(db, 'cf_tg_clash', '777', 'is_same');
    insertCard(db, 'cf_fb_clash', 'fb:uid-1', 'is_same');
    insertCard(db, 'cf_other', 'acct_other', 'is_b');
    insertVote(db, 'cf_other', '777');
    insertVote(db, 'cf_other', 'fb:uid-1');
    insertVote(db, 'cf_fb_clash', '777');
    insertVote(db, 'cf_tg_clash', 'acct_other');

    // The web account holds the paid plan, so it is the one that survives.
    await kv.put('sub:fb:uid-1', JSON.stringify({ plan: 'starter', expiresAt: Date.now() + DAY }));
    const linked = await linkTelegramAndFirebase(env, '777', 'uid-1');
    expect(linked.accountId).toBe('fb:uid-1');

    expect(cards(db)).toEqual([
      { id: 'cf_fb_clash', account_id: 'fb:uid-1' },
      { id: 'cf_other', account_id: 'acct_other' },
      { id: 'cf_tg_only', account_id: 'fb:uid-1' },
    ]);
    expect(votes(db)).toEqual([
      { card_id: 'cf_fb_clash', account_id: 'fb:uid-1' },
      { card_id: 'cf_other', account_id: 'fb:uid-1' },
    ]);
  });

  it('when the Telegram account is the one kept, the web account\'s cards and votes move to it', async () => {
    const { env, db } = makeEnv();
    insertCard(db, 'cf_fb_only', 'fb:uid-2', 'is_c');
    insertCard(db, 'cf_other', 'acct_other', 'is_d');
    insertVote(db, 'cf_other', 'fb:uid-2');

    // Neither side is paid, and the Telegram row is written first, so it is the older and survives.
    const linked = await linkTelegramAndFirebase(env, '778', 'uid-2');
    expect(linked.accountId).toBe('778');

    expect(cards(db)).toEqual([
      { id: 'cf_fb_only', account_id: '778' },
      { id: 'cf_other', account_id: 'acct_other' },
    ]);
    expect(votes(db)).toEqual([{ card_id: 'cf_other', account_id: '778' }]);
  });
});

describe('a database without migration 0033', () => {
  it('the feed routes say the migration is missing; export, delete and link still work', async () => {
    const { env, db } = makeEnv({ skipMigrations: ['0033'] });
    const ideaId = await ownIdea(env, db, ALICE);
    for (const res of [await feed(env), await share(env, ALICE, ideaId), await vote(env, BOB, 'cf_0000000000000000')]) {
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe('MIGRATION_REQUIRED');
    }
    const alice = { id: String(ALICE), accountId: await accountOf(env, ALICE), source: 'telegram' } as HostedIdentity;
    expect((await createPrivacyJob(env, alice, 'export')).status).toBe(200);
    expect((await createPrivacyJob(env, alice, 'delete')).status).toBe(200);
    expect((await linkTelegramAndFirebase(env, '779', 'uid-3')).accountId).toBe('779');
  });
});

describe('the release checks know the tables', () => {
  it('the smoke check lists the migration and both tables', () => {
    const source = readFileSync(resolve(__dirname, '..', 'scripts', 'smoke-check.mjs'), 'utf8');
    expect(source).toContain("'migrations/0033_community_feed.sql'");
    expect(source).toContain("'community_feed_cards'");
    expect(source).toContain("'community_feed_votes'");
  });
});
