/** Shared identity shape for hosted-key quota and user persistence. */
export type HostedIdentity = {
  /** Login key: Telegram uses String(id); Firebase uses `fb:{uid}`. */
  id: string;
  source: 'telegram' | 'firebase';
  email?: string;
  name?: string;
  /**
   * Shared billing + workspace id after upsert/link.
   * Stars, TON, and (later) Stripe all write `sub:{accountId}`.
   */
  accountId?: string;
};

/** Enterprise Role-Based Access Control (RBAC) roles */
export type OrgRole = 'owner' | 'admin' | 'analyst' | 'auditor' | 'viewer';

/** Granular enterprise permissions */
export type OrgPermission =
  | 'canManageOrg'
  | 'canManageKeys'
  | 'canAudit'
  | 'canExport'
  | 'canViewLogs';

export type Organization = {
  id: string;
  name: string;
  slug: string;
  tier: 'standard' | 'growth' | 'agency' | 'enterprise';
  created_at: number;
  updated_at: number;
};

export type OrganizationMembership = {
  org_id: string;
  user_id: string;
  role: OrgRole;
  status: 'active' | 'invited' | 'suspended';
  joined_at: number;
};

export type AuditLogEntry = {
  id: string;
  org_id: string;
  actor_id: string;
  action: string;
  target_id?: string;
  details?: Record<string, unknown> | string;
  ip_address?: string;
  user_agent?: string;
  prev_hash?: string;
  hash: string;
  created_at: number;
};

export type EncryptedKeyBag = {
  ciphertext: string;
  iv: string;
  salt: string;
  v: number;
};
