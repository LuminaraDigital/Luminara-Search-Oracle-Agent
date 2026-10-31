/**
 * Document ids and field maps for the phase 2/3 mirror.
 * Collections follow ADR 0001: `users/{userId}`, `audits/{docId}`.
 * Audit entry ids are unique per account, so the doc id is `{accountId.length}.{accountId}.{entryId}`.
 * `email_unsub_token` is never copied.
 */
import { readAuditRun } from './auditRunEntry';
import type { D1Database } from '@cloudflare/workers-types';
import type { StoredAuditEntry } from './auditHistoryRoute';

export const USER_COLLECTION = 'users';
export const AUDIT_COLLECTION = 'audits';
export const PROD_GCP_PROJECT = 'luminara-suite';
export const MIRROR_TIMEOUT_MS = 4_000;
export const AUDIT_HISTORY_CAP = 500;

export type DataPlane = 'd1' | 'dual' | 'firestore';

export type DataPlaneEnv = {
  /** Optional D1 users DB. When unset, profiles fall back to KV `user:{id}`. */
  DB?: D1Database;
  /** `d1` (default) | `dual` | `firestore`. Anything else falls back to `d1`. */
  DATA_PLANE?: string;
  /** GCP project that holds Firestore. Public. Leave unset while the flag is `d1`. */
  GCP_PROJECT_ID?: string;
  /** Workload Identity provider resource name. Not a secret. */
  GCP_WIF_AUDIENCE?: string;
  /** HTTPS issuer for the Worker's OIDC discovery document. Not a secret. */
  GCP_OIDC_ISSUER?: string;
  /** `sub` claim, for example `suite-worker`. Not a user id and not a secret. */
  GCP_OIDC_SUBJECT?: string;
  /** `kid` of the OIDC signing key. Not a secret. */
  GCP_OIDC_KEY_ID?: string;
  /** PKCS#8 PEM of the Worker's OIDC signing key. Wrangler secret. Not a Google service account key. */
  GCP_OIDC_SIGNING_KEY?: string;
  /** Public JWK JSON (no private fields) served at the issuer JWKS URL. */
  GCP_OIDC_PUBLIC_JWK?: string;
  /** suite-worker service account email to impersonate. Not a secret. */
  GCP_IMPERSONATE_SERVICE_ACCOUNT?: string;
};

export type UserLoginRow = {
  id: string;
  account_id: string | null;
  created_at: number;
  last_seen_at: number;
  email: string | null;
  display_name: string | null;
  welcome_sent_at: number | null;
  email_opt_out_at: number | null;
};

export type UserLoginWrite = {
  id: string;
  source: 'telegram' | 'firebase';
  email: string | null;
  displayName: string | null;
  telegramId: string | null;
  firebaseUid: string | null;
  createdAt: number;
  lastSeenAt: number;
  accountId: string;
};

export const USER_LIVE_FIELDS = [
  'id',
  'source',
  'accountId',
  'email',
  'displayName',
  'telegramId',
  'firebaseUid',
  'createdAt',
  'lastSeenAt',
] as const;

const DOC_ID_BAD = /\/|^\.$|^\.\.$|^__.*__$/;

export function userDocId(userId: string): string {
  if (!userId || DOC_ID_BAD.test(userId) || userId.length > 1400) throw new Error('invalid user doc id');
  return userId;
}

/** Entry ids are unique per account. The length prefix keeps the pair unambiguous. */
export function auditDocId(accountId: string, entryId: string): string {
  const id = `${accountId.length.toString(36)}.${accountId}.${entryId}`;
  if (DOC_ID_BAD.test(id) || id.length > 1400) throw new Error('invalid audit doc id');
  return id;
}

export function userWriteFields(row: UserLoginWrite): Record<string, unknown> {
  return {
    id: row.id,
    source: row.source,
    accountId: row.accountId,
    email: row.email,
    displayName: row.displayName,
    telegramId: row.telegramId,
    firebaseUid: row.firebaseUid,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  };
}

