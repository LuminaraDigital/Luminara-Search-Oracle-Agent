/**
 * Tamper-Evident SIEM Audit Logging Engine.
 *
 * Implements cryptographic append-only hash chaining (SHA-256) for compliance
 * and enterprise security observability (SOC 2, ISO 27001, HIPAA).
 */

import type { UserStoreEnv } from './userStore';
import type { AuditLogEntry } from './userTypes';
import { sha256Hex } from './workerUtils';
import { redactForAudit } from './logRedaction';

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const AUDIT_APPEND_ATTEMPTS = 12;
/** Jittered backoff between append attempts so a burst on one org serialises instead of colliding again. */
const auditBackoff = (attempt: number) =>
  new Promise<void>((done) => setTimeout(done, Math.floor(Math.random() * 10 * (attempt + 1))));
/**
 * Chain head = last row appended for the org (rowid is insertion order). Not
 * created_at: a retried writer could carry an older timestamp than the head.
 * Binds one parameter: org_id.
 */
const AUDIT_HEAD_SQL = 'SELECT hash FROM org_audit_logs WHERE org_id = ? ORDER BY rowid DESC LIMIT 1';

async function readAuditHead(
  db: D1Database,
  orgId: string,
): Promise<{ hash: string; created_at: number } | null> {
  return db
    .prepare('SELECT hash, created_at FROM org_audit_logs WHERE org_id = ? ORDER BY rowid DESC LIMIT 1')
    .bind(orgId)
    .first<{ hash: string; created_at: number }>();
}

/**
 * Audit chain id for an account's personal org. Must match the id minted by
 * getOrCreateUserOrg (worker/enterpriseStore.ts) so GET /enterprise/audit-logs
 * can read agent, budget, and privacy events. Writers must never pass a raw
 * accountId as org_id.
 */
export function auditOrgIdFor(accountId: string): string {
  return `org_${String(accountId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * Non-secret fingerprint of a license key for audit metadata: first 12 hex chars
 * of SHA-256(key). Never log or store the raw key in audit details.
 */
export async function licenseKeyFingerprint(key: string): Promise<string> {
  return (await sha256Hex(`luminara-license-key:${key}`)).slice(0, 12);
}

/**
 * Full SHA-256 hex of the normalized (trimmed, uppercased) license key.
 * Used by vault seed/verify manifests to prove remote state after rotation.
 * Distinct from licenseKeyFingerprint (12-char audit display digest); both are
 * non-reversible. Never log or return the raw key alongside this value.
 */
export async function licenseKeySha256(key: string): Promise<string> {
  const normalized = String(key || '').trim().toUpperCase();
  return sha256Hex(`luminara-license-key:${normalized}`);
}

/**
 * Best-effort audit write for money and admin events (license activation, TON
 * credit, Stars refund, admin key mint/seed/dump).
 *
 * Tradeoff: a failed audit write must not abort the money op. The entitlement was
 * already granted (or the refund already issued at Telegram); failing the request
 * now would desynchronize the user's paid state from the ledger with no way to
 * retry cleanly, and D1/KV blips are transient. So we log the failure to the
 * Worker console (alerting surface) and return. The hash-chained log loses that
 * one entry until operators reconcile from console logs.
 */
export async function recordAuditLogBestEffort(
  env: UserStoreEnv,
  params: {
    org_id: string;
    actor_id: string;
    action: string;
    target_id?: string;
    details?: Record<string, unknown> | string;
    ip_address?: string;
    user_agent?: string;
  },
): Promise<void> {
  try {
    await recordAuditLog(env, params);
  } catch (err) {
    console.error(
      `[audit] failed to record ${params.action} for org ${params.org_id} (money op already committed, not retried):`,
      err instanceof Error ? err.message : err,
    );
  }
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Computes an immutable cryptographic SHA-256 hash for an audit log entry,
 * linking it to the previous entry's hash.
 */
export async function computeAuditHash(
  prevHash: string,
  orgId: string,
  actorId: string,
  action: string,
  targetId: string,
  timestamp: number,
  detailsJson: string,
): Promise<string> {
  const payload = `${prevHash}|${orgId}|${actorId}|${action}|${targetId}|${timestamp}|${detailsJson}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(payload));
  return bufferToHex(hashBuffer);
}

