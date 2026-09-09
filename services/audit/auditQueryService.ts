/**
 * Lightweight audit query language (SilverBullet-inspired, AEO-scoped).
 * Examples:
 *   audits where score < 60
 *   audits where domain = example.com
 *   audits where competitor = Acme
 *   audits where focus = AEO and score >= 70
 */

import { listAudits, type AuditHistoryEntry } from './auditHistoryService';

export interface AuditQueryResult {
  query: string;
  ok: boolean;
  error?: string;
  matches: AuditHistoryEntry[];
  count: number;
}

type Pred = (e: AuditHistoryEntry) => boolean;

function parseValue(raw: string): string | number {
  const t = raw.trim().replace(/^["']|["']$/g, '');
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

function cmp(left: number | null | undefined, op: string, right: number): boolean {
  if (left == null || !Number.isFinite(left)) return false;
  switch (op) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '=':
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    default:
      return false;
  }
}

function buildPredicate(clause: string): Pred | { error: string } {
  const m = clause
    .trim()
    .match(/^(score|health|citation|schema|domain|focus|competitor|client)\s*(<=|>=|!=|=|==|<|>)\s*(.+)$/i);
  if (!m) return { error: `Unrecognized clause: "${clause}". Try: score < 60` };

  const field = m[1].toLowerCase();
  const op = m[2];
  const value = parseValue(m[3]);

  if (field === 'score' || field === 'health') {
    if (typeof value !== 'number') return { error: 'score requires a number' };
    return (e) => cmp(e.healthScore, op, value);
  }
  if (field === 'citation') {
    if (typeof value !== 'number') return { error: 'citation requires a number' };
    return (e) => cmp(e.citationRatePercent, op, value);
  }
  if (field === 'schema') {
    if (typeof value !== 'number') return { error: 'schema requires a number' };
    return (e) => cmp(e.schemaGapCount, op, value);
  }
  if (field === 'domain') {
    const needle = String(value).toLowerCase();
    return (e) => {
      if (op === '!=') return e.domain !== needle;
      return e.domain.includes(needle) || needle.includes(e.domain);
    };
  }
  if (field === 'focus') {
    const needle = String(value).toUpperCase();
    return (e) => e.focus.toUpperCase() === needle || e.focus.toUpperCase().includes(needle);
  }
  if (field === 'competitor') {
    const needle = String(value).toLowerCase();
    return (e) =>
      e.competitorsMentioned.some((c) => c.toLowerCase().includes(needle)) ||
      (e.topCompetitor || '').toLowerCase().includes(needle);
  }
  if (field === 'client') {
    const needle = String(value).toLowerCase();
    return (e) => (e.clientId || '').toLowerCase() === needle;
  }
  return { error: `Unknown field: ${field}` };
}

/**
 * Parse and run a query over stored audits.
 */
export function runAuditQuery(rawQuery: string, scope?: { domain?: string; clientId?: string | null }): AuditQueryResult {
  const query = (rawQuery || '').trim();
  if (!query) {
    return { query, ok: false, error: 'Empty query', matches: [], count: 0 };
  }

  const normalized = query.replace(/^audits\s+/i, '').trim();
  const whereMatch = normalized.match(/^where\s+(.+)$/i);
  if (!whereMatch) {
    return {
      query,
      ok: false,
      error: 'Expected: audits where <field> <op> <value> [and ...]',
      matches: [],
      count: 0,
    };
  }

  const clauses = whereMatch[1].split(/\s+and\s+/i).map((c) => c.trim()).filter(Boolean);
  const preds: Pred[] = [];
  for (const clause of clauses) {
    const p = buildPredicate(clause);
    if ('error' in p) {
      return { query, ok: false, error: p.error, matches: [], count: 0 };
    }
    preds.push(p);
  }

  const matches = listAudits({
    domain: scope?.domain,
    clientId: scope?.clientId,
  }).filter((e) => preds.every((p) => p(e)));

  return { query, ok: true, matches, count: matches.length };
}

export const auditQueryService = {
  run: runAuditQuery,
};
