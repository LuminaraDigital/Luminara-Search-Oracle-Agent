/**
 * Durable user profiles, Telegram↔Firebase account linking, and workspace blobs.
 * Prefers Cloudflare D1 when bound; falls back to KV so local tests still work.
 */
import type { KVNamespace } from '@cloudflare/workers-types';
import { PlanDowngradeRefusedError, wouldDowngrade } from './planRank';
import type { HostedIdentity, EncryptedKeyBag } from './userTypes';
import { scheduleWelcomeEmail, type WelcomeEnv } from './welcomeEmail';
import type { DataPlaneEnv } from './dataPlaneDocs';
import { readPlane, type DataPlaneDeps } from './dataPlane';
import { openAuditHistoryStore } from './auditHistoryRepo';
import { openUserLoginStore } from './userLoginRepo';
import { findErasedLogin } from './accountMirror';

export type UserStoreEnv = DataPlaneEnv & {
  LUMINARA_KV?: KVNamespace;
  /**
   * Budget enforcement kill-switch: `off` | `soft` | `hard`.
   * Unset defaults to hard (policy-driven). See worker/budgets.ts.
   */
  BUDGET_ENFORCEMENT?: string;
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

/** shortcut: last_seen is stored at most once an hour. A name or email change still writes. */
const PROFILE_TOUCH_MS = 60 * 60 * 1000;

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

export type UpsertedUser = StoredUser & { created: boolean; welcomePending: boolean };

export async function upsertAppUser(env: UserStoreEnv, user: HostedIdentity, deps?: DataPlaneDeps): Promise<UpsertedUser> {
  const now = Date.now();
  const telegramId = user.source === 'telegram' ? user.id : undefined;
  const firebaseUid = user.source === 'firebase' ? firebaseUidFromId(user.id) : undefined;
  if (env.DB) {
    const erased = await findErasedLogin(env.DB, user.id);
    if (erased) {
      return {
        id: user.id,
        source: user.source,
        account_id: user.accountId || user.id,
        email: user.email,
        name: user.name,
        telegram_id: telegramId,
        firebase_uid: firebaseUid,
        created_at: now,
        last_seen_at: now,
        created: false,
        welcomePending: false,
      };
    }
  }
  const plane = readPlane(env, deps?.log);

  if (plane === 'firestore' || env.DB) {
    const users = openUserLoginStore(env, deps, plane);
    const existing = await users.find(user.id);
    const accountId = existing?.account_id || user.accountId || user.id;
    const createdAt = existing?.created_at ?? now;
    if (
      existing?.account_id
      && now - existing.last_seen_at < PROFILE_TOUCH_MS
      && (existing.email ?? null) === (user.email ?? null)
      && (existing.display_name ?? null) === (user.name ?? null)
    ) {
      return {
        id: user.id,
        source: user.source,
        account_id: existing.account_id,
        email: user.email,
        name: user.name,
        telegram_id: telegramId,
        firebase_uid: firebaseUid,
        created_at: createdAt,
        last_seen_at: existing.last_seen_at,
        created: false,
        welcomePending: welcomeStillOwed(existing, user.email),
      };
    }

    await users.save({
      id: user.id,
      source: user.source,
      email: user.email ?? null,
      displayName: user.name ?? null,
      telegramId: telegramId ?? null,
      firebaseUid: firebaseUid ?? null,
      createdAt,
      lastSeenAt: now,
      accountId,
    });

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
      created: !existing,
      welcomePending: !existing || welcomeStillOwed(existing, user.email),
    };
  }

  const prev = await readKvUser(env, user.id);
  if (
    prev?.account_id
    && now - prev.last_seen_at < PROFILE_TOUCH_MS
    && (prev.email ?? null) === (user.email ?? null)
    && (prev.name ?? null) === (user.name ?? null)
    && prev.source === user.source
  ) {
    return { ...prev, created: false, welcomePending: false };
  }
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

  return { ...row, created: !prev, welcomePending: !prev && Boolean(user.email?.trim()) };
}

function welcomeStillOwed(
  row: { welcome_sent_at: number | null; email_opt_out_at: number | null },
  email?: string,
): boolean {
  if (!email?.trim() || row.email_opt_out_at != null) return false;
  return row.welcome_sent_at == null;
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
    try {
      const row = await env.DB.prepare(`SELECT account_id FROM users WHERE id = ?`)
        .bind(userId)
        .first<{ account_id: string | null }>();
      if (row?.account_id) return row.account_id;
    } catch {
      console.warn(JSON.stringify({ event: 'account_store_error' }));
    }
  }
  const kvUser = await readKvUser(env, userId);
  return kvUser?.account_id || userId;
}