/**
 * Appends a tamper-evident audit record to the organization's immutable audit trail.
 */
export async function recordAuditLog(
  env: UserStoreEnv,
  params: {
    org_id: string;
    actor_id: string;
    action: string;
    target_id?: string;
    details?: Record<string, unknown> | string;
    ip_address?: string;
    user_agent?: string;
  },
): Promise<AuditLogEntry> {
  let now = Date.now();
  const id = `log_${crypto.randomUUID()}`;
  // Redact secrets out of details before they are persisted or returned.
  const safeDetails = redactForAudit(params.details) as Record<string, unknown> | string | undefined;
  const detailsJson = typeof safeDetails === 'string'
    ? safeDetails
    : JSON.stringify(safeDetails || {});
  const targetId = params.target_id || '';

  let prevHash = GENESIS_HASH;

  if (env.DB) {
    // Fork-proof append. D1 has no interactive transactions, so "read head, then
    // insert" lets two concurrent writers link to the same prev_hash and fork the
    // chain. The insert below lands only if the head is still the hash we linked
    // to; otherwise it writes nothing and we re-read the head and retry.
    let currentHash = '';
    let appended = false;
    for (let attempt = 0; attempt < AUDIT_APPEND_ATTEMPTS && !appended; attempt++) {
      if (attempt > 0) await auditBackoff(attempt);
      const head = await readAuditHead(env.DB, params.org_id);
      prevHash = head?.hash || GENESIS_HASH;
      // Keep created_at monotonic along the chain so chronological reads match link order.
      now = Math.max(Date.now(), head ? Number(head.created_at) || 0 : 0);
      currentHash = await computeAuditHash(
        prevHash,
        params.org_id,
        params.actor_id,
        params.action,
        targetId,
        now,
        detailsJson,
      );
      const res = await env.DB.prepare(
        `INSERT INTO org_audit_logs (id, org_id, actor_id, action, target_id, details, ip_address, user_agent, prev_hash, hash, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE COALESCE((${AUDIT_HEAD_SQL}), ?) = ?`,
      )
        .bind(
          id,
          params.org_id,
          params.actor_id,
          params.action,
          targetId || null,
          detailsJson,
          params.ip_address || null,
          params.user_agent || null,
          prevHash,
          currentHash,
          now,
          params.org_id,
          GENESIS_HASH,
          prevHash,
        )
        .run();
      appended = Number(res.meta?.changes || 0) > 0;
    }
    if (!appended) {
      throw new Error(`audit chain head moved ${AUDIT_APPEND_ATTEMPTS} times for ${params.org_id}; entry not written`);
    }

    return {
      id,
      org_id: params.org_id,
      actor_id: params.actor_id,
      action: params.action,
      target_id: targetId || undefined,
      details: safeDetails,
      ip_address: params.ip_address,
      user_agent: params.user_agent,
      prev_hash: prevHash,
      hash: currentHash,
      created_at: now,
    };
  }

  // Fallback for tests or KV runtimes
  const currentHash = await computeAuditHash(
    prevHash,
    params.org_id,
    params.actor_id,
    params.action,
    targetId,
    now,
    detailsJson,
  );

  return {
    id,
    org_id: params.org_id,
    actor_id: params.actor_id,
    action: params.action,
    target_id: targetId || undefined,
    details: safeDetails,
    ip_address: params.ip_address,
    user_agent: params.user_agent,
    prev_hash: prevHash,
    hash: currentHash,
    created_at: now,
  };
}

/**
 * Retrieves paginated audit logs for an organization.
 */
export async function getAuditLogs(
  env: UserStoreEnv,
  orgId: string,
  options?: { limit?: number; offset?: number; legacyOrgIds?: string[] },
): Promise<{ entries: AuditLogEntry[]; total: number }> {
  const limit = Math.min(Math.max(Number(options?.limit || 50), 1), 200);
  const offset = Math.max(Number(options?.offset || 0), 0);
  // Legacy rows (pre auditOrgIdFor) used the raw accountId as org_id. They are
  // merged on read, never rewritten: rewriting org_id would break the hash chain.
  const orgIds = [orgId, ...(options?.legacyOrgIds || []).filter((id) => id && id !== orgId)].slice(0, 5);
  const placeholders = orgIds.map(() => '?').join(', ');

  if (env.DB) {
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM org_audit_logs WHERE org_id IN (${placeholders})`,
    )
      .bind(...orgIds)
      .first<{ total: number }>();

    const { results } = await env.DB.prepare(
      `SELECT id, org_id, actor_id, action, target_id, details, ip_address, user_agent, prev_hash, hash, created_at
       FROM org_audit_logs
       WHERE org_id IN (${placeholders})
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...orgIds, limit, offset)
      .all<AuditLogEntry>();

    return {
      entries: results || [],
      total: countRow?.total || 0,
    };
  }

  return { entries: [], total: 0 };
}

