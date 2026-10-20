/**
 * Signed Audit Receipt. Ed25519 is applied by the Worker over canonical JSON.
 * This module only builds and checks the payload. It does not hold a private key.
 *
 * Crawl text is hashed as raw UTF-8. Engine responses, the prompt set, and the
 * model list are hashed as canonical JSON. A null input is not_measured and its
 * hash is null. An empty string is measured.
 */
import { canonicalJson, sha256HexOf } from '../trust/receiptCrypto';

export const AUDIT_RECEIPT_KIND = 'signed_audit_receipt';
export const AUDIT_RECEIPT_ISSUER = 'luminarasuite.com';
/** Prepended to the signed bytes so this payload cannot verify as a Trust Receipt under the shared key. */
export const AUDIT_RECEIPT_SIGNING_PREFIX = 'luminara:audit-receipt:v1\n';
/** This route only signs what the account holder submitted. It is not a Luminara-run audit. */
export const AUDIT_RECEIPT_SOURCE = 'caller_submitted';
/** Paid accounts. Override with AUDIT_RECEIPT_DAILY_QUOTA (integer 1 to 1000). */
export const DEFAULT_AUDIT_RECEIPT_DAILY_QUOTA = 10;

export type AuditFieldStatus = 'measured' | 'not_measured';

export type AuditReceiptHashes = {
  crawl: string | null;
  engineResponses: string | null;
  promptSet: string | null;
  models: string | null;
};

export type AuditReceiptFieldStatus = {
  crawl: AuditFieldStatus;
  engineResponses: AuditFieldStatus;
  promptSet: AuditFieldStatus;
  models: AuditFieldStatus;
  observedAt: AuditFieldStatus;
};

export type AuditReceiptModel = { engine: string; modelId: string };

export type AuditReceiptContent = {
  domain: string;
  issuedAt: string;
  observedAt: string | null;
  hashes: AuditReceiptHashes;
  models: AuditReceiptModel[] | null;
  fieldStatus: AuditReceiptFieldStatus;
  source: typeof AUDIT_RECEIPT_SOURCE;
  /** SHA-256 of a domain-separated account id. Not the account id itself. */
  accountHash: string;
};

export type SignedAuditReceiptPayload = AuditReceiptContent & {
  v: 1;
  kind: typeof AUDIT_RECEIPT_KIND;
  id: string;
  iss: typeof AUDIT_RECEIPT_ISSUER;
  kid: string;
  contentSha256: string;
};

async function hashUtf8(text: string): Promise<string> {
  return sha256HexOf(text);
}

async function hashCanonical(value: unknown): Promise<string> {
  return sha256HexOf(canonicalJson(value));
}

export async function contentSha256Of(content: AuditReceiptContent): Promise<string> {
  return sha256HexOf(canonicalJson(content));
}

export async function auditReceiptAccountHash(accountId: string): Promise<string> {
  return sha256HexOf(`luminara:audit-receipt-account:${accountId}`);
}

export async function assembleAuditReceiptContent(input: {
  domain: string;
  issuedAt: string;
  crawl: string | null;
  engineResponses: unknown | null;
  prompts: string[] | null;
  models: AuditReceiptModel[] | null;
  observedAt: string | null;
  accountId: string;
}): Promise<AuditReceiptContent & { contentSha256: string }> {
  const content: AuditReceiptContent = {
    domain: input.domain,
    issuedAt: input.issuedAt,
    observedAt: input.observedAt,
    hashes: {
      crawl: input.crawl === null ? null : await hashUtf8(input.crawl),
      engineResponses: input.engineResponses === null ? null : await hashCanonical(input.engineResponses),
      promptSet: input.prompts === null ? null : await hashCanonical(input.prompts),
      models: input.models === null ? null : await hashCanonical(input.models),
    },
    models: input.models,
    fieldStatus: {
      crawl: input.crawl === null ? 'not_measured' : 'measured',
      engineResponses: input.engineResponses === null ? 'not_measured' : 'measured',
      promptSet: input.prompts === null ? 'not_measured' : 'measured',
      models: input.models === null ? 'not_measured' : 'measured',
      observedAt: input.observedAt === null ? 'not_measured' : 'measured',
    },
    source: AUDIT_RECEIPT_SOURCE,
    accountHash: await auditReceiptAccountHash(input.accountId),
  };
  return { ...content, contentSha256: await contentSha256Of(content) };
}
