/**
 * Account-memory recall: the one place that builds the memory block for a chat prompt.
 *
 * With MEMORY_RECALL_V2 on, recall is full-text search (FTS5, bm25) over the account's active
 * facts. If a vector index is configured, its hits are checked against D1 with the same filter
 * and merged by Reciprocal Rank Fusion. The result is capped by item count, characters and time,
 * so memory never crowds out the prompt or holds up a reply. Owner rules (kind 'constraint') are
 * left out because scopedMemory.ts puts them in the prompt on their own.
 *
 * The layered-memory approach (typed facts, hybrid retrieval, RRF, recall budgets) follows ideas
 * published in TencentDB Agent Memory (MIT). This file is written from scratch for Luminara.
 */
import type { Env } from './env';
import { resolveVectorProvider, searchMemoryVectors } from './memoryRag';
import { flagEnabled } from './preprodFlags';
import { withinBudget } from './workerUtils';
import { wrapUntrustedContent } from '../utils/untrustedContent';

export type RecallBudget = { maxItems: number; maxChars: number; timeoutMs: number };
export type RecallHit = { id: string; text: string; kind: string; score: number };
export type RecallBlock = { block: string; facts: string[] };

export const DEFAULT_RECALL_BUDGET: RecallBudget = { maxItems: 5, maxChars: 1200, timeoutMs: 400 };
export const NO_RECALL: RecallBlock = { block: '', facts: [] };

/** Standard RRF constant: higher k flattens the weight between ranks. */
export const RRF_K = 60;

const CANDIDATES_PER_LIST = 20;
const MAX_QUERY_TERMS = 12;
const BLOCK_HEADING = '## Account memory (retrieved)';

export function memoryRecallV2Enabled(env: Pick<Env, 'MEMORY_RECALL_V2'>): boolean {
  return flagEnabled(env.MEMORY_RECALL_V2);
}

const STOP_WORDS = new Set([
  'is', 'it', 'we', 'do', 'to', 'in', 'on', 'at', 'of', 'an', 'or', 'be', 'by', 'my', 'me', 'us',
  'so', 'if', 'no', 'up', 'as', 'go', 'am', 'he',
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'our', 'with', 'this', 'that', 'from',
  'have', 'has', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'how', 'can',
  'could', 'should', 'would', 'will', 'about', 'into', 'than', 'then', 'them', 'they', 'their',
  'there', 'these', 'those', 'does', 'did', 'just', 'like', 'also', 'any', 'all', 'some', 'get',
  'please', 'tell', 'show', 'give', 'make', 'want', 'need',
]);

/**
 * Turns free text into a safe FTS5 query: each word is a quoted string joined with OR, so user
 * text can never inject FTS operators (NEAR, *, -, column filters, parentheses). Two-letter
 * words count ("AI", "PR"). Returns null when nothing searchable is left.
 */
