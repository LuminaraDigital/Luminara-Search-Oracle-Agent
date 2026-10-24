/**
 * Account-link and privacy-erase mirror.
 * D1 stays the source of truth. Dual mode copies a link into Firestore and, after a
 * D1 erase, deletes that account's Firestore docs inside waitUntil. A failed delete
 * stays pending in firestore_erase_ledger so reconcile can finish it.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { scheduleWaitUntil } from './welcomeEmail';
import { mirrorLog, mirrorTimeout, readPlane, type DataPlaneDeps, type DataPlaneLog } from './dataPlane';
import type { DataPlaneEnv } from './dataPlaneDocs';
import { AUDIT_COLLECTION, USER_COLLECTION, auditDocId, userDocId } from './dataPlaneDocs';
import { firestoreFromEnv, type FirestoreClient } from './firestoreRest';

export const ERASE_MIRROR_FAILED = 'ERASE_MIRROR_FAILED';
export const ERASE_UNCONFIGURED = 'ERASE_UNCONFIGURED';
export const ERASE_LEDGER_MISSING = 'ERASE_LEDGER_MISSING';
export const ERASE_LEDGER_FAILED = 'ERASE_LEDGER_FAILED';
export const ERASE_PAGE_SIZE = 100;
/** shortcut: one attempt deletes at most this many query pages. Reconcile continues. */
export const ERASE_MAX_PAGES = 20;

export type EraseTarget = { accountId: string; userIds: string[] };

export function erasePageSize(deps?: DataPlaneDeps): number {
  const size = deps?.erasePageSize;
  return typeof size === 'number' && Number.isInteger(size) && size > 0 && size <= 500 ? size : ERASE_PAGE_SIZE;
}

