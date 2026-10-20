/**
 * Signed Audit Receipts. The Worker hashes the submitted audit fields and
 * signs that payload with RECEIPT_SIGNING_KEY. Raw crawl text is not stored.
 * No chain call.
 */
import type { Env } from './env';
import { checkSignedAuditReceipt, readSignedAuditReceiptPayload } from '../services/auditReceipt/check';
import {
  assembleAuditReceiptContent,
  AUDIT_RECEIPT_ISSUER,
  AUDIT_RECEIPT_KIND,
  type AuditReceiptModel,
  type SignedAuditReceiptPayload,
} from '../services/auditReceipt/payload';
import { canonicalJson } from '../services/trust/receiptCrypto';
import { currentReceiptKid, receiptPublicKeySet, signReceiptPayload, ReceiptSigningUnavailable } from './receiptSigning';
import { identify, billingId, json } from './workerUtils';
import { MAX_BODY_BYTES, readBody, safePublicHostname } from './security';

const ID_RE = /^sar_[a-f0-9]{32}$/;
const OBSERVED_MIN = Date.UTC(2020, 0, 1);
const OBSERVED_SKEW_MS = 5 * 60 * 1000;

type ReceiptRow = {
  id: string;
  payload_json: string;
  signature: string;
  kid: string;
};

function own(value: object, key: string): unknown {
  if (!Object.hasOwn(value, key)) return undefined;
  return Reflect.get(value, key);
}

function missingTable(err: unknown): boolean {
  return /no such table: signed_audit_receipts/i.test(err instanceof Error ? err.message : String(err));
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
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return { ok: false, error: 'prompts must be 1 to 20 strings, or null.' };
  const prompts: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return { ok: false, error: 'Each prompt must be a string.' };
    const text = item.trim();
    if (!text || text.length > 400) return { ok: false, error: 'Each prompt must be 1 to 400 characters.' };
    prompts.push(text);
  }
  return { ok: true, value: prompts };
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

function publicReceipt(row: ReceiptRow) {
  return {
    id: row.id,
    payloadJson: row.payload_json,
    signature: row.signature,
    kid: row.kid,
    verifyPath: `/verify/audit/${row.id}`,
  };
}

export async function handleAuditReceiptRoute(request: Request, env: Env, path: string): Promise<Response | null> {
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
    return json({ ok: true, ...check, payload: check.payload });
  }

  if (path === '/audit-receipts') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!env.DB) return json({ ok: false, error: 'Signed Audit Receipts need D1.', code: 'D1_UNAVAILABLE' }, 503);
    const who = await identify(request, env);
    if (who.error || !who.user) return json({ ok: false, error: who.error || 'Sign in required.', code: 'AUTH_REQUIRED' }, 401);
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
    let kid: string | null;
    try {
      kid = await currentReceiptKid(env);
    } catch (err) {
      if (err instanceof ReceiptSigningUnavailable) {
        return json({ ok: false, error: 'RECEIPT_SIGNING_KEY is not configured. No receipt was signed.', code: 'RECEIPT_SIGNING_UNAVAILABLE' }, 503);
      }
      throw err;
    }
    if (!kid) return json({ ok: false, error: 'RECEIPT_SIGNING_KEY is not configured. No receipt was signed.', code: 'RECEIPT_SIGNING_UNAVAILABLE' }, 503);
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
    };
    const payloadJson = canonicalJson(payload);
    let signature: string;
    try {
      signature = (await signReceiptPayload(env, payload)).signature;
    } catch (err) {
      if (err instanceof ReceiptSigningUnavailable) {
        return json({ ok: false, error: 'RECEIPT_SIGNING_KEY is not configured. No receipt was signed.', code: 'RECEIPT_SIGNING_UNAVAILABLE' }, 503);
      }
      throw err;
    }
    if (!readSignedAuditReceiptPayload(JSON.parse(payloadJson))) {
      return json({ ok: false, error: 'The receipt payload could not be read back. Nothing was stored.', code: 'RECEIPT_UNREADABLE' }, 500);
    }
    try {
      await env.DB.prepare(
        `INSERT INTO signed_audit_receipts (id, account_id, domain, payload_json, signature, kid, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, billingId(who.user), domain, payloadJson, signature, kid, Date.now())
        .run();
    } catch (err) {
      if (missingTable(err)) {
        return json({ ok: false, error: 'Signed Audit Receipt table is not migrated (0034).', code: 'AUDIT_RECEIPT_TABLE_MISSING' }, 503);
      }
      throw err;
    }
    return json({ ok: true, receipt: publicReceipt({ id, payload_json: payloadJson, signature, kid }) }, 201);
  }

  const match = path.match(/^\/audit-receipts\/([^/]+)$/);
  if (!match) return null;
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const id = match[1];
  if (!ID_RE.test(id)) return json({ ok: false, error: 'Receipt not found.' }, 404);
  if (!env.DB) return json({ ok: false, error: 'Signed Audit Receipts need D1.', code: 'D1_UNAVAILABLE' }, 503);
  try {
    const row = await env.DB.prepare(`SELECT id, payload_json, signature, kid FROM signed_audit_receipts WHERE id = ?`)
      .bind(id)
      .first<ReceiptRow>();
    if (!row) return json({ ok: false, error: 'Receipt not found.' }, 404);
    return json({ ok: true, receipt: publicReceipt(row) }, 200, { 'Cache-Control': 'no-store' });
  } catch (err) {
    if (missingTable(err)) return json({ ok: false, error: 'Signed Audit Receipt table is not migrated (0034).', code: 'AUDIT_RECEIPT_TABLE_MISSING' }, 503);
    throw err;
  }
}
