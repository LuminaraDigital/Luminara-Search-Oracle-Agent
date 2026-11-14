/**
 * OAuth 2.1 refresh-token rotation for MCP public clients.
 * The family row moves with one conditional D1 update:
 * UPDATE ... WHERE family_id=? AND current_refresh_hash=? AND revoked=0.
 * A second writer sees zero rows changed and, inside the grace window, receives
 * the winner's tokens. Raw tokens are not stored. The grace copy is AES-GCM
 * under a key derived from MCP_OAUTH_SECRET only.
 */
import type { Env } from './env';
import { sha256Hex } from './workerUtils';
import { randomId } from '../services/projects/projectUtils';
import { planCapsFor } from './telegramBot';
import { isErasedSubject } from './accountMirror';
import { isSessionRevokedUser } from './opaqueSession';

export const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;
export type OAuthGrantType = (typeof SUPPORTED_GRANT_TYPES)[number];

/** Refresh token lifetime. Each successful refresh slides the client registration by the same amount. */
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 90;

/** Access token lifetime once a refresh token exists. Clients without refresh stay on 30 days. */
export const REFRESH_ACCESS_TTL_SECONDS = 60 * 60;

/**
 * RFC 9700 rotates refresh tokens and treats reuse as theft. This 30 second grace
 * returns the same successor so a client that lost the response can retry once
 * without the server revoking the family.
 */
const REUSE_GRACE_MS = 30_000;

const REFRESH_PREFIX = 'mcr_';
const FAMILY_COLUMNS = `family_id, account_id, user_id, client_id, client_name, granted_scope,
  current_refresh_hash, revoked, retired_refresh_hash, grace_until, successor_enc, updated_at`;

export type RefreshAccessStore = {
  put(input: {
    accessToken: string;
    accountId: string;
    userId: string;
    plan: string;
    scope: string;
    clientId: string;
    clientName: string | null;
    familyId: string;
    expiresIn: number;
  }): Promise<void>;
  deleteHash(accountId: string, accessHash: string): Promise<void>;
  deleteFamilyConnection(accountId: string, familyId: string): Promise<void>;
};

type FamilyRow = {
  familyId: string;
  accountId: string;
  userId: string;
  clientId: string;
  clientName: string | null;
  grantedScope: string;
  currentRefreshHash: string;
  revoked: boolean;
  retiredRefreshHash: string | null;
  graceUntil: number | null;
  successorEnc: string | null;
  updatedAt: number;
};

type Successor = { accessToken: string; refreshToken: string; scope: string };

export type RefreshGrantResult =
  | { kind: 'issued'; accessToken: string; refreshToken: string; scope: string; expiresIn: number }
  | { kind: 'invalid_grant' }
  | { kind: 'invalid_scope' }
  | { kind: 'unavailable' };

