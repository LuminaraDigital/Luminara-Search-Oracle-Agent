/**
 * Trust Receipts (Trust Network TN1). A receipt is a signed statement that a
 * Worker verifier checked a claim. It indexes evidence by hash and never copies
 * it. There is deliberately no route that mints a receipt from client input:
 * only server-side verifiers (domainVerification.ts first) call issueTrustReceipt,
 * and a verified level is refused without the verifier's typed result (VerifierResult).
 *
 * Routes (all 404 unless TRUST_RECEIPTS_ENABLED):
 *   GET  /trust/keys                       public key set (public)
 *   GET  /trust/receipts                   owner list
 *   GET  /trust/receipts/:id               owner, or anyone when public (revoked shown as revoked)
 *   POST /trust/receipts/:id/visibility    owner: { visibility: 'public' | 'private' }
 *   POST /trust/receipts/:id/revoke        owner: { reason }
 */
import type { Env } from './env';
import type { DomainProofMethod } from './domainVerification';
import { auditOrgIdFor, recordAuditLogBestEffort } from './auditLog';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import { billingId, identify, json } from './workerUtils';
import {
  ReceiptSigningUnavailable,
  receiptPublicKeySet,
  signReceiptPayload,
  currentReceiptKid,
} from './receiptSigning';
import { canonicalJson } from '../services/trust/receiptCrypto';
import type {
  TrustReceiptClaim,
  TrustReceiptLevel,
  TrustReceiptPayload,
  TrustReceiptSubjectKind,
  TrustReceiptView,
  TrustReceiptEvidence,
} from '../services/trust/receiptTypes';

export const RECEIPT_ISSUER = 'luminarasuite.com';

/** Flag rule shared by Trust Network flags: explicit true/false wins; unset is on in local dev only. */
export function trustFlagEnabled(env: Pick<Env, 'ENVIRONMENT'>, raw: string | undefined): boolean {
  const flag = String(raw || '').trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return !String(env.ENVIRONMENT || '').trim();
}

export function isTrustReceiptsEnabled(env: Pick<Env, 'ENVIRONMENT' | 'TRUST_RECEIPTS_ENABLED'>): boolean {
  return trustFlagEnabled(env, env.TRUST_RECEIPTS_ENABLED);
}

