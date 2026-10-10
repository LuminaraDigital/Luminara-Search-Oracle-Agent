/**
 * Browser client for Trust Receipts and domain verification (/api/trust/*).
 * Owner routes go through workerFetchWithAuthRetry (same auth as projects).
 * Public routes (keys, public receipt) use plain fetch so /verify works signed out.
 */
import { apiBase, loadServerHealth, workerFetchWithAuthRetry } from '../apiClient';
import { verifyReceiptSignature, type ReceiptPublicJwk } from './receiptCrypto';
import { RECEIPT_LEVEL_LABELS, type TrustReceiptLevel, type TrustReceiptView } from './receiptTypes';

/** Level label as a full sentence (labels do not all end with a period). */
export function receiptLevelSentence(level: TrustReceiptLevel): string {
  const label = RECEIPT_LEVEL_LABELS[level] ?? String(level);
  return /[.!?]$/.test(label) ? label : `${label}.`;
}

/** A revoke reason as a full sentence. Reasons are stored as short phrases, most without a full stop. */
export function revokedReasonSentence(reason: string | null | undefined): string {
  const text = String(reason || '').trim();
  if (!text) return '';
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

export type ReceiptSignatureState = 'checking' | 'valid' | 'invalid' | 'key_not_found';
export type ReceiptSignatureNotice = { label: string; detail: string; tone: 'neutral' | 'valid' | 'withdrawn' | 'danger' };

const SIGNATURE_NOTICES: Record<ReceiptSignatureState, ReceiptSignatureNotice> = {
  checking: { label: 'Checking signature', detail: 'Verifying in your browser with the published key.', tone: 'neutral' },
  valid: {
    label: 'Valid signature',
    detail: 'Checked in your browser. This receipt was signed by Luminara and has not been altered.',
    tone: 'valid',
  },
  invalid: {
    label: 'Invalid signature',
    detail: 'The signature does not match the receipt contents. Do not rely on this receipt.',
    tone: 'danger',
  },
  key_not_found: {
    label: 'Key not found',
    detail: 'The signing key for this receipt is not in the published key set, so it cannot be checked.',
    tone: 'danger',
  },
};

/**
 * What the receipt page says about the signature. A withdrawn receipt never gets the
 * "Valid signature" success notice: its signature still checks out, and that must
 * not read as "this receipt stands".
 */
export function receiptSignatureNotice(state: ReceiptSignatureState, revoked: boolean): ReceiptSignatureNotice {
  if (revoked && state === 'valid') {
    return {
      label: 'Withdrawn',
      detail: 'Luminara signed this receipt and later withdrew it. The signature is genuine, but the receipt no longer stands. Do not rely on it.',
      tone: 'withdrawn',
    };
  }
  return SIGNATURE_NOTICES[state];
}

export type TrustFeatureFlags = {
  receiptsEnabled: boolean;
  receiptSigningConfigured: boolean;
  domainVerifyEnabled: boolean;
};

export type DomainVerificationStatus = 'pending' | 'verified' | 'lapsed' | 'revoked';
export type DomainProofMethod = 'dns_txt' | 'well_known' | 'meta_tag';

export type DomainVerificationRow = {
  domain: string;
  status: DomainVerificationStatus;
  method: DomainProofMethod | null;
  tokenHint: string | null;
  tokenExpiresAt: string | null;
  receiptId: string | null;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
};

export type DomainInstructions = {
  dns_txt: { type: string; name: string; value: string; note?: string };
  well_known: { url: string; content: string };
  meta_tag: { url: string; tag: string };
};

export type StartDomainResult =
  | { ok: true; alreadyVerified?: false; domain: string; token: string; tokenExpiresAt: string; instructions: DomainInstructions }
  | { ok: true; alreadyVerified: true; domain: DomainVerificationRow };

export type DomainCheckResult =
  | { ok: true; status: 'verified'; method: DomainProofMethod; receiptId: string | null; receiptIssued: boolean; receiptError?: string }
  | { ok: false; status: 'not_found'; error: string; tried?: DomainProofMethod[] }
  | { ok: false; status: 'unreachable'; error: string; measurementStatus: 'not_measured' }
  | { ok: false; status: 'error'; error: string; code?: string };

export const DOMAIN_METHOD_LABELS: Record<DomainProofMethod, string> = {
  dns_txt: 'DNS TXT record',
  well_known: 'Verification file',
  meta_tag: 'Meta tag',
};

/** Thrown for non-2xx responses so callers can branch on `code` (for example *_DISABLED). */
export class TrustApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'TrustApiError';
  }
}

export function isTrustDisabledError(err: unknown): boolean {
  return err instanceof TrustApiError && (err.code === 'TRUST_RECEIPTS_DISABLED' || err.code === 'DOMAIN_VERIFY_DISABLED');
}

type ApiBody = { ok?: boolean; error?: string; code?: string } & Record<string, unknown>;

async function readJson(r: Response): Promise<ApiBody> {
  try {
    return (await r.json()) as ApiBody;
  } catch {
    return {};
  }
}

