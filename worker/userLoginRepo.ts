/**
 * Login-row repository for `users`.
 * d1 matches the existing upsert SQL. dual writes that SQL, then best-effort patches Firestore.
 * firestore is implemented and not enabled in wrangler.
 * Account link, privacy erase, and email_unsub_token stay on D1. Backfill repairs the mirror.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { DataPlane, DataPlaneEnv, UserLoginRow, UserLoginWrite } from './dataPlaneDocs';
import { USER_COLLECTION, USER_LIVE_FIELDS, userDocId, userDocToLogin, userWriteFields } from './dataPlaneDocs';
import {
  DataPlaneConfigError,
  logMirror,
  mirrorLog,
  mirrorTimeout,
  scheduleMirror,
  type DataPlaneDeps,
} from './dataPlane';
import { firestoreFromEnv, type FirestoreClient } from './firestoreRest';

export type UserLoginStore = {
  find(id: string): Promise<UserLoginRow | null>;
  save(row: UserLoginWrite): Promise<void>;
};

export function openUserLoginStore(env: DataPlaneEnv, deps: DataPlaneDeps | undefined, plane: DataPlane): UserLoginStore {
  const d1 = env.DB ? new D1UserLoginStore(env.DB) : null;
  if (plane === 'd1') {
    if (!d1) throw new DataPlaneConfigError('Database unavailable');
    return d1;
  }
  const fs = firestoreFromEnv(env, deps);
  if (plane === 'firestore') {
    if (!fs) throw new DataPlaneConfigError('Firestore is not configured');
    return new FirestoreUserLoginStore(fs);
  }
  if (plane !== 'dual') {
    const _exhaustive: never = plane;
    return _exhaustive;
  }
  if (!d1) throw new DataPlaneConfigError('Database unavailable');
  return new DualUserLoginStore(d1, fs, deps);
}

export class D1UserLoginStore implements UserLoginStore {
  constructor(private readonly db: D1Database) {}

  find(id: string): Promise<UserLoginRow | null> {
    return this.db.prepare(
      `SELECT id, account_id, created_at, last_seen_at, email, display_name, welcome_sent_at, email_opt_out_at FROM users WHERE id = ?`,
    ).bind(id).first<UserLoginRow>();
  }

  async save(row: UserLoginWrite): Promise<void> {
    await this.db.prepare(
      `INSERT INTO users (id, source, email, display_name, telegram_id, firebase_uid, created_at, last_seen_at, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         last_seen_at = excluded.last_seen_at,
         account_id = COALESCE(users.account_id, excluded.account_id)`,
    ).bind(
      row.id,
      row.source,
      row.email,
      row.displayName,
      row.telegramId,
      row.firebaseUid,
      row.createdAt,
      row.lastSeenAt,
      row.accountId,
    ).run();
  }
}

class FirestoreUserLoginStore implements UserLoginStore {
  constructor(private readonly client: FirestoreClient) {}

  async find(id: string): Promise<UserLoginRow | null> {
    const fields = await this.client.get(USER_COLLECTION, userDocId(id));
    if (!fields) return null;
    return userDocToLogin(id, fields);
  }

  async save(row: UserLoginWrite, signal?: AbortSignal): Promise<void> {
    await this.client.patch(USER_COLLECTION, userDocId(row.id), userWriteFields(row), {
      mask: USER_LIVE_FIELDS,
      signal,
    });
  }
}

class DualUserLoginStore implements UserLoginStore {
  constructor(
    private readonly d1: D1UserLoginStore,
    private readonly firestore: FirestoreClient | null,
    private readonly deps: DataPlaneDeps | undefined,
  ) {}

  find(id: string): Promise<UserLoginRow | null> {
    return this.d1.find(id);
  }

  async save(row: UserLoginWrite): Promise<void> {
    await this.d1.save(row);
    const log = mirrorLog(this.deps);
    let id = 'invalid';
    try {
      id = userDocId(row.id);
    } catch {
      logMirror({ op: 'upsert', entity: 'user', id }, 'error', 0, log);
      return;
    }
    if (!this.firestore) {
      logMirror({ op: 'upsert', entity: 'user', id }, 'unconfigured', 0, log);
      return;
    }
    const firestore = this.firestore;
    scheduleMirror({ op: 'upsert', entity: 'user', id }, mirrorTimeout(this.deps), log, (signal) =>
      firestore.patch(USER_COLLECTION, id, userWriteFields(row), { mask: USER_LIVE_FIELDS, signal }),
    );
  }
}
