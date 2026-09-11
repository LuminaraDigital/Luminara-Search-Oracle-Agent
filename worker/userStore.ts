/**
 * Durable user profiles, Telegram↔Firebase account linking, and workspace blobs.
 * Prefers Cloudflare D1 when bound; falls back to KV so local tests still work.
 */
import type { HostedIdentity, EncryptedKeyBag } from './userTypes';

export type UserStoreEnv = {
  DB?: D1Database;
  LUMINARA_KV?: KVNamespace;
};

export type StoredUser = {
  id: string;
  source: 'telegram' | 'firebase';
  /** Shared billing + workspace id (same across linked Telegram and Firebase logins). */
  account_id: string;
  email?: string;
  name?: string;
  telegram_id?: string;
  firebase_uid?: string;
  created_at: number;
  last_seen_at: number;
};

export type WorkspacePayload = {
  /** Opaque product state keyed by localStorage-style names. */
  storage?: Record<string, string>;
  /** Optional BYOK key bag (synced so keys follow the account). */
  keys?: Record<string, string>;
  /** Zero-knowledge client-side encrypted key bag (AES-256-GCM + PBKDF2) */
  encryptedKeys?: EncryptedKeyBag;
};

export type WorkspaceRecord = {
  accountId: string;
  payload: WorkspacePayload;
  updatedAt: number;
};

function firebaseUidFromId(id: string): string | undefined {
  return id.startsWith('fb:') ? id.slice(3) : undefined;
}

async function readKvUser(env: UserStoreEnv, id: string): Promise<StoredUser | null> {
  if (!env.LUMINARA_KV) return null;
  try {
    const row = (await env.LUMINARA_KV.get(`user:${id}`, 'json')) as StoredUser | null;
    if (!row) return null;
    if (!row.account_id) row.account_id = row.id;
    return row;
  } catch {
    return null;
  }
}

async function writeKvUser(env: UserStoreEnv, row: StoredUser): Promise<void> {
  if (!env.LUMINARA_KV) return;
  await env.LUMINARA_KV.put(`user:${row.id}`, JSON.stringify(row));
}

export async function upsertAppUser(env: UserStoreEnv, user: HostedIdentity): Promise<StoredUser> {
  const now = Date.now();
  const telegramId = user.source === 'telegram' ? user.id : undefined;
  const firebaseUid = user.source === 'firebase' ? firebaseUidFromId(user.id) : undefined;

  if (env.DB) {
    const existing = await env.DB.prepare(`SELECT id, account_id, created_at FROM users WHERE id = ?`)
      .bind(user.id)
      .first<{ id: string; account_id: string | null; created_at: number }>();
    const accountId = existing?.account_id || user.accountId || user.id;
    const createdAt = existing?.created_at ?? now;

    await env.DB.prepare(
      `INSERT INTO users (id, source, email, display_name, telegram_id, firebase_uid, created_at, last_seen_at, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         display_name = excluded.display_name,
         last_seen_at = excluded.last_seen_at,
         account_id = COALESCE(users.account_id, excluded.account_id)`,
    )
      .bind(
        user.id,
        user.source,
        user.email ?? null,
        user.name ?? null,
        telegramId ?? null,
        firebaseUid ?? null,
        createdAt,
        now,
        accountId,
      )
      .run();

    return {
      id: user.id,
      source: user.source,
      account_id: accountId,
      email: user.email,
      name: user.name,
      telegram_id: telegramId,
      firebase_uid: firebaseUid,
      created_at: createdAt,
      last_seen_at: now,
    };
  }

  const prev = await readKvUser(env, user.id);
  const row: StoredUser = {
    id: user.id,
    source: user.source,
    account_id: prev?.account_id || user.accountId || user.id,
    email: user.email,
    name: user.name,
    telegram_id: telegramId,
    firebase_uid: firebaseUid,
    created_at: prev?.created_at ?? now,
    last_seen_at: now,
  };
  await writeKvUser(env, row);

  // Maintain index of all registered users for admin auditability
  if (env.LUMINARA_KV) {
    try {
      const idx = ((await env.LUMINARA_KV.get('users:index', 'json')) as string[] | null) || [];
      if (!idx.includes(user.id)) {
        idx.unshift(user.id);
        await env.LUMINARA_KV.put('users:index', JSON.stringify(idx.slice(0, 1000)));
      }
    } catch {
      /* ignore */
    }
  }

  return row;
}