/** Token-endpoint body for a refresh result. Callers add Cache-Control: no-store. */
export function refreshGrantResponse(result: RefreshGrantResult): { status: number; body: Record<string, string | number> } {
  switch (result.kind) {
    case 'issued':
      return {
        status: 200,
        body: {
          access_token: result.accessToken,
          refresh_token: result.refreshToken,
          token_type: 'Bearer',
          expires_in: result.expiresIn,
          scope: result.scope,
        },
      };
    case 'invalid_scope':
      return {
        status: 400,
        body: { error: 'invalid_scope', error_description: 'Scope cannot widen past the original grant or the current plan.' },
      };
    case 'unavailable':
      return {
        status: 503,
        body: { error: 'temporarily_unavailable', error_description: 'Could not check the account. Try again.' },
      };
    case 'invalid_grant':
      return { status: 400, body: { error: 'invalid_grant' } };
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGrantType(value: unknown): value is OAuthGrantType {
  return SUPPORTED_GRANT_TYPES.some((grant) => grant === value);
}

/**
 * RFC 7591 section 2: omitted grant_types means authorization_code only.
 * Unknown names are ignored. authorization_code is always kept, because it is
 * the only way to start a session here. refresh_token is kept only when the
 * client named it.
 */
export function parseRegisteredGrantTypes(raw: unknown): OAuthGrantType[] | null {
  if (raw === undefined) return ['authorization_code'];
  if (!Array.isArray(raw)) return null;
  const seen = new Set<OAuthGrantType>();
  for (const item of raw) {
    if (isGrantType(item)) seen.add(item);
  }
  seen.add('authorization_code');
  return SUPPORTED_GRANT_TYPES.filter((grant) => seen.has(grant));
}

/** A stored client with no grant_types field was registered before refresh existed. It stays authorization_code only. */
export function grantsFromStoredClient(raw: unknown): OAuthGrantType[] {
  return parseRegisteredGrantTypes(raw) ?? ['authorization_code'];
}

export function familyIdFromAccessRecord(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    return typeof value.familyId === 'string' && value.familyId ? value.familyId : null;
  } catch {
    return null;
  }
}

/**
 * Scope issued on refresh. Null when the request adds a scope the consent
 * never granted, or when the plan allows none of what was asked.
 * Omitting scope keeps the consent, then drops anything the plan no longer allows.
 */
export function scopeAfterRefresh(granted: string, requested: string | null, allowed: ReadonlySet<string>): string | null {
  const grantedList = granted.split(/\s+/).filter(Boolean);
  const grantedSet = new Set(grantedList);
  const asked =
    requested === null || requested.trim() === '' ? grantedList : requested.split(/\s+/).filter(Boolean);
  if (asked.length === 0) return null;
  for (const scope of asked) {
    if (!grantedSet.has(scope)) return null;
  }
  const kept = ['mcp:free', 'mcp:research'].filter((scope) => asked.includes(scope) && allowed.has(scope));
  return kept.length > 0 ? kept.join(' ') : null;
}

function mintRefreshToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `${REFRESH_PREFIX}${hex}`;
}

function dbErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function missingTable(err: unknown): boolean {
  return /no such table/i.test(dbErrorMessage(err));
}

function parseFamilyRow(value: unknown): FamilyRow | null {
  if (!isRecord(value)) return null;
  const revoked = value.revoked;
  const clientName = value.client_name;
  const retired = value.retired_refresh_hash;
  const grace = value.grace_until;
  const successor = value.successor_enc;
  const updatedAt = value.updated_at;
  if (
    typeof value.family_id !== 'string' ||
    typeof value.account_id !== 'string' ||
    typeof value.user_id !== 'string' ||
    typeof value.client_id !== 'string' ||
    typeof value.granted_scope !== 'string' ||
    typeof value.current_refresh_hash !== 'string' ||
    (revoked !== 0 && revoked !== 1) ||
    (clientName !== null && typeof clientName !== 'string') ||
    (retired !== null && typeof retired !== 'string') ||
    (grace !== null && typeof grace !== 'number') ||
    (successor !== null && typeof successor !== 'string') ||
    typeof updatedAt !== 'number'
  ) {
    return null;
  }
  return {
    familyId: value.family_id,
    accountId: value.account_id,
    userId: value.user_id,
    clientId: value.client_id,
    clientName,
    grantedScope: value.granted_scope,
    currentRefreshHash: value.current_refresh_hash,
    revoked: revoked === 1,
    retiredRefreshHash: retired,
    graceUntil: grace,
    successorEnc: successor,
    updatedAt,
  };
}

function familyIsIdle(family: FamilyRow, now: number): boolean {
  return now - family.updatedAt >= REFRESH_TTL_SECONDS * 1000;
}

/** First connection time stays put when a later refresh overwrites the row. */
export function keptConnectionCreatedAt(raw: string | null, fallback: number): number {
  if (!raw || raw === '1') return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (isRecord(value) && typeof value.createdAt === 'number') return value.createdAt;
  } catch {
    /* a corrupt value keeps the new timestamp */
  }
  return fallback;
}

