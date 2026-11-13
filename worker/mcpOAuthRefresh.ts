/**
 * OAuth 2.1 refresh-token rotation for MCP public clients.
 * The family record is the commit: one KV put moves the current hash and
 * retires the one that was used. A retired hash revokes the whole family.
 * KV has no compare-and-swap. A nonce claim plus a confirming read keeps a
 * single writer; a stale replica can still let two proceed, and the loser
 * drops its token.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { sha256Hex } from './workerUtils';
import { randomId } from '../services/projects/projectUtils';
import { getActiveSubscription } from './quotaMiddleware';
import { planCapsFor } from './telegramBot';
import { isErasedSubject } from './accountMirror';
import { isSessionRevokedUser } from './opaqueSession';

export const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;
export type OAuthGrantType = (typeof SUPPORTED_GRANT_TYPES)[number];

/** Outlives the 30-day access token so a client can refresh after that token expires. */
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 90;

const FAMILY_PREFIX = 'mcp_oauth_refresh_family:';
const LOOKUP_PREFIX = 'mcp_oauth_refresh:';
const CLAIM_PREFIX = 'mcp_oauth_refresh_claim:';
const REFRESH_PREFIX = 'mcr_';
/** KV refuses a cacheTtl under 30 seconds. */
const KV_READ_TTL_SECONDS = 30;
/** A claim older than this is a crashed writer. A live writer still holds it. */
const CLAIM_HOLD_MS = 30_000;

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
  }): Promise<void>;
  deleteHash(accountId: string, accessHash: string): Promise<void>;
};

type RefreshFamily = {
  familyId: string;
  accountId: string;
  userId: string;
  clientId: string;
  clientName: string | null;
  grantedScope: string;
  generation: number;
  writerNonce: string;
  currentRefreshHash: string;
  usedRefreshHashes: string[];
  accessTokenHashes: string[];
  revoked: boolean;
};

export type RefreshGrantResult =
  | { kind: 'issued'; accessToken: string; refreshToken: string; scope: string }
  | { kind: 'invalid_grant' }
  | { kind: 'invalid_scope' }
  | { kind: 'unavailable' };

type Presented =
  | { kind: 'rotate'; family: RefreshFamily }
  | { kind: 'reuse'; family: RefreshFamily }
  | { kind: 'invalid_grant' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Omitted grant_types register both. An unknown type or a list without authorization_code is refused. */
export function parseRegisteredGrantTypes(raw: unknown): OAuthGrantType[] | null {
  if (raw === undefined) return [...SUPPORTED_GRANT_TYPES];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isGrantType(item)) return null;
    seen.add(item);
  }
  if (!seen.has('authorization_code')) return null;
  return SUPPORTED_GRANT_TYPES.filter((grant) => seen.has(grant));
}

function isGrantType(value: unknown): value is OAuthGrantType {
  return SUPPORTED_GRANT_TYPES.some((grant) => grant === value);
}

/** Records written before refresh tokens shipped omit the field and receive both grants. */
export function grantsFromStoredClient(raw: unknown): OAuthGrantType[] {
  if (raw === undefined) return [...SUPPORTED_GRANT_TYPES];
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

function parseFamily(raw: string | null): RefreshFamily | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const clientName = value.clientName;
  if (
    typeof value.familyId !== 'string' ||
    typeof value.accountId !== 'string' ||
    typeof value.userId !== 'string' ||
    typeof value.clientId !== 'string' ||
    (clientName !== null && typeof clientName !== 'string') ||
    typeof value.grantedScope !== 'string' ||
    typeof value.generation !== 'number' ||
    !Number.isFinite(value.generation) ||
    typeof value.writerNonce !== 'string' ||
    typeof value.currentRefreshHash !== 'string' ||
    !isStringList(value.usedRefreshHashes) ||
    !isStringList(value.accessTokenHashes) ||
    typeof value.revoked !== 'boolean'
  ) {
    return null;
  }
  return {
    familyId: value.familyId,
    accountId: value.accountId,
    userId: value.userId,
    clientId: value.clientId,
    clientName,
    grantedScope: value.grantedScope,
    generation: value.generation,
    writerNonce: value.writerNonce,
    currentRefreshHash: value.currentRefreshHash,
    usedRefreshHashes: value.usedRefreshHashes,
    accessTokenHashes: value.accessTokenHashes,
    revoked: value.revoked,
  };
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

function decidePresented(family: RefreshFamily, refreshHash: string): Presented {
  if (family.revoked) return { kind: 'invalid_grant' };
  if (refreshHash === family.currentRefreshHash) return { kind: 'rotate', family };
  if (family.usedRefreshHashes.includes(refreshHash)) return { kind: 'reuse', family };
  return { kind: 'invalid_grant' };
}

function mintRefreshToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `${REFRESH_PREFIX}${hex}`;
}

