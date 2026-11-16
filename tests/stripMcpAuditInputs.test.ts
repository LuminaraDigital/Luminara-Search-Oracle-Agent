import { describe, expect, it } from 'vitest';
import { getAuditChainEntries, recordAuditLog, verifyAuditChain } from '../worker/auditLog';
import { mcpAuditStripTarget, stripMcpAuditInputs } from '../worker/stripMcpAuditInputs';
import type { UserStoreEnv } from '../worker/userStore';
import { createSqliteD1 } from './helpers/sqliteD1';

function env(): UserStoreEnv {
  return { DB: createSqliteD1() } as UserStoreEnv;
}

async function chain(db: UserStoreEnv['DB'], orgId: string) {
  const { entries } = await getAuditChainEntries({ DB: db } as UserStoreEnv, orgId);
  return { entries, verdict: await verifyAuditChain(entries) };
}

describe('stripMcpAuditInputs', () => {
  it('drops tool inputs, keeps the row metadata, reseals the chain, and does nothing the second time', async () => {
    const db = env();
    const orgId = 'org_acct_strip';
    await recordAuditLog(db, {
      org_id: orgId,
      actor_id: 'user_1',
      action: 'license.activate',
      target_id: 'lic',
      details: { note: 'kept' },
      ip_address: '203.0.113.4',
      user_agent: 'test-agent',
    });
    const mcp = await recordAuditLog(db, {
      org_id: orgId,
      actor_id: 'user_1',
      action: 'mcp_tool_allow',
      target_id: 'save_report',
      details: {
        tool: 'save_report',
        decision: 'allow',
        projectId: 'proj_1',
        args: { title: 'secret title', html: '<p>secret</p>' },
      },
      ip_address: '203.0.113.4',
      user_agent: 'test-agent',
    });
    await recordAuditLog(db, {
      org_id: orgId,
      actor_id: 'user_1',
      action: 'mcp_tool_block',
      target_id: 'browse_goal',
      details: {
        tool: 'browse_goal',
        decision: 'block',
        reason: 'budget_exhausted',
        projectId: 'proj_1',
        args: { goal: 'secret goal' },
      },
    });

    const first = await stripMcpAuditInputs(db.DB!);
    expect(first).toEqual({ orgs: 1, rows: 2 });

    const { entries, verdict } = await chain(db.DB, orgId);
    expect(verdict).toMatchObject({ verified: true, length: 3 });
    const allow = entries.find((entry) => entry.id === mcp.id);
    expect(JSON.parse(String(allow?.details))).toEqual({ tool: 'save_report', decision: 'allow' });
    expect(allow).toMatchObject({
      org_id: orgId,
      actor_id: 'user_1',
      action: 'mcp_tool_allow',
      target_id: 'save_report',
      created_at: mcp.created_at,
    });
    const stored = await db.DB!.prepare(
      `SELECT ip_address, user_agent, created_at FROM org_audit_logs WHERE id = ?`,
    ).bind(mcp.id).first<{ ip_address: string; user_agent: string; created_at: number }>();
    expect(stored).toMatchObject({ ip_address: '203.0.113.4', user_agent: 'test-agent', created_at: mcp.created_at });
    const block = entries.find((entry) => entry.action === 'mcp_tool_block');
    expect(JSON.parse(String(block?.details))).toEqual({
      tool: 'browse_goal',
      decision: 'block',
      reason: 'budget_exhausted',
    });
    const kept = entries.find((entry) => entry.action === 'license.activate');
    expect(JSON.parse(String(kept?.details))).toEqual({ note: 'kept' });
    expect(JSON.stringify(entries)).not.toContain('secret title');
    expect(JSON.stringify(entries)).not.toContain('secret goal');
    expect(JSON.stringify(entries)).not.toContain('proj_1');

    const hashes = entries.map((entry) => entry.hash);
    const second = await stripMcpAuditInputs(db.DB!);
    expect(second).toEqual({ orgs: 0, rows: 0 });
    const again = await chain(db.DB, orgId);
    expect(again.verdict.verified).toBe(true);
    expect(again.entries.map((entry) => entry.hash)).toEqual(hashes);
  });

  it('leaves a non-MCP row alone, including a details field named args', async () => {
    const db = env();
    const orgId = 'org_acct_other';
    const row = await recordAuditLog(db, {
      org_id: orgId,
      actor_id: 'user_2',
      action: 'license.activate',
      details: { args: { title: 'do-not-strip' } },
    });
    expect(await stripMcpAuditInputs(db.DB!)).toEqual({ orgs: 0, rows: 0 });
    const { entries, verdict } = await chain(db.DB, orgId);
    expect(verdict.verified).toBe(true);
    expect(entries[0].hash).toBe(row.hash);
    expect(JSON.parse(String(entries[0].details))).toEqual({ args: { title: 'do-not-strip' } });
  });

  it('reseals a row whose parent hash no longer exists', async () => {
    const db = env();
    const orgId = 'org_acct_orphan';
    await recordAuditLog(db, {
      org_id: orgId,
      actor_id: 'user_3',
      action: 'mcp_tool_allow',
      target_id: 'whoami',
      details: { tool: 'whoami', decision: 'allow', args: { note: 'first secret' } },
    });
    const second = await recordAuditLog(db, {
      org_id: orgId,
      actor_id: 'user_3',
      action: 'mcp_tool_allow',
      target_id: 'whoami',
      details: { tool: 'whoami', decision: 'allow' },
    });
    await db.DB!.prepare(`UPDATE org_audit_logs SET prev_hash = ? WHERE id = ?`).bind('deadbeef', second.id).run();

    const result = await stripMcpAuditInputs(db.DB!);
    expect(result.rows).toBeGreaterThan(0);
    const { entries, verdict } = await chain(db.DB, orgId);
    expect(verdict).toMatchObject({ verified: true, length: 2 });
    expect(JSON.stringify(entries)).not.toContain('first secret');
    expect(await stripMcpAuditInputs(db.DB!)).toEqual({ orgs: 0, rows: 0 });
  });

  it('refuses production unless the confirm variable is set', () => {
    expect(() => mcpAuditStripTarget(['--prod'], {})).toThrow(/Refusing production/);
    expect(() => mcpAuditStripTarget([], {})).toThrow(/exactly one/);
    expect(mcpAuditStripTarget(['--staging'], {}).database).toBe('luminara-users-staging');
    expect(mcpAuditStripTarget(['--prod'], { CONFIRM_PROD_AUDIT_STRIP: '1' }).envName).toBe('production');
  });
});