function newReceiptId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `rcpt_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

type ReceiptRow = {
  id: string;
  account_id: string;
  subject_kind: string;
  subject_id: string;
  claim: string;
  level: string;
  payload_json: string;
  signature: string;
  kid: string;
  visibility: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
};

function toView(row: ReceiptRow): TrustReceiptView {
  return {
    id: row.id,
    payload: JSON.parse(row.payload_json) as TrustReceiptPayload,
    payloadJson: row.payload_json,
    signature: row.signature,
    kid: row.kid,
    visibility: row.visibility === 'public' ? 'public' : 'private',
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

/**
 * What a Worker verifier checked, and that the check passed. A receipt at a verified
 * level is issued only with one of these in hand, built from the verifier's own result.
 */
export type VerifierResult = {
  /** Only a passed check can back a verified receipt. */
  passed: true;
  /** What was checked: the subject, and the claim about it. */
  subject: { kind: TrustReceiptSubjectKind; id: string };
  claim: TrustReceiptClaim;
  /** How it was checked, for example `dns_txt`. */
  method: string;
  /** Where the proof was read, and the SHA-256 of the bytes that were read. */
  evidenceUrl: string;
  evidenceSha256: string;
};

type IssueReceiptCommon = {
  accountId: string;
  subject: { kind: TrustReceiptSubjectKind; id: string };
  claim: TrustReceiptClaim;
  method: string;
  evidence: TrustReceiptEvidence[];
  measurementStatus: 'measured' | 'estimated' | 'not_measured';
  expiresAt?: string;
  visibility?: 'private' | 'public';
};

/**
 * `self_reported` needs no check. Every other level says Luminara verified something,
 * so it must carry the verifier result it rests on.
 */
export type IssueReceiptInput = IssueReceiptCommon &
  (
    | { level: 'self_reported'; verifierResult?: undefined }
    | { level: Exclude<TrustReceiptLevel, 'self_reported'>; verifierResult: VerifierResult }
  );

/** Thrown when a verified level is asked for without a verifier result that matches the receipt. */
export class ReceiptNotVerified extends Error {
  constructor(reason: string) {
    super(`Refusing to issue a verified receipt: ${reason}`);
    this.name = 'ReceiptNotVerified';
  }
}

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

/** Typed against the domain verifier, so a method it cannot produce does not compile here. */
const DOMAIN_PROOF_METHODS: Record<DomainProofMethod, true> = { dns_txt: true, well_known: true, meta_tag: true };

/**
 * The verifiers that exist, by level, then claim, then the methods that verifier can
 * return. Today that is one: the domain check in domainVerification.ts. A verified
 * receipt for any other level, claim or method is refused, because nothing in the
 * Worker could have checked it. Add an entry here in the change that ships a verifier.
 */
const VERIFIER_METHODS: Record<Exclude<TrustReceiptLevel, 'self_reported'>, Partial<Record<TrustReceiptClaim, readonly string[]>>> = {
  worker_verified: { domain_control: Object.keys(DOMAIN_PROOF_METHODS) },
  registry_verified: {},
};

/**
 * The runtime half of the IssueReceiptInput type: a cast or a JavaScript caller cannot
 * skip it. It checks that the result is complete, matches the receipt and names a real
 * verifier. It cannot prove who built the result: that rests on the rule that only a
 * verifier builds one, which tests/receiptsNeedVerifier.test.ts checks statically.
 */
function assertVerifierResult(input: IssueReceiptInput): void {
  if (input.level === 'self_reported') return;
  const result = input.verifierResult as VerifierResult | undefined;
  if (!result || result.passed !== true) throw new ReceiptNotVerified('no passed verifier result was given');
  if (
    result.subject?.kind !== input.subject.kind ||
    result.subject?.id !== input.subject.id ||
    result.claim !== input.claim ||
    result.method !== input.method
  ) {
    throw new ReceiptNotVerified('the verifier result is for a different subject, claim or method');
  }
  if (!VERIFIER_METHODS[input.level]?.[input.claim]?.includes(input.method)) {
    throw new ReceiptNotVerified('no verifier checks this claim by this method at this level');
  }
  // Both must be real values before they are compared: two missing fields are equal too.
  const sha256 = result.evidenceSha256;
  const url = result.evidenceUrl;
  if (typeof sha256 !== 'string' || !SHA256_HEX_RE.test(sha256) || typeof url !== 'string' || !url) {
    throw new ReceiptNotVerified('the verifier result does not say what was read, or its hash is not a SHA-256');
  }
  if (!input.evidence.some((e) => e.sha256 === sha256 && e.url === url)) {
    throw new ReceiptNotVerified('the receipt does not carry the evidence the verifier read');
  }
}

/**
 * Signs and stores a receipt. Server-side verifiers only. Throws
 * ReceiptSigningUnavailable when no key or no D1 is configured, so a verifier
 * can report "verified, receipt not issued" honestly instead of faking one.
 * Throws ReceiptNotVerified when a verified level has no matching verifier result.
 */
export async function issueTrustReceipt(env: Env, input: IssueReceiptInput): Promise<TrustReceiptView> {
  assertVerifierResult(input);
  if (!env.DB) throw new ReceiptSigningUnavailable('D1 is not bound');
  const kid = await currentReceiptKid(env);
  if (!kid) throw new ReceiptSigningUnavailable('RECEIPT_SIGNING_KEY is not configured');
  const id = newReceiptId();
  const issuedAt = new Date().toISOString();
  const payload: TrustReceiptPayload = {
    v: 1,
    id,
    iss: RECEIPT_ISSUER,
    kid,
    issuedAt,
    expiresAt: input.expiresAt,
    subject: input.subject,
    claim: input.claim,
    level: input.level,
    method: input.method,
    evidence: input.evidence,
    measurementStatus: input.measurementStatus,
  };
  const payloadJson = canonicalJson(payload);
  const { signature, kid: signedKid } = await signReceiptPayload(env, payload);
  const visibility = input.visibility === 'public' ? 'public' : 'private';

  await env.DB.prepare(
    `INSERT INTO trust_receipts (id, account_id, subject_kind, subject_id, claim, level, payload_json, signature, kid, visibility, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.accountId,
      input.subject.kind,
      input.subject.id,
      input.claim,
      input.level,
      payloadJson,
      signature,
      signedKid,
      visibility,
      input.expiresAt || null,
      issuedAt,
    )
    .run();

  await recordAuditLogBestEffort(env, {
    org_id: auditOrgIdFor(input.accountId),
    actor_id: 'system:trust',
    action: 'trust_receipt_issued',
    target_id: id,
    details: { claim: input.claim, level: input.level, subject: `${input.subject.kind}:${input.subject.id}`, method: input.method },
  });

  return {
    id,
    payload,
    payloadJson,
    signature,
    kid: signedKid,
    visibility,
    revokedAt: null,
    revokedReason: null,
  };
}