async function forgetExpiredSuccessor(env: Env, row: FamilyRow | null): Promise<FamilyRow | null> {
  if (!row?.successorEnc || row.graceUntil === null || row.graceUntil > Date.now()) return row;
  await env.DB!.prepare(
    `UPDATE mcp_oauth_refresh_family SET successor_enc = NULL
     WHERE family_id = ? AND grace_until IS NOT NULL AND grace_until <= ?`,
  )
    .bind(row.familyId, Date.now())
    .run();
  return { ...row, successorEnc: null };
}

async function readFamilyById(env: Env, familyId: string): Promise<FamilyRow | null> {
  const row: unknown = await env.DB!.prepare(`SELECT ${FAMILY_COLUMNS} FROM mcp_oauth_refresh_family WHERE family_id = ?`)
    .bind(familyId)
    .first();
  return forgetExpiredSuccessor(env, parseFamilyRow(row));
}

async function findFamily(env: Env, refreshHash: string): Promise<FamilyRow | null> {
  const db = env.DB!;
  const current: unknown = await db
    .prepare(`SELECT ${FAMILY_COLUMNS} FROM mcp_oauth_refresh_family WHERE current_refresh_hash = ?`)
    .bind(refreshHash)
    .first();
  if (current) return forgetExpiredSuccessor(env, parseFamilyRow(current));
  const retiredCol: unknown = await db
    .prepare(`SELECT ${FAMILY_COLUMNS} FROM mcp_oauth_refresh_family WHERE retired_refresh_hash = ?`)
    .bind(refreshHash)
    .first();
  if (retiredCol) return forgetExpiredSuccessor(env, parseFamilyRow(retiredCol));
  const link = await db
    .prepare(`SELECT family_id FROM mcp_oauth_refresh_retired WHERE refresh_hash = ?`)
    .bind(refreshHash)
    .first<{ family_id: string }>();
  if (!link?.family_id) return null;
  return readFamilyById(env, link.family_id);
}

type PlanRead = { kind: 'plan'; plan: string } | { kind: 'unavailable' };

/** A KV fault is unavailable. A missing subscription is the free plan, not a downgrade caused by an error. */
async function readPlan(env: Env, accountId: string, userId: string): Promise<PlanRead> {
  if (!env.LUMINARA_KV) return { kind: 'plan', plan: 'free' };
  try {
    const now = Date.now();
    const keys = accountId === userId ? [`sub:${accountId}`] : [`sub:${accountId}`, `sub:${userId}`];
    for (const key of keys) {
      const value: unknown = await env.LUMINARA_KV.get(key, 'json');
      if (!isRecord(value)) continue;
      const expiresAt = value.expiresAt;
      const plan = value.plan;
      if (typeof expiresAt === 'number' && expiresAt > now && typeof plan === 'string' && plan) {
        return { kind: 'plan', plan };
      }
    }
    return { kind: 'plan', plan: 'free' };
  } catch (err) {
    console.error('[mcp-oauth] plan read failed:', dbErrorMessage(err));
    return { kind: 'unavailable' };
  }
}

type Entitlement =
  | { kind: 'active'; plan: string; allowed: ReadonlySet<string> }
  | { kind: 'revoked' }
  | { kind: 'unavailable' };

async function readEntitlement(env: Env, family: FamilyRow): Promise<Entitlement> {
  try {
    if (await isSessionRevokedUser(env, family.userId)) return { kind: 'revoked' };
    if (env.DB && (await isErasedSubject(env.DB, family.accountId, family.userId))) return { kind: 'revoked' };
  } catch (err) {
    console.error('[mcp-oauth] entitlement check failed:', dbErrorMessage(err));
    return { kind: 'unavailable' };
  }
  const planRead = await readPlan(env, family.accountId, family.userId);
  if (planRead.kind === 'unavailable') return { kind: 'unavailable' };
  const caps = planCapsFor(planRead.plan);
  if (!caps.mcpAccess) return { kind: 'revoked' };
  const allowed = new Set<string>(['mcp:free']);
  if (caps.apiAccess) allowed.add('mcp:research');
  return { kind: 'active', plan: planRead.plan, allowed };
}

