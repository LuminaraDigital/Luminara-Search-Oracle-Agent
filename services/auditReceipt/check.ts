/**
 * Checks a Signed Audit Receipt with published public keys only.
 * The signature is Ed25519 over canonical JSON. The content hash is recomputed
 * from the fields and compared with contentSha256.
 */
import { own } from '../own';
import { canonicalJson, verifyReceiptSignature, type ReceiptPublicJwk } from '../trust/receiptCrypto';
import {
  AUDIT_RECEIPT_ISSUER,
  AUDIT_RECEIPT_KIND,
  AUDIT_RECEIPT_SIGNING_PREFIX,
  AUDIT_RECEIPT_SOURCE,
  contentSha256Of,
  type AuditFieldStatus,
  type AuditReceiptContent,
  type AuditReceiptHashes,
  type AuditReceiptModel,
  type SignedAuditReceiptPayload,
} from './payload';

export type PastedAuditReceipt = { payloadJson: string; signature: string; kid: string };

export type AuditReceiptCheck = {
  signature: 'valid' | 'invalid' | 'key_not_published';
  contentHash: 'match' | 'mismatch' | 'unread';
  payload: SignedAuditReceiptPayload | null;
};

const SHA256_HEX = /^[a-f0-9]{64}$/;

function hashField(value: unknown, status: AuditFieldStatus): string | null | undefined {
  if (status === 'not_measured') return value === null ? null : undefined;
  if (typeof value === 'string' && SHA256_HEX.test(value)) return value;
  return undefined;
}

function fieldStatus(value: unknown): AuditFieldStatus | null {
  if (value === 'measured' || value === 'not_measured') return value;
  return null;
}

function readModels(value: unknown, status: AuditFieldStatus): AuditReceiptModel[] | null | undefined {
  if (status === 'not_measured') return value === null ? null : undefined;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const models: AuditReceiptModel[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const engine = own(item, 'engine');
    const modelId = own(item, 'modelId');
    if (typeof engine !== 'string' || typeof modelId !== 'string' || !engine || !modelId) return undefined;
    models.push({ engine, modelId });
  }
  return models;
}

export function readSignedAuditReceiptPayload(value: unknown): SignedAuditReceiptPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (own(value, 'v') !== 1 || own(value, 'kind') !== AUDIT_RECEIPT_KIND) return null;
  if (own(value, 'iss') !== AUDIT_RECEIPT_ISSUER) return null;
  const id = own(value, 'id');
  const kid = own(value, 'kid');
  const issuedAt = own(value, 'issuedAt');
  const domain = own(value, 'domain');
  const contentSha256 = own(value, 'contentSha256');
  const observedAt = own(value, 'observedAt');
  if (typeof id !== 'string' || typeof kid !== 'string' || typeof issuedAt !== 'string' || typeof domain !== 'string') return null;
  if (typeof contentSha256 !== 'string' || !SHA256_HEX.test(contentSha256)) return null;
  if (own(value, 'source') !== AUDIT_RECEIPT_SOURCE) return null;
  const accountHash = own(value, 'accountHash');
  if (typeof accountHash !== 'string' || !SHA256_HEX.test(accountHash)) return null;
  const statusRaw = own(value, 'fieldStatus');
  const hashesRaw = own(value, 'hashes');
  if (!statusRaw || typeof statusRaw !== 'object' || Array.isArray(statusRaw)) return null;
  if (!hashesRaw || typeof hashesRaw !== 'object' || Array.isArray(hashesRaw)) return null;
  const crawlStatus = fieldStatus(own(statusRaw, 'crawl'));
  const engineStatus = fieldStatus(own(statusRaw, 'engineResponses'));
  const promptStatus = fieldStatus(own(statusRaw, 'promptSet'));
  const modelStatus = fieldStatus(own(statusRaw, 'models'));
  const observedStatus = fieldStatus(own(statusRaw, 'observedAt'));
  if (!crawlStatus || !engineStatus || !promptStatus || !modelStatus || !observedStatus) return null;
  const crawl = hashField(own(hashesRaw, 'crawl'), crawlStatus);
  const engineResponses = hashField(own(hashesRaw, 'engineResponses'), engineStatus);
  const promptSet = hashField(own(hashesRaw, 'promptSet'), promptStatus);
  const modelHash = hashField(own(hashesRaw, 'models'), modelStatus);
  if (crawl === undefined || engineResponses === undefined || promptSet === undefined || modelHash === undefined) return null;
  if (observedStatus === 'measured' ? typeof observedAt !== 'string' : observedAt !== null) return null;
  const models = readModels(own(value, 'models'), modelStatus);
  if (models === undefined) return null;
  const hashes: AuditReceiptHashes = { crawl, engineResponses, promptSet, models: modelHash };
  return {
    v: 1,
    kind: AUDIT_RECEIPT_KIND,
    id,
    iss: AUDIT_RECEIPT_ISSUER,
    kid,
    issuedAt,
    domain,
    observedAt: typeof observedAt === 'string' ? observedAt : null,
    hashes,
    models,
    fieldStatus: {
      crawl: crawlStatus,
      engineResponses: engineStatus,
      promptSet: promptStatus,
      models: modelStatus,
      observedAt: observedStatus,
    },
    contentSha256,
    source: AUDIT_RECEIPT_SOURCE,
    accountHash,
  };
}

function contentOf(payload: SignedAuditReceiptPayload): AuditReceiptContent {
  return {
    domain: payload.domain,
    issuedAt: payload.issuedAt,
    observedAt: payload.observedAt,
    hashes: payload.hashes,
    models: payload.models,
    fieldStatus: payload.fieldStatus,
    source: payload.source,
    accountHash: payload.accountHash,
  };
}

export async function checkSignedAuditReceipt(input: {
  payloadJson: string;
  signature: string;
  kid: string;
  keys: ReceiptPublicJwk[];
}): Promise<AuditReceiptCheck> {
  const key = input.keys.find((item) => item.kid === input.kid);
  if (!key) return { signature: 'key_not_published', contentHash: 'unread', payload: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.payloadJson);
  } catch {
    return { signature: 'invalid', contentHash: 'unread', payload: null };
  }
  const signatureOk = await verifyReceiptSignature(key, parsed, input.signature, AUDIT_RECEIPT_SIGNING_PREFIX);
  const payload = readSignedAuditReceiptPayload(parsed);
  if (!payload || payload.kid !== input.kid) {
    return { signature: signatureOk ? 'valid' : 'invalid', contentHash: 'unread', payload: null };
  }
  const again = await contentSha256Of(contentOf(payload));
  return {
    signature: signatureOk ? 'valid' : 'invalid',
    contentHash: again === payload.contentSha256 ? 'match' : 'mismatch',
    payload,
  };
}

export function parsePastedAuditReceipt(text: string): PastedAuditReceipt | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'Paste the receipt JSON.' };
  }
  const nested = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? own(parsed, 'receipt') : undefined;
  const root = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : parsed;
  if (!root || typeof root !== 'object' || Array.isArray(root)) return { error: 'Paste the receipt JSON.' };
  const signature = own(root, 'signature');
  const kid = own(root, 'kid');
  if (typeof signature !== 'string' || !signature || typeof kid !== 'string' || !kid) {
    return { error: 'The receipt needs a signature and a key id.' };
  }
  const payloadJson = own(root, 'payloadJson');
  if (typeof payloadJson === 'string' && payloadJson) return { payloadJson, signature, kid };
  const payload = own(root, 'payload');
  if (payload && typeof payload === 'object') return { payloadJson: canonicalJson(payload), signature, kid };
  return { error: 'The receipt needs payloadJson.' };
}
