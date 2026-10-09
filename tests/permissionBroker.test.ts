import { describe, it, expect, vi } from 'vitest';
import { PermissionBroker } from '../services/agentCore/permissionBroker';
import { TurnWatchdog } from '../services/agentCore/turnWatchdog';

describe('PermissionBroker', () => {
  it('automatically grants free and low-risk tools without blocking', () => {
    const broker = new PermissionBroker();

    const freeRes = broker.requestPermission(
      'thread-1',
      'lead-strategist',
      'get_project_context',
      'project: acme-seo'
    );
    expect(freeRes.granted).toBe(true);
    expect(freeRes.outcome).toBe('allowed-once');
    expect(freeRes.requestId).toBeUndefined();

    const lowRiskRes = broker.requestPermission(
      'thread-1',
      'aeo-analyst',
      'parse_sitemap',
      'https://example.com/sitemap.xml'
    );
    expect(lowRiskRes.granted).toBe(true);
    expect(lowRiskRes.outcome).toBe('allowed-once');
  });

  it('gates paid research tools and pauses watchdog stall clock', () => {
    const setWaitingOnHuman = vi.fn();
    const mockWatchdog = {
      setWaitingOnHuman,
    } as unknown as TurnWatchdog;

    const broker = new PermissionBroker({ watchdog: mockWatchdog });

    const paidRes = broker.requestPermission(
      'thread-pay',
      'keyword-scout',
      'dataforseo_research',
      'keywords: [ai visibility tool, aeo platform]',
      0.15
    );

    expect(paidRes.granted).toBe(false);
    expect(paidRes.requestId).toBeDefined();
    expect(setWaitingOnHuman).toHaveBeenCalledWith('thread-pay', true);

    const pending = broker.getPending(paidRes.requestId!);
    expect(pending?.riskTier).toBe('paid_research');
    expect(pending?.costEstimateUsd).toBe(0.15);
    expect(pending?.status).toBe('pending');

    // User approves the card
    const resolved = broker.resolveRequest(paidRes.requestId!, 'allowed-once');
    expect(resolved).toBe(true);
    expect(pending?.status).toBe('resolved');
    expect(pending?.outcome).toBe('allowed-once');
    expect(setWaitingOnHuman).toHaveBeenCalledWith('thread-pay', false);
  });

  it('supports rejection outcome on risky destructive tools', () => {
    const broker = new PermissionBroker();

    const res = broker.requestPermission(
      'thread-del',
      'admin-agent',
      'delete_audit_history',
      'domain: acme.com'
    );
    expect(res.granted).toBe(false);
    expect(res.requestId).toBeDefined();

    broker.resolveRequest(res.requestId!, 'rejected');
    const item = broker.getPending(res.requestId!);
    expect(item?.outcome).toBe('rejected');
  });
});
