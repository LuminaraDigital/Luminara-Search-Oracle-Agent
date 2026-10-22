/**
 * Signed Audit Receipts. The Worker hashes the submitted audit fields and
 * signs that payload with RECEIPT_SIGNING_KEY. Raw crawl text is not stored.
 * The signature says the account holder submitted these hashes. It is not a
 * Luminara-run audit. No chain call.
 */
import type { Env } from './env';
import { checkSignedAuditReceipt, readSignedAuditReceiptPayload } from '../services/auditReceipt/check';
import {
  assembleAuditReceiptContent,
  AUDIT_RECEIPT_ISSUER,
  AUDIT_RECEIPT_KIND,
  AUDIT_RECEIPT_SIGNING_PREFIX,
  DEFAULT_AUDIT_RECEIPT_DAILY_QUOTA,
  DEFAULT_AUDIT_RECEIPT_DOMAIN_FRESH_DAYS,
  type AuditReceiptModel,
  type SignedAuditReceiptPayload,
} from '../services/auditReceipt/payload';
import { own } from '../services/own';
import { parsePromptList } from '../services/promptList';
import { canonicalJson } from '../services/trust/receiptCrypto';
import { entitlementsFor } from '../services/plans/planEntitlements';
import { currentReceiptKid, receiptPublicKeySet, signReceiptPayload, ReceiptSigningUnavailable } from './receiptSigning';
import { identify, billingId, json } from './workerUtils';
import { getActiveSubscription } from './quotaMiddleware';
import { isDomainVerifyEnabled } from './domainVerification';
import { MAX_BODY_BYTES, readBody, safePublicHostname } from './security';
import type { HostedIdentity } from './userTypes';

const ID_RE = /^sar_[a-f0-9]{32}$/;
const OBSERVED_MIN = Date.UTC(2020, 0, 1);
const OBSERVED_SKEW_MS = 5 * 60 * 1000;

type ReceiptRow = {
  id: string;
  account_id: string;
  payload_json: string;
  signature: string;
  kid: string;
  revoked_at: number | null;
  revoked_reason: string | null;
};


function signingUnavailable(): Response {
  return json(
    { ok: false, error: 'RECEIPT_SIGNING_KEY is not configured. No receipt was signed.', code: 'RECEIPT_SIGNING_UNAVAILABLE' },
    503,
  );
}

function schemaMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no such table: signed_audit_receipts/i.test(msg) || /no such column: revoked_(at|reason)/i.test(msg);
}

function tableMissing(): Response {
  return json({ ok: false, error: 'Signed Audit Receipts need migrations 0034 and 0035.', code: 'AUDIT_RECEIPT_TABLE_MISSING' }, 503);
}

function receiptsWritable(env: Env): Response | null {
  if (String(env.AUDIT_RECEIPTS_ENABLED || '') === 'true') return null;
  return json({ ok: false, error: 'Signed Audit Receipt minting is off.', code: 'AUDIT_RECEIPTS_DISABLED' }, 403);
}

function accountHmacKey(env: Env): string | null {
  const key = String(env.AUDIT_RECEIPT_ACCOUNT_HMAC_KEY || '').trim();
  return key ? key : null;
}

function hmacUnavailable(): Response {
  return json(
    { ok: false, error: 'AUDIT_RECEIPT_ACCOUNT_HMAC_KEY is not configured. No receipt was signed.', code: 'AUDIT_RECEIPT_HMAC_UNAVAILABLE' },
    503,
  );
}