async function readFamily(env: Env, familyId: string): Promise<RefreshFamily | null> {
  const raw = (await env.LUMINARA_KV?.get(`${FAMILY_PREFIX}${familyId}`, { cacheTtl: KV_READ_TTL_SECONDS })) ?? null;
  return parseFamily(raw);
}

async function writeFamily(env: Env, family: RefreshFamily): Promise<void> {
  await env.LUMINARA_KV?.put(`${FAMILY_PREFIX}${family.familyId}`, JSON.stringify(family), {
    expirationTtl: REFRESH_TTL_SECONDS,
  });
}

async function readLookup(env: Env, refreshHash: string): Promise<string | null> {
  const familyId = await env.LUMINARA_KV?.get(`${LOOKUP_PREFIX}${refreshHash}`, { cacheTtl: KV_READ_TTL_SECONDS });
  return familyId || null;
}

async function writeLookup(env: Env, refreshHash: string, familyId: string): Promise<void> {
  await env.LUMINARA_KV?.put(`${LOOKUP_PREFIX}${refreshHash}`, familyId, { expirationTtl: REFRESH_TTL_SECONDS });
}

async function deleteLookup(env: Env, refreshHash: string): Promise<void> {
  await env.LUMINARA_KV?.delete(`${LOOKUP_PREFIX}${refreshHash}`);
}

type Entitlement =
  | { kind: 'active'; plan: string; allowed: ReadonlySet<string> }
  | { kind: 'revoked' }
  | { kind: 'unavailable' };

async function readEntitlement(env: Env, family: RefreshFamily): Promise<Entitlement> {
  try {
    if (await isSessionRevokedUser(env, family.userId)) return { kind: 'revoked' };
    if (env.DB && (await isErasedSubject(env.DB, family.accountId, family.userId))) return { kind: 'revoked' };
  } catch (err) {
    console.error('[mcp-oauth] entitlement check failed:', err instanceof Error ? err.message : err);
    return { kind: 'unavailable' };
  }
  const user: HostedIdentity = {
    id: family.userId,
    source: family.userId.startsWith('fb:') ? 'firebase' : 'telegram',
    accountId: family.accountId,
  };
  const sub = await getActiveSubscription(env, user);
  const plan = sub?.plan || 'free';
  const caps = planCapsFor(plan);
  if (!caps.mcpAccess) return { kind: 'revoked' };
  const allowed = new Set<string>();
  allowed.add('mcp:free');
  if (caps.apiAccess) allowed.add('mcp:research');
  return { kind: 'active', plan, allowed };
}

async function deleteChildren(env: Env, family: RefreshFamily, store: RefreshAccessStore): Promise<void> {
  for (const hash of family.accessTokenHashes) {
    await store.deleteHash(family.accountId, hash);
  }
  const refreshHashes = [family.currentRefreshHash, ...family.usedRefreshHashes];
  for (const hash of refreshHashes) {
    await deleteLookup(env, hash);
    await env.LUMINARA_KV?.delete(`${CLAIM_PREFIX}${hash}`);
  }
}

/** Marks the family revoked, then deletes its access tokens and refresh lookups. Idempotent. */
export async function revokeRefreshFamily(
  env: Env,
  familyId: string,
  store: RefreshAccessStore,
  boundAccountId?: string,
): Promise<boolean> {
  const family = await readFamily(env, familyId);
  if (!family) return false;
  if (boundAccountId && family.accountId !== boundAccountId) return false;
  if (!family.revoked) {
    await writeFamily(env, { ...family, revoked: true, writerNonce: randomId('wrt', 8) });
  }
  await deleteChildren(env, family, store);
  return true;
}

export async function revokeRefreshByToken(env: Env, token: string, store: RefreshAccessStore): Promise<boolean> {
  if (!token.startsWith(REFRESH_PREFIX) || !env.LUMINARA_KV) return false;
  const familyId = await readLookup(env, await sha256Hex(token));
  if (!familyId) return false;
  return revokeRefreshFamily(env, familyId, store);
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
  if (!env.LUMINARA_KV) return null;
  const refreshToken = mintRefreshToken();
  const family: RefreshFamily = {
    familyId: randomId('fam', 12),
    accountId: input.accountId,
    userId: input.userId,
    clientId: input.clientId,
    clientName: input.clientName,
    grantedScope: input.grantedScope,
    generation: 1,
    writerNonce: randomId('wrt', 8),
    currentRefreshHash: await sha256Hex(refreshToken),
    usedRefreshHashes: [],
    accessTokenHashes: [await sha256Hex(input.accessToken)],
    revoked: false,
  };
  await writeFamily(env, family);
  await writeLookup(env, family.currentRefreshHash, family.familyId);
  return { refreshToken, familyId: family.familyId };
}

