/**
 * Instant Audit history (D1). The browser keeps a cache; this table is the durable copy.
 *   GET /audits/history?limit=&domain=   newest first, whole entries
 *   PUT /audits/history { entry }        upsert by (account, entry id); first measuredAt is kept
 */
import type { Env } from './env';
import { MAX_BODY_BYTES, readBody } from './security';
import { identify, json, billingId } from './workerUtils';

const MAX_ROWS_PER_ACCOUNT = 500;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_EXCERPT = 80_000;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

export type StoredAuditEntry = {
  id: string;
  domain: string;
  focus: string;
  measuredAt: number;
  healthScore: number | null;
  citationRatePercent: number | null;
  schemaGapCount: number | null;
  topCompetitor: string | null;
  competitorsMentioned: string[];
  title: string;
  summary: string;
  reportExcerpt: string;
  clientId: string | null;
  tags: string[];
};

function normalizeDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase()
    .trim()
    .slice(0, 253);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').slice(0, maxItems).map((v) => v.slice(0, maxLength));
}

/** Rebuilds the entry field by field, so the row never stores keys the client made up. */
export function sanitizeAuditEntry(raw: unknown): { ok: true; entry: StoredAuditEntry } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'entry object required' };
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  if (!ID_RE.test(id)) return { ok: false, error: 'entry.id must be 1-128 letters, digits, or _ . : -' };
  const domain = normalizeDomain(text(r.domain, 2048));
  if (!domain) return { ok: false, error: 'entry.domain required' };
  const measuredAt = numberOrNull(r.measuredAt);
  if (measuredAt === null || measuredAt <= 0) return { ok: false, error: 'entry.measuredAt must be a timestamp in ms' };
  if (typeof r.reportExcerpt === 'string' && r.reportExcerpt.length > MAX_EXCERPT) {
    return { ok: false, error: `entry.reportExcerpt is over ${MAX_EXCERPT} characters` };
  }
  return {
    ok: true,
    entry: {
      id,
      domain,
      focus: text(r.focus, 120),
      measuredAt: Math.round(measuredAt),
      healthScore: numberOrNull(r.healthScore),
      citationRatePercent: numberOrNull(r.citationRatePercent),
      schemaGapCount: numberOrNull(r.schemaGapCount),
      topCompetitor: typeof r.topCompetitor === 'string' ? r.topCompetitor.slice(0, 200) : null,
      competitorsMentioned: strings(r.competitorsMentioned, 20, 200),
      title: text(r.title, 300),
      summary: text(r.summary, 400),
      reportExcerpt: text(r.reportExcerpt, MAX_EXCERPT),
      clientId: typeof r.clientId === 'string' && r.clientId ? r.clientId.slice(0, 128) : null,
      tags: strings(r.tags, 10, 120),
    },
  };
}

function parseRow(row: { entry_json: string; measured_at: number }): StoredAuditEntry | null {
  try {
    const entry = JSON.parse(row.entry_json) as StoredAuditEntry;
    return { ...entry, measuredAt: row.measured_at };
  } catch {
    return null;
  }
}

export async function handleAuditHistoryRoute(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const who = await identify(request, env);
  if (who.error || !who.user) {
    return json({ ok: false, error: who.error || 'Sign in required', code: 'AUTH_REQUIRED' }, 401);
  }
  const accountId = billingId(who.user);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('limit') || DEFAULT_LIMIT);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const domain = normalizeDomain(url.searchParams.get('domain') || '');
    const res = domain
      ? await env.DB.prepare(
          `SELECT entry_json, measured_at FROM audit_history WHERE account_id = ? AND domain = ? ORDER BY measured_at DESC LIMIT ?`,
        ).bind(accountId, domain, limit).all<{ entry_json: string; measured_at: number }>()
      : await env.DB.prepare(
          `SELECT entry_json, measured_at FROM audit_history WHERE account_id = ? ORDER BY measured_at DESC LIMIT ?`,
        ).bind(accountId, limit).all<{ entry_json: string; measured_at: number }>();
    const entries = (res.results || []).map(parseRow).filter((e): e is StoredAuditEntry => e !== null);
    return json({ ok: true, entries });
  }

  if (request.method === 'PUT') {
    const read = await readBody(request, MAX_BODY_BYTES);
    if (!read.ok) return json({ ok: false, error: read.error }, read.status);
    const checked = sanitizeAuditEntry((read.value as { entry?: unknown } | null)?.entry);
    if (!checked.ok) return json({ ok: false, error: checked.error, code: 'INVALID_ENTRY' }, 400);
    const entry = checked.entry;
    const now = Date.now();
    // A re-save of the same audit keeps the time it was first measured, as the browser list does.
    await env.DB.prepare(
      `INSERT INTO audit_history (account_id, id, domain, measured_at, entry_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, id) DO UPDATE SET
         domain = excluded.domain,
         entry_json = excluded.entry_json,
         updated_at = excluded.updated_at`,
    ).bind(accountId, entry.id, entry.domain, entry.measuredAt, JSON.stringify(entry), now).run();
    await env.DB.prepare(
      `DELETE FROM audit_history WHERE account_id = ? AND id NOT IN (
         SELECT id FROM audit_history WHERE account_id = ? ORDER BY measured_at DESC LIMIT ?
       )`,
    ).bind(accountId, accountId, MAX_ROWS_PER_ACCOUNT).run();
    const row = await env.DB.prepare(`SELECT entry_json, measured_at FROM audit_history WHERE account_id = ? AND id = ?`)
      .bind(accountId, entry.id)
      .first<{ entry_json: string; measured_at: number }>();
    return json({ ok: true, entry: row ? parseRow(row) : null });
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}