function optionalString(value: unknown, label: string, max: number): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${label} must be a string or null.` };
  if (value.length > max) return { ok: false, error: `${label} is too long.` };
  return { ok: true, value };
}

function parseModels(value: unknown): { ok: true; value: AuditReceiptModel[] | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: null };
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) return { ok: false, error: 'models must be 1 to 8 { engine, modelId } objects, or null.' };
  const models: AuditReceiptModel[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: 'Each model needs engine and modelId.' };
    const engine = own(item, 'engine');
    const modelId = own(item, 'modelId');
    if (typeof engine !== 'string' || typeof modelId !== 'string') return { ok: false, error: 'Each model needs engine and modelId strings.' };
    const engineText = engine.trim();
    const modelText = modelId.trim();
    if (!engineText || engineText.length > 80 || !modelText || modelText.length > 120) {
      return { ok: false, error: 'engine and modelId must be short non-empty strings.' };
    }
    models.push({ engine: engineText, modelId: modelText });
  }
  return { ok: true, value: models };
}

function parsePrompts(value: unknown): { ok: true; value: string[] | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: null };
  const parsed = parsePromptList(value);
  if (!parsed.ok) return parsed.error === 'prompts must be 1 to 20 strings.'
    ? { ok: false, error: 'prompts must be 1 to 20 strings, or null.' }
    : parsed;
  return { ok: true, value: parsed.prompts };
}

function parseObservedAt(value: unknown, now: number): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'observedAt must be an ISO time or null.' };
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < OBSERVED_MIN || parsed > now + OBSERVED_SKEW_MS) {
    return { ok: false, error: 'observedAt must be an ISO time from 2020 through a few minutes ahead of now.' };
  }
  return { ok: true, value: new Date(parsed).toISOString() };
}

function quotaLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 1000) return n;
  return DEFAULT_AUDIT_RECEIPT_DAILY_QUOTA;
}

/** 00:00 UTC. That is 11:00 in Sydney while AEDT (UTC+11) is in effect. */
function utcDayStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function publicReceipt(row: ReceiptRow) {
  return {
    id: row.id,
    payloadJson: row.payload_json,
    signature: row.signature,
    kid: row.kid,
    verifyPath: `/verify/audit/${row.id}`,
    revokedAt: row.revoked_at == null ? null : new Date(row.revoked_at).toISOString(),
    revokedReason: row.revoked_reason,
    source: 'caller_submitted' as const,
  };
}

async function revokedForPayload(env: Env, payloadJson: string): Promise<{ revokedAt: string | null; revokedReason: string | null }> {
  if (!env.DB) return { revokedAt: null, revokedReason: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return { revokedAt: null, revokedReason: null };
  }
  const payload = readSignedAuditReceiptPayload(parsed);
  if (!payload || !ID_RE.test(payload.id)) return { revokedAt: null, revokedReason: null };
  try {
    const row = await env.DB.prepare(
      `SELECT revoked_at, revoked_reason, payload_json FROM signed_audit_receipts WHERE id = ?`,
    )
      .bind(payload.id)
      .first<{ revoked_at: number | null; revoked_reason: string | null; payload_json: string }>();
    if (!row || row.payload_json !== payloadJson) return { revokedAt: null, revokedReason: null };
    return {
      revokedAt: row.revoked_at == null ? null : new Date(row.revoked_at).toISOString(),
      revokedReason: row.revoked_reason,
    };
  } catch (err) {
    if (schemaMissing(err)) return { revokedAt: null, revokedReason: null };
    throw err;
  }
}

function domainFreshMs(raw: string | undefined): number {
  const n = Number(raw);
  const days = Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_AUDIT_RECEIPT_DOMAIN_FRESH_DAYS;
  return days * 86_400_000;
}

async function domainGate(
  env: Env,
  accountId: string,
  domain: string,
  now: number,
): Promise<'yes' | 'not_verified' | 'stale' | 'verify_off' | 'missing_table'> {
  if (!isDomainVerifyEnabled(env)) return 'verify_off';
  try {
    const row = await env.DB!.prepare(
      `SELECT status, last_checked_at FROM domain_verifications WHERE account_id = ? AND domain = ?`,
    )
      .bind(accountId, domain)
      .first<{ status: string; last_checked_at: string | null }>();
    if (row?.status !== 'verified') return 'not_verified';
    const checked = Date.parse(row.last_checked_at ?? '');
    if (!Number.isFinite(checked) || now - checked > domainFreshMs(env.AUDIT_RECEIPT_DOMAIN_FRESH_DAYS)) return 'stale';
    return 'yes';
  } catch (err) {
    if (/no such table: domain_verifications/i.test(err instanceof Error ? err.message : String(err))) return 'missing_table';
    throw err;
  }
}

export async function handleAuditReceiptRoute(
  request: Request,
  env: Env,
  path: string,
  user: HostedIdentity | null = null,
): Promise<Response | null> {
  if (path === '/audit-receipts/keys') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const set = await receiptPublicKeySet(env);
    return json({ ok: true, issuer: AUDIT_RECEIPT_ISSUER, ...set }, 200, { 'Cache-Control': 'public, max-age=300' });
  }

  if (path === '/audit-receipts/verify') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const read = await readBody(request, MAX_BODY_BYTES);
    if (!read.ok) return json({ ok: false, error: read.error }, read.status);
    const body = read.value;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'JSON object required.' }, 400);
    const payloadJson = own(body, 'payloadJson');
    const signature = own(body, 'signature');
    const kid = own(body, 'kid');
    if (typeof payloadJson !== 'string' || typeof signature !== 'string' || typeof kid !== 'string') {
      return json({ ok: false, error: 'payloadJson, signature, and kid are required.' }, 400);
    }
    const keys = (await receiptPublicKeySet(env)).keys;
    const check = await checkSignedAuditReceipt({ payloadJson, signature, kid, keys });
    const revoked = check.signature === 'valid' ? await revokedForPayload(env, payloadJson) : { revokedAt: null, revokedReason: null };
    return json({ ok: true, ...check, payload: check.payload, ...revoked });
  }

  const revoke = path.match(/^\/audit-receipts\/(sar_[a-f0-9]{32})\/revoke$/);
  if (revoke) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const closed = receiptsWritable(env);
    if (closed) return closed;
    if (!env.DB) return json({ ok: false, error: 'Signed Audit Receipts need D1.', code: 'D1_UNAVAILABLE' }, 503);
    const who = user ? { user, error: undefined } : await identify(request, env);
    if (who.error || !who.user) return json({ ok: false, error: who.error || 'Sign in required.', code: 'AUTH_REQUIRED' }, 401);
    const read = await readBody(request, MAX_BODY_BYTES);
    if (!read.ok) return json({ ok: false, error: read.error }, read.status);
    const reasonRaw = read.value && typeof read.value === 'object' && !Array.isArray(read.value) ? own(read.value, 'reason') : undefined;
    const reason = typeof reasonRaw === 'string' && reasonRaw.trim() ? reasonRaw.trim().slice(0, 200) : 'Revoked by the account holder.';
    try {
      const res = await env.DB.prepare(
        `UPDATE signed_audit_receipts SET revoked_at = ?, revoked_reason = ?
         WHERE id = ? AND account_id = ? AND revoked_at IS NULL`,
      )
        .bind(Date.now(), reason, revoke[1], billingId(who.user))
        .run();
      if (Number(res.meta?.changes ?? 0) !== 1) return json({ ok: false, error: 'Receipt not found.', code: 'NOT_FOUND' }, 404);
      const row = await env.DB.prepare(
        `SELECT id, account_id, payload_json, signature, kid, revoked_at, revoked_reason FROM signed_audit_receipts WHERE id = ?`,
      )
        .bind(revoke[1])
        .first<ReceiptRow>();
      return json({ ok: true, receipt: row ? publicReceipt(row) : { id: revoke[1] } });
    } catch (err) {
      if (schemaMissing(err)) return tableMissing();
      throw err;
    }
  }

  if (path === '/audit-receipts') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const closed = receiptsWritable(env);
    if (closed) return closed;
    if (!env.DB) return json({ ok: false, error: 'Signed Audit Receipts need D1.', code: 'D1_UNAVAILABLE' }, 503);
    const who = user ? { user, error: undefined } : await identify(request, env);
    if (who.error || !who.user) return json({ ok: false, error: who.error || 'Sign in required.', code: 'AUTH_REQUIRED' }, 401);
    const accountId = billingId(who.user);
    const read = await readBody(request, MAX_BODY_BYTES);
    if (!read.ok) return json({ ok: false, error: read.error }, read.status);
    const body = read.value;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'JSON object required.' }, 400);
    const domain = safePublicHostname(typeof own(body, 'domain') === 'string' ? String(own(body, 'domain')) : '');
    if (!domain) return json({ ok: false, error: 'domain must be a public hostname such as acme.com.' }, 400);
    const crawl = optionalString(own(body, 'crawl'), 'crawl', 400_000);
    if (!crawl.ok) return json({ ok: false, error: crawl.error }, 400);
    const prompts = parsePrompts(own(body, 'prompts'));
    if (!prompts.ok) return json({ ok: false, error: prompts.error }, 400);
    const models = parseModels(own(body, 'models'));
    if (!models.ok) return json({ ok: false, error: models.error }, 400);
    const observedAt = parseObservedAt(own(body, 'observedAt'), Date.now());
    if (!observedAt.ok) return json({ ok: false, error: observedAt.error }, 400);
    const engineResponses = own(body, 'engineResponses');
    const engineValue = engineResponses == null ? null : engineResponses;
    if (engineValue !== null) {
      try {
        const encoded = canonicalJson(engineValue);
        if (encoded.length > 400_000) return json({ ok: false, error: 'engineResponses is too long.' }, 400);
      } catch {
        return json({ ok: false, error: 'engineResponses must be JSON that can be hashed. Omit it to record not measured.' }, 400);
      }
    }
    if (crawl.value === null && engineValue === null && prompts.value === null && models.value === null && observedAt.value === null) {
      return json({ ok: false, error: 'Nothing to sign. Send at least one field, or omit a field to record it as not measured.' }, 400);
    }
    const sub = await getActiveSubscription(env, who.user);
    if (entitlementsFor(sub?.plan).scheduledReaudit === 'none') {
      return json({ ok: false, error: 'Signed Audit Receipts need a paid plan.', code: 'PLAN_LIMIT' }, 402);
    }
    const now = Date.now();
    const verified = await domainGate(env, accountId, domain, now);
    if (verified === 'missing_table') {
      return json({ ok: false, error: 'Domain verification table is not migrated (0020).', code: 'DOMAIN_VERIFY_TABLE_MISSING' }, 503);
    }
    if (verified === 'verify_off') {
      return json({ ok: false, error: 'Domain verification is off, so a receipt cannot be signed.', code: 'DOMAIN_VERIFY_DISABLED' }, 403);
    }
    if (verified === 'stale') {
      return json(
        { ok: false, error: 'This domain verification is outside the re-check window. Check the domain again before signing.', code: 'DOMAIN_CHECK_STALE' },
        403,
      );
    }
    if (verified !== 'yes') {
      return json(
        { ok: false, error: 'Verify this domain for the account before signing a receipt for it.', code: 'DOMAIN_NOT_VERIFIED' },
        403,
      );
    }
    const hmacKey = accountHmacKey(env);
    if (!hmacKey) return hmacUnavailable();
    const limit = quotaLimit(env.AUDIT_RECEIPT_DAILY_QUOTA);
    let kid: string | null;
    try {
      kid = await currentReceiptKid(env);
    } catch (err) {
      if (err instanceof ReceiptSigningUnavailable) return signingUnavailable();
      throw err;
    }
    if (!kid) return signingUnavailable();
    const id = `sar_${crypto.randomUUID().replace(/-/g, '')}`;
    const issuedAt = new Date().toISOString();
    const content = await assembleAuditReceiptContent({
      domain,
      issuedAt,
      crawl: crawl.value,
      engineResponses: engineValue,
      prompts: prompts.value,
      models: models.value,
      observedAt: observedAt.value,
      accountId,
      accountHmacKey: hmacKey,
    });
    const payload: SignedAuditReceiptPayload = {
      v: 1,
      kind: AUDIT_RECEIPT_KIND,
      id,
      iss: AUDIT_RECEIPT_ISSUER,
      kid,
      contentSha256: content.contentSha256,
      domain: content.domain,
      issuedAt: content.issuedAt,
      observedAt: content.observedAt,
      hashes: content.hashes,
      models: content.models,
      fieldStatus: content.fieldStatus,
      source: content.source,
      accountHash: content.accountHash,
    };
    const payloadJson = canonicalJson(payload);
    let signature: string;
    let signedKid: string;
    try {
      const signed = await signReceiptPayload(env, payload, AUDIT_RECEIPT_SIGNING_PREFIX);
      signature = signed.signature;
      signedKid = signed.kid;
    } catch (err) {
      if (err instanceof ReceiptSigningUnavailable) return signingUnavailable();
      throw err;
    }
    if (signedKid !== kid) return signingUnavailable();
    if (!readSignedAuditReceiptPayload(JSON.parse(payloadJson))) {
      return json({ ok: false, error: 'The receipt payload could not be read back. Nothing was stored.', code: 'RECEIPT_UNREADABLE' }, 500);
    }
    let inserted = 0;
    try {
      const res = await env.DB.prepare(
        `INSERT INTO signed_audit_receipts (id, account_id, domain, payload_json, signature, kid, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT COUNT(*) FROM signed_audit_receipts WHERE account_id = ? AND created_at >= ?) < ?`,
      )
        .bind(id, accountId, domain, payloadJson, signature, signedKid, now, accountId, utcDayStart(now), limit)
        .run();
      inserted = Number(res.meta?.changes ?? 0);
    } catch (err) {
      if (schemaMissing(err)) return tableMissing();
      throw err;
    }
    if (inserted !== 1) {
      return json({ ok: false, error: `Daily Signed Audit Receipt limit is ${limit}. The day starts at 00:00 UTC.`, code: 'QUOTA', limit }, 429);
    }
    return json(
      { ok: true, receipt: publicReceipt({ id, account_id: accountId, payload_json: payloadJson, signature, kid: signedKid, revoked_at: null, revoked_reason: null }) },
      201,
    );
  }

  const match = path.match(/^\/audit-receipts\/([^/]+)$/);
  if (!match) return null;
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const id = match[1];
  if (!ID_RE.test(id)) return json({ ok: false, error: 'Receipt not found.' }, 404);
  if (!env.DB) return json({ ok: false, error: 'Signed Audit Receipts need D1.', code: 'D1_UNAVAILABLE' }, 503);
  try {
    const row = await env.DB.prepare(
      `SELECT id, account_id, payload_json, signature, kid, revoked_at, revoked_reason FROM signed_audit_receipts WHERE id = ?`,
    )
      .bind(id)
      .first<ReceiptRow>();
    if (!row) return json({ ok: false, error: 'Receipt not found.' }, 404);
    return json({ ok: true, receipt: publicReceipt(row) }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    if (schemaMissing(err)) return tableMissing();
    throw err;
  }
}