type Claim = 'owner' | 'busy';

async function claimCurrent(env: Env, refreshHash: string): Promise<Claim> {
  const key = `${CLAIM_PREFIX}${refreshHash}`;
  const prior = await env.LUMINARA_KV?.get(key, { cacheTtl: KV_READ_TTL_SECONDS });
  if (prior) {
    const stamped = Number(prior.slice(prior.lastIndexOf(':') + 1));
    if (Number.isFinite(stamped) && Date.now() - stamped < CLAIM_HOLD_MS) return 'busy';
  }
  const nonce = `${randomId('clm', 8)}:${Date.now()}`;
  await env.LUMINARA_KV?.put(key, nonce, { expirationTtl: REFRESH_TTL_SECONDS });
  const seen = await env.LUMINARA_KV?.get(key, { cacheTtl: KV_READ_TTL_SECONDS });
  return seen === nonce ? 'owner' : 'busy';
}

export async function rotateRefreshGrant(
  env: Env,
  input: { refreshToken: string; clientId: string; requestedScope: string | null },
  store: RefreshAccessStore,
): Promise<RefreshGrantResult> {
  if (!env.LUMINARA_KV || !input.refreshToken.startsWith(REFRESH_PREFIX)) return { kind: 'invalid_grant' };
  const refreshHash = await sha256Hex(input.refreshToken);
  const familyId = await readLookup(env, refreshHash);
  if (!familyId) return { kind: 'invalid_grant' };
  const family = await readFamily(env, familyId);
  if (!family) return { kind: 'invalid_grant' };

  const presented = decidePresented(family, refreshHash);
  if (presented.kind === 'invalid_grant') {
    if (family.revoked) await deleteChildren(env, family, store);
    return { kind: 'invalid_grant' };
  }
  if (presented.kind === 'reuse') {
    await revokeRefreshFamily(env, family.familyId, store);
    return { kind: 'invalid_grant' };
  }
  if (presented.family.clientId !== input.clientId) return { kind: 'invalid_grant' };

  const entitlement = await readEntitlement(env, presented.family);
  if (entitlement.kind === 'unavailable') return { kind: 'unavailable' };
  if (entitlement.kind === 'revoked') {
    await revokeRefreshFamily(env, presented.family.familyId, store);
    return { kind: 'invalid_grant' };
  }
  const scope = scopeAfterRefresh(presented.family.grantedScope, input.requestedScope, entitlement.allowed);
  if (!scope) return { kind: 'invalid_scope' };

  const claim = await claimCurrent(env, refreshHash);
  if (claim === 'busy') return { kind: 'invalid_grant' };
  const fresh = await readFamily(env, familyId);
  if (!fresh || decidePresented(fresh, refreshHash).kind !== 'rotate') return { kind: 'invalid_grant' };

  const refreshToken = mintRefreshToken();
  const accessToken = `mcp_${randomId('tok', 20)}`;
  const writerNonce = randomId('wrt', 8);
  const next: RefreshFamily = {
    ...fresh,
    generation: fresh.generation + 1,
    writerNonce,
    currentRefreshHash: await sha256Hex(refreshToken),
    usedRefreshHashes: [...fresh.usedRefreshHashes, refreshHash],
    accessTokenHashes: [...fresh.accessTokenHashes, await sha256Hex(accessToken)],
  };
  await writeFamily(env, next);
  await writeLookup(env, next.currentRefreshHash, next.familyId);
  const confirmed = await readFamily(env, familyId);
  if (!confirmed || confirmed.writerNonce !== writerNonce) {
    if (!confirmed || confirmed.currentRefreshHash !== next.currentRefreshHash) {
      await deleteLookup(env, next.currentRefreshHash);
    }
    return { kind: 'invalid_grant' };
  }
  await store.put({
    accessToken,
    accountId: fresh.accountId,
    userId: fresh.userId,
    plan: entitlement.plan,
    scope,
    clientId: fresh.clientId,
    clientName: fresh.clientName,
    familyId: fresh.familyId,
  });
  return { kind: 'issued', accessToken, refreshToken, scope };
}