/** Revokes a receipt owned by accountId. Returns false when not found or already revoked. */
export async function revokeTrustReceipt(
  env: Env,
  accountId: string,
  receiptId: string,
  reason: string,
  actorId = 'system:trust',
): Promise<boolean> {
  if (!env.DB) return false;
  const res = await env.DB.prepare(
    `UPDATE trust_receipts SET revoked_at = ?, revoked_reason = ?, visibility = 'private'
     WHERE id = ? AND account_id = ? AND revoked_at IS NULL`,
  )
    .bind(new Date().toISOString(), reason.slice(0, 200), receiptId, accountId)
    .run();
  const changed = Number(res.meta?.changes || 0) > 0;
  if (changed) {
    await recordAuditLogBestEffort(env, {
      org_id: auditOrgIdFor(accountId),
      actor_id: actorId,
      action: 'trust_receipt_revoked',
      target_id: receiptId,
      details: { reason: reason.slice(0, 200) },
    });
  }
  return changed;
}

/**
 * The method the gateway route stamped on each receipt it issued. That route fetched
 * nothing and checked nothing, so none of those receipts rests on a verifier result.
 */
export const GATEWAY_RECEIPT_METHOD = 'gateway_oracle_audit_v1';
/** Shown to anyone who opens the receipt's link, so it is a plain sentence. */
export const GATEWAY_RECEIPT_REVOKED_REASON = 'This receipt was issued without a check and has been withdrawn.';
/** Kept low: each receipt costs a KV write and a few D1 queries, and one Worker call may only make so many. */
export const GATEWAY_REVOKE_BATCH = 10;

/** Thrown when the trust_receipts table is not in this database (migration 0020 not applied). */
export class TrustReceiptsTableMissing extends Error {
  constructor() {
    super('This database has no trust_receipts table. Apply migration 0020 first. Without the table no receipt exists here, so there is nothing to revoke.');
    this.name = 'TrustReceiptsTableMissing';
  }
}

/**
 * Revokes the receipts the gateway route issued, chosen by the method in the signed
 * payload, so a receipt from a real verifier is never touched. Each call handles up to
 * GATEWAY_REVOKE_BATCH and reports how many are left. Safe to run again: a revoked
 * receipt is not selected and its first reason and time are kept.
 *
 * Revoking marks the row and what the receipt's page shows. It cannot reach a copy
 * somebody saved: that copy's signature stays valid until the signing key is rotated.
 */
export async function revokeGatewayIssuedReceipts(env: Env): Promise<{ revoked: number; remaining: number }> {
  if (!env.DB) throw new Error('Trust receipts need D1');
  const stillLive = `FROM trust_receipts WHERE revoked_at IS NULL AND json_extract(payload_json, '$.method') = ?`;
  const { results } = await env.DB.prepare(`SELECT id, account_id, visibility ${stillLive} ORDER BY created_at LIMIT ?`)
    .bind(GATEWAY_RECEIPT_METHOD, GATEWAY_REVOKE_BATCH)
    .all<Pick<ReceiptRow, 'id' | 'account_id' | 'visibility'>>()
    .catch((err: unknown) => {
      if (/no such table: trust_receipts/i.test(err instanceof Error ? err.message : String(err))) throw new TrustReceiptsTableMissing();
      throw err;
    });
  let revoked = 0;
  for (const row of results || []) {
    // These were public from the moment they were issued, so a shared link must keep showing "revoked".
    if (row.visibility === 'public') await markEverPublic(env, row.id);
    if (await revokeTrustReceipt(env, row.account_id, row.id, GATEWAY_RECEIPT_REVOKED_REASON, 'admin')) revoked++;
  }
  const left = await env.DB.prepare(`SELECT COUNT(*) AS n ${stillLive}`).bind(GATEWAY_RECEIPT_METHOD).first<{ n: number }>();
  return { revoked, remaining: Number(left?.n || 0) };
}

async function readReceipt(env: Env, id: string): Promise<ReceiptRow | null> {
  if (!env.DB) return null;
  return env.DB.prepare(`SELECT * FROM trust_receipts WHERE id = ?`).bind(id).first<ReceiptRow>();
}

const RECEIPT_ID_RE = /^rcpt_[a-f0-9]{24}$/;