async function deleteAccessTokens(env: Env, family: FamilyRow, store: RefreshAccessStore): Promise<void> {
  const cutoff = Date.now() - REFRESH_ACCESS_TTL_SECONDS * 1000;
  const listed = await env.DB!.prepare(
    `SELECT access_hash FROM mcp_oauth_refresh_access WHERE family_id = ? AND issued_at >= ?`,
  )
    .bind(family.familyId, cutoff)
    .all<{ access_hash: string }>();
  for (const row of listed.results ?? []) {
    if (typeof row.access_hash === 'string') await store.deleteHash(family.accountId, row.access_hash);
  }
  await store.deleteFamilyConnection(family.accountId, family.familyId);
  await env.DB!.prepare(`DELETE FROM mcp_oauth_refresh_access WHERE family_id = ?`).bind(family.familyId).run();
  await env.DB!.prepare(`DELETE FROM mcp_oauth_refresh_retired WHERE family_id = ?`).bind(family.familyId).run();
}

/** Marks the family revoked and deletes the access tokens it lists. Idempotent. */
export async function revokeRefreshFamily(
  env: Env,
  familyId: string,
  store: RefreshAccessStore,
  boundAccountId?: string,
): Promise<boolean> {
  if (!env.DB) return false;
  const family = await readFamilyById(env, familyId);
  if (!family) return false;
  if (boundAccountId && family.accountId !== boundAccountId) return false;
  await env.DB.prepare(
    `UPDATE mcp_oauth_refresh_family
     SET revoked = 1, successor_enc = NULL, retired_refresh_hash = NULL, grace_until = NULL, updated_at = ?
     WHERE family_id = ?`,
  )
    .bind(Date.now(), familyId)
    .run();
  await deleteAccessTokens(env, family, store);
  return true;
}

export async function revokeRefreshByToken(env: Env, token: string, store: RefreshAccessStore): Promise<boolean> {
  if (!token.startsWith(REFRESH_PREFIX) || !env.DB) return false;
  try {
    const family = await findFamily(env, await sha256Hex(token));
    if (!family) return false;
    return revokeRefreshFamily(env, family.familyId, store);
  } catch (err) {
    if (missingTable(err)) return false;
    throw err;
  }
}

