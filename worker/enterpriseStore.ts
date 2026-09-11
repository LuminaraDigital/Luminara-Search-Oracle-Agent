/**
 * Enterprise Multi-Tenancy and Role-Based Access Control (RBAC) Store.
 *
 * Manages Organizations, Organization Memberships, and granular role permissions.
 * Integrates with Cloudflare D1 with automatic fallback for tests / KV-only runtimes.
 */

import type { UserStoreEnv } from './userStore';
import type {
  HostedIdentity,
  Organization,
  OrganizationMembership,
  OrgRole,
  OrgPermission,
} from './userTypes';

/** Permissions matrix per role */
export const ROLE_PERMISSIONS: Record<OrgRole, ReadonlySet<OrgPermission>> = {
  owner: new Set(['canManageOrg', 'canManageKeys', 'canAudit', 'canExport', 'canViewLogs']),
  admin: new Set(['canManageOrg', 'canManageKeys', 'canAudit', 'canExport', 'canViewLogs']),
  analyst: new Set(['canAudit', 'canExport', 'canManageKeys']),
  auditor: new Set(['canViewLogs', 'canExport']),
  viewer: new Set(['canExport']),
};

/** Check if a role possesses a specific permission */
export function hasPermission(role: OrgRole, permission: OrgPermission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return Boolean(perms && perms.has(permission));
}

function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'workspace';
}

/**
 * Ensures a user belongs to at least one organization.
 * If no membership exists, auto-provisions a personal organization where the user is 'owner'.
 */
export async function getOrCreateUserOrg(
  env: UserStoreEnv,
  user: HostedIdentity,
): Promise<{ org: Organization; membership: OrganizationMembership }> {
  const accountId = user.accountId || user.id;
  const now = Date.now();

  if (env.DB) {
    // 1. Check if user already has an active membership
    const existingMembership = await env.DB.prepare(
      `SELECT org_id, user_id, role, status, joined_at
       FROM organization_memberships
       WHERE user_id = ? AND status = 'active'
       ORDER BY joined_at ASC
       LIMIT 1`,
    )
      .bind(user.id)
      .first<{ org_id: string; user_id: string; role: OrgRole; status: 'active'; joined_at: number }>();

    if (existingMembership) {
      const existingOrg = await env.DB.prepare(
        `SELECT id, name, slug, tier, created_at, updated_at FROM organizations WHERE id = ?`,
      )
        .bind(existingMembership.org_id)
        .first<Organization>();

      if (existingOrg) {
        return { org: existingOrg, membership: existingMembership };
      }
    }

    // 2. Create default personal organization for user
    const orgId = `org_${accountId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const name = user.name ? `${user.name}'s Organization` : `Organization (${accountId})`;
    const slug = `${sanitizeSlug(user.name || accountId)}-${orgId.slice(-6)}`;

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organizations (id, name, slug, tier, created_at, updated_at)
         VALUES (?, ?, ?, 'standard', ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      ).bind(orgId, name, slug, now, now),
      env.DB.prepare(
        `INSERT INTO organization_memberships (org_id, user_id, role, status, joined_at)
         VALUES (?, ?, 'owner', 'active', ?)
         ON CONFLICT(org_id, user_id) DO NOTHING`,
      ).bind(orgId, user.id, now),
    ]);

    const org: Organization = {
      id: orgId,
      name,
      slug,
      tier: 'standard',
      created_at: now,
      updated_at: now,
    };

    const membership: OrganizationMembership = {
      org_id: orgId,
      user_id: user.id,
      role: 'owner',
      status: 'active',
      joined_at: now,
    };

    return { org, membership };
  }

  // Fallback for KV / memory test environment
  const fallbackOrg: Organization = {
    id: `org_${accountId}`,
    name: user.name ? `${user.name}'s Organization` : `Workspace`,
    slug: sanitizeSlug(accountId),
    tier: 'standard',
    created_at: now,
    updated_at: now,
  };

  const fallbackMembership: OrganizationMembership = {
    org_id: fallbackOrg.id,
    user_id: user.id,
    role: 'owner',
    status: 'active',
    joined_at: now,
  };

  return { org: fallbackOrg, membership: fallbackMembership };
}

/** Retrieve user membership within a specific organization */
export async function getOrgMembership(
  env: UserStoreEnv,
  orgId: string,
  userId: string,
): Promise<OrganizationMembership | null> {
  if (env.DB) {
    const row = await env.DB.prepare(
      `SELECT org_id, user_id, role, status, joined_at
       FROM organization_memberships
       WHERE org_id = ? AND user_id = ?`,
    )
      .bind(orgId, userId)
      .first<{ org_id: string; user_id: string; role: OrgRole; status: 'active' | 'invited' | 'suspended'; joined_at: number }>();
    return row || null;
  }
  return null;
}

/** List all members of an organization */
export async function listOrgMemberships(
  env: UserStoreEnv,
  orgId: string,
): Promise<OrganizationMembership[]> {
  if (env.DB) {
    const { results } = await env.DB.prepare(
      `SELECT org_id, user_id, role, status, joined_at
       FROM organization_memberships
       WHERE org_id = ?
       ORDER BY joined_at ASC`,
    )
      .bind(orgId)
      .all<OrganizationMembership>();
    return results || [];
  }
  return [];
}

/** Set or update a member's role within an organization */
export async function setOrgMemberRole(
  env: UserStoreEnv,
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<void> {
  if (env.DB) {
    await env.DB.prepare(
      `UPDATE organization_memberships
       SET role = ?
       WHERE org_id = ? AND user_id = ?`,
    )
      .bind(role, orgId, userId)
      .run();
  }
}
