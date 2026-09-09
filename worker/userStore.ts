/**
 * Durable user profiles for signed-in Telegram / Firebase callers.
 * Prefers Cloudflare D1 when bound; falls back to KV so deploys work before D1 is created.
 */
import type { HostedIdentity } from './userTypes';

export type UserStoreEnv = {
  DB?: D1Database;
  LUMINARA_KV?: KVNamespace;
};

export type StoredUser = {
  id: string;
  source: 'telegram' | 'firebase';
  email?: string;
  name?: string;
  telegram_id?: string;
  firebase_uid?: string;
  created_at: number;
  last_seen_at: number;
};

export async function upsertAppUser(env: UserStoreEnv, user: HostedIdentity): Promise<void> {
  const now = Date.now();
  const telegramId = user.source === 'telegram' ? user.id : undefined;
  const firebaseUid = user.source === 'firebase' ? user.id.replace(/^fb:/, '') : undefined;

  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO users (id, source, email, display_name, telegram_id, firebase_uid, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         last_seen_at = excluded.last_seen_at`,
    )
      .bind(
        user.id,
        user.source,
        user.email ?? null,
        user.name ?? null,
        telegramId ?? null,
        firebaseUid ?? null,
        now,
        now,
      )
      .run();
    return;
  }

  if (!env.LUMINARA_KV) return;
  const key = `user:${user.id}`;
  let createdAt = now;
  try {
    const existing = (await env.LUMINARA_KV.get(key, 'json')) as StoredUser | null;
    if (existing?.created_at) createdAt = existing.created_at;
  } catch {
    /* ignore */
  }
  const row: StoredUser = {
    id: user.id,
    source: user.source,
    email: user.email,
    name: user.name,
    telegram_id: telegramId,
    firebase_uid: firebaseUid,
    created_at: createdAt,
    last_seen_at: now,
  };
  await env.LUMINARA_KV.put(key, JSON.stringify(row));
}
