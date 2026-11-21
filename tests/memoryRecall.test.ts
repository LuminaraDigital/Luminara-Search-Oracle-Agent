/**
 * Ranked account-memory recall (worker/memoryRecall.ts) against the real migrations in SQLite.
 * Checks the FTS index stays in step with memory_facts, that recall never crosses accounts,
 * projects or status, that budgets hold, and that the flag-off path is the old one.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';
import {
  applyRecallBudget,
  ftsQueryFromText,
  memoryRecallV2Enabled,
  recallBlock,
  recallMemory,
  rrfMerge,
} from '../worker/memoryRecall';
import type { Env } from '../worker/env';

type FactRow = {
  id: string;
  account?: string;
  text: string;
  kind?: string;
  status?: string;
  projectId?: string | null;
  expiresAt?: number | null;
};

function seed(rows: FactRow[]) {
  const db = createSqliteD1();
  const insert = db.sqlite.prepare(
    `INSERT INTO memory_facts (id, account_id, text, kind, status, project_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  rows.forEach((r, i) =>
    insert.run(r.id, r.account ?? 'acc_a', r.text, r.kind ?? 'fact', r.status ?? 'active', r.projectId ?? null, r.expiresAt ?? null, i + 1),
  );
  return db;
}

const envWith = (db: unknown, flags: Partial<Env> = {}) => ({ DB: db, ...flags }) as unknown as Env;

describe('FTS index triggers', () => {
  it('indexes inserts, re-indexes text updates and drops deletes', () => {
    const db = seed([{ id: 'f1', text: 'We bake sourdough in Leeds' }]);
    db.sqlite.exec(`UPDATE memory_facts SET text = 'We bake rye bread in York' WHERE id = 'f1'`);
    const find = (q: string) =>
      db.sqlite.prepare(`SELECT fact_id FROM memory_facts_fts WHERE memory_facts_fts MATCH ?`).all(q).map((r: any) => r.fact_id);
    expect(find('"york"')).toEqual(['f1']);
    expect(find('"leeds"')).toEqual([]);
    db.sqlite.exec(`DELETE FROM memory_facts WHERE id = 'f1'`);
    expect(find('"york"')).toEqual([]);
  });

  it('the privacy erase delete leaves nothing of the account in the index', () => {
    const db = seed([
      { id: 'a1', text: 'Our clinic is in Bristol' },
      { id: 'b1', account: 'acc_b', text: 'Our clinic is in Bath' },
    ]);
    db.sqlite.exec(`DELETE FROM memory_facts WHERE account_id = 'acc_a'`);
    const left = db.sqlite.prepare(`SELECT fact_id FROM memory_facts_fts`).all().map((r: any) => r.fact_id);
    expect(left).toEqual(['b1']);
  });
});

describe('ftsQueryFromText', () => {
  it('quotes every term so FTS operators in user text are inert', () => {
    const q = ftsQueryFromText('bakery NEAR(leeds) -york * "x" OR col:value')!;
    expect(q).toBe('"bakery" OR "near" OR "leeds" OR "york" OR "col" OR "value"');
  });

  it('keeps two-letter terms such as AI and drops two-letter filler', () => {
    expect(ftsQueryFromText('is AI good for us?')).toBe('"ai" OR "good"');
  });

  it('returns null for text with nothing searchable', () => {
    expect(ftsQueryFromText('what is the?')).toBeNull();
    expect(ftsQueryFromText('')).toBeNull();
  });

  it('hostile input runs as a query without throwing', async () => {
    const db = seed([{ id: 'f1', text: 'We sell handmade candles' }]);
    const env = envWith(db);
    for (const hostile of ['"', "candles'); DROP TABLE memory_facts; --", 'NEAR(a b, 2)', '^candles*', '(((', 'col:candles']) {
      await expect(recallMemory(env, 'acc_a', hostile)).resolves.toBeInstanceOf(Array);
    }
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM memory_facts').get().n).toBe(1);
  });
});

describe('rrfMerge', () => {
  it('scores 1/(k+rank+1) per list and lifts items found by both lists', () => {
    const merged = rrfMerge(
      [
        [{ id: 'a' }, { id: 'b' }],
        [{ id: 'b' }, { id: 'c' }],
      ],
      (x) => x.id,
      60,
    );
    expect(merged.map((m) => m.id)).toEqual(['b', 'a', 'c']);
    expect(merged[0].rrfScore).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(merged[1].rrfScore).toBeCloseTo(1 / 61, 10);
  });
});

describe('applyRecallBudget', () => {
  it('caps items and characters, skipping an item that would overflow', () => {
    const hits = [{ text: 'x'.repeat(50) }, { text: 'y'.repeat(80) }, { text: 'z'.repeat(20) }, { text: 'w'.repeat(5) }];
    expect(applyRecallBudget(hits, { maxItems: 5, maxChars: 100 }).map((h) => h.text[0])).toEqual(['x', 'z', 'w']);
    expect(applyRecallBudget(hits, { maxItems: 1, maxChars: 1000 })).toHaveLength(1);
  });
});

describe('recallMemory', () => {
  const rows: FactRow[] = [
    { id: 'mine', text: 'We prefer short replies about our candle shop' },
    { id: 'other_account', account: 'acc_b', text: 'Our candle shop is in Paris' },
    { id: 'rule', kind: 'constraint', text: 'Never mention the candle recall' },
    { id: 'gone', status: 'deleted', text: 'Old candle supplier was Acme' },
    { id: 'expired', expiresAt: 1, text: 'Candle sale ends Friday' },
    { id: 'project_x', projectId: 'p_x', text: 'Candle shop project X targets Leeds' },
    { id: 'project_y', projectId: 'p_y', text: 'Candle shop project Y targets York' },
  ];

  it('returns only this account’s active, unexpired, non-rule facts', async () => {
    const env = envWith(seed(rows));
    const ids = (await recallMemory(env, 'acc_a', 'candle shop')).map((h) => h.id).sort();
    expect(ids).toEqual(['mine']);
  });

  it('with a project, adds that project’s facts and never another project’s', async () => {
    const env = envWith(seed(rows));
    const ids = (await recallMemory(env, 'acc_a', 'candle shop', { projectId: 'p_x' })).map((h) => h.id).sort();
    expect(ids).toEqual(['mine', 'project_x']);
  });

  it('carries the fact kind', async () => {
    const env = envWith(seed([{ id: 'p', kind: 'preference', text: 'Prefers replies in plain English' }]));
    const [hit] = await recallMemory(env, 'acc_a', 'english replies');
    expect(hit.kind).toBe('preference');
  });

  it('gives an empty list, not an error, when the database fails or is slow', async () => {
    const broken = { prepare: () => { throw new Error('boom'); } };
    await expect(recallMemory(envWith(broken), 'acc_a', 'candle')).resolves.toEqual([]);
    const slow = {
      prepare: () => ({ bind: () => ({ all: () => new Promise((r) => setTimeout(() => r({ results: [{ id: 'x', text: 'late', kind: 'fact', rank: -1 }] }), 200)) }) }),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(recallMemory(envWith(slow), 'acc_a', 'candle', { budget: { timeoutMs: 20 } })).resolves.toEqual([]);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain(JSON.stringify({ event: 'memory_recall_timeout', timeoutMs: 20 }));
    warn.mockRestore();
  });

  it('finds a fact about AI from a two-letter query word', async () => {
    const env = envWith(seed([{ id: 'ai', text: 'We use AI to write product descriptions' }]));
    expect((await recallMemory(env, 'acc_a', 'what about AI?')).map((h) => h.id)).toEqual(['ai']);
  });

  it('keeps a vector hit only if D1 still allows it, with D1 text, and merges it with its FTS twin', async () => {
    const db = seed(rows);
    const matches = ['mine', 'rule', 'gone', 'expired', 'project_y', 'other_account', 'missing'].map((id, i) => ({
      id: `acc_a:${id}`,
      score: 1 - i / 10,
      metadata: { text: 'stale index text' },
    }));
    const env = envWith(db, { MEMORY_VECTORS: { query: async () => ({ matches }), upsert: async () => ({}) } as any });
    const hits = await recallMemory(env, 'acc_a', 'candle shop', { projectId: 'p_x' });
    expect(hits.map((h) => h.id).sort()).toEqual(['mine', 'project_x']);
    expect(hits.find((h) => h.id === 'mine')?.text).toBe('We prefer short replies about our candle shop');
    expect(hits[0].id).toBe('mine');
  });
});

describe('recallBlock', () => {
  it('flag off: keeps the old keyword path and block format', async () => {
    const env = envWith(seed([{ id: 'f1', text: 'We prefer short replies' }]));
    expect(memoryRecallV2Enabled(env)).toBe(false);
    const out = await recallBlock(env, 'acc_a', 'short replies');
    expect(out.facts).toEqual(['We prefer short replies']);
    expect(out.block).toContain('1. (2.00) We prefer short replies');
  });

  it('flag on: ranked lines carry the kind and no score', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = envWith(seed([{ id: 'f1', kind: 'preference', text: 'We prefer short replies' }]), { MEMORY_RECALL_V2: 'true' });
    const out = await recallBlock(env, 'acc_a', 'short replies');
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'memory_recall', hits: 1 }));
    log.mockRestore();
    expect(out.facts).toEqual(['We prefer short replies']);
    expect(out.block).toContain('1. [preference] We prefer short replies');
    expect(out.block).toMatch(/UNTRUSTED_ACCOUNT_MEMORY_[0-9a-f]+_BEGIN/);
    expect(out.block).not.toMatch(/\(\d+\.\d+\)/);
  });

  it('flag on with no match gives no block', async () => {
    const env = envWith(seed([{ id: 'f1', text: 'We prefer short replies' }]), { MEMORY_RECALL_V2: 'true' });
    expect(await recallBlock(env, 'acc_a', 'pricing for dentists')).toEqual({ block: '', facts: [] });
  });
});
