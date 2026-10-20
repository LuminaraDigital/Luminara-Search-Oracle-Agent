/**
 * One Instant Audit spends one free check.
 * The client mints a run, then hosted provider calls that carry it are not metered again
 * until the call cap or the 10 minute TTL. A run with no measured result refunds that check.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, identify, json } from './workerUtils';
import { checkHostedQuota, refundMeteredQuota, type QuotaStatus } from './quotaMiddleware';
import { safePublicHostname } from './security';

export const AUDIT_RUN_TTL_SEC = 10 * 60;
export const AUDIT_RUN_CALL_CAP = 30;
export const AUDIT_RUN_TOKEN_HEADER = 'x-audit-run';
export const AUDIT_RUN_DOMAIN_HEADER = 'x-audit-domain';

const KEY_PREFIX = 'audit-run:';

interface AuditRunRecord {
  userId: string;
  domain: string;
  left: number;
  exp: number;
  meterKey?: string;
  limit: number;
  sawSuccess: boolean;
  refunded: boolean;
}

export type AuditRunClaim =
  | { kind: 'meter' }
  | { kind: 'covered'; token: string; domain: string }
  | { kind: 'reject'; error: string };

export function auditHostname(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withScheme).hostname.toLowerCase().replace(/\.$/, '');
    return safePublicHostname(host) ? host : '';
  } catch {
    return '';
  }
}

/** Absolute `url` on a scrape/search body. Empty when the body has no URL. */
export function requestTargetHost(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const url = (body as { url?: unknown }).url;
  return typeof url === 'string' ? auditHostname(url) : '';
}

function recordKey(token: string): string {
  return `${KEY_PREFIX}${token}`;
}

async function readRun(env: Env, token: string): Promise<AuditRunRecord | null> {
  if (!env.LUMINARA_KV || !token) return null;
  const raw = await env.LUMINARA_KV.get(recordKey(token));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuditRunRecord;
    if (!parsed || typeof parsed.userId !== 'string' || typeof parsed.domain !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeRun(env: Env, token: string, record: AuditRunRecord): Promise<void> {
  const ttl = Math.max(60, Math.ceil((record.exp - Date.now()) / 1000));
  await env.LUMINARA_KV!.put(recordKey(token), JSON.stringify(record), { expirationTtl: ttl });
}

export async function mintAuditRun(
  env: Env,
  user: HostedIdentity,
  domainInput: string,
): Promise<Response> {
  const domain = auditHostname(domainInput);
  if (!domain) {
    return json({ ok: false, error: 'A public site is required.', code: 'BAD_REQUEST' }, 400);
  }
  if (!env.LUMINARA_KV) {
    return json({ ok: false, error: 'Audit runs are unavailable.', code: 'AUDIT_RUN_UNAVAILABLE' }, 503);
  }
  const quota = await checkHostedQuota(env, user);
  if (!quota.ok) {
    return json(
      {
        ok: false,
        error: quota.error,
        code: 'PAYWALL_EXCEEDED',
        limit: quota.limit,
        used: quota.used,
        remaining: quota.remaining,
      },
      402,
    );
  }
  const token = crypto.randomUUID();
  const record: AuditRunRecord = {
    userId: billingId(user),
    domain,
    left: AUDIT_RUN_CALL_CAP,
    exp: Date.now() + AUDIT_RUN_TTL_SEC * 1000,
    meterKey: quota.meterKey,
    limit: quota.limit,
    sawSuccess: false,
    refunded: false,
  };
  await writeRun(env, token, record);
  return json({ ok: true, token, domain, calls: AUDIT_RUN_CALL_CAP, ttlSec: AUDIT_RUN_TTL_SEC });
}

export async function refundAuditRun(env: Env, user: HostedIdentity, token: string): Promise<Response> {
  const record = await readRun(env, token);
  if (!record || record.exp <= Date.now()) {
    return json({ ok: false, error: 'This audit run expired.', code: 'AUDIT_RUN_REJECTED' }, 401);
  }
  if (record.userId !== billingId(user)) {
    return json({ ok: false, error: 'This audit run belongs to another account.', code: 'AUDIT_RUN_REJECTED' }, 401);
  }
  if (record.refunded || record.sawSuccess || !record.meterKey) {
    return json({ ok: true, refunded: false });
  }
  const status: QuotaStatus = {
    ok: true,
    limit: record.limit,
    used: 0,
    remaining: 0,
    resetSec: 0,
    isUnlimited: false,
    meterKey: record.meterKey,
  };
  const released = await refundMeteredQuota(env, status);
  record.refunded = released.refunded;
  await writeRun(env, token, record);
  return json({ ok: true, refunded: released.refunded });
}

/**
 * A missing token meters normally (chat and other tools).
 * A bad token is rejected. A run that is over its call cap meters that call normally.
 * shortcut: the cap decrement is get-then-put, so two calls at once can both pass.
 */
export async function takeAuditRunCall(env: Env, user: HostedIdentity, request: Request): Promise<AuditRunClaim> {
  const token = request.headers.get(AUDIT_RUN_TOKEN_HEADER)?.trim() || '';
  if (!token) return { kind: 'meter' };
  const domain = auditHostname(request.headers.get(AUDIT_RUN_DOMAIN_HEADER) || '');
  const record = await readRun(env, token);
  if (!record || record.exp <= Date.now()) {
    return { kind: 'reject', error: 'This audit run expired.' };
  }
  if (record.userId !== billingId(user)) {
    return { kind: 'reject', error: 'This audit run belongs to another account.' };
  }
  if (!domain || domain !== record.domain) {
    return { kind: 'reject', error: 'This audit run is for a different site.' };
  }
  if (record.left <= 0) return { kind: 'meter' };
  record.left -= 1;
  await writeRun(env, token, record);
  return { kind: 'covered', token, domain };
}

export async function noteAuditRunSuccess(env: Env, token: string): Promise<void> {
  const record = await readRun(env, token);
  if (!record || record.sawSuccess) return;
  record.sawSuccess = true;
  await writeRun(env, token, record);
}

export async function handleAuditScoutRun(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  const who = await identify(request, env);
  if (who.error || !who.user) return json({ ok: false, error: who.error || 'Sign in required.', code: 'AUTH_REQUIRED' }, 401);
  let body: { domain?: unknown; token?: unknown; refund?: unknown };
  try {
    body = (await request.json()) as { domain?: unknown; token?: unknown; refund?: unknown };
  } catch {
    return json({ ok: false, error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400);
  }
  if (body.refund === true) {
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) return json({ ok: false, error: 'token required', code: 'BAD_REQUEST' }, 400);
    return refundAuditRun(env, who.user, token);
  }
  const domain = typeof body.domain === 'string' ? body.domain : '';
  return mintAuditRun(env, who.user, domain);
}
