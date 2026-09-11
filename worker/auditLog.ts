/**
 * Tamper-Evident SIEM Audit Logging Engine.
 *
 * Implements cryptographic append-only hash chaining (SHA-256) for compliance
 * and enterprise security observability (SOC 2, ISO 27001, HIPAA).
 */

import type { UserStoreEnv } from './userStore';
import type { AuditLogEntry } from './userTypes';

const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

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
  const now = Date.now();
  const id = `log_${crypto.randomUUID()}`;
  const detailsJson = typeof params.details === 'string'
    ? params.details
    : JSON.stringify(params.details || {});
  const targetId = params.target_id || '';

  let prevHash = GENESIS_HASH;

  if (env.DB) {
    const lastEntry = await env.DB.prepare(
      `SELECT hash FROM org_audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(params.org_id)
      .first<{ hash: string }>();

    if (lastEntry?.hash) {
      prevHash = lastEntry.hash;
    }

    const currentHash = await computeAuditHash(
      prevHash,
      params.org_id,
      params.actor_id,
      params.action,
      targetId,
      now,
      detailsJson,
    );

    await env.DB.prepare(
      `INSERT INTO org_audit_logs (id, org_id, actor_id, action, target_id, details, ip_address, user_agent, prev_hash, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      )
      .run();

    return {
      id,
      org_id: params.org_id,
      actor_id: params.actor_id,
      action: params.action,
      target_id: targetId || undefined,
      details: params.details,
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
    details: params.details,
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
  options?: { limit?: number; offset?: number },
): Promise<{ entries: AuditLogEntry[]; total: number }> {
  const limit = Math.min(Math.max(Number(options?.limit || 50), 1), 200);
  const offset = Math.max(Number(options?.offset || 0), 0);

  if (env.DB) {
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as total FROM org_audit_logs WHERE org_id = ?`,
    )
      .bind(orgId)
      .first<{ total: number }>();

    const { results } = await env.DB.prepare(
      `SELECT id, org_id, actor_id, action, target_id, details, ip_address, user_agent, prev_hash, hash, created_at
       FROM org_audit_logs
       WHERE org_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(orgId, limit, offset)
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
 */
export async function verifyAuditChain(
  entries: AuditLogEntry[],
): Promise<{ verified: boolean; brokenAtId?: string }> {
  // Chain verification runs in chronological order (oldest to newest)
  const sorted = [...entries].sort((a, b) => a.created_at - b.created_at);

  let expectedPrevHash = GENESIS_HASH;
  for (const entry of sorted) {
    if (entry.prev_hash !== expectedPrevHash) {
      return { verified: false, brokenAtId: entry.id };
    }

    const detailsJson = typeof entry.details === 'string'
      ? entry.details
      : JSON.stringify(entry.details || {});

    const computed = await computeAuditHash(
      entry.prev_hash,
      entry.org_id,
      entry.actor_id,
      entry.action,
      entry.target_id || '',
      entry.created_at,
      detailsJson,
    );

    if (computed !== entry.hash) {
      return { verified: false, brokenAtId: entry.id };
    }

    expectedPrevHash = entry.hash;
  }

  return { verified: true };
}
