/**
 * Instant Audit history repository (migration 0038).
 * D1 stays the source of truth in `d1` and `dual`. Dual mirrors the stored row, which already
 * keeps the first measuredAt. Firestore writes time out inside waitUntil and cannot fail the request.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { StoredAuditEntry } from './auditHistoryRoute';
import type { DataPlane, DataPlaneEnv } from './dataPlaneDocs';
import {
  AUDIT_COLLECTION,
  AUDIT_HISTORY_CAP,
  auditDocId,
  auditFields,
  fieldsToAudit,
} from './dataPlaneDocs';
import {
  DataPlaneConfigError,
  logMirror,
  mirrorLog,
  mirrorTimeout,
  scheduleMirror,
  type DataPlaneDeps,
} from './dataPlane';
import { firestoreFromEnv, type FirestoreClient, type FirestoreDoc } from './firestoreRest';

export type AuditHistoryQuery = { accountId: string; domain: string; limit: number };
export type AuditHistoryWrite = { accountId: string; entry: StoredAuditEntry; now: number };

export type AuditHistoryRepository = {
  list(query: AuditHistoryQuery): Promise<StoredAuditEntry[]>;
  upsert(write: AuditHistoryWrite): Promise<StoredAuditEntry | null>;
};

export function openAuditHistoryStore(
  env: DataPlaneEnv,
  deps: DataPlaneDeps | undefined,
  plane: DataPlane,
): AuditHistoryRepository {
  const d1 = env.DB ? new D1AuditHistoryRepository(env.DB) : null;
  if (plane === 'd1') {
    if (!d1) throw new DataPlaneConfigError('Database unavailable');
    return d1;
  }
  const fs = firestoreFromEnv(env, deps);
  if (plane === 'firestore') {
    if (!fs) throw new DataPlaneConfigError('Firestore is not configured');
    return new FirestoreAuditHistoryRepository(fs);
  }
  if (plane !== 'dual') {
    const _exhaustive: never = plane;
    return _exhaustive;
  }
  if (!d1) throw new DataPlaneConfigError('Database unavailable');
  return new DualAuditHistoryRepository(d1, fs, deps);
}

export class D1AuditHistoryRepository implements AuditHistoryRepository {
  constructor(
    private readonly db: D1Database,
    private readonly maxRows = AUDIT_HISTORY_CAP,
  ) {}

  async list(query: AuditHistoryQuery): Promise<StoredAuditEntry[]> {
    const res = query.domain
      ? await this.db.prepare(
        `SELECT entry_json, measured_at FROM audit_history WHERE account_id = ? AND domain = ? ORDER BY measured_at DESC LIMIT ?`,
      ).bind(query.accountId, query.domain, query.limit).all<{ entry_json: string; measured_at: number }>()
      : await this.db.prepare(
        `SELECT entry_json, measured_at FROM audit_history WHERE account_id = ? ORDER BY measured_at DESC LIMIT ?`,
      ).bind(query.accountId, query.limit).all<{ entry_json: string; measured_at: number }>();
    return (res.results || []).map(parseRow).filter((entry): entry is StoredAuditEntry => entry !== null);
  }

  async upsert(write: AuditHistoryWrite): Promise<StoredAuditEntry | null> {
    const entry = write.entry;
    await this.db.prepare(
      `INSERT INTO audit_history (account_id, id, domain, measured_at, entry_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, id) DO UPDATE SET
         domain = excluded.domain,
         entry_json = excluded.entry_json,
         updated_at = excluded.updated_at`,
    ).bind(write.accountId, entry.id, entry.domain, entry.measuredAt, JSON.stringify(entry), write.now).run();
    const count = await this.db.prepare(`SELECT COUNT(*) AS n FROM audit_history WHERE account_id = ?`)
      .bind(write.accountId)
      .first<{ n: number }>();
    if (Number(count?.n ?? 0) > this.maxRows) {
      await this.db.prepare(
        `DELETE FROM audit_history WHERE account_id = ? AND id NOT IN (
           SELECT id FROM audit_history WHERE account_id = ? ORDER BY measured_at DESC LIMIT ?
         )`,
      ).bind(write.accountId, write.accountId, this.maxRows).run();
    }
    const row = await this.db.prepare(`SELECT entry_json, measured_at FROM audit_history WHERE account_id = ? AND id = ?`)
      .bind(write.accountId, entry.id)
      .first<{ entry_json: string; measured_at: number }>();
    return row ? parseRow(row) : null;
  }
}

class FirestoreAuditHistoryRepository implements AuditHistoryRepository {
  constructor(
    private readonly client: FirestoreClient,
    private readonly maxRows = AUDIT_HISTORY_CAP,
  ) {}

  async list(query: AuditHistoryQuery): Promise<StoredAuditEntry[]> {
    const docs = await this.client.query({
      collection: AUDIT_COLLECTION,
      accountId: query.accountId,
      domain: query.domain || undefined,
      limit: query.limit,
    });
    return docs.map((doc) => fieldsToAudit(doc.fields)).filter((entry): entry is StoredAuditEntry => entry !== null);
  }

  async upsert(write: AuditHistoryWrite, signal?: AbortSignal): Promise<StoredAuditEntry | null> {
    const id = auditDocId(write.accountId, write.entry.id);
    const existing = await this.client.get(AUDIT_COLLECTION, id, signal);
    const previous = existing ? fieldsToAudit(existing) : null;
    const entry = previous ? { ...write.entry, measuredAt: previous.measuredAt } : write.entry;
    await this.client.patch(AUDIT_COLLECTION, id, auditFields(write.accountId, entry, write.now), { signal });
    await trimMirrored(this.client, write.accountId, this.maxRows, signal);
    return entry;
  }
}

class DualAuditHistoryRepository implements AuditHistoryRepository {
  constructor(
    private readonly d1: D1AuditHistoryRepository,
    private readonly firestore: FirestoreClient | null,
    private readonly deps: DataPlaneDeps | undefined,
  ) {}

  list(query: AuditHistoryQuery): Promise<StoredAuditEntry[]> {
    return this.d1.list(query);
  }

  async upsert(write: AuditHistoryWrite): Promise<StoredAuditEntry | null> {
    const stored = await this.d1.upsert(write);
    if (!stored) return null;
    const log = mirrorLog(this.deps);
    let id = 'invalid';
    try {
      id = auditDocId(write.accountId, stored.id);
    } catch {
      logMirror({ op: 'upsert', entity: 'audit', id }, 'error', 0, log);
      return stored;
    }
    if (!this.firestore) {
      logMirror({ op: 'upsert', entity: 'audit', id }, 'unconfigured', 0, log);
      return stored;
    }
    const firestore = this.firestore;
    const fields = auditFields(write.accountId, stored, write.now);
    scheduleMirror({ op: 'upsert', entity: 'audit', id }, mirrorTimeout(this.deps), log, async (signal) => {
      await firestore.patch(AUDIT_COLLECTION, id, fields, { signal });
      await trimMirrored(firestore, write.accountId, AUDIT_HISTORY_CAP, signal);
    });
    return stored;
  }
}

/** shortcut: each save deletes at most 5 overflow pages. Backfill rewrites the D1 cap of 500. */
async function trimMirrored(
  client: FirestoreClient,
  accountId: string,
  maxRows: number,
  signal?: AbortSignal,
): Promise<void> {
  for (let round = 0; round < 5; round++) {
    const page: FirestoreDoc[] = await client.query(
      { collection: AUDIT_COLLECTION, accountId, limit: maxRows + 1 },
      signal,
    );
    if (page.length <= maxRows) return;
    for (const extra of page.slice(maxRows)) await client.delete(AUDIT_COLLECTION, extra.id, signal);
  }
}

function parseRow(row: { entry_json: string; measured_at: number }): StoredAuditEntry | null {
  try {
    const parsed: unknown = JSON.parse(row.entry_json);
    if (!isRecord(parsed)) return null;
    return fieldsToAudit({ ...parsed, measuredAt: row.measured_at });
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
