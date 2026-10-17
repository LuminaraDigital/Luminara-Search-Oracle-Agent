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

function makeEnv() {
  const kv = memoryKv();
  const db = createSqliteD1();
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

function call(env: Env, path: string, method: string, opts: { tgId?: number; body?: unknown; query?: string; now?: number } = {}) {
  const request = new Request(`https://luminarasuite.com/api${path}${opts.query ?? ''}`, {
    method,
    headers: opts.tgId ? authHeaders(opts.tgId) : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return handleIdeaScoutRoute(request, env, path, { now: () => opts.now ?? NOON });
}

const feed = (env: Env, query?: string) => call(env, '/idea-scout/feed', 'GET', { query });
const share = (env: Env, tgId: number, ideaId: string, now?: number) => call(env, '/idea-scout/share', 'POST', { tgId, body: { ideaId }, now });
const vote = (env: Env, tgId: number, cardId: string) => call(env, '/idea-scout/vote', 'POST', { tgId, body: { id: cardId } });

async function accountOf(env: Env, tgId: number): Promise<string> {
  const who = await identify(new Request('https://luminarasuite.com/api/idea-scout', { headers: authHeaders(tgId) }), env);
  return billingId(who.user!);
}

let ideaSeq = 0;
/** Stores an idea card the way POST /idea-scout does, owned by the Telegram user's account. */
async function ownIdea(env: Env, db: SqliteD1, tgId: number): Promise<string> {
  const id = `is_${String(++ideaSeq).padStart(16, '0')}`;
  const idea = 'Appointment reminders by text message for independent repair shops';
  const card = buildIdeaScoutCard({ idea, niche: 'Auto repair', snapshots: [] });
  db.sqlite
    .prepare(
      `INSERT INTO idea_scouts (id, account_id, idea_text, niche, competitor_urls_json, card_json, status, created_at)
       VALUES (?, ?, ?, 'Auto repair', '[]', ?, 'ready', ?)`,
    )
    .run(id, await accountOf(env, tgId), idea, JSON.stringify(card), NOON);
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

/** Every key and every scalar value in a JSON body, as strings. */
function keysAndValues(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysAndValues(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysAndValues(v, out);
    }
  } else if (value != null) out.push(String(value));
  return out;
}

describe('the community feed in D1', () => {
  it('an empty feed returns an empty list, and the old KV feed is not served', async () => {
    const { env, kv } = makeEnv();
    kv.store.set('idea_scout:community_feed', JSON.stringify([{ id: 'is_seed_offline_crm', ideaText: 'x', upvotes: 12, accountId: 'acct_old' }]));
    const res = await feed(env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cards: [] });
  });

  it('a feed response contains no account id, and the public id is the card\'s own, never the idea\'s', async () => {
    const { env, db } = makeEnv();
    const ideaId = await ownIdea(env, db, ALICE);
    const shared = await share(env, ALICE, ideaId);
    const shareBody = (await shared.json()) as { id: string };
    const voted = await vote(env, BOB, shareBody.id);
    const listed = await feed(env);
    const feedBody = (await listed.json()) as { cards: Array<{ id: string; upvotes: number }> };

    expect(shareBody.id).toMatch(/^cf_[a-f0-9]{16}$/);
    expect(feedBody.cards).toHaveLength(1);
    expect(feedBody.cards[0]).toMatchObject({ id: shareBody.id, upvotes: 1 });
    const forbidden = [await accountOf(env, ALICE), await accountOf(env, BOB), ideaId];
    for (const body of [shareBody, await voted.json(), feedBody]) {
      const seen = keysAndValues(body);
      expect(seen.filter((s) => /account/i.test(s) || forbidden.includes(s))).toEqual([]);
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
    await share(env, ALICE, ideaId);
    for (const id of [ideaId, 'cf_0000000000000000', '']) {
      expect((await vote(env, BOB, id)).status, id).toBe(404);
    }
    expect(count(db, 'community_feed_votes')).toBe(0);
  });

  it('the daily share cap is counted inside the insert, so shares sent together cannot pass it', async () => {
    const { env, db } = makeEnv();
    const ideas: string[] = [];
    for (let i = 0; i < FEED_SHARES_PER_UTC_DAY + 2; i++) ideas.push(await ownIdea(env, db, ALICE));
    const results = await Promise.all(ideas.map((id) => share(env, ALICE, id)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([...Array(FEED_SHARES_PER_UTC_DAY).fill(200), 429, 429]);
    const refused = await results.find((r) => r.status === 429)!.json();
    expect(refused).toMatchObject({ ok: false, code: 'SHARE_DAILY_CAP', limit: FEED_SHARES_PER_UTC_DAY });
    expect(count(db, 'community_feed_cards')).toBe(FEED_SHARES_PER_UTC_DAY);

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

  it('sort=top orders by votes, the default by newest first', async () => {
    const { env, db } = makeEnv();
    const older = await sharedCard(env, db, ALICE);
    const newer = (await (await share(env, BOB, await ownIdea(env, db, BOB), NOON + 1)).json()) as { id: string };
    await vote(env, CAROL, older);
    const ids = async (query?: string) => ((await (await feed(env, query)).json()) as { cards: Array<{ id: string }> }).cards.map((c) => c.id);
    expect(await ids()).toEqual([newer.id, older]);
    expect(await ids('?sort=top')).toEqual([older, newer.id]);
  });

  it.each([
    ['/idea-scout/feed', 'GET', 60, undefined],
    ['/idea-scout/vote', 'POST', 30, { id: 'cf_0000000000000000' }],
    ['/idea-scout/share', 'POST', 10, { ideaId: 'is_ffffffffffffffff' }],
  ] as const)('%s %s is rate limited at %i a minute', async (path, method, limit, body) => {
    const { env } = makeEnv();
    for (let i = 0; i < limit; i++) {
      expect((await call(env, path, method, { tgId: ALICE, body })).status).not.toBe(429);
    }
    const over = await call(env, path, method, { tgId: ALICE, body });
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
    const b = await sharedCard(env, db, BOB);
    const c = await sharedCard(env, db, CAROL);
    for (const [who, card] of [[ALICE, b], [ALICE, c], [BOB, a], [BOB, c], [CAROL, a]] as const) {
      expect((await vote(env, who, card)).status).toBe(200);
    }

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
    await vote(env, ALICE, b);

    const exported = await createPrivacyJob(env, await userOf(env, ALICE), 'export');
    const { jobId } = (await exported.json()) as { jobId: string };
    const raw = (await kv.get(`privacy:export:${jobId}`)) as string;
    const body = JSON.parse(raw);
    expect(body.processors).toEqual(expect.arrayContaining(['community_feed_cards', 'community_feed_votes']));
    expect(body.communityFeedCards).toEqual([expect.objectContaining({ id: a, status: 'visible', upvotes: 1 })]);
    expect(body.communityFeedVotes).toEqual([{ card_id: b, created_at: NOON }]);
    expect(raw).not.toContain(`"${await accountOf(env, BOB)}"`);
  });

  it('cards and votes follow the surviving account on a link; a collision keeps the survivor\'s row', async () => {
    const { env, kv, db } = makeEnv();
    const insertCard = db.sqlite.prepare(
      `INSERT INTO community_feed_cards (id, account_id, idea_id, idea_text, niche, card_json, utc_day, shared_at)
       VALUES (?, ?, ?, 'An idea', NULL, '{}', '2026-10-11', 1)`,
    );
    const insertVote = db.sqlite.prepare(`INSERT INTO community_feed_votes (card_id, account_id, created_at) VALUES (?, ?, 1)`);
    insertCard.run('cf_tg_only', '777', 'is_a');
    insertCard.run('cf_tg_clash', '777', 'is_same');
    insertCard.run('cf_fb_clash', 'fb:uid-1', 'is_same');
    insertCard.run('cf_other', 'acct_other', 'is_b');
    insertVote.run('cf_other', '777');
    insertVote.run('cf_other', 'fb:uid-1');
    insertVote.run('cf_fb_clash', '777');
    insertVote.run('cf_tg_clash', 'acct_other');

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
});

describe('the release checks know the tables', () => {
  it('the smoke check lists the migration and both tables', () => {
    const source = readFileSync(resolve(__dirname, '..', 'scripts', 'smoke-check.mjs'), 'utf8');
    expect(source).toContain("'migrations/0033_community_feed.sql'");
    expect(source).toContain("'community_feed_cards'");
    expect(source).toContain("'community_feed_votes'");
  });
});

/** The same database, except that any statement whose SQL matches `pattern` fails when it runs. */
function failingOn(db: SqliteD1, pattern: RegExp): D1Database {
  const fail = (sql: string) => {
    if (pattern.test(sql)) throw new Error('D1_ERROR: Network connection lost.');
  };
  const wrap = (stmt: any, sql: string): any => ({
    ...stmt,
    bind: (...args: unknown[]) => wrap(stmt.bind(...args), sql),
    execute: () => (fail(sql), stmt.execute()),
    run: async () => (fail(sql), stmt.run()),
  });
  return { ...db, prepare: (sql: string) => wrap(db.prepare(sql), sql) } as unknown as D1Database;
}
