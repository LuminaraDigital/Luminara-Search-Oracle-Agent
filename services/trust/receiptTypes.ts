/**
 * Trust Receipt types shared by the Worker and the app. See
 * docs/plans/trust-network-additive-plan.md and specs/0017-trust-receipts.md.
 */

export type TrustReceiptSubjectKind = 'domain' | 'business' | 'account' | 'agent' | 'project';

export type TrustReceiptClaim =
  | 'domain_control'
  | 'business_registry'
  | 'same_as'
  | 'team_member'
  | 'live_deploy'
  | 'repo_commit'
  | 'fix_retested'
  | 'audit_run'
  | 'agent_job_delivered'
  | 'agent_action_log'
  | 'self_reported_file';

/**
 * Who checked the claim. `self_reported` means Luminara recorded it but did not
 * verify it; UI must never render it as verified.
 */
export type TrustReceiptLevel = 'worker_verified' | 'registry_verified' | 'self_reported';

export type TrustReceiptEvidence = {
  ref: string;
  url?: string;
  sha256?: string;
  fetchedAt?: string;
  httpStatus?: number;
};

export type TrustReceiptPayload = {
  v: 1;
  id: string;
  iss: string;
  kid: string;
  issuedAt: string;
  expiresAt?: string;
  subject: { kind: TrustReceiptSubjectKind; id: string };
  claim: TrustReceiptClaim;
  level: TrustReceiptLevel;
  method: string;
  evidence: TrustReceiptEvidence[];
  measurementStatus: 'measured' | 'estimated' | 'not_measured';
};

export type TrustReceiptView = {
  id: string;
  payload: TrustReceiptPayload;
  /** Exact bytes that were signed (canonical JSON). Verify against this, not a re-serialisation. */
  payloadJson: string;
  signature: string;
  kid: string;
  visibility: 'private' | 'public';
  revokedAt: string | null;
  revokedReason: string | null;
};

export const RECEIPT_CLAIM_LABELS: Record<TrustReceiptClaim, string> = {
  domain_control: 'Domain control',
  business_registry: 'Business register match',
  same_as: 'Linked profile',
  team_member: 'Team member',
  live_deploy: 'Live deployment',
  repo_commit: 'Repository commit',
  fix_retested: 'Fix retested',
  audit_run: 'Audit run',
  agent_job_delivered: 'Agent job delivered',
  agent_action_log: 'Agent action log',
  self_reported_file: 'Self-reported file',
};

export const RECEIPT_LEVEL_LABELS: Record<TrustReceiptLevel, string> = {
  worker_verified: 'Checked by Luminara',
  registry_verified: 'Matched against an official register',
  self_reported: 'Self-reported. Luminara did not verify this.',
};
