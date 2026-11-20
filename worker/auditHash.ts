/**
 * Hash chain for org_audit_logs. No other worker imports, so the one-time
 * rewrite script can load it under Node's type stripper.
 */
import type { AuditLogEntry } from './userTypes';

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** The details string that computeAuditHash and verifyAuditChain both use. */
export function auditEntryDetailsJson(details: AuditLogEntry['details'] | null | undefined): string {
  return typeof details === 'string' ? details : JSON.stringify(details || {});
}

/** SHA-256 of one audit row, linked to the previous row's hash. */
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
 * Verifies an audit chain.
 * Walks prev_hash links from genesis instead of trusting timestamp order, so it
 * reports three failure shapes: an edited row (hash mismatch), a fork (two rows
 * linking to the same parent, from pre-fix concurrent writes), and orphans (rows
 * unreachable from genesis, for example a deleted parent).
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
    const computed = await computeAuditHash(
      entry.prev_hash || GENESIS_HASH,
      entry.org_id,
      entry.actor_id,
      entry.action,
      entry.target_id || '',
      Number(entry.created_at),
      auditEntryDetailsJson(entry.details),
    );
    if (computed !== entry.hash) {
      return { verified: false, brokenAtId: entry.id, reason: 'hash_mismatch', length: reached.size, headHash: expectedPrevHash };
    }
    if (reached.has(entry.id)) break;
    reached.add(entry.id);
    expectedPrevHash = entry.hash;
  }

  const length = reached.size;
  if (length < entries.length) {
    const orphan = [...entries]
      .sort((a, b) => a.created_at - b.created_at)
      .find((entry) => !reached.has(entry.id));
    return { verified: false, brokenAtId: orphan?.id, reason: 'orphan', length, headHash: expectedPrevHash };
  }

  return { verified: true, length, headHash: expectedPrevHash };
}