/** True only when this access hash is listed on a family that is still active. A write happens only when expired grace ciphertext is present. */
export async function refreshFamilyAllowsAccess(env: Env, familyId: string, accessHash: string): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT f.revoked AS revoked, f.successor_enc AS successor_enc, f.grace_until AS grace_until
       FROM mcp_oauth_refresh_family f
       JOIN mcp_oauth_refresh_access a ON a.family_id = f.family_id
       WHERE f.family_id = ? AND a.access_hash = ?`,
    )
      .bind(familyId, accessHash)
      .first<{ revoked: number; successor_enc: string | null; grace_until: number | null }>();
    if (!row) return false;
    if (typeof row.successor_enc === 'string' && row.successor_enc && typeof row.grace_until === 'number' && row.grace_until <= Date.now()) {
      await env.DB.prepare(
        `UPDATE mcp_oauth_refresh_family SET successor_enc = NULL
         WHERE family_id = ? AND successor_enc IS NOT NULL AND grace_until IS NOT NULL AND grace_until <= ?`,
      )
        .bind(familyId, Date.now())
        .run();
    }
    return row.revoked === 0;
  } catch (err) {
    console.error('[mcp-oauth] family access check failed:', dbErrorMessage(err));
    return false;
  }
}

export async function createRefreshFamily(
  env: Env,
  input: {
    accountId: string;
    userId: string;
    clientId: string;
    clientName: string | null;
    grantedScope: string;
    accessToken: string;
  },
): Promise<{ refreshToken: string; familyId: string } | null> {
  if (!env.DB) return null;
  const refreshToken = mintRefreshToken();
  const familyId = randomId('fam', 12);
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO mcp_oauth_refresh_family (
         family_id, account_id, user_id, client_id, client_name, granted_scope, current_refresh_hash, revoked, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
      .bind(
        familyId,
        input.accountId,
        input.userId,
        input.clientId,
        input.clientName,
        input.grantedScope,
        await sha256Hex(refreshToken),
        now,
      )
      .run();
    await env.DB.prepare(`INSERT INTO mcp_oauth_refresh_access (access_hash, family_id, issued_at) VALUES (?, ?, ?)`)
      .bind(await sha256Hex(input.accessToken), familyId, now)
      .run();
  } catch (err) {
    if (missingTable(err)) return null;
    throw err;
  }
  return { refreshToken, familyId };
}

/** MCP_OAUTH_SECRET only. AUTH_WEBHOOK_SECRET and BOT_TOKEN are not accepted here. */
function signingSecret(env: Env): string | null {
  const secret = (env.MCP_OAUTH_SECRET || '').trim();
  return secret || null;
}

async function successorKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('mcp-refresh-successor'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function sealSuccessor(secret: string, successor: Successor): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await successorKey(secret),
      new TextEncoder().encode(JSON.stringify(successor)),
    ),
  );
  return `v1:${b64url(iv)}:${b64url(cipher)}`;
}

async function openSuccessor(secret: string, stored: string | null): Promise<Successor | null> {
  if (!stored) return null;
  const [version, ivPart, cipherPart] = stored.split(':');
  if (version !== 'v1' || !ivPart || !cipherPart) return null;
  const iv = fromB64url(ivPart);
  const cipher = fromB64url(cipherPart);
  if (!iv || !cipher) return null;
  let plain: string;
  try {
    const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await successorKey(secret), cipher);
    plain = new TextDecoder().decode(decoded);
  } catch {
    return null;
  }
  if (!plain) return null;
  let value: unknown;
  try {
    value = JSON.parse(plain);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (
    typeof value.accessToken !== 'string' ||
    typeof value.refreshToken !== 'string' ||
    typeof value.scope !== 'string'
  ) {
    return null;
  }
  return { accessToken: value.accessToken, refreshToken: value.refreshToken, scope: value.scope };
}

function inGrace(family: FamilyRow, refreshHash: string, now: number): boolean {
  return family.retiredRefreshHash === refreshHash && family.graceUntil !== null && family.graceUntil > now && !family.revoked;
}

async function replaySuccessor(
  env: Env,
  family: FamilyRow,
  secret: string,
  store: RefreshAccessStore,
  plan: string,
): Promise<RefreshGrantResult> {
  const successor = await openSuccessor(secret, family.successorEnc);
  if (!successor) return { kind: 'unavailable' };
  await env.DB!.prepare(
    `INSERT OR IGNORE INTO mcp_oauth_refresh_access (access_hash, family_id, issued_at) VALUES (?, ?, ?)`,
  )
    .bind(await sha256Hex(successor.accessToken), family.familyId, Date.now())
    .run();
  await store.put({
    accessToken: successor.accessToken,
    accountId: family.accountId,
    userId: family.userId,
    plan,
    scope: successor.scope,
    clientId: family.clientId,
    clientName: family.clientName,
    familyId: family.familyId,
    expiresIn: REFRESH_ACCESS_TTL_SECONDS,
  });
  return {
    kind: 'issued',
    accessToken: successor.accessToken,
    refreshToken: successor.refreshToken,
    scope: successor.scope,
    expiresIn: REFRESH_ACCESS_TTL_SECONDS,
  };
}

export async function rotateRefreshGrant(
  env: Env,
  input: { refreshToken: string; clientId: string; requestedScope: string | null },
  store: RefreshAccessStore,
): Promise<RefreshGrantResult> {
  if (!input.refreshToken.startsWith(REFRESH_PREFIX)) return { kind: 'invalid_grant' };
  if (!env.DB) return { kind: 'unavailable' };
  const secret = signingSecret(env);
  if (!secret) return { kind: 'unavailable' };
  const refreshHash = await sha256Hex(input.refreshToken);
  let family: FamilyRow | null;
  try {
    family = await findFamily(env, refreshHash);
  } catch (err) {
    if (missingTable(err)) return { kind: 'unavailable' };
    throw err;
  }
  if (!family) return { kind: 'invalid_grant' };
  if (family.revoked) {
    await deleteAccessTokens(env, family, store);
    return { kind: 'invalid_grant' };
  }
  if (family.clientId !== input.clientId) return { kind: 'invalid_grant' };

  const now = Date.now();
  if (familyIsIdle(family, now)) {
    await revokeRefreshFamily(env, family.familyId, store);
    return { kind: 'invalid_grant' };
  }
  if (inGrace(family, refreshHash, now)) {
    const entitlement = await readEntitlement(env, family);
    if (entitlement.kind === 'unavailable') return { kind: 'unavailable' };
    if (entitlement.kind === 'revoked') {
      await revokeRefreshFamily(env, family.familyId, store);
      return { kind: 'invalid_grant' };
    }
    return replaySuccessor(env, family, secret, store, entitlement.plan);
  }
  if (family.currentRefreshHash !== refreshHash) {
    await revokeRefreshFamily(env, family.familyId, store);
    return { kind: 'invalid_grant' };
  }

  const entitlement = await readEntitlement(env, family);
  if (entitlement.kind === 'unavailable') return { kind: 'unavailable' };
  if (entitlement.kind === 'revoked') {
    await revokeRefreshFamily(env, family.familyId, store);
    return { kind: 'invalid_grant' };
  }
  const scope = scopeAfterRefresh(family.grantedScope, input.requestedScope, entitlement.allowed);
  if (!scope) return { kind: 'invalid_scope' };

  const refreshToken = mintRefreshToken();
  const accessToken = `mcp_${randomId('tok', 20)}`;
  const successor: Successor = { accessToken, refreshToken, scope };
  const successorEnc = await sealSuccessor(secret, successor);
  const newHash = await sha256Hex(refreshToken);
  const accessHash = await sha256Hex(accessToken);
  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE mcp_oauth_refresh_family
       SET current_refresh_hash = ?, retired_refresh_hash = ?, grace_until = ?, successor_enc = ?, updated_at = ?
       WHERE family_id = ? AND current_refresh_hash = ? AND revoked = 0`,
    ).bind(newHash, refreshHash, now + REUSE_GRACE_MS, successorEnc, now, family.familyId, refreshHash),
    env.DB.prepare(
      `INSERT OR IGNORE INTO mcp_oauth_refresh_access (access_hash, family_id, issued_at)
       SELECT ?, ?, ? WHERE EXISTS (
         SELECT 1 FROM mcp_oauth_refresh_family WHERE family_id = ? AND current_refresh_hash = ? AND revoked = 0
       )`,
    ).bind(accessHash, family.familyId, now, family.familyId, newHash),
    env.DB.prepare(
      `INSERT OR IGNORE INTO mcp_oauth_refresh_retired (refresh_hash, family_id, retired_at)
       SELECT ?, ?, ? WHERE EXISTS (
         SELECT 1 FROM mcp_oauth_refresh_family WHERE family_id = ? AND current_refresh_hash = ? AND revoked = 0
       )`,
    ).bind(refreshHash, family.familyId, now, family.familyId, newHash),
  ]);
  if (Number(updated?.meta?.changes ?? 0) !== 1) {
    const again = await findFamily(env, refreshHash);
    if (again && again.clientId === input.clientId && inGrace(again, refreshHash, Date.now())) {
      return replaySuccessor(env, again, secret, store, entitlement.plan);
    }
    if (again && !again.revoked && again.currentRefreshHash !== refreshHash) {
      await revokeRefreshFamily(env, again.familyId, store);
    }
    return { kind: 'invalid_grant' };
  }
  await store.put({
    accessToken,
    accountId: family.accountId,
    userId: family.userId,
    plan: entitlement.plan,
    scope,
    clientId: family.clientId,
    clientName: family.clientName,
    familyId: family.familyId,
    expiresIn: REFRESH_ACCESS_TTL_SECONDS,
  });
  return { kind: 'issued', accessToken, refreshToken, scope, expiresIn: REFRESH_ACCESS_TTL_SECONDS };
}