/**
 * Verifies the mathematical integrity of an audit chain (detects tampering/forgery).
 *
 * Walks prev_hash links from genesis instead of trusting timestamp order, so it
 * reports three failure shapes: an edited row (hash mismatch), a fork (two rows
 * linking to the same parent, from pre-fix concurrent writes), and orphans (rows
 * unreachable from genesis, e.g. a deleted parent).
 */
export async function verifyAuditChain(
  entries: AuditLogEntry[],
): Promise<{ verified: boolean; brokenAtId?: string; reason?: 'hash_mismatch' | 'fork' | 'orphan'; length: number; headHash: string }> {
  const byPrev = new Map<string, AuditLogEntry[]>();
  for (const entry of entries) {
    const key = entry.prev_hash || GENESIS_HASH;
    const list = byPrev.get(key) || [];
    list.push(entry);
    byPrev.set(key, list);
  }

  let expectedPrevHash = GENESIS_HASH;
  const reached = new Set<string>();
  for (;;) {
    const next = (byPrev.get(expectedPrevHash) || []).sort((a, b) => a.created_at - b.created_at);
    if (next.length === 0) break;
    if (next.length > 1) {
      return { verified: false, brokenAtId: next[1].id, reason: 'fork', length: reached.size, headHash: expectedPrevHash };
    }
    const entry = next[0];

    const detailsJson = typeof entry.details === 'string'
      ? entry.details
      : JSON.stringify(entry.details || {});

    const computed = await computeAuditHash(
      entry.prev_hash || GENESIS_HASH,
      entry.org_id,
      entry.actor_id,
      entry.action,
      entry.target_id || '',
      Number(entry.created_at),
      detailsJson,
    );

    if (computed !== entry.hash) {
      return { verified: false, brokenAtId: entry.id, reason: 'hash_mismatch', length: reached.size, headHash: expectedPrevHash };
    }

    if (reached.has(entry.id)) break; // defensive: a hash cycle cannot occur with SHA-256, but never loop forever
    reached.add(entry.id);
    expectedPrevHash = entry.hash;
  }

  const length = reached.size;
  if (length < entries.length) {
    const orphan = [...entries]
      .sort((a, b) => a.created_at - b.created_at)
      .find((e) => !reached.has(e.id));
    return { verified: false, brokenAtId: orphan?.id, reason: 'orphan', length, headHash: expectedPrevHash };
  }

  return { verified: true, length, headHash: expectedPrevHash };
}

/** Upper bound on rows read for one chain verification (D1 response size). */
export const AUDIT_CHAIN_VERIFY_MAX_ROWS = 5000;

/**
 * Reads one org's full chain (oldest first) for verification. Returns
 * `truncated: true` when the chain exceeds AUDIT_CHAIN_VERIFY_MAX_ROWS; callers
 * must report that instead of claiming the whole chain verified.
 */
export async function getAuditChainEntries(
  env: UserStoreEnv,
  orgId: string,
): Promise<{ entries: AuditLogEntry[]; truncated: boolean }> {
  if (!env.DB) return { entries: [], truncated: false };
  const { results } = await env.DB.prepare(
    `SELECT id, org_id, actor_id, action, target_id, details, prev_hash, hash, created_at
     FROM org_audit_logs WHERE org_id = ? ORDER BY rowid ASC LIMIT ?`,
  )
    .bind(orgId, AUDIT_CHAIN_VERIFY_MAX_ROWS + 1)
    .all<AuditLogEntry>();
  const rows = results || [];
  return { entries: rows.slice(0, AUDIT_CHAIN_VERIFY_MAX_ROWS), truncated: rows.length > AUDIT_CHAIN_VERIFY_MAX_ROWS };
}
