/**
 * Typed fact extraction (worker/memoryExtract.ts). No model is called: fetch is a fake whose
 * reply is a fixture, and the database is SQLite with the real migrations.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';
import { extractTypedFacts, memoryLlmExtractEnabled, parseExtraction } from '../worker/memoryExtract';
import { extractFactsFromChat } from '../worker/memoryRag';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';

const SOURCE = 'We run a dog grooming salon in Leeds with 3 staff. Always answer in plain English, please.';

function modelReply(facts: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ facts }) } }] }), { status: 200 }),
  ) as unknown as typeof fetch;
}

const envWith = (db: unknown, flags: Partial<Env> = {}) =>
  ({ DB: db, GROQ_API_KEY: 'test-key', ...flags }) as unknown as Env;

describe('parseExtraction', () => {
  const ok = { kind: 'profile', text: 'Runs a dog grooming salon in Leeds', confidence: 0.9 };

  it('keeps a grounded fact of a known kind', () => {
    expect(parseExtraction(JSON.stringify({ facts: [ok] }), SOURCE)).toEqual([ok]);
  });

  it('drops unknown kinds, questions, and too short or too long text', () => {
    const raw = JSON.stringify({
      facts: [
        { kind: 'secret', text: 'Runs a dog grooming salon in Leeds', confidence: 0.9 },
        { kind: 'profile', text: 'Does the salon in Leeds groom dogs?', confidence: 0.9 },
        { kind: 'profile', text: 'Leeds', confidence: 0.9 },
        { kind: 'profile', text: `Dog grooming salon ${'Leeds '.repeat(80)}`, confidence: 0.9 },
      ],
    });
    expect(parseExtraction(raw, SOURCE)).toEqual([]);
  });

  it('drops a fact carrying a number the user never typed', () => {
    const raw = JSON.stringify({
      facts: [
        { kind: 'profile', text: 'Dog grooming salon in Leeds with 3 staff', confidence: 0.9 },
        { kind: 'profile', text: 'Dog grooming salon in Leeds earns 40000 a year', confidence: 0.9 },
      ],
    });
    expect(parseExtraction(raw, SOURCE).map((f) => f.text)).toEqual(['Dog grooming salon in Leeds with 3 staff']);
  });

  it('drops a fact whose words are not the user’s', () => {
    const raw = JSON.stringify({ facts: [{ kind: 'profile', text: 'Specialises in luxury feline spa treatments', confidence: 0.9 }] });
    expect(parseExtraction(raw, SOURCE)).toEqual([]);
  });

  it('clamps confidence and tolerates fenced JSON; garbage gives an empty list', () => {
    const fenced = '```json\n' + JSON.stringify({ facts: [{ ...ok, confidence: 7 }] }) + '\n```';
    expect(parseExtraction(fenced, SOURCE)[0].confidence).toBe(1);
    expect(parseExtraction('not json', SOURCE)).toEqual([]);
    expect(parseExtraction(JSON.stringify({ facts: 'x' }), SOURCE)).toEqual([]);
    expect(parseExtraction(null, SOURCE)).toEqual([]);
  });
});

describe('extractTypedFacts', () => {
  const facts = [
    { kind: 'profile', text: 'Runs a dog grooming salon in Leeds', confidence: 0.9 },
    { kind: 'instruction', text: 'Always answer in plain English', confidence: 0.95 },
    { kind: 'preference', text: 'Answer in plain English please', confidence: 0.4 },
  ];

  it('stores confident facts with kind, project and dedupe key; files the rest as pending', async () => {
    const db = createSqliteD1();
    const fetcher = modelReply(facts);
    const out = await extractTypedFacts(envWith(db), 'acc_a', { message: SOURCE, autoStore: true, projectId: 'p1' }, fetcher);
    expect(out).toMatchObject({ ok: true, extractor: 'model', candidates: 3, stored: 2, duplicates: 0 });
    const rows = db.sqlite.prepare(`SELECT kind, project_id, status, content_sha256 FROM memory_facts ORDER BY kind`).all();
    expect(rows.map((r: any) => [r.kind, r.project_id, r.status])).toEqual([
      ['instruction', 'p1', 'active'],
      ['profile', 'p1', 'active'],
    ]);
    expect(rows.every((r: any) => /^[0-9a-f]{64}$/.test(r.content_sha256))).toBe(true);
    const pending = db.sqlite.prepare(`SELECT status FROM memory_chat_extractions WHERE status = 'pending'`).all();
    expect(pending).toHaveLength(1);
    const indexed = db.sqlite.prepare(`SELECT COUNT(*) AS n FROM memory_facts_fts`).get().n;
    expect(indexed).toBe(2);
  });

  it('sends the message fenced as untrusted data', async () => {
    const fetcher = modelReply([]);
    await extractTypedFacts(envWith(createSqliteD1()), 'acc_a', { message: SOURCE }, fetcher);
    const body = JSON.parse((fetcher as any).mock.calls[0][1].body);
    expect(body.messages[1].content).toContain('UNTRUSTED_USER_MESSAGE');
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('the same fact twice is stored once and logged as NONE', async () => {
    const db = createSqliteD1();
    const env = envWith(db);
    await extractTypedFacts(env, 'acc_a', { message: SOURCE, autoStore: true }, modelReply([facts[0]]));
    const again = await extractTypedFacts(env, 'acc_a', { message: SOURCE, autoStore: true }, modelReply([facts[0]]));
    expect(again).toMatchObject({ stored: 0, duplicates: 1 });
    expect(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM memory_facts`).get().n).toBe(1);
    expect(db.sqlite.prepare(`SELECT event FROM memory_history ORDER BY created_at`).all().map((r: any) => r.event)).toEqual(['ADD', 'NONE']);
  });

  it('returns null when no model answers, so the caller can fall back', async () => {
    const down = vi.fn(async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
    expect(await extractTypedFacts(envWith(createSqliteD1()), 'acc_a', { message: SOURCE }, down)).toBeNull();
    const noKey = envWith(createSqliteD1(), { GROQ_API_KEY: undefined, GROQ_API_KEY_FALLBACK: undefined });
    expect(await extractTypedFacts(noKey, 'acc_a', { message: SOURCE }, modelReply(facts))).toBeNull();
  });
});

describe('extractFactsFromChat flag', () => {
  const user = { id: 'acc_a', source: 'firebase' } as unknown as HostedIdentity;

  it('flag off: never calls a model and keeps the regex extractor', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const db = createSqliteD1();
    const env = envWith(db);
    expect(memoryLlmExtractEnabled(env)).toBe(false);
    const res = await extractFactsFromChat(env, user, { message: 'We always reply within one day to every customer', autoStore: true });
    const body = (await res.json()) as { extractor?: string; candidates: number };
    expect(body.extractor).toBeUndefined();
    expect(body.candidates).toBe(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('flag on but model down: falls back to the regex extractor', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('down', { status: 500 }));
    const env = envWith(createSqliteD1(), { MEMORY_LLM_EXTRACT: 'true' });
    const res = await extractFactsFromChat(env, user, { message: 'We always reply within one day to every customer', autoStore: true });
    const body = (await res.json()) as { extractor?: string; candidates: number };
    expect(spy).toHaveBeenCalledTimes(1);
    expect(body.extractor).toBeUndefined();
    expect(body.candidates).toBe(1);
    spy.mockRestore();
  });
});
