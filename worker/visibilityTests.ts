/**
 * Visibility Unit Tests store (migration 0057): raw in R2, verdict rows in D1. Routes live in visibilityTestsRoute.ts.
 */
import type { Env } from './env';
import { entitlementsFor } from '../services/plans/planEntitlements';
import { answerStatus, buildScorecard, passList, score, summarize, type ScorecardAnswerRow, type ScorecardVerdictRow } from '../services/visibilityTests/scorer';
import type {
  CrawlSnapshot,
  ExpectedFacts,
  RawAnswer,
  RawVisibilityRun,
  ScorecardRow,
  VisibilitySummary,
  VisibilityVerdict,
} from '../services/visibilityTests/types';
import { SCORER_VERSION } from '../services/visibilityTests/types';

const MAX_ANSWERS = 15;
const MAX_ANSWER_CHARS = 8_000;
const MAX_PAGES = 6;
const MAX_PAGE_CHARS = 20_000;
const MAX_FACTS = 8;
const MAX_FACT_CHARS = 120;
const MAX_SOURCES = 20;
/** Audit history keeps this many rows on an unlimited plan. Retention follows it. */
const UNLIMITED_RUNS = 500;
const RETENTION_PAGE = 100;
const SCORECARD_ANSWERS = 500;
export const EXPORTED_RAW_RUNS = 25;
/** An export is one KV value, capped at 25 MiB, and everything else in it needs room too. */
const EXPORTED_RAW_BYTES = 12_000_000;

export type RunKind = 'audit' | 'own_models';

type RunRow = {
  id: string;
  account_id: string;
  domain: string;
  scorer_version: number;
  raw_key: string | null;
  summary_json: string;
  created_at: number;
  graded_at: number;
};

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function cleanDomain(raw: unknown): string {
  return text(raw, 2048)
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase()
    .trim()
    .slice(0, 253);
}

export function sanitizeFacts(raw: unknown): ExpectedFacts | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const domain = cleanDomain(r.domain);
  if (!domain) return null;
  return {
    brand: text(r.brand, 200).trim() || domain,
    domain,
    suburb: text(r.suburb, MAX_FACT_CHARS).trim() || undefined,
    service: text(r.service, MAX_FACT_CHARS).trim() || undefined,
    keyFacts: strings(r.keyFacts, MAX_FACTS, MAX_FACT_CHARS),
    bannedClaims: strings(r.bannedClaims, MAX_FACTS, MAX_FACT_CHARS),
    confirmed: r.confirmed === true,
  };
}

/** Rebuilds each answer field by field. Ids come from here, so a client cannot collide two answers. */
function sanitizeAnswer(raw: unknown, index: number, now: number): RawAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== 'search' && r.kind !== 'byok_probe') return null;
  const prompt = text(r.prompt, 2000).trim();
  if (!prompt) return null;
  return {
    id: `a${index}`,
    kind: r.kind,
    engine: text(r.engine, 120).trim() || 'unknown',
    provider: text(r.provider, 64).trim() || 'unknown',
    model: text(r.model, 120).trim() || 'unknown',
    prompt,
    intent: text(r.intent, 32).trim() || 'unknown',
    text: text(r.text, MAX_ANSWER_CHARS),
    sources: strings(r.sources, MAX_SOURCES, 2000).filter((url) => /^https?:\/\//i.test(url)),
    finishReason: text(r.finishReason, 32) || undefined,
    error: text(r.error, 200) || undefined,
    inputTokens: count(r.inputTokens),
    outputTokens: count(r.outputTokens),
    costUsd: count(r.costUsd),
    latencyMs: count(r.latencyMs),
    answeredAt: count(r.answeredAt) ?? now,
  };
}

function sanitizeSnapshot(raw: unknown, now: number): CrawlSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.pages)) return null;
  const pages = r.pages.slice(0, MAX_PAGES).flatMap((page) => {
    if (!page || typeof page !== 'object') return [];
    const p = page as Record<string, unknown>;
    return [{
      url: text(p.url, 2000),
      title: text(p.title, 300),
      schemaTypes: strings(p.schemaTypes, 40, 120),
      text: text(p.text, MAX_PAGE_CHARS),
    }];
  });
  return pages.length ? { pages, fetchedAt: count(r.fetchedAt) ?? now } : null;
}

export function sanitizeRun(raw: unknown, now: number): { ok: true; run: RawVisibilityRun } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'JSON body required' };
  const r = raw as Record<string, unknown>;
  const facts = sanitizeFacts(r.facts);
  if (!facts) return { ok: false, error: 'facts.domain required' };
  if (!Array.isArray(r.answers)) return { ok: false, error: 'answers must be a list' };
  if (r.answers.length > MAX_ANSWERS) return { ok: false, error: `at most ${MAX_ANSWERS} answers in one run` };
  const answers = r.answers.flatMap((answer, index) => sanitizeAnswer(answer, index, now) ?? []);
  const snapshot = sanitizeSnapshot(r.snapshot, now);
  if (!answers.length && !snapshot) return { ok: false, error: 'a run needs answers or a crawl snapshot' };
  return { ok: true, run: { facts, answers, snapshot } };
}

