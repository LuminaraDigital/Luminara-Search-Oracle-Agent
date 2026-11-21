/**
 * Fact extraction (worker/memoryExtract.ts) and the shared store (memoryRag.storeChatFacts).
 * No model is called: fetch is a fake whose reply is a fixture, and the database is SQLite with
 * the real migrations. The parse cases are the ones a review found slipping through.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';
import {
  extractChatFacts,
  handleMemoryExtractRoute,
  memoryLlmExtractEnabled,
  parseExtraction,
} from '../worker/memoryExtract';
import { assertedSentences, CHAT_FACTS_DAILY_CAP, regexFactCandidates, storeChatFacts } from '../worker/memoryRag';
import { rememberConstraint } from '../worker/scopedMemory';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';

const SOURCE = 'We run a dog grooming salon in Leeds with 3 staff. Always answer in plain English, please.';

function modelReply(facts: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ facts }) } }] }), { status: 200 }),
  ) as unknown as typeof fetch;
}

const envWith = (db: unknown, flags: Partial<Env> = {}) =>
  ({ DB: db, GROQ_API_KEY: 'test-key', MEMORY_LLM_EXTRACT: 'true', ...flags }) as unknown as Env;

const keep = (source: string, facts: Array<{ kind?: string; text: string }>) =>
  parseExtraction(JSON.stringify({ facts: facts.map((f) => ({ kind: 'profile', confidence: 0.9, ...f })) }), source).map((f) => f.text);

describe('parseExtraction', () => {
  it('keeps a grounded fact of a known kind, short ones included', () => {
    expect(keep(SOURCE, [{ text: 'Runs a dog grooming salon in Leeds' }])).toEqual(['Runs a dog grooming salon in Leeds']);
    expect(keep('We sell cakes.', [{ text: 'Sells cakes.' }])).toEqual(['Sells cakes.']);
  });

  it('drops unknown kinds, questions and over-long text', () => {
    expect(keep(SOURCE, [{ kind: 'secret', text: 'Runs a dog grooming salon in Leeds' }])).toEqual([]);
    expect(keep(SOURCE, [{ text: 'Does the salon in Leeds groom dogs?' }])).toEqual([]);
    expect(keep(SOURCE, [{ text: `Dog grooming salon ${'Leeds '.repeat(80)}` }])).toEqual([]);
  });

  it('matches numbers whole: a number inside a longer one is not the user’s', () => {
    expect(keep('We have 300 clients in Leeds.', [{ text: 'Serves 3 clients in Leeds' }])).toEqual([]);
    expect(keep('Our conversion rate was 12.35% last year.', [{ text: 'Our conversion rate is 3%' }])).toEqual([]);
    expect(keep('Orders are £150 each since 2023.', [{ text: 'Orders are £15 each since 2023' }])).toEqual([]);
    expect(keep(SOURCE, [{ text: 'Dog grooming salon in Leeds with 3 staff' }])).toEqual(['Dog grooming salon in Leeds with 3 staff']);
  });

  it('drops a fact whose words are not the user’s', () => {
    expect(keep(SOURCE, [{ text: 'Specialises in luxury feline spa treatments' }])).toEqual([]);
    expect(keep('We are a bakery in Bristol.', [{ text: 'Market leader in artisan bread' }])).toEqual([]);
  });

  it('keeps decimals and version numbers whole', () => {
    expect(assertedSentences('We charge £1.50 per delivery. Version 2.0 shipped.')).toEqual([
      'We charge £1.50 per delivery.',
      'Version 2.0 shipped.',
    ]);
    expect(keep('We charge £1.50 per delivery.', [{ text: 'Charges £1.50 per delivery' }])).toEqual(['Charges £1.50 per delivery']);
    expect(keep('We charge £1.50 per delivery.', [{ text: 'Charges £1 per delivery' }])).toEqual([]);
  });

  it('treats thousands separators as the same number', () => {
    expect(keep('Our average order is £1,250.', [{ text: 'Average order is £1250' }])).toEqual(['Average order is £1250']);
  });

  it('checks numbers written as words', () => {
    expect(keep('We have two shops in Leeds.', [{ text: 'Has three shops in Leeds' }])).toEqual([]);
    expect(keep('We have two shops in Leeds.', [{ text: 'Has two shops in Leeds' }])).toEqual(['Has two shops in Leeds']);
  });

  it('refuses a fact that drops or adds a negation', () => {
    expect(keep('We do NOT deliver to York.', [{ text: 'We deliver to York.' }])).toEqual([]);
    expect(keep('We deliver to York.', [{ text: 'We never deliver to York' }])).toEqual([]);
    expect(keep('We never discount our bread.', [{ text: 'Never discounts bread' }])).toEqual(['Never discounts bread']);
  });

  it('compares the negation with the sentence the fact comes from', () => {
    const source = "We don't deliver to York. We deliver to Leeds every morning.";
    expect(keep(source, [{ text: 'We deliver to Leeds every morning' }])).toEqual(['We deliver to Leeds every morning']);
    expect(keep(source, [{ text: 'We deliver to York' }])).toEqual([]);
  });

  it('never turns a question into a fact', () => {
    expect(assertedSentences('Do we deliver to York? We bake daily.')).toEqual(['We bake daily.']);
    expect(keep('Do we deliver to York?', [{ text: 'The user delivers to York' }])).toEqual([]);
  });

  it('the regex fallback never stores a question either', () => {
    expect(regexFactCandidates('Should we always reply in French? We always reply within one day.')).toEqual([
      { kind: 'fact', text: 'We always reply within one day', confidence: 0.72 },
    ]);
  });

  it('clamps confidence and tolerates fenced JSON; garbage gives an empty list', () => {
    const fenced = '```json\n' + JSON.stringify({ facts: [{ kind: 'profile', text: 'Runs a dog grooming salon in Leeds', confidence: 7 }] }) + '\n```';
    expect(parseExtraction(fenced, SOURCE)[0].confidence).toBe(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseExtraction('not json', SOURCE)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: 'memory_extract_failed', reason: 'invalid_json' }));
    warn.mockRestore();
    expect(parseExtraction(JSON.stringify({ facts: 'x' }), SOURCE)).toEqual([]);
    expect(parseExtraction(null, SOURCE)).toEqual([]);
  });
});

describe('extractChatFacts', () => {
  const facts = [
    { kind: 'profile', text: 'Runs a dog grooming salon in Leeds', confidence: 0.9 },
    { kind: 'instruction', text: 'Always answer in plain English', confidence: 0.95 },
    { kind: 'preference', text: 'Answer in plain English please', confidence: 0.4 },
  ];

  it('stores confident facts with kind, project and dedupe key; files the rest as pending', async () => {
    const db = createSqliteD1();
    const out = await extractChatFacts(envWith(db), 'acc_a', { message: SOURCE, autoStore: true, projectId: 'p1' }, modelReply(facts));
    expect(out).toMatchObject({ ok: true, extractor: 'model', candidates: 3, stored: 2, duplicates: 0 });
    const rows = db.sqlite.prepare(`SELECT kind, project_id, status, content_sha256 FROM memory_facts ORDER BY kind`).all();
    expect(rows.map((r: any) => [r.kind, r.project_id, r.status])).toEqual([
      ['instruction', 'p1', 'active'],
      ['profile', 'p1', 'active'],
    ]);
    expect(rows.every((r: any) => /^[0-9a-f]{64}$/.test(r.content_sha256))).toBe(true);
    expect(db.sqlite.prepare(`SELECT status, COUNT(*) AS n FROM memory_chat_extractions GROUP BY status ORDER BY status`).all()).toEqual([
      { status: 'pending', n: 1 },
      { status: 'stored', n: 2 },
    ]);
    expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM memory_history WHERE event = 'ADD'`).get().n).toBe(2);
    expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM memory_facts_fts`).get().n).toBe(2);
  });

  it('sends the message fenced, with PII removed, in JSON mode with a capped reasoning budget', async () => {
    const fetcher = modelReply([]);
    await extractChatFacts(envWith(createSqliteD1()), 'acc_a', { message: 'Email me at owner@example.com. We bake sourdough in Leeds.' }, fetcher);
    const body = JSON.parse((fetcher as any).mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('UNTRUSTED_USER_MESSAGE');
    expect(body.messages[1].content).not.toContain('owner@example.com');
    expect(body).toMatchObject({ response_format: { type: 'json_object' }, temperature: 0, reasoning_effort: 'low', max_completion_tokens: 800 });
  });

  it('makes no model call when the message only asks questions', async () => {
    const fetcher = modelReply(facts);
    const out = await extractChatFacts(envWith(createSqliteD1()), 'acc_a', { message: 'How do I rank higher? What should I fix first?' }, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(out).toMatchObject({ extractor: 'model', candidates: 0, stored: 0 });
  });

  it('the same fact twice is stored once and logged as NONE', async () => {
    const db = createSqliteD1();
    const env = envWith(db);
    await extractChatFacts(env, 'acc_a', { message: SOURCE, autoStore: true }, modelReply([facts[0]]));
    const again = await extractChatFacts(env, 'acc_a', { message: SOURCE, autoStore: true }, modelReply([facts[0]]));
    expect(again).toMatchObject({ stored: 0, duplicates: 1 });
    expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM memory_facts`).get().n).toBe(1);
    expect(db.sqlite.prepare(`SELECT event FROM memory_history ORDER BY created_at`).all().map((r: any) => r.event)).toEqual(['ADD', 'NONE']);
  });

  it('dedupes against an owner rule with the same text and scope (one shared key)', async () => {
    const db = createSqliteD1();
    const env = envWith(db);
    await rememberConstraint(env, { accountId: 'acc_a', projectId: null, domain: null, text: 'Always answer in plain English', source: 'owner' });
    const out = await extractChatFacts(env, 'acc_a', { message: SOURCE, autoStore: true }, modelReply([facts[1]]));
    expect(out).toMatchObject({ stored: 0, duplicates: 1 });
  });

  it('gives an event fact an expiry and leaves other kinds without one', async () => {
    const db = createSqliteD1();
    const message = 'We are launching our spring menu in Leeds next Friday. We sell sourdough.';
    await extractChatFacts(envWith(db), 'acc_a', { message, autoStore: true }, modelReply([
      { kind: 'event', text: 'Launching the spring menu in Leeds next Friday', confidence: 0.9 },
      { kind: 'profile', text: 'Sells sourdough', confidence: 0.9 },
    ]));
    const rows = db.sqlite.prepare(`SELECT kind, expires_at FROM memory_facts ORDER BY kind`).all() as Array<{ kind: string; expires_at: number | null }>;
    expect(rows[0].kind).toBe('event');
    expect(rows[0].expires_at).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(rows[1]).toEqual({ kind: 'profile', expires_at: null });
  });

  it('files facts as pending once the daily auto-store cap is reached', async () => {
    const db = createSqliteD1();
    const insert = db.sqlite.prepare(`INSERT INTO memory_facts (id, account_id, text, source, created_at) VALUES (?, 'acc_a', ?, 'chat', ?)`);
    for (let i = 0; i < CHAT_FACTS_DAILY_CAP; i++) insert.run(`old_${i}`, `old fact ${i}`, Date.now());
    const out = await extractChatFacts(envWith(db), 'acc_a', { message: SOURCE, autoStore: true }, modelReply([facts[0]]));
    expect(out).toMatchObject({ stored: 0 });
    expect(db.sqlite.prepare(`SELECT status FROM memory_chat_extractions`).all()).toEqual([{ status: 'pending' }]);
  });

  it('falls back to the regex extractor when no model answers, and logs why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const down = vi.fn(async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
    const db = createSqliteD1();
    const out = await extractChatFacts(envWith(db), 'acc_a', { message: 'We always reply within one day to every customer', autoStore: true, projectId: 'p9' }, down);
    expect(out).toMatchObject({ extractor: 'regex', candidates: 1, stored: 1 });
    expect(db.sqlite.prepare(`SELECT kind, project_id FROM memory_facts`).get()).toEqual({ kind: 'fact', project_id: 'p9' });
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain(JSON.stringify({ event: 'memory_extract_failed', status: 503 }));
    warn.mockRestore();
  });

  it('flag off: never calls a model and uses the regex extractor', async () => {
    const fetcher = modelReply(facts);
    const env = envWith(createSqliteD1(), { MEMORY_LLM_EXTRACT: 'false' });
    expect(memoryLlmExtractEnabled(env)).toBe(false);
    const out = await extractChatFacts(env, 'acc_a', { message: 'We always reply within one day to every customer', autoStore: true }, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(out).toMatchObject({ extractor: 'regex', candidates: 1 });
  });
});

describe('storeChatFacts', () => {
  it('writes nothing for no candidates', async () => {
    const db = createSqliteD1();
    expect(await storeChatFacts({ DB: db } as unknown as Env, 'acc_a', [], { extractor: 'regex', autoStore: true })).toEqual({
      extractionIds: [],
      stored: 0,
      duplicates: 0,
    });
  });
});

describe('POST /api/memory/extract', () => {
  const user = { id: 'acc_a', source: 'firebase' } as unknown as HostedIdentity;
  const post = (body: unknown) => new Request('https://x/api/memory/extract', { method: 'POST', body: JSON.stringify(body) });

  it('rejects an empty message and extracts for the signed-in account', async () => {
    const db = createSqliteD1();
    const env = envWith(db, { MEMORY_LLM_EXTRACT: 'false' });
    expect((await handleMemoryExtractRoute(post({ message: ' ' }), env, user)).status).toBe(400);
    const res = await handleMemoryExtractRoute(post({ message: 'We always reply within one day to every customer', autoStore: true }), env, user);
    expect(await res.json()).toMatchObject({ ok: true, extractor: 'regex', stored: 1 });
    expect(db.sqlite.prepare(`SELECT account_id FROM memory_facts`).get()).toEqual({ account_id: 'acc_a' });
  });
});