export function ftsQueryFromText(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
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

/** Which facts recall may use: this account, active, unexpired, not an owner rule, this project or none. */
const RECALLABLE = `f.account_id = ? AND f.status = 'active' AND f.kind <> 'constraint'
       AND (f.expires_at IS NULL OR f.expires_at > ?) AND (f.project_id IS NULL OR f.project_id = ?)`;

type FactRow = { id: string; text: string; kind: string | null };

async function ftsHits(db: D1Database, accountId: string, query: string, projectId: string | null): Promise<RecallHit[]> {
  const match = ftsQueryFromText(query);
  if (!match) return [];
  const rows = await db
    .prepare(
      `SELECT f.id AS id, f.text AS text, f.kind AS kind, bm25(memory_facts_fts) AS rank
       FROM memory_facts_fts
       JOIN memory_facts f ON f.id = memory_facts_fts.fact_id
       WHERE memory_facts_fts MATCH ? AND ${RECALLABLE}
       ORDER BY rank
       LIMIT ?`,
    )
    .bind(match, accountId, Date.now(), projectId, CANDIDATES_PER_LIST)
    .all<FactRow & { rank: number }>();
  // bm25 is lower-is-better; flip the sign so a bigger score means a better match.
  return (rows.results || []).map((r) => ({ id: r.id, text: r.text, kind: r.kind || 'fact', score: -r.rank }));
}

/** Vector ids are `${accountId}:${factId}` (Azure stores ':' as '_'). */
function factIdFromVectorId(accountId: string, vectorId: string): string {
  for (const prefix of [`${accountId}:`, `${accountId.replace(/[^a-zA-Z0-9_-]/g, '_')}_`]) {
    if (vectorId.startsWith(prefix)) return vectorId.slice(prefix.length);
  }
  return vectorId;
}

/**
 * Vector hits, kept only if the fact is still recallable in D1 (same filter as full-text search),
 * with text and kind read from D1 rather than from index metadata. Empty without a vector index.
 */
async function vectorHits(env: Env, db: D1Database, accountId: string, query: string, projectId: string | null): Promise<RecallHit[]> {
  if (resolveVectorProvider(env) === 'none') return [];
  const ids = (await searchMemoryVectors(env, accountId, query, CANDIDATES_PER_LIST)).map((h) => factIdFromVectorId(accountId, h.id));
  if (!ids.length) return [];
  const rows = await db
    .prepare(`SELECT f.id AS id, f.text AS text, f.kind AS kind FROM memory_facts f WHERE f.id IN (${ids.map(() => '?').join(',')}) AND ${RECALLABLE}`)
    .bind(...ids, accountId, Date.now(), projectId)
    .all<FactRow>();
  const byId = new Map((rows.results || []).map((r) => [r.id, r]));
  return ids.flatMap((id, rank) => {
    const row = byId.get(id);
    return row ? [{ id, text: row.text, kind: row.kind || 'fact', score: CANDIDATES_PER_LIST - rank }] : [];
  });
}

/**
 * Ranked memory for one account and, when given, one project. Facts with no project apply to
 * every project. Never throws: an error or a timeout gives an empty list, and both are logged.
 */
export async function recallMemory(
  env: Env,
  accountId: string,
  query: string,
  opts: { projectId?: string | null; budget?: Partial<RecallBudget> } = {},
): Promise<RecallHit[]> {
  const db = env.DB;
  if (!db) return [];
  const budget = { ...DEFAULT_RECALL_BUDGET, ...opts.budget };
  const projectId = opts.projectId ?? null;
  const logged = (event: string) => (err: unknown): RecallHit[] => {
    console.warn(JSON.stringify({ event, error: String(err) }));
    return [];
  };
  const work = Promise.all([
    ftsHits(db, accountId, query, projectId).catch(logged('memory_recall_fts_failed')),
    vectorHits(env, db, accountId, query, projectId).catch(logged('memory_recall_vector_failed')),
  ]).then(([fts, vec]) =>
    applyRecallBudget(
      rrfMerge([fts, vec], (h) => h.id).map(({ rrfScore, ...hit }) => ({ ...hit, score: rrfScore })),
      budget,
    ),
  );
  const hits = await withinBudget<RecallHit[] | null>(work, budget.timeoutMs, null);
  if (hits === null) {
    console.warn(JSON.stringify({ event: 'memory_recall_timeout', timeoutMs: budget.timeoutMs }));
    return [];
  }
  return hits;
}

/**
 * The memory block for a chat prompt and the facts in it. Flag on: ranked lines `N. [kind] text`,
 * no scores, in a nonce fence because the stored text came from users. Flag off: the earlier
 * keyword path, unchanged.
 */
export async function recallBlock(
  env: Env,
  accountId: string,
  query: string,
  opts: { projectId?: string | null } = {},
): Promise<RecallBlock> {
  if (memoryRecallV2Enabled(env)) {
    const hits = await recallMemory(env, accountId, query, opts);
    // Success counts, so logs show recall working (no text, no account id).
    console.log(JSON.stringify({ event: 'memory_recall', hits: hits.length }));
    if (!hits.length) return NO_RECALL;
    const lines = hits.map((h, i) => `${i + 1}. [${h.kind}] ${h.text}`).join('\n');
    return {
      block: `${BLOCK_HEADING}\n${wrapUntrustedContent('ACCOUNT_MEMORY', lines, { nonce: true, maxChars: DEFAULT_RECALL_BUDGET.maxChars + 200 })}`,
      facts: hits.map((h) => h.text),
    };
  }
  const hits = await searchMemoryVectors(env, accountId, query, 5);
  if (!hits.length) return NO_RECALL;
  const lines = hits.map((h, i) => `${i + 1}. (${h.score.toFixed(2)}) ${h.text}`).join('\n');
  // Memory may contain attacker-influenced chat extracts; fence before system prompt merge.
  return { block: `${BLOCK_HEADING}\n${wrapUntrustedContent('ACCOUNT_MEMORY', lines)}`.trim(), facts: hits.map((h) => h.text) };
}