export function parseUserIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  if (typeof value !== 'string' || !value) return [];
  try {
    return parseUserIds(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

export function readErasedLedger(parsed: unknown): { userIds: string[]; accountIds: string[] } {
  const userIds: string[] = [];
  const accountIds: string[] = [];
  if (!Array.isArray(parsed)) return { userIds, accountIds };
  for (const row of parsed) {
    if (!isRecord(row)) continue;
    const accountId = text(row.accountId) ?? text(row.account_id);
    if (accountId) accountIds.push(accountId);
    const raw = 'userIds' in row ? row.userIds : row.user_ids_json;
    userIds.push(...parseUserIds(raw));
  }
  return { userIds, accountIds };
}

export function eraseTargetsFromExport(parsed: unknown): EraseTarget[] {
  if (!Array.isArray(parsed)) return [];
  const targets: EraseTarget[] = [];
  for (const row of parsed) {
    if (!isRecord(row)) continue;
    const accountId = text(row.accountId) ?? text(row.account_id);
    if (!accountId) continue;
    const raw = 'userIds' in row ? row.userIds : row.user_ids_json;
    targets.push({ accountId, userIds: parseUserIds(raw) });
  }
  return targets;
}

export async function purgeFirestoreAccount(
  client: FirestoreClient,
  target: EraseTarget,
  pageSize: number,
  signal?: AbortSignal,
): Promise<number> {
  const explicit: string[] = [];
  for (const userId of target.userIds) {
    try {
      explicit.push(userDocId(userId));
    } catch {
      continue;
    }
  }
  if (explicit.length) await client.batchDelete(USER_COLLECTION, explicit, signal);
  let pages = await deleteCollectionPages(client, USER_COLLECTION, target.accountId, pageSize, signal);
  pages += await deleteCollectionPages(client, AUDIT_COLLECTION, target.accountId, pageSize, signal);
  return pages;
}

/** Rewrite audit docs onto the surviving account id, then delete the old ids. */
export async function moveMirroredAudits(
  client: FirestoreClient,
  fromAccountId: string,
  toAccountId: string,
  pageSize: number,
  signal?: AbortSignal,
): Promise<void> {
  if (fromAccountId === toAccountId) return;
  for (let round = 0; round < ERASE_MAX_PAGES; round++) {
    const docs = await client.query({
      collection: AUDIT_COLLECTION,
      accountId: fromAccountId,
      limit: pageSize,
      orderBy: 'accountId',
    }, signal);
    if (docs.length === 0) return;
    for (const doc of docs) {
      const entryId = text(doc.fields.id);
      if (entryId) {
        await client.patch(AUDIT_COLLECTION, auditDocId(toAccountId, entryId), { ...doc.fields, accountId: toAccountId }, { signal });
      }
      await client.delete(AUDIT_COLLECTION, doc.id, signal);
    }
    if (docs.length < pageSize) return;
  }
  throw new Error(ERASE_MIRROR_FAILED);
}

export async function trackAndScheduleErase(env: DataPlaneEnv, deps: DataPlaneDeps | undefined, target: EraseTarget): Promise<void> {
  const log = mirrorLog(deps);
  try {
    await queueErase(env, deps, target, log);
  } catch {
    logErase(log, { id: target.accountId, outcome: 'error', code: ERASE_LEDGER_FAILED, latencyMs: 0, pages: 0 });
  }
}

export async function reconcilePendingErases(
  env: DataPlaneEnv,
  deps?: DataPlaneDeps,
): Promise<{ cleared: number; pending: number }> {
  if (!env.DB) return { cleared: 0, pending: 0 };
  const rows = await listPending(env.DB);
  const client = firestoreFromEnv(env, deps);
  if (!client) return { cleared: 0, pending: rows.length };
  const pageSize = erasePageSize(deps);
  let cleared = 0;
  let pending = 0;
  for (const row of rows) {
    try {
      await purgeFirestoreAccount(client, row, pageSize);
      await noteErase(env.DB, row, 'done', '', Date.now());
      cleared += 1;
    } catch {
      await noteErase(env.DB, row, 'pending', ERASE_MIRROR_FAILED, Date.now()).catch(() => undefined);
      pending += 1;
    }
  }
  return { cleared, pending };
}

async function queueErase(env: DataPlaneEnv, deps: DataPlaneDeps | undefined, target: EraseTarget, log: DataPlaneLog): Promise<void> {
  if (!env.DB) {
    logErase(log, { id: target.accountId, outcome: 'error', code: ERASE_LEDGER_MISSING, latencyMs: 0, pages: 0 });
    return;
  }
  const db = env.DB;
  const plane = readPlane(env, log);
  if (plane === 'd1') {
    const wrote = await noteErase(db, target, 'done', '', Date.now());
    if (wrote === 'missing') logErase(log, { id: target.accountId, outcome: 'error', code: ERASE_LEDGER_MISSING, latencyMs: 0, pages: 0 });
    return;
  }
  const wrote = await noteErase(db, target, 'pending', '', Date.now());
  if (wrote === 'missing') logErase(log, { id: target.accountId, outcome: 'error', code: ERASE_LEDGER_MISSING, latencyMs: 0, pages: 0 });
  const client = firestoreFromEnv(env, deps);
  if (!client) {
    if (wrote === 'ok') await noteErase(db, target, 'pending', ERASE_UNCONFIGURED, Date.now());
    logErase(log, { id: target.accountId, outcome: 'unconfigured', code: ERASE_UNCONFIGURED, latencyMs: 0, pages: 0 });
    return;
  }
  const pageSize = erasePageSize(deps);
  const timeoutMs = mirrorTimeout(deps);
  scheduleErase(timeoutMs, async (signal) => {
    const started = Date.now();
    try {
      const pages = await purgeFirestoreAccount(client, target, pageSize, signal);
      await noteErase(db, target, 'done', '', Date.now());
      logErase(log, { id: target.accountId, outcome: 'ok', code: '', latencyMs: Date.now() - started, pages });
    } catch {
      await noteErase(db, target, 'pending', ERASE_MIRROR_FAILED, Date.now()).catch(() => undefined);
      logErase(log, {
        id: target.accountId,
        outcome: signal.aborted ? 'timeout' : 'error',
        code: ERASE_MIRROR_FAILED,
        latencyMs: Date.now() - started,
        pages: 0,
      });
    }
  });
}

function scheduleErase(timeoutMs: number, run: (signal: AbortSignal) => Promise<void>): void {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  scheduleWaitUntil(run(ac.signal).finally(() => clearTimeout(timer)));
}

async function deleteCollectionPages(
  client: FirestoreClient,
  collection: string,
  accountId: string,
  pageSize: number,
  signal?: AbortSignal,
): Promise<number> {
  let pages = 0;
  for (let round = 0; round < ERASE_MAX_PAGES; round++) {
    const docs = await client.query({ collection, accountId, limit: pageSize, orderBy: 'accountId' }, signal);
    pages += 1;
    if (docs.length === 0) return pages;
    await client.batchDelete(collection, docs.map((doc) => doc.id), signal);
    if (docs.length < pageSize) return pages;
  }
  throw new Error(ERASE_MIRROR_FAILED);
}

async function noteErase(
  db: D1Database,
  target: EraseTarget,
  status: 'pending' | 'done',
  code: string,
  now: number,
): Promise<'ok' | 'missing'> {
  try {
    await db.prepare(
      `INSERT INTO firestore_erase_ledger (account_id, user_ids_json, status, code, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         user_ids_json = excluded.user_ids_json,
         status = excluded.status,
         code = excluded.code,
         attempts = CASE
           WHEN excluded.status = 'pending' AND firestore_erase_ledger.status = 'pending' THEN firestore_erase_ledger.attempts + 1
           ELSE firestore_erase_ledger.attempts
         END,
         updated_at = excluded.updated_at`,
    ).bind(target.accountId, JSON.stringify(target.userIds), status, code, now, now).run();
    return 'ok';
  } catch (err) {
    if (missingTable(err)) return 'missing';
    throw err;
  }
}

async function listPending(db: D1Database): Promise<EraseTarget[]> {
  try {
    const rows = await db.prepare(
      `SELECT account_id, user_ids_json FROM firestore_erase_ledger WHERE status = 'pending'`,
    ).all<{ account_id: string; user_ids_json: string }>();
    return (rows.results ?? []).map((row) => ({
      accountId: row.account_id,
      userIds: parseUserIds(row.user_ids_json),
    }));
  } catch (err) {
    if (missingTable(err)) return [];
    throw err;
  }
}

function logErase(log: DataPlaneLog, input: { id: string; outcome: string; code: string; latencyMs: number; pages: number }): void {
  log(JSON.stringify({
    event: 'data_plane_erase',
    op: 'delete',
    entity: 'account',
    id: input.id,
    outcome: input.outcome,
    code: input.code,
    latency_ms: input.latencyMs,
    pages: input.pages,
  }));
}

function missingTable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : '';
  return /no such table/i.test(message);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