export async function handleTrustReceiptsRoute(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/trust/keys' && !path.startsWith('/trust/receipts')) return null;
  if (!isTrustReceiptsEnabled(env)) return json({ ok: false, error: 'Not found', code: 'TRUST_RECEIPTS_DISABLED' }, 404);

  if (path === '/trust/keys') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const set = await receiptPublicKeySet(env);
    return json({ ok: true, issuer: RECEIPT_ISSUER, ...set }, 200, { 'Cache-Control': 'public, max-age=300' });
  }

  if (!env.DB) return json({ ok: false, error: 'Trust receipts need D1', code: 'D1_UNAVAILABLE' }, 503);

  if (path === '/trust/receipts') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const who = await identify(request, env);
    if (!who.user) return json({ ok: false, error: who.error || 'Sign in required', code: 'AUTH_REQUIRED' }, 401);
    const { results } = await env.DB.prepare(
      `SELECT * FROM trust_receipts WHERE account_id = ? ORDER BY created_at DESC LIMIT 200`,
    )
      .bind(billingId(who.user))
      .all<ReceiptRow>();
    return json({ ok: true, receipts: (results || []).map(toView) });
  }

  const match = path.match(/^\/trust\/receipts\/([^/]+)(?:\/(visibility|revoke))?$/);
  if (!match) return json({ ok: false, error: 'Not found' }, 404);
  const [, id, action] = match;
  if (!RECEIPT_ID_RE.test(id)) return json({ ok: false, error: 'Receipt not found' }, 404);

  if (!action) {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const row = await readReceipt(env, id);
    if (!row) return json({ ok: false, error: 'Receipt not found' }, 404);
    const who = await identify(request, env);
    const isOwner = Boolean(who.user && billingId(who.user) === row.account_id);
    // Revoked receipts that were once shared stay readable as revoked, so a stale
    // link shows "revoked" rather than vanishing. Private receipts never leak existence.
    const readable = isOwner || row.visibility === 'public' || (row.revoked_at !== null && (await wasEverPublic(env, row.id)));
    if (!readable) return json({ ok: false, error: 'Receipt not found' }, 404);
    return json({ ok: true, owner: isOwner, receipt: toView(row) }, 200, { 'Cache-Control': 'no-store' });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const who = await identify(request, env);
  if (!who.user) return json({ ok: false, error: who.error || 'Sign in required', code: 'AUTH_REQUIRED' }, 401);
  const accountId = billingId(who.user);
  const row = await readReceipt(env, id);
  if (!row || row.account_id !== accountId) return json({ ok: false, error: 'Receipt not found' }, 404);

  const read = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const body = (read.value || {}) as Record<string, unknown>;

  if (action === 'visibility') {
    const visibility = body.visibility;
    if (visibility !== 'public' && visibility !== 'private') {
      return json({ ok: false, error: 'visibility must be "public" or "private"' }, 400);
    }
    if (row.revoked_at && visibility === 'public') {
      return json({ ok: false, error: 'A revoked receipt cannot be made public', code: 'RECEIPT_REVOKED' }, 409);
    }
    await env.DB.prepare(`UPDATE trust_receipts SET visibility = ? WHERE id = ? AND account_id = ?`)
      .bind(visibility, id, accountId)
      .run();
    if (visibility === 'public') await markEverPublic(env, id);
    await recordAuditLogBestEffort(env, {
      org_id: auditOrgIdFor(accountId),
      actor_id: who.user.id,
      action: 'trust_receipt_visibility',
      target_id: id,
      details: { visibility },
    });
    return json({ ok: true, id, visibility });
  }

  // action === 'revoke'
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'revoked by owner';
  const changed = await revokeTrustReceipt(env, accountId, id, reason, who.user.id);
  if (!changed) return json({ ok: false, error: 'Receipt already revoked', code: 'RECEIPT_REVOKED' }, 409);
  return json({ ok: true, id, revoked: true });
}

/**
 * KV marker so a receipt that was ever shared publicly stays resolvable as
 * "revoked" after revocation flips it private. Without KV, revoked receipts
 * simply 404 to non-owners (safe default).
 */
async function markEverPublic(env: Env, id: string): Promise<void> {
  try {
    await env.LUMINARA_KV?.put(`trust:ever_public:${id}`, '1');
  } catch {
    /* best effort */
  }
}

async function wasEverPublic(env: Env, id: string): Promise<boolean> {
  try {
    return (await env.LUMINARA_KV?.get(`trust:ever_public:${id}`)) === '1';
  } catch {
    return false;
  }
}
