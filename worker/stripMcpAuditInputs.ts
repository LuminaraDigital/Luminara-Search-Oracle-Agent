/**
 * One-time rewrite of MCP security-log rows.
 *
 * Rows whose action starts with mcp_tool_ used to store the call's args and
 * projectId. This drops those two keys, keeps every other field, and reseals
 * the org's hash chain in insertion order so verifyAuditChain still passes.
 * D1 SQL cannot recompute SHA-256, so this is a script, not a migrations/*.sql file.
 * A second run finds no args or projectId and writes nothing.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { GENESIS_HASH, auditEntryDetailsJson, computeAuditHash, verifyAuditChain } from './auditHash';
import type { AuditLogEntry } from './userTypes';

const INPUT_KEYS = new Set(['args', 'projectId']);
const ATTEMPTS = 8;

const ORG_SQL = `SELECT org_id FROM org_audit_logs
WHERE action LIKE 'mcp_tool_%'
  AND json_valid(details)
  AND (
    json_type(details, '$.args') IS NOT NULL
    OR json_type(details, '$.projectId') IS NOT NULL
  )
UNION
SELECT a.org_id FROM org_audit_logs a
WHERE a.org_id IN (SELECT DISTINCT org_id FROM org_audit_logs WHERE action LIKE 'mcp_tool_%')
  AND IFNULL(a.prev_hash, '') != ?
  AND NOT EXISTS (
    SELECT 1 FROM org_audit_logs p WHERE p.org_id = a.org_id AND p.hash = a.prev_hash
  )`;

const ROWS_SQL = `SELECT rowid AS row_id, id, org_id, actor_id, action, target_id, details, ip_address, user_agent, prev_hash, hash, created_at
FROM org_audit_logs WHERE org_id = ? ORDER BY rowid ASC`;

const COUNT_SQL = `SELECT COUNT(*) AS n, MAX(rowid) AS tail FROM org_audit_logs WHERE org_id = ?`;

const UPDATE_SQL = `UPDATE org_audit_logs SET details = ?, prev_hash = ?, hash = ? WHERE id = ? AND hash = ?`;

type ChainRow = {
  row_id: number;
  id: string;
  org_id: string;
  actor_id: string;
  action: string;
  target_id: string | null;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  prev_hash: string | null;
  hash: string;
  created_at: number;
};

export type McpAuditStripResult = { orgs: number; rows: number };

export function mcpAuditStripTarget(
  argv: readonly string[],
  env: { CONFIRM_PROD_AUDIT_STRIP?: string },
): { database: string; envName: 'staging' | 'production' } {
  const prod = argv.includes('--prod');
  const staging = argv.includes('--staging');
  if (prod === staging) throw new Error('Pass exactly one of --staging or --prod.');
  if (prod && env.CONFIRM_PROD_AUDIT_STRIP !== '1') {
    throw new Error('Refusing production. Set CONFIRM_PROD_AUDIT_STRIP=1 to run this on luminara-users.');
  }
  return prod
    ? { database: 'luminara-users', envName: 'production' }
    : { database: 'luminara-users-staging', envName: 'staging' };
}

function asDetailsText(details: unknown): string | null {
  if (details == null) return null;
  return typeof details === 'string' ? details : JSON.stringify(details);
}

/** Drop args and projectId from one MCP tool row. Any other details string is returned unchanged. */
export function stripMcpToolAuditDetails(action: string, details: string | null): string | null {
  if (!action.startsWith('mcp_tool_') || details == null) return details;
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    return details;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return details;
  const obj = parsed as Record<string, unknown>;
  if (!Object.keys(obj).some((key) => INPUT_KEYS.has(key))) return details;
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (INPUT_KEYS.has(key)) continue;
    next[key] = obj[key];
  }
  return JSON.stringify(next);
}

function hasToolInputs(rows: ChainRow[]): boolean {
  return rows.some((row) => {
    const details = asDetailsText(row.details);
    if (!row.action.startsWith('mcp_tool_') || details == null) return false;
    try {
      const parsed = JSON.parse(details) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      return 'args' in parsed || 'projectId' in parsed;
    } catch {
      return false;
    }
  });
}

function toEntry(row: ChainRow): AuditLogEntry {
  return {
    id: row.id,
    org_id: row.org_id,
    actor_id: row.actor_id,
    action: row.action,
    target_id: row.target_id || undefined,
    details: asDetailsText(row.details) ?? undefined,
    prev_hash: row.prev_hash || GENESIS_HASH,
    hash: row.hash,
    created_at: Number(row.created_at),
  };
}

async function readOrg(db: D1Database, orgId: string): Promise<{ rows: ChainRow[]; n: number; tail: number | null }> {
  const count = await db.prepare(COUNT_SQL).bind(orgId).first<{ n: number; tail: number | null }>();
  const read = await db.prepare(ROWS_SQL).bind(orgId).all<ChainRow>();
  const rows = (read.results || []).map((row) => ({ ...row, details: asDetailsText(row.details) }));
  return { rows, n: Number(count?.n || 0), tail: count?.tail == null ? null : Number(count.tail) };
}

async function resealOrg(db: D1Database, orgId: string): Promise<number> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const before = await readOrg(db, orgId);
    if (before.n !== before.rows.length) continue;
    if (before.rows.length > 0 && before.tail !== Number(before.rows[before.rows.length - 1].row_id)) continue;

    let prev = GENESIS_HASH;
    const updates = [];
    for (const row of before.rows) {
      const stored = asDetailsText(row.details);
      const stripped = stripMcpToolAuditDetails(row.action, stored);
      const hash = await computeAuditHash(
        prev,
        row.org_id,
        row.actor_id,
        row.action,
        row.target_id || '',
        Number(row.created_at),
        auditEntryDetailsJson(stripped),
      );
      const link = row.prev_hash || GENESIS_HASH;
      if (stripped !== stored || link !== prev || row.hash !== hash) {
        updates.push(db.prepare(UPDATE_SQL).bind(stripped, prev, hash, row.id, row.hash));
      }
      prev = hash;
    }

    if (updates.length === 0) {
      const verdict = await verifyAuditChain(before.rows.map(toEntry));
      if (verdict.verified && !hasToolInputs(before.rows)) return 0;
      continue;
    }

    for (let i = 0; i < updates.length; i += 100) {
      await db.batch(updates.slice(i, i + 100));
    }

    const after = await readOrg(db, orgId);
    if (after.n !== before.n || after.tail !== before.tail) continue;
    const verdict = await verifyAuditChain(after.rows.map(toEntry));
    if (!verdict.verified || hasToolInputs(after.rows)) continue;

    const beforeHash = new Map(before.rows.map((row) => [row.id, `${row.hash}|${asDetailsText(row.details)}`]));
    return after.rows.filter((row) => beforeHash.get(row.id) !== `${row.hash}|${asDetailsText(row.details)}`).length;
  }
  throw new Error(`Audit chain for ${orgId} changed while MCP tool inputs were removed. Run the script again.`);
}

export async function stripMcpAuditInputs(db: D1Database): Promise<McpAuditStripResult> {
  const listed = await db.prepare(ORG_SQL).bind(GENESIS_HASH).all<{ org_id: string }>();
  const orgIds = [...new Set((listed.results || []).map((row) => row.org_id))];
  let orgs = 0;
  let rows = 0;
  for (const orgId of orgIds) {
    const changed = await resealOrg(db, orgId);
    if (changed > 0) {
      orgs += 1;
      rows += changed;
    }
  }
  return { orgs, rows };
}