/**
 * Daily sweep. Idle families (no rotation for 90 days) are revoked so a dormant
 * grant cannot refresh forever. Retired hashes of a live family stay, so pruning
 * cannot hide reuse of an old refresh token. Expired access rows and grace ciphertext go.
 */
export async function pruneMcpOAuthRefreshRows(
  env: Env,
  now = Date.now(),
): Promise<{ access: number; retired: number; successors: number; families: number }> {
  const empty = { access: 0, retired: 0, successors: 0, families: 0 };
  if (!env.DB) return empty;
  try {
    const idleCutoff = now - REFRESH_TTL_SECONDS * 1000;
    const idle = await env.DB.prepare(
      `SELECT family_id, account_id FROM mcp_oauth_refresh_family WHERE revoked = 0 AND updated_at < ?`,
    )
      .bind(idleCutoff)
      .all<{ family_id: string; account_id: string }>();
    let families = 0;
    for (const row of idle.results ?? []) {
      if (typeof row.family_id !== 'string' || typeof row.account_id !== 'string') continue;
      await env.DB.prepare(
        `UPDATE mcp_oauth_refresh_family
         SET revoked = 1, successor_enc = NULL, retired_refresh_hash = NULL, grace_until = NULL, updated_at = ?
         WHERE family_id = ? AND revoked = 0`,
      )
        .bind(now, row.family_id)
        .run();
      await env.DB.prepare(`DELETE FROM mcp_oauth_refresh_access WHERE family_id = ?`).bind(row.family_id).run();
      await env.DB.prepare(`DELETE FROM mcp_oauth_refresh_retired WHERE family_id = ?`).bind(row.family_id).run();
      const connectionKey = `mcp_oauth_connection:${await sha256Hex(row.account_id)}:${row.family_id}`;
      await env.LUMINARA_KV?.delete(connectionKey);
      families += 1;
    }
    const access = await env.DB.prepare(`DELETE FROM mcp_oauth_refresh_access WHERE issued_at < ?`)
      .bind(now - REFRESH_ACCESS_TTL_SECONDS * 1000)
      .run();
    const retired = await env.DB.prepare(
      `DELETE FROM mcp_oauth_refresh_retired
       WHERE family_id IN (SELECT family_id FROM mcp_oauth_refresh_family WHERE revoked = 1)`,
    ).run();
    const successors = await env.DB.prepare(
      `UPDATE mcp_oauth_refresh_family SET successor_enc = NULL
       WHERE successor_enc IS NOT NULL AND grace_until IS NOT NULL AND grace_until <= ?`,
    )
      .bind(now)
      .run();
    return {
      access: Number(access.meta?.changes ?? 0),
      retired: Number(retired.meta?.changes ?? 0),
      successors: Number(successors.meta?.changes ?? 0),
      families,
    };
  } catch (err) {
    if (missingTable(err)) return empty;
    throw err;
  }
}
