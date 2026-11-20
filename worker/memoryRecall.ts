/**
 * Ranked account-memory recall (flag MEMORY_RECALL_V2).
 *
 * Full-text search (FTS5, bm25) over the account's active facts. If a vector index is configured,
 * its hits are merged in by Reciprocal Rank Fusion. The result is capped by item count, characters
 * and time, so memory can never crowd out the prompt or hold up a reply. Owner rules (kind
 * 'constraint') are left out here because scopedMemory.ts puts them in the prompt on their own.
 *
 * The layered-memory approach (typed facts, hybrid retrieval, RRF, recall budgets) follows ideas
 * published in TencentDB Agent Memory (MIT). This file is written from scratch for Luminara.
 */
import type { Env } from './env';
import { resolveVectorProvider, searchMemoryVectors, type MemoryVectorHit } from './memoryRag';

export type RecallBudget = { maxItems: number; maxChars: number; timeoutMs: number };

export const DEFAULT_RECALL_BUDGET: RecallBudget = { maxItems: 5, maxChars: 1200, timeoutMs: 400 };

/** Standard RRF constant: higher k flattens the weight between ranks. */
export const RRF_K = 60;

const CANDIDATES_PER_LIST = 20;
const MAX_QUERY_TERMS = 12;

const ON = new Set(['true', 'on', '1', 'yes']);

export function memoryRecallV2Enabled(env: Pick<Env, 'MEMORY_RECALL_V2'>): boolean {
  return ON.has(String(env.MEMORY_RECALL_V2 ?? '').trim().toLowerCase());
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'our', 'with', 'this', 'that', 'from',
  'have', 'has', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'how', 'can',
  'could', 'should', 'would', 'will', 'about', 'into', 'than', 'then', 'them', 'they', 'their',
  'there', 'these', 'those', 'does', 'did', 'just', 'like', 'also', 'any', 'all', 'some', 'get',
  'please', 'tell', 'show', 'give', 'make', 'want', 'need',
]);

/**
 * Turns free text into a safe FTS5 query: each word is a quoted string joined with OR, so user
 * text can never inject FTS operators (NEAR, *, -, column filters, parentheses).
 * Returns null when nothing searchable is left.
 */
export function ftsQueryFromText(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  const unique = [...new Set(words)].slice(0, MAX_QUERY_TERMS);
  if (!unique.length) return null;
  return unique.map((w) => `"${w}"`).join(' OR ');
}

/** Each item scores the sum over lists of 1 / (k + rank + 1). An item found by both lists rises. */
export function rrfMerge<T>(lists: T[][], getId: (item: T) => string, k = RRF_K): Array<T & { rrfScore: number }> {
  const merged = new Map<string, { item: T; rrfScore: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const id = getId(item);
      const score = 1 / (k + rank + 1);
      const seen = merged.get(id);
      if (seen) seen.rrfScore += score;
      else merged.set(id, { item, rrfScore: score });
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .map(({ item, rrfScore }) => ({ ...item, rrfScore }));
}

/** Keeps whole items in rank order until the item or character cap is reached. */
export function applyRecallBudget<T extends { text: string }>(hits: T[], budget: Pick<RecallBudget, 'maxItems' | 'maxChars'>): T[] {
  const out: T[] = [];
  let chars = 0;
  for (const hit of hits) {
    if (out.length >= budget.maxItems) break;
    if (chars + hit.text.length > budget.maxChars) continue;
    out.push(hit);
    chars += hit.text.length;
  }
  return out;
}

export type RecallHit = MemoryVectorHit & { kind: string };

async function ftsHits(env: Env, accountId: string, query: string, projectId: string | null): Promise<RecallHit[]> {
  const match = ftsQueryFromText(query);
  if (!match || !env.DB) return [];
  const rows = await env.DB.prepare(
    `SELECT f.id AS id, f.text AS text, f.kind AS kind, bm25(memory_facts_fts) AS rank
     FROM memory_facts_fts
     JOIN memory_facts f ON f.id = memory_facts_fts.fact_id
     WHERE memory_facts_fts MATCH ?
       AND f.account_id = ?
       AND f.status = 'active'
       AND f.kind <> 'constraint'
       AND (f.expires_at IS NULL OR f.expires_at > ?)
       AND (f.project_id IS NULL OR f.project_id = ?)
     ORDER BY rank
     LIMIT ?`,
  )
    .bind(match, accountId, Date.now(), projectId, CANDIDATES_PER_LIST)
    .all<{ id: string; text: string; kind: string | null; rank: number }>();
  // bm25 is lower-is-better; flip the sign so a bigger score means a better match.
  return (rows.results || []).map((r) => ({ id: r.id, text: r.text, kind: r.kind || 'fact', score: -r.rank }));
}

async function vectorHits(env: Env, accountId: string, query: string): Promise<RecallHit[]> {
  // Only a configured index counts. With none, searchMemoryVectors falls back to keyword overlap,
  // which would duplicate the full-text list.
  if (resolveVectorProvider(env) === 'none') return [];
  const hits = await searchMemoryVectors(env, accountId, query, CANDIDATES_PER_LIST);
  const vectorPrefix = `${accountId}:`;
  return hits
    .map((h) => ({ ...h, id: h.id.startsWith(vectorPrefix) ? h.id.slice(vectorPrefix.length) : h.id, kind: 'fact' }))
    .filter((h) => h.text);
}

function withTimeout<T>(task: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([task.catch(() => fallback), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Ranked memory for one account and, when given, one project. Facts with no project apply to
 * every project. Never throws: an error or a timeout gives an empty list.
 */
export async function recallMemory(
  env: Env,
  accountId: string,
  query: string,
  opts: { projectId?: string | null; budget?: Partial<RecallBudget> } = {},
): Promise<RecallHit[]> {
  const budget = { ...DEFAULT_RECALL_BUDGET, ...opts.budget };
  const projectId = opts.projectId ?? null;
  const work = (async () => {
    const [fts, vec] = await Promise.all([
      ftsHits(env, accountId, query, projectId).catch((err) => {
        console.warn(JSON.stringify({ event: 'memory_recall_fts_failed', error: String(err) }));
        return [] as RecallHit[];
      }),
      vectorHits(env, accountId, query).catch(() => [] as RecallHit[]),
    ]);
    const merged = rrfMerge([fts, vec], (h) => h.id).map(({ rrfScore, ...hit }) => ({ ...hit, score: rrfScore }));
    return applyRecallBudget(merged, budget);
  })();
  return withTimeout(work, budget.timeoutMs, []);
}

/** One line per fact for the fenced prompt block. Kinds are labels; no scores reach the model. */
export function formatRecallLines(hits: RecallHit[]): string {
  return hits.map((h, i) => `${i + 1}. [${h.kind}] ${h.text}`).join('\n');
}
