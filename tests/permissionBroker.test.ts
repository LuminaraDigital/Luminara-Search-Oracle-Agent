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

  it('fails closed for unknown tools as high_risk requiring human approval (M-23)', () => {
    const broker = new PermissionBroker();
    expect(broker.classifyAction('unregistered_custom_tool')).toBe('high_risk');
    const res = broker.requestPermission(
      'thread-unknown',
      'agent-1',
      'unregistered_custom_tool',
      'arg: test',
    );
    expect(res.granted).toBe(false);
    expect(res.requestId).toBeDefined();
    expect(broker.getPending(res.requestId!)?.riskTier).toBe('high_risk');
  });

  it('classifies decide_booking_signoff and prepare_cms_mcp_call as destructive and never auto-approves or cascades destructive tools (MEDIUM #13)', () => {
    const broker = new PermissionBroker();
    expect(broker.classifyAction('decide_booking_signoff')).toBe('destructive');
    expect(broker.classifyAction('prepare_cms_mcp_call')).toBe('destructive');

    const req1 = broker.requestPermission('t-dest', 'agent-1', 'prepare_cms_mcp_call', 'patch #1');
    const req2 = broker.requestPermission('t-dest', 'agent-1', 'prepare_cms_mcp_call', 'patch #2');
    expect(req1.granted).toBe(false);
    expect(req2.granted).toBe(false);

    // Resolving with remember: true must NOT remember or cascade sibling pending destructive requests.
    expect(broker.resolveRequest(req1.requestId!, 'allowed-once', { remember: true })).toBe(true);
    expect(broker.isToolRemembered('prepare_cms_mcp_call')).toBe(false);
    expect(broker.getPending(req2.requestId!)?.status).toBe('pending');

    // Subsequent call to the same destructive tool must still require approval.
    const req3 = broker.requestPermission('t-dest', 'agent-1', 'prepare_cms_mcp_call', 'patch #3');
    expect(req3.granted).toBe(false);
  });
});