/** Lists all users ordered by most recent activity (sign-in) for admin auditability. */
export async function listAllUsers(env: UserStoreEnv, limit = 100): Promise<StoredUser[]> {
  if (env.DB) {
    const rows = await env.DB.prepare(
      `SELECT id, source, email, display_name as name, telegram_id, firebase_uid, created_at, last_seen_at, account_id
       FROM users ORDER BY last_seen_at DESC LIMIT ?`,
    )
      .bind(limit)
      .all<StoredUser>();
    return rows.results || [];
  }

  if (env.LUMINARA_KV) {
    try {
      let ids = ((await env.LUMINARA_KV.get('users:index', 'json')) as string[] | null) || [];
      if (!ids.length && typeof env.LUMINARA_KV.list === 'function') {
        const listRes = await env.LUMINARA_KV.list({ prefix: 'user:', limit });
        ids = (listRes.keys || []).map(k => k.name.replace(/^user:/, ''));
      }
      const users: StoredUser[] = [];
      for (const id of ids.slice(0, limit)) {
        const u = await readKvUser(env, id);
        if (u) users.push(u);
      }
      return users.sort((a, b) => b.last_seen_at - a.last_seen_at);
    } catch {
      return [];
    }
  }

  return [];
}

/** Resolves the billing/workspace account id for a login identity. */
export async function resolveAccountId(env: UserStoreEnv, userId: string): Promise<string> {
  if (env.DB) {
    const row = await env.DB.prepare(`SELECT account_id FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ account_id: string | null }>();
    if (row?.account_id) return row.account_id;
  }
  const kvUser = await readKvUser(env, userId);
  return kvUser?.account_id || userId;
}

/**
 * Attaches accountId onto a HostedIdentity after upsert.
 */
export async function withAccountId(env: UserStoreEnv, user: HostedIdentity): Promise<HostedIdentity> {
  const stored = await upsertAppUser(env, user);
  return { ...user, accountId: stored.account_id };
}

async function hasActiveSub(env: UserStoreEnv, accountOrUserId: string): Promise<boolean> {
  if (!env.LUMINARA_KV) return false;
  try {
    const sub = (await env.LUMINARA_KV.get(`sub:${accountOrUserId}`, 'json')) as { expiresAt?: number } | null;
    return Boolean(sub?.expiresAt && sub.expiresAt > Date.now());
  } catch {
    return false;
  }
}

/**
 * Copies an active subscription from legacy login ids onto the shared account id.
 * Stripe later writes the same `sub:{accountId}` key.
 */
export async function mirrorSubscriptionToAccount(
  env: UserStoreEnv,
  accountId: string,
  candidateIds: string[],
): Promise<void> {
  if (!env.LUMINARA_KV) return;
  const existing = (await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as { expiresAt?: number } | null;
  if (existing?.expiresAt && existing.expiresAt > Date.now()) return;

  let best: { expiresAt?: number } | null = null;
  for (const id of candidateIds) {
    if (id === accountId) continue;
    const sub = (await env.LUMINARA_KV.get(`sub:${id}`, 'json')) as { expiresAt?: number } | null;
    if (!sub?.expiresAt || sub.expiresAt <= Date.now()) continue;
    if (!best?.expiresAt || sub.expiresAt > best.expiresAt) best = sub;
  }
  if (best) {
    await env.LUMINARA_KV.put(`sub:${accountId}`, JSON.stringify(best));
  }
}

/**
 * Persist a paid plan under the shared account id (and the login id for legacy readers).
 * Stars, TON, and future Stripe checkouts should all call this.
 */
export async function writeSubscriptionRecord(
  env: UserStoreEnv,
  loginUserId: string,
  record: Record<string, unknown>,
): Promise<{ accountId: string }> {
  const accountId = await resolveAccountId(env, String(loginUserId));
  if (!env.LUMINARA_KV) return { accountId };
  const body = JSON.stringify(record);
  await env.LUMINARA_KV.put(`sub:${accountId}`, body);
  if (accountId !== String(loginUserId)) {
    await env.LUMINARA_KV.put(`sub:${loginUserId}`, body);
  }
  return { accountId };
}

/**
 * Link Telegram numeric id and Firebase uid so both logins share one account_id.
 * Prefer the account that already has an active paid plan; otherwise keep the older account.
 */
export async function linkTelegramAndFirebase(
  env: UserStoreEnv,
  telegramId: string,
  firebaseUid: string,
  meta?: { email?: string; name?: string; tgName?: string },
): Promise<{ accountId: string; telegramUserId: string; firebaseUserId: string }> {
  const tgIdentity: HostedIdentity = {
    id: telegramId,
    source: 'telegram',
    name: meta?.tgName,
  };
  const fbIdentity: HostedIdentity = {
    id: `fb:${firebaseUid}`,
    source: 'firebase',
    email: meta?.email,
    name: meta?.name,
  };

  const tgRow = await upsertAppUser(env, tgIdentity);
  const fbRow = await upsertAppUser(env, fbIdentity);

  let accountId = tgRow.account_id;
  const tgPaid = await hasActiveSub(env, tgRow.account_id) || await hasActiveSub(env, telegramId);
  const fbPaid = await hasActiveSub(env, fbRow.account_id) || await hasActiveSub(env, fbRow.id);

  if (fbPaid && !tgPaid) accountId = fbRow.account_id;
  else if (tgPaid && !fbPaid) accountId = tgRow.account_id;
  else if (fbRow.created_at < tgRow.created_at) accountId = fbRow.account_id;
  else accountId = tgRow.account_id;

  if (env.DB) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET account_id = ?, telegram_id = ?, last_seen_at = ? WHERE id = ?`,
      ).bind(accountId, telegramId, Date.now(), telegramId),
      env.DB.prepare(
        `UPDATE users SET account_id = ?, firebase_uid = ?, email = COALESCE(?, email), display_name = COALESCE(?, display_name), last_seen_at = ? WHERE id = ?`,
      ).bind(accountId, firebaseUid, meta?.email ?? null, meta?.name ?? null, Date.now(), `fb:${firebaseUid}`),
    ]);
  } else {
    const now = Date.now();
    await writeKvUser(env, {
      ...tgRow,
      account_id: accountId,
      telegram_id: telegramId,
      last_seen_at: now,
    });
    await writeKvUser(env, {
      ...fbRow,
      account_id: accountId,
      firebase_uid: firebaseUid,
      email: meta?.email ?? fbRow.email,
      name: meta?.name ?? fbRow.name,
      last_seen_at: now,
    });
  }

  await mirrorSubscriptionToAccount(env, accountId, [
    accountId,
    telegramId,
    `fb:${firebaseUid}`,
    tgRow.account_id,
    fbRow.account_id,
  ]);

  return {
    accountId,
    telegramUserId: telegramId,
    firebaseUserId: `fb:${firebaseUid}`,
  };
}