export function userExportToFields(row: Record<string, unknown>): Record<string, unknown> | null {
  const id = asString(row.id);
  if (!id || (row.source !== 'telegram' && row.source !== 'firebase')) return null;
  const createdAt = asNumber(row.created_at);
  const lastSeenAt = asNumber(row.last_seen_at);
  if (createdAt === null || lastSeenAt === null) return null;
  return {
    id,
    source: row.source,
    accountId: asString(row.account_id) || id,
    email: asString(row.email),
    displayName: asString(row.display_name),
    telegramId: asString(row.telegram_id),
    firebaseUid: asString(row.firebase_uid),
    createdAt,
    lastSeenAt,
    welcomeSentAt: asNumber(row.welcome_sent_at),
    emailOptOutAt: asNumber(row.email_opt_out_at),
  };
}

export function userDocToLogin(docId: string, fields: Record<string, unknown>): UserLoginRow | null {
  if (fields.source !== 'telegram' && fields.source !== 'firebase') return null;
  const createdAt = asNumber(fields.createdAt);
  const lastSeenAt = asNumber(fields.lastSeenAt);
  if (createdAt === null || lastSeenAt === null) return null;
  return {
    id: asString(fields.id) || docId,
    account_id: asString(fields.accountId),
    created_at: createdAt,
    last_seen_at: lastSeenAt,
    email: asString(fields.email),
    display_name: asString(fields.displayName),
    welcome_sent_at: asNumber(fields.welcomeSentAt),
    email_opt_out_at: asNumber(fields.emailOptOutAt),
  };
}

export function auditFields(accountId: string, entry: StoredAuditEntry, updatedAt: number): Record<string, unknown> {
  return {
    accountId,
    id: entry.id,
    domain: entry.domain,
    measuredAt: entry.measuredAt,
    updatedAt,
    focus: entry.focus,
    healthScore: entry.healthScore,
    citationRatePercent: entry.citationRatePercent,
    schemaGapCount: entry.schemaGapCount,
    topCompetitor: entry.topCompetitor,
    competitorsMentioned: entry.competitorsMentioned,
    title: entry.title,
    summary: entry.summary,
    reportExcerpt: entry.reportExcerpt,
    clientId: entry.clientId,
    tags: entry.tags,
    auditRun: entry.auditRun,
  };
}

export function fieldsToAudit(fields: Record<string, unknown>): StoredAuditEntry | null {
  const id = asString(fields.id);
  const domain = asString(fields.domain);
  const measuredAt = asNumber(fields.measuredAt);
  if (!id || !domain || measuredAt === null) return null;
  return {
    id,
    domain,
    focus: asString(fields.focus) ?? '',
    measuredAt,
    healthScore: asNumber(fields.healthScore),
    citationRatePercent: asNumber(fields.citationRatePercent),
    schemaGapCount: asNumber(fields.schemaGapCount),
    topCompetitor: asString(fields.topCompetitor),
    competitorsMentioned: stringList(fields.competitorsMentioned),
    title: asString(fields.title) ?? '',
    summary: asString(fields.summary) ?? '',
    reportExcerpt: asString(fields.reportExcerpt) ?? '',
    clientId: asString(fields.clientId),
    tags: stringList(fields.tags),
    auditRun: readAuditRun(fields.auditRun),
  };
}

export function auditExportToWrite(row: Record<string, unknown>): { id: string; fields: Record<string, unknown> } | null {
  const accountId = asString(row.account_id);
  const entryId = asString(row.id);
  if (!accountId || !entryId || typeof row.entry_json !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.entry_json);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const domain = asString(row.domain);
  const merged: Record<string, unknown> = { ...parsed, id: entryId };
  if (domain) merged.domain = domain;
  const entry = fieldsToAudit(merged);
  const measuredAt = asNumber(row.measured_at);
  if (!entry || measuredAt === null) return null;
  entry.measuredAt = measuredAt;
  let docId: string;
  try {
    docId = auditDocId(accountId, entry.id);
  } catch {
    return null;
  }
  return { id: docId, fields: auditFields(accountId, entry, asNumber(row.updated_at) ?? measuredAt) };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