/**
 * Attaches accountId onto a HostedIdentity after upsert.
 */
export async function withAccountId(env: UserStoreEnv & WelcomeEnv, user: HostedIdentity): Promise<HostedIdentity> {
  try {
    const stored = await upsertAppUser(env, user);
    scheduleWelcomeEmail(env, stored);
    return { ...user, accountId: stored.account_id };
  } catch {
    console.warn(JSON.stringify({ event: 'account_store_error' }));
    return { ...user, accountId: user.accountId || user.id };
  }
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
  // `allowLowerPlan` is for a caller that takes a plan away on purpose (a reversed or disputed
  // payment falling back to the plan still paid for). A purchase never sets it.
  opts: { allowLowerPlan?: boolean } = {},
): Promise<{ accountId: string }> {
  const accountId = await resolveAccountId(env, String(loginUserId));
  if (!env.LUMINARA_KV) return { accountId };
  const existing = (await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as
    | { plan?: unknown; expiresAt?: number; appliedCharges?: unknown; chargeId?: unknown }
    | null;
  // A purchase may never replace a plan that is still running with a lower one. The rule lives
  // here because every rail writes through here, so a rail added later inherits it.
  if (!opts.allowLowerPlan && wouldDowngrade(existing, record.plan)) {
    throw new PlanDowngradeRefusedError(String(existing?.plan), Number(existing?.expiresAt), String(record.plan));
  }
  // A purchase on another rail must not erase which Stars charges an active record was built
  // from: the charge sweep and refunds read that list to tell a granted charge from a lost one.
  let toWrite = record;
  if (!Array.isArray(record.appliedCharges)) {
    // Records written before the list existed name one charge.
    const earlier = Array.isArray(existing?.appliedCharges)
      ? existing.appliedCharges
      : typeof existing?.chargeId === 'string' && existing.chargeId
        ? [existing.chargeId]
        : [];
    if (existing?.expiresAt && existing.expiresAt > Date.now() && earlier.length > 0) {
      toWrite = { ...record, appliedCharges: earlier };
    }
  }
  const body = JSON.stringify(toWrite);
  await env.LUMINARA_KV.put(`sub:${accountId}`, body);
  if (accountId !== String(loginUserId)) {
    await env.LUMINARA_KV.put(`sub:${loginUserId}`, body);
  }
  return { accountId };
}

/**
 * Thrown when an explicit link would merge two different accounts that each
 * already have an active paid plan. Nothing is written.
 */
export class AccountLinkRefusedError extends Error {
  readonly code = 'DUAL_PAID';
  readonly status = 409;
  readonly telegramAccountId: string;
  readonly firebaseAccountId: string;

  constructor(telegramAccountId: string, firebaseAccountId: string) {
    super(
      'Both Telegram and web accounts have active paid plans. Linking was refused. Ask the account owner or support to approve a merge.',
    );
    this.name = 'AccountLinkRefusedError';
    this.telegramAccountId = telegramAccountId;
    this.firebaseAccountId = firebaseAccountId;
  }
}

async function readStoredUser(env: UserStoreEnv, id: string): Promise<StoredUser | null> {
  if (env.DB) {
    const row = await env.DB.prepare(
      `SELECT id, source, email, display_name as name, telegram_id, firebase_uid, created_at, last_seen_at, account_id
       FROM users WHERE id = ?`,
    )
      .bind(id)
      .first<StoredUser>();
    if (!row) return null;
    if (!row.account_id) row.account_id = row.id;
    return row;
  }
  return readKvUser(env, id);
}

/**
 * Link Telegram numeric id and Firebase uid so both logins share one account_id.
 * Only call this after explicit consent (`POST /api/auth/link` with `{ confirm: true }`).
 * If the two sides are different accounts and both have an active paid plan, throws
 * AccountLinkRefusedError and does not write. Otherwise keep the paid account, or the
 * older account when neither side is paid.
 */
export async function linkTelegramAndFirebase(
  env: UserStoreEnv,
  telegramId: string,
  firebaseUid: string,
  meta?: { email?: string; name?: string; tgName?: string },
  deps?: DataPlaneDeps,
): Promise<{ accountId: string; telegramUserId: string; firebaseUserId: string }> {
  const firebaseUserId = `fb:${firebaseUid}`;
  const existingTg = await readStoredUser(env, telegramId);
  const existingFb = await readStoredUser(env, firebaseUserId);
  const tgAccountPreview = existingTg?.account_id || telegramId;
  const fbAccountPreview = existingFb?.account_id || firebaseUserId;
  const tgPaid = (await hasActiveSub(env, tgAccountPreview)) || (await hasActiveSub(env, telegramId));
  const fbPaid = (await hasActiveSub(env, fbAccountPreview)) || (await hasActiveSub(env, firebaseUserId));
  if (tgPaid && fbPaid && tgAccountPreview !== fbAccountPreview) {
    throw new AccountLinkRefusedError(tgAccountPreview, fbAccountPreview);
  }

  const tgIdentity: HostedIdentity = {
    id: telegramId,
    source: 'telegram',
    name: meta?.tgName,
  };
  const fbIdentity: HostedIdentity = {
    id: firebaseUserId,
    source: 'firebase',
    email: meta?.email,
    name: meta?.name,
  };

  const tgRow = await upsertAppUser(env, tgIdentity, deps);
  const fbRow = await upsertAppUser(env, fbIdentity, deps);

  let accountId = tgRow.account_id;
  if (fbPaid && !tgPaid) accountId = fbRow.account_id;
  else if (tgPaid && !fbPaid) accountId = tgRow.account_id;
  else if (fbRow.created_at < tgRow.created_at) accountId = fbRow.account_id;
  else accountId = tgRow.account_id;

  const plane = readPlane(env, deps?.log);
  if (env.DB) {
    await openUserLoginStore(env, deps, plane).linkPair({
      accountId,
      lastSeenAt: Date.now(),
      telegramId,
      firebaseUserId,
      firebaseUid,
      email: meta?.email ?? null,
      displayName: meta?.name ?? null,
    });
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

  // Stars charge rows follow the account that survives the link. Its own statement, so a
  // database without the table yet cannot fail the link.
  if (env.DB) {
    const audits = openAuditHistoryStore(env, deps, plane);
    const losing = [tgRow.account_id, fbRow.account_id].filter((id) => id && id !== accountId);
    for (const from of losing) {
      try {
        await env.DB.prepare(`UPDATE stars_charges SET account_id = ? WHERE account_id = ?`).bind(accountId, from).run();
      } catch (err) {
        console.error('[UserStore] Stars charge rows were not moved to the linked account', err);
      }
      try {
        await env.DB.prepare(`UPDATE ton_pending_orders SET account_id = ? WHERE account_id = ?`).bind(accountId, from).run();
      } catch (err) {
        console.error('[UserStore] Pending TON orders were not moved to the linked account', err);
      }
      try {
        await env.DB.prepare(`UPDATE payment_support_requests SET account_id = ? WHERE account_id = ?`).bind(accountId, from).run();
      } catch (err) {
        console.error('[UserStore] Payment support requests were not moved to the linked account', err);
      }
      // Community feed cards and votes. A row that would collide with one the surviving account
      // already has is not moved; it is deleted, and a deleted card takes its votes with it.
      try {
        await env.DB.batch([
          env.DB.prepare(`UPDATE OR IGNORE community_feed_votes SET account_id = ? WHERE account_id = ?`).bind(accountId, from),
          env.DB.prepare(`DELETE FROM community_feed_votes WHERE account_id = ?`).bind(from),
          env.DB.prepare(`UPDATE OR IGNORE community_feed_cards SET account_id = ? WHERE account_id = ?`).bind(accountId, from),
          env.DB.prepare(`DELETE FROM community_feed_votes WHERE card_id IN (SELECT id FROM community_feed_cards WHERE account_id = ?)`).bind(from),
          env.DB.prepare(`DELETE FROM community_feed_cards WHERE account_id = ?`).bind(from),
        ]);
      } catch (err) {
        console.error('[UserStore] Community feed rows were not moved to the linked account', err);
      }
      // Audit history. An id the surviving account already has is the same saved audit, so the copy goes.
      try {
        await audits.move(from, accountId);
      } catch (err) {
        console.error('[UserStore] Audit history rows were not moved to the linked account', err);
      }
    }
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