export async function getWorkspace(env: UserStoreEnv, accountId: string): Promise<WorkspaceRecord | null> {
  if (env.DB) {
    const row = await env.DB.prepare(
      `SELECT account_id, payload, updated_at FROM user_workspace WHERE account_id = ?`,
    )
      .bind(accountId)
      .first<{ account_id: string; payload: string; updated_at: number }>();
    if (!row) return null;
    let payload: WorkspacePayload = {};
    try {
      payload = JSON.parse(row.payload) as WorkspacePayload;
    } catch {
      payload = {};
    }
    return { accountId: row.account_id, payload, updatedAt: row.updated_at };
  }

  if (!env.LUMINARA_KV) return null;
  const raw = (await env.LUMINARA_KV.get(`workspace:${accountId}`, 'json')) as WorkspaceRecord | null;
  return raw;
}

export async function putWorkspace(
  env: UserStoreEnv,
  accountId: string,
  payload: WorkspacePayload,
  updatedAt: number,
): Promise<WorkspaceRecord> {
  const record: WorkspaceRecord = { accountId, payload, updatedAt };
  const body = JSON.stringify(payload);

  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO user_workspace (account_id, payload, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    )
      .bind(accountId, body, updatedAt)
      .run();
    return record;
  }

  if (env.LUMINARA_KV) {
    await env.LUMINARA_KV.put(`workspace:${accountId}`, JSON.stringify(record));
  }
  return record;
}
