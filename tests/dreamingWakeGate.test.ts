import { describe, it, expect } from 'vitest';
import { evaluateWakeGate } from '../worker/dreamingWakeGate';
import type { BusinessMemoryItem, DreamEvent } from '../types';

describe('Luminara Dreaming Deterministic Wake Gate', () => {
  const baseMemory: BusinessMemoryItem = {
    id: 'mem_1',
    accountId: 'acct_1',
    domain: 'luminares.io',
    memoryType: 'business_dna',
    title: 'Luminares Profile',
    content: 'AEO and GEO optimization suite.',
    structuredData: {},
    confidence: 1.0,
    status: 'active',
    sourceRefs: ['init'],
    createdAt: Date.now() - 100000,
    updatedAt: Date.now() - 100000,
    lastVerifiedAt: Date.now() - 100000,
    expiresAt: null,
  };

  it('keeps the Dream Agent asleep when no events or expired memories exist', () => {
    const res = evaluateWakeGate({
      pendingEvents: [],
      activeMemories: [baseMemory],
      triggerReason: 'post_audit',
    });

    expect(res.shouldWake).toBe(false);
    expect(res.pendingEventsCount).toBe(0);
    expect(res.signalScore).toBe(0);
  });

  it('keeps the Dream Agent asleep when accumulated signal is below threshold', () => {
    const events: DreamEvent[] = [
      {
        id: 'devt_1',
        accountId: 'acct_1',
        domain: 'luminares.io',
        eventType: 'audit_completed',
        payload: { score: 70 },
        contentHash: 'hash1',
        signalWeight: 1.0,
        createdAt: Date.now(),
      },
    ];

    const res = evaluateWakeGate({
      pendingEvents: events,
      activeMemories: [baseMemory],
      triggerReason: 'post_audit',
      threshold: 3.0,
    });

    expect(res.shouldWake).toBe(false);
    expect(res.signalScore).toBe(1.0);
    expect(res.threshold).toBe(3.0);
  });

  it('wakes the Dream Agent when signal score reaches or exceeds threshold', () => {
    const events: DreamEvent[] = [
      {
        id: 'devt_1',
        accountId: 'acct_1',
        domain: 'luminares.io',
        eventType: 'audit_completed',
        payload: { score: 70 },
        contentHash: 'hash1',
        signalWeight: 1.0,
        createdAt: Date.now(),
      },
      {
        id: 'devt_2',
        accountId: 'acct_1',
        domain: 'luminares.io',
        eventType: 'recommendation_updated',
        payload: { status: 'in_progress' },
        contentHash: 'hash2',
        signalWeight: 2.0,
        createdAt: Date.now(),
      },
    ];

    const res = evaluateWakeGate({
      pendingEvents: events,
      activeMemories: [baseMemory],
      triggerReason: 'post_audit',
      threshold: 3.0,
    });

    expect(res.shouldWake).toBe(true);
    expect(res.signalScore).toBe(3.0);
    expect(res.reason).toContain('exceeded threshold');
  });

  it('wakes immediately upon detecting a high-signal profile change', () => {
    const events: DreamEvent[] = [
      {
        id: 'devt_profile',
        accountId: 'acct_1',
        domain: 'luminares.io',
        eventType: 'client_profile_changed',
        payload: { name: 'Luminares Global', usp: 'Enterprise AI Search Defense' },
        contentHash: 'hash_profile',
        signalWeight: 2.5,
        createdAt: Date.now(),
      },
    ];

    const res = evaluateWakeGate({
      pendingEvents: events,
      activeMemories: [baseMemory],
      triggerReason: 'post_audit',
      threshold: 5.0, // High threshold, but high-signal should bypass
    });

    expect(res.shouldWake).toBe(true);
    expect(res.highSignalDetected).toBe(true);
    expect(res.detectedConflictSummary).toContain('Brand name shift');
  });

  it('wakes for manual or MCP triggers when any pending event exists', () => {
    const events: DreamEvent[] = [
      {
        id: 'devt_single',
        accountId: 'acct_1',
        domain: 'luminares.io',
        eventType: 'audit_completed',
        payload: { score: 65 },
        contentHash: 'hash_single',
        signalWeight: 1.0,
        createdAt: Date.now(),
      },
    ];

    const res = evaluateWakeGate({
      pendingEvents: events,
      activeMemories: [baseMemory],
      triggerReason: 'manual_user',
    });

    expect(res.shouldWake).toBe(true);
    expect(res.reason).toContain('Direct trigger (manual_user)');
  });

  it('wakes when active memories have expired and need pruning', () => {
    const expiredMemory: BusinessMemoryItem = {
      ...baseMemory,
      id: 'mem_expired',
      title: 'Temporary promotion',
      expiresAt: Date.now() - 5000,
    };

    const res = evaluateWakeGate({
      pendingEvents: [],
      activeMemories: [expiredMemory],
      triggerReason: 'post_audit',
    });

    expect(res.shouldWake).toBe(true);
    expect(res.expiredMemoryIds).toContain('mem_expired');
    expect(res.reason).toContain('expired memory record');
  });
});
