/**
 * Findings board (W2 / WDL Product): D1-backed work items from Instant Audit crew findings.
 * Never ingest Oracle chat ValidatorFinding rows here.
 */
import type { Env } from './env';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import { identify, json, billingId } from './workerUtils';
import { findingStableKey } from '../services/audit/findingStableKey';

const MAX_BULK = 50;
const STATUSES = new Set(['open', 'in_progress', 'done', 'wont_fix']);
const CATEGORIES = new Set([
  'schema',
  'technical',
  'content_quality',
  'eeat',
  'citations',
  'competitor_gap',
]);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

export type FindingRow = {
  id: string;
  audit_run_id: string;
  account_id: string;
  client_id: string | null;
  domain: string;
  stable_key: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  evidence_json: string | null;
  status: string;
  owner: string | null;
  due_at: number | null;
  created_at: number;
  updated_at: number;
};

function randomId(prefix: string): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return `${prefix}_${Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function normalizeDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase()
    .trim();
}

function rowToPublic(row: FindingRow) {
  let evidence: unknown = null;
  if (row.evidence_json) {
    try {
      evidence = JSON.parse(row.evidence_json);
    } catch {
      evidence = null;
    }
  }
  return {
    id: row.id,
    auditRunId: row.audit_run_id,
    domain: row.domain,
    stableKey: row.stable_key,
    category: row.category,
    severity: row.severity,
    title: row.title,
    description: row.description,
    evidence,
    status: row.status,
    owner: row.owner,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clientId: row.client_id,
  };
}

type BulkItem = {
  category?: string;
  severity?: string;
  title?: string;
  description?: string;
  evidence?: unknown;
  status?: string;
  owner?: string;
  dueAt?: number;
  auditRunId?: string;
  stableKey?: string;
  id?: string;
};

export async function handleFindingsRoute(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);

  const who = await identify(request, env);
  if (who.error || !who.user) {
    return json({ ok: false, error: who.error || 'Unauthorized', code: 'AUTH_REQUIRED' }, 401);
  }
  const accountId = billingId(who.user);

  // GET /findings?domain=
  if (path === '/findings' && request.method === 'GET') {
    const url = new URL(request.url);
    const domainRaw = url.searchParams.get('domain') || '';
    const domain = normalizeDomain(domainRaw);
    if (!domain) return json({ ok: false, error: 'domain query required' }, 400);
    const status = url.searchParams.get('status');
    let sql = `SELECT * FROM audit_findings WHERE account_id = ? AND domain = ?`;
    const binds: unknown[] = [accountId, domain];
    if (status && STATUSES.has(status)) {
      sql += ` AND status = ?`;
      binds.push(status);
    }
    sql += ` ORDER BY updated_at DESC LIMIT 200`;
    const res = await env.DB.prepare(sql)
      .bind(...binds)
      .all<FindingRow>();
    const rows = (res.results || []) as FindingRow[];
    return json({ ok: true, findings: rows.map(rowToPublic) });
  }

  // POST /findings/bulk
  if (path === '/findings/bulk' && request.method === 'POST') {
    const raw = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!raw.ok) return json({ ok: false, error: raw.error }, raw.status);
    let body: { domain?: string; clientId?: string | null; findings?: BulkItem[]; auditRunId?: string };
    try {
      body = JSON.parse(raw.text) as typeof body;
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }
    const domain = normalizeDomain(body.domain || '');
    if (!domain) return json({ ok: false, error: 'domain required' }, 400);
    const items = Array.isArray(body.findings) ? body.findings.slice(0, MAX_BULK) : [];
    if (items.length === 0) return json({ ok: false, error: 'findings array required' }, 400);

    const auditRunId = (body.auditRunId || items[0]?.auditRunId || randomId('run')).slice(0, 64);
    const clientId = body.clientId ? String(body.clientId).slice(0, 128) : null;
    const now = Date.now();
    const upserted: ReturnType<typeof rowToPublic>[] = [];
    let skipped = 0;

    for (const item of items) {
      const title = String(item.title || '').trim().slice(0, 240);
      const category = String(item.category || '').trim();
      const severity = String(item.severity || 'medium').trim();
      const description = String(item.description || '').trim().slice(0, 4000);
      if (!title || !CATEGORIES.has(category) || !SEVERITIES.has(severity)) {
        skipped += 1;
        continue;
      }
      const status = item.status && STATUSES.has(item.status) ? item.status : 'open';
      const stableKey =
        (item.stableKey && String(item.stableKey).slice(0, 64)) ||
        findingStableKey(domain, category, title);
      const id = (item.id && String(item.id).slice(0, 64)) || randomId('fnd');
      let evidenceJson: string | null = null;
      if (item.evidence !== undefined) {
        try {
          evidenceJson = JSON.stringify(item.evidence).slice(0, 20_000);
        } catch {
          evidenceJson = null;
        }
      }
      const owner = item.owner ? String(item.owner).slice(0, 120) : null;
      const dueAt = typeof item.dueAt === 'number' && Number.isFinite(item.dueAt) ? item.dueAt : null;

      await env.DB.prepare(
        `INSERT INTO audit_findings (
          id, audit_run_id, account_id, client_id, domain, stable_key,
          category, severity, title, description, evidence_json, status, owner, due_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, domain, stable_key) DO UPDATE SET
          audit_run_id = excluded.audit_run_id,
          category = excluded.category,
          severity = excluded.severity,
          title = excluded.title,
          description = excluded.description,
          evidence_json = COALESCE(excluded.evidence_json, audit_findings.evidence_json),
          updated_at = excluded.updated_at,
          client_id = COALESCE(excluded.client_id, audit_findings.client_id)
        `,
      )
        .bind(
          id,
          auditRunId,
          accountId,
          clientId,
          domain,
          stableKey,
          category,
          severity,
          title,
          description,
          evidenceJson,
          status,
          owner,
          dueAt,
          now,
          now,
        )
        .run();

      const row = await env.DB.prepare(
        `SELECT * FROM audit_findings WHERE account_id = ? AND domain = ? AND stable_key = ?`,
      )
        .bind(accountId, domain, stableKey)
        .first<FindingRow>();
      if (row) upserted.push(rowToPublic(row));
    }

    return json({ ok: true, auditRunId, findings: upserted, skipped });
  }

  // PATCH /findings/:id
  const patchMatch = path.match(/^\/findings\/([^/]+)$/);
  if (patchMatch && request.method === 'PATCH') {
    const findingId = decodeURIComponent(patchMatch[1]);
    const raw = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!raw.ok) return json({ ok: false, error: raw.error }, raw.status);
    let body: { status?: string; owner?: string | null; dueAt?: number | null };
    try {
      body = JSON.parse(raw.text) as typeof body;
    } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const existing = await env.DB.prepare(
      `SELECT * FROM audit_findings WHERE id = ? AND account_id = ?`,
    )
      .bind(findingId, accountId)
      .first<FindingRow>();
    if (!existing) return json({ ok: false, error: 'Not found' }, 404);

    const nextStatus =
      body.status && STATUSES.has(body.status) ? body.status : existing.status;
    const nextOwner =
      body.owner === null
        ? null
        : body.owner !== undefined
          ? String(body.owner).slice(0, 120)
          : existing.owner;
    const nextDue =
      body.dueAt === null
        ? null
        : typeof body.dueAt === 'number' && Number.isFinite(body.dueAt)
          ? body.dueAt
          : existing.due_at;
    const now = Date.now();

    await env.DB.prepare(
      `UPDATE audit_findings SET status = ?, owner = ?, due_at = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
    )
      .bind(nextStatus, nextOwner, nextDue, now, findingId, accountId)
      .run();

    const row = await env.DB.prepare(`SELECT * FROM audit_findings WHERE id = ? AND account_id = ?`)
      .bind(findingId, accountId)
      .first<FindingRow>();
    return json({ ok: true, finding: row ? rowToPublic(row) : null });
  }

  return json({ error: 'Method not allowed' }, 405);
}
