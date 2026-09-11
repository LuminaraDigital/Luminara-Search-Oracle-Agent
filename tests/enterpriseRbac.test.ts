import { describe, expect, it } from 'vitest';
import {
  ROLE_PERMISSIONS,
  hasPermission,
} from '../worker/enterpriseStore';
import {
  computeAuditHash,
  verifyAuditChain,
} from '../worker/auditLog';
import type { AuditLogEntry } from '../worker/userTypes';

describe('Enterprise Multi-Tenancy, RBAC & SIEM Audit Logging', () => {
  describe('Role-Based Access Control (RBAC) permissions', () => {
    it('grants full administrative rights to Owner and Admin', () => {
      expect(hasPermission('owner', 'canManageOrg')).toBe(true);
      expect(hasPermission('owner', 'canManageKeys')).toBe(true);
      expect(hasPermission('owner', 'canAudit')).toBe(true);
      expect(hasPermission('owner', 'canExport')).toBe(true);
      expect(hasPermission('owner', 'canViewLogs')).toBe(true);

      expect(hasPermission('admin', 'canManageOrg')).toBe(true);
      expect(hasPermission('admin', 'canManageKeys')).toBe(true);
      expect(hasPermission('admin', 'canViewLogs')).toBe(true);
    });

    it('enforces least-privilege boundary on Analyst', () => {
      expect(hasPermission('analyst', 'canAudit')).toBe(true);
      expect(hasPermission('analyst', 'canExport')).toBe(true);
      expect(hasPermission('analyst', 'canManageKeys')).toBe(true);
      expect(hasPermission('analyst', 'canManageOrg')).toBe(false);
      expect(hasPermission('analyst', 'canViewLogs')).toBe(false);
    });

    it('enforces audit-only permissions on Auditor', () => {
      expect(hasPermission('auditor', 'canViewLogs')).toBe(true);
      expect(hasPermission('auditor', 'canExport')).toBe(true);
      expect(hasPermission('auditor', 'canAudit')).toBe(false);
      expect(hasPermission('auditor', 'canManageKeys')).toBe(false);
      expect(hasPermission('auditor', 'canManageOrg')).toBe(false);
    });

    it('limits Viewer to report viewing and export only', () => {
      expect(hasPermission('viewer', 'canExport')).toBe(true);
      expect(hasPermission('viewer', 'canAudit')).toBe(false);
      expect(hasPermission('viewer', 'canManageKeys')).toBe(false);
      expect(hasPermission('viewer', 'canViewLogs')).toBe(false);
      expect(hasPermission('viewer', 'canManageOrg')).toBe(false);
    });
  });

  describe('Tamper-Evident Audit Log Cryptographic Chain', () => {
    it('computes deterministic SHA-256 hashes', async () => {
      const h1 = await computeAuditHash(
        '0000000000000000000000000000000000000000000000000000000000000000',
        'org_test_1',
        'user_123',
        'auth.login',
        '',
        1700000000,
        JSON.stringify({ ip: '1.2.3.4' }),
      );
      const h2 = await computeAuditHash(
        '0000000000000000000000000000000000000000000000000000000000000000',
        'org_test_1',
        'user_123',
        'auth.login',
        '',
        1700000000,
        JSON.stringify({ ip: '1.2.3.4' }),
      );
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verifies a valid cryptographic audit chain', async () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      const entry1Hash = await computeAuditHash(
        genesisHash,
        'org_1',
        'user_1',
        'auth.login',
        '',
        1000,
        JSON.stringify({ provider: 'google' }),
      );

      const entry1: AuditLogEntry = {
        id: 'log_1',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'auth.login',
        details: { provider: 'google' },
        prev_hash: genesisHash,
        hash: entry1Hash,
        created_at: 1000,
      };

      const entry2Hash = await computeAuditHash(
        entry1Hash,
        'org_1',
        'user_1',
        'workspace.sync_keys',
        '',
        2000,
        JSON.stringify({ count: 3 }),
      );

      const entry2: AuditLogEntry = {
        id: 'log_2',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'workspace.sync_keys',
        details: { count: 3 },
        prev_hash: entry1Hash,
        hash: entry2Hash,
        created_at: 2000,
      };

      const verification = await verifyAuditChain([entry1, entry2]);
      expect(verification.verified).toBe(true);
    });

    it('detects tampering or forged entries in the audit trail', async () => {
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';

      const entry1Hash = await computeAuditHash(
        genesisHash,
        'org_1',
        'user_1',
        'auth.login',
        '',
        1000,
        JSON.stringify({ ip: '1.1.1.1' }),
      );

      const entry1: AuditLogEntry = {
        id: 'log_1',
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'auth.login',
        details: { ip: '1.1.1.1' },
        prev_hash: genesisHash,
        hash: entry1Hash,
        created_at: 1000,
      };

      // Tampered entry with invalid prev_hash
      const entry2: AuditLogEntry = {
        id: 'log_2',
        org_id: 'org_1',
        actor_id: 'user_attacker',
        action: 'org.escalate_privilege',
        details: {},
        prev_hash: 'bad_hash_123',
        hash: 'fake_hash',
        created_at: 2000,
      };

      const verification = await verifyAuditChain([entry1, entry2]);
      expect(verification.verified).toBe(false);
      expect(verification.brokenAtId).toBe('log_2');
    });
  });

  describe('Audit Log Store & API Endpoint', () => {
    it('records and returns audit logs in fallback/in-memory mode', async () => {
      const { recordAuditLog, getAuditLogs } = await import('../worker/auditLog');
      const env = { LUMINARA_KV: undefined, DB: undefined };

      const recorded = await recordAuditLog(env, {
        org_id: 'org_test_fallbacks',
        actor_id: 'user_fallback',
        action: 'workspace.sync',
        details: { keyCount: 2 },
        ip_address: '127.0.0.1',
      });

      expect(recorded.id).toMatch(/^log_/);
      expect(recorded.org_id).toBe('org_test_fallbacks');
      expect(recorded.hash).toMatch(/^[0-9a-f]{64}$/);

      const logs = await getAuditLogs(env, 'org_test_fallbacks');
      expect(logs.entries).toBeDefined();
    });

    it('blocks unauthenticated access to /api/enterprise/audit-logs', async () => {
      const worker = (await import('../worker/index')).default;
      const res = await worker.fetch(
        new Request('https://luminarasuite.com/api/enterprise/audit-logs', {
          headers: { 'cf-connecting-ip': '1.2.3.4' },
        }),
        {
          ASSETS: { fetch: async () => new Response('ok') } as any,
          WEBAPP_URL: 'https://luminarasuite.com',
          ALLOWED_ORIGINS: 'https://luminarasuite.com',
        } as any,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any,
      );

      expect(res.status).toBe(401);
      const data: any = await res.json();
      expect(data.error).toBeTruthy();
    }, 15000);

    it('rejects non-GET methods on /api/enterprise/audit-logs with 405', async () => {
      const worker = (await import('../worker/index')).default;
      const res = await worker.fetch(
        new Request('https://luminarasuite.com/api/enterprise/audit-logs', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '1.2.3.4' },
        }),
        {
          ASSETS: { fetch: async () => new Response('ok') } as any,
          WEBAPP_URL: 'https://luminarasuite.com',
          ALLOWED_ORIGINS: 'https://luminarasuite.com',
        } as any,
        { waitUntil: () => {}, passThroughOnException: () => {} } as any,
      );

      expect(res.status).toBe(405);
    }, 15000);
  });
});