async function ownerCall<T>(path: string, init: RequestInit = {}, label = 'Request'): Promise<T> {
  const r = await workerFetchWithAuthRetry(`${apiBase()}/api/trust${path}`, init);
  const data = await readJson(r);
  if (!r.ok || data.ok === false) {
    throw new TrustApiError(data.error || `${label} failed (${r.status})`, r.status, data.code);
  }
  return data as T;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

/**
 * Reads trust flags from /api/health. Returns null when health could not be
 * loaded, so callers try the API and rely on its *_DISABLED codes instead.
 */
export async function fetchTrustFlags(): Promise<TrustFeatureFlags | null> {
  const health = await loadServerHealth();
  if (!health.ok) return null;
  const trust = health.trust;
  return {
    receiptsEnabled: Boolean(trust?.receiptsEnabled),
    receiptSigningConfigured: Boolean(trust?.receiptSigningConfigured),
    domainVerifyEnabled: Boolean(trust?.domainVerifyEnabled),
  };
}

export async function fetchReceiptKeys(): Promise<{ issuer: string; keys: ReceiptPublicJwk[] }> {
  const r = await fetch(`${apiBase()}/api/trust/keys`);
  const data = await readJson(r);
  if (!r.ok || data.ok === false) throw new TrustApiError(data.error || `Key lookup failed (${r.status})`, r.status, data.code);
  return { issuer: String(data.issuer || ''), keys: Array.isArray(data.keys) ? (data.keys as ReceiptPublicJwk[]) : [] };
}

export async function listMyReceipts(): Promise<TrustReceiptView[]> {
  const data = await ownerCall<{ receipts?: TrustReceiptView[] }>('/receipts', {}, 'List receipts');
  return data.receipts || [];
}

/** Public read. Sends auth when available so owners can also see their private receipts. */
export async function fetchReceipt(id: string): Promise<{ owner: boolean; receipt: TrustReceiptView }> {
  const r = await workerFetchWithAuthRetry(`${apiBase()}/api/trust/receipts/${encodeURIComponent(id)}`);
  const data = await readJson(r);
  if (!r.ok || data.ok === false || !data.receipt) {
    throw new TrustApiError(data.error || `Receipt lookup failed (${r.status})`, r.status, data.code);
  }
  return { owner: Boolean(data.owner), receipt: data.receipt as TrustReceiptView };
}

export async function setReceiptVisibility(id: string, visibility: 'public' | 'private'): Promise<void> {
  await ownerCall(`/receipts/${encodeURIComponent(id)}/visibility`, jsonInit('POST', { visibility }), 'Update visibility');
}

export async function revokeReceipt(id: string, reason: string): Promise<void> {
  await ownerCall(`/receipts/${encodeURIComponent(id)}/revoke`, jsonInit('POST', { reason }), 'Revoke receipt');
}

export async function listDomains(): Promise<DomainVerificationRow[]> {
  const data = await ownerCall<{ domains?: DomainVerificationRow[] }>('/domains', {}, 'List domains');
  return data.domains || [];
}

export async function startDomainVerification(domain: string): Promise<StartDomainResult> {
  return ownerCall<StartDomainResult>('/domains', jsonInit('POST', { domain }), 'Start verification');
}

/** Never throws for the expected not_found / unreachable outcomes; maps other failures to status 'error'. */
export async function checkDomain(domain: string): Promise<DomainCheckResult> {
  const r = await workerFetchWithAuthRetry(
    `${apiBase()}/api/trust/domains/${encodeURIComponent(domain)}/check`,
    jsonInit('POST'),
  );
  const data = await readJson(r);
  if (data.status === 'verified' || data.status === 'not_found' || data.status === 'unreachable') {
    return data as unknown as DomainCheckResult;
  }
  return { ok: false, status: 'error', error: data.error || `Check failed (${r.status})`, code: data.code };
}

export async function removeDomain(domain: string): Promise<void> {
  await ownerCall(`/domains/${encodeURIComponent(domain)}`, { method: 'DELETE' }, 'Remove domain');
}

export function verifyLinkFor(receiptId: string): string {
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  return `${origin}/verify/r/${receiptId}`;
}

export type OfflineVerifyResult = { valid: boolean; kidFound: boolean };

/**
 * Verifies a receipt in the browser with only the published public keys.
 * Uses the exact signed bytes (payloadJson), never a re-serialised payload.
 * Pass `keys` to skip the network (tests, cached key sets).
 */
export async function verifyReceiptOffline(
  receipt: Pick<TrustReceiptView, 'kid' | 'payloadJson' | 'signature'>,
  keys?: ReceiptPublicJwk[],
): Promise<OfflineVerifyResult> {
  let keySet = keys;
  if (!keySet) {
    try {
      keySet = (await fetchReceiptKeys()).keys;
    } catch {
      keySet = [];
    }
  }
  const key = keySet.find((k) => k.kid === receipt.kid);
  if (!key) return { valid: false, kidFound: false };
  let payload: unknown;
  try {
    payload = JSON.parse(receipt.payloadJson);
  } catch {
    return { valid: false, kidFound: true };
  }
  const valid = await verifyReceiptSignature(key, payload, receipt.signature);
  return { valid, kidFound: true };
}