function parseSummary(row: Pick<RunRow, 'summary_json'>): VisibilitySummary | null {
  try {
    return JSON.parse(row.summary_json) as VisibilitySummary;
  } catch {
    return null;
  }
}

function runView(row: RunRow) {
  return {
    id: row.id,
    domain: row.domain,
    scorerVersion: row.scorer_version,
    currentScorerVersion: SCORER_VERSION,
    canRegrade: row.raw_key !== null,
    summary: parseSummary(row),
    createdAt: row.created_at,
    gradedAt: row.graded_at,
  };
}

function verdictInserts(env: Env, runId: string, accountId: string, verdicts: VisibilityVerdict[]) {
  return verdicts.map((v) =>
    env.DB!.prepare(
      `INSERT OR REPLACE INTO visibility_test_verdicts
        (run_id, account_id, test_id, answer_id, test_type, family, derivation, tags_json, label, result, why)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(runId, accountId, v.testId, v.answerId ?? '', v.testType, v.family, v.derivation, JSON.stringify(v.tags), v.label, v.result, v.why),
  );
}

async function putRaw(env: Env, runId: string, raw: RawVisibilityRun): Promise<string | null> {
  if (!env.AUDIT_EVIDENCE) return null;
  const key = `visibility-raw/${runId}.json`;
  try {
    await env.AUDIT_EVIDENCE.put(key, JSON.stringify(raw), { httpMetadata: { contentType: 'application/json' } });
    return key;
  } catch (err) {
    console.error('[visibilityTests] raw record was not saved', err);
    return null;
  }
}

function runKind(raw: RawVisibilityRun): RunKind {
  return raw.snapshot || raw.answers.some((answer) => answer.kind === 'search') ? 'audit' : 'own_models';
}

/** Saves raw first, so a verdict row never exists for evidence that was dropped by a failed write. */
export async function saveRun(env: Env, accountId: string, raw: RawVisibilityRun, now: number, plan: string | null | undefined) {
  const id = crypto.randomUUID();
  const verdicts = score(raw);
  const summary = summarize(verdicts);
  const rawKey = await putRaw(env, id, raw);
  const row: RunRow = {
    id,
    account_id: accountId,
    domain: raw.facts.domain,
    scorer_version: SCORER_VERSION,
    raw_key: rawKey,
    summary_json: JSON.stringify(summary),
    created_at: now,
    graded_at: now,
  };
  try {
    await env.DB!.batch([
      env.DB!.prepare(
        `INSERT INTO visibility_test_runs (id, account_id, domain, kind, scorer_version, raw_key, summary_json, created_at, graded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, accountId, row.domain, runKind(raw), SCORER_VERSION, rawKey, row.summary_json, now, now),
      ...raw.answers.map((answer) =>
        env.DB!.prepare(
          `INSERT INTO visibility_test_answers
            (run_id, id, account_id, kind, engine, provider, model, status, cost_usd, latency_ms, answered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, answer.id, accountId, answer.kind, answer.engine, answer.provider, answer.model, answerStatus(answer), answer.costUsd, answer.latencyMs, answer.answeredAt),
      ),
      ...verdictInserts(env, id, accountId, verdicts),
    ]);
  } catch (err) {
    if (rawKey) {
      await env.AUDIT_EVIDENCE?.delete(rawKey).catch((deleteErr) => {
        console.error('[visibilityTests] orphaned raw record', rawKey, deleteErr);
      });
    }
    throw err;
  }
  // The run is saved. A failed prune retries on the next save and must not read as a failed save.
  await pruneRuns(env, accountId, plan).catch((err) => console.error('[visibilityTests] prune failed', err));
  return { run: runView(row), verdicts };
}

/**
 * Runs past the plan's audit history depth go, raw first. A failed raw delete keeps the row, so the next save retries.
 * Each kind has its own depth, so pressing Ask my AI accounts never pushes out the audit a past report needs.
 */
export async function pruneRuns(env: Env, accountId: string, plan: string | null | undefined): Promise<number> {
  const depth = entitlementsFor(plan).auditHistoryDepth || UNLIMITED_RUNS;
  const stale = await env.DB!.prepare(
    `SELECT id, raw_key FROM (
       SELECT id, raw_key, ROW_NUMBER() OVER (PARTITION BY kind ORDER BY created_at DESC, id) AS position
         FROM visibility_test_runs WHERE account_id = ?
     ) WHERE position > ? LIMIT ?`,
  ).bind(accountId, depth, RETENTION_PAGE).all<{ id: string; raw_key: string | null }>();
  let removed = 0;
  for (const run of stale.results ?? []) {
    if (run.raw_key) {
      if (!env.AUDIT_EVIDENCE) continue;
      const deleted = await env.AUDIT_EVIDENCE.delete(run.raw_key).then(() => true, () => false);
      if (!deleted) continue;
    }
    await env.DB!.batch(deleteRunStatements(env, accountId, run.id));
    removed += 1;
  }
  return removed;
}

function deleteRunStatements(env: Env, accountId: string, runId: string) {
  return ['visibility_test_verdicts', 'visibility_test_answers'].map((table) =>
    env.DB!.prepare(`DELETE FROM ${table} WHERE run_id = ? AND account_id = ?`).bind(runId, accountId),
  ).concat(env.DB!.prepare(`DELETE FROM visibility_test_runs WHERE id = ? AND account_id = ?`).bind(runId, accountId));
}

export async function regradeRun(env: Env, row: RunRow, factsOverride: ExpectedFacts | null, now: number) {
  if (!row.raw_key || !env.AUDIT_EVIDENCE) return null;
  const object = await env.AUDIT_EVIDENCE.get(row.raw_key);
  if (!object) return null;
  const saved = (await object.json()) as RawVisibilityRun;
  const raw = factsOverride ? { ...saved, facts: factsOverride } : saved;
  const verdicts = score(raw);
  const summaryJson = JSON.stringify(summarize(verdicts));
  await env.DB!.batch([
    env.DB!.prepare(`DELETE FROM visibility_test_verdicts WHERE run_id = ? AND account_id = ?`).bind(row.id, row.account_id),
    ...verdictInserts(env, row.id, row.account_id, verdicts),
    env.DB!.prepare(`UPDATE visibility_test_runs SET scorer_version = ?, summary_json = ?, graded_at = ? WHERE id = ? AND account_id = ?`)
      .bind(SCORER_VERSION, summaryJson, now, row.id, row.account_id),
    ...raw.answers.map((answer) =>
      env.DB!.prepare(`UPDATE visibility_test_answers SET status = ? WHERE run_id = ? AND id = ?`).bind(answerStatus(answer), row.id, answer.id),
    ),
  ]);
  // After the rows: a failed write leaves old facts in raw, and the next regrade sends the current ones anyway.
  if (factsOverride) {
    await env.AUDIT_EVIDENCE.put(row.raw_key, JSON.stringify(raw), { httpMetadata: { contentType: 'application/json' } })
      .catch((err) => console.error('[visibilityTests] regraded facts were not saved to raw', err));
  }
  return { run: runView({ ...row, scorer_version: SCORER_VERSION, summary_json: summaryJson, graded_at: now }), verdicts };
}

export async function findRun(env: Env, accountId: string, id: string): Promise<RunRow | null> {
  return env.DB!.prepare(`SELECT * FROM visibility_test_runs WHERE id = ? AND account_id = ?`).bind(id, accountId).first<RunRow>();
}

export async function listRuns(env: Env, accountId: string, domain: string, limit: number, kind?: RunKind) {
  const filters = [...(domain ? [`domain = ?`] : []), ...(kind ? [`kind = ?`] : [])].map((clause) => `AND ${clause} `).join('');
  const res = await env.DB!.prepare(`SELECT * FROM visibility_test_runs WHERE account_id = ? ${filters}ORDER BY created_at DESC LIMIT ?`)
    .bind(accountId, ...(domain ? [domain] : []), ...(kind ? [kind] : []), limit).all<RunRow>();
  return (res.results ?? []).map(runView);
}

export async function getRunVerdicts(env: Env, accountId: string, id: string) {
  const row = await findRun(env, accountId, id);
  if (!row) return null;
  const res = await env.DB!.prepare(
    `SELECT test_id, answer_id, test_type, family, derivation, tags_json, label, result, why
       FROM visibility_test_verdicts WHERE run_id = ? AND account_id = ?`,
  ).bind(id, accountId).all<{
    test_id: string;
    answer_id: string;
    test_type: VisibilityVerdict['testType'];
    family: VisibilityVerdict['family'];
    derivation: VisibilityVerdict['derivation'];
    tags_json: string;
    label: string;
    result: VisibilityVerdict['result'];
    why: string;
  }>();
  const verdicts = (res.results ?? []).map((v): VisibilityVerdict => ({
    testId: v.test_id,
    testType: v.test_type,
    family: v.family,
    derivation: v.derivation,
    tags: JSON.parse(v.tags_json) as string[],
    answerId: v.answer_id || null,
    label: v.label,
    result: v.result,
    why: v.why,
  }));
  return { run: runView(row), verdicts };
}

/**
 * Search and website checks only: a public page must not present an own-model estimate as a result.
 * A failed lookup leaves the list off the link. It never blocks sharing a report.
 */
export async function sharedPassList(env: Env, accountId: string, runId: string): Promise<string[] | undefined> {
  try {
    const res = await env.DB!.prepare(
      `SELECT v.label, v.result, v.test_type FROM visibility_test_verdicts v
         LEFT JOIN visibility_test_answers a ON a.run_id = v.run_id AND a.id = v.answer_id
        WHERE v.run_id = ? AND v.account_id = ? AND (v.answer_id = '' OR a.kind = 'search')`,
    ).bind(runId, accountId).all<{ label: string; result: VisibilityVerdict['result']; test_type: VisibilityVerdict['testType'] }>();
    const labels = passList((res.results ?? []).map((row) => ({ label: row.label, result: row.result, testType: row.test_type })));
    return labels.length ? labels : undefined;
  } catch (err) {
    console.error('[visibilityTests] pass list was not built', err);
    return undefined;
  }
}

export async function providerScorecard(env: Env, accountId: string, domain: string): Promise<ScorecardRow[]> {
  const scope = domain ? `AND r.domain = ?` : '';
  const binds = domain ? [accountId, domain, SCORECARD_ANSWERS] : [accountId, SCORECARD_ANSWERS];
  const answers = await env.DB!.prepare(
    `SELECT a.run_id, a.id, a.provider, a.model, a.status, a.cost_usd, a.latency_ms
       FROM visibility_test_answers a JOIN visibility_test_runs r ON r.id = a.run_id
      WHERE a.account_id = ? AND a.kind = 'byok_probe' ${scope}
      ORDER BY a.answered_at DESC LIMIT ?`,
  ).bind(...binds).all<ScorecardAnswerRow & { run_id: string }>();
  const verdicts = await env.DB!.prepare(
    `SELECT v.run_id, v.answer_id, v.family, v.result
       FROM visibility_test_verdicts v
       JOIN visibility_test_answers a ON a.run_id = v.run_id AND a.id = v.answer_id
       JOIN visibility_test_runs r ON r.id = v.run_id
      WHERE v.account_id = ? AND a.kind = 'byok_probe' ${scope}
      ORDER BY a.answered_at DESC LIMIT ?`,
  ).bind(...(domain ? [accountId, domain, SCORECARD_ANSWERS * 30] : [accountId, SCORECARD_ANSWERS * 30]))
    .all<ScorecardVerdictRow & { run_id: string }>();
  const uid = (runId: string, answerId: string) => `${runId}/${answerId}`;
  return buildScorecard(
    (answers.results ?? []).map((a) => ({ ...a, id: uid(a.run_id, a.id) })),
    (verdicts.results ?? []).map((v) => ({ ...v, answer_id: uid(v.run_id, v.answer_id) })),
  );
}

/** Raw records of an account, deleted before the rows that name them. A failure stops the erase, so a retry finds them. */
export async function eraseVisibilityRaw(env: Env, accountId: string): Promise<number> {
  const res = await env.DB!.prepare(`SELECT raw_key FROM visibility_test_runs WHERE account_id = ? AND raw_key IS NOT NULL`)
    .bind(accountId).all<{ raw_key: string }>();
  const keys = (res.results ?? []).map((row) => row.raw_key);
  if (!keys.length) return 0;
  if (!env.AUDIT_EVIDENCE) throw new Error('AUDIT_EVIDENCE binding is required to erase saved raw answers');
  for (let at = 0; at < keys.length; at += 1000) await env.AUDIT_EVIDENCE.delete(keys.slice(at, at + 1000));
  return keys.length;
}

/** Newest raw records for a data export. The rest stay reachable by email request and are counted. */
export async function exportVisibilityRaw(env: Env, accountId: string): Promise<{ records: unknown[]; omitted: number }> {
  if (!env.AUDIT_EVIDENCE) return { records: [], omitted: 0 };
  const res = await env.DB!.prepare(
    `SELECT id, raw_key FROM visibility_test_runs WHERE account_id = ? AND raw_key IS NOT NULL ORDER BY created_at DESC`,
  ).bind(accountId).all<{ id: string; raw_key: string }>();
  const rows = res.results ?? [];
  const records: unknown[] = [];
  let bytes = 0;
  for (const row of rows.slice(0, EXPORTED_RAW_RUNS)) {
    const object = await env.AUDIT_EVIDENCE.get(row.raw_key);
    if (!object) continue;
    const raw: unknown = await object.json();
    bytes += JSON.stringify(raw).length;
    if (bytes > EXPORTED_RAW_BYTES) break;
    records.push({ runId: row.id, raw });
  }
  return { records, omitted: rows.length - records.length };
}
