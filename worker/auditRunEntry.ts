import type { AuditRunMeta } from '../services/audit/auditRun';

const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_QUERIES = 12;
const MAX_QUERY_LENGTH = 300;

function shortText(value: unknown): string | null {
  return typeof value === 'string' && value ? value.slice(0, 120) : null;
}

/** Rebuilds the run record field by field. Anything else in the object is dropped. */
export function readAuditRun(value: unknown): AuditRunMeta | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  return {
    runId: typeof r.runId === 'string' && ID_RE.test(r.runId) ? r.runId : null,
    model: shortText(r.model),
    provider: shortText(r.provider),
    method: r.method === 'crew_search_rows' || r.method === 'live_probe' ? r.method : null,
    queries: Array.isArray(r.queries)
      ? r.queries.filter((q): q is string => typeof q === 'string').slice(0, MAX_QUERIES).map((q) => q.slice(0, MAX_QUERY_LENGTH))
      : [],
  };
}
