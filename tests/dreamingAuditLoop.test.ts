import { describe, it, expect, beforeEach } from 'vitest';
import { geminiService } from '../services/geminiService';
import { dreamingClient } from '../services/dreaming/dreamingClient';
import type { BusinessDNA, BusinessMemoryItem } from '../types';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => {
    storage[k] = String(v);
  },
  removeItem: (k: string) => {
    delete storage[k];
  },
  clear: () => {
    Object.keys(storage).forEach((k) => delete storage[k]);
  },
};

(globalThis as any).localStorage = mockLocalStorage;

describe('Luminara Dreaming Closed-Loop Prompt & Audit Integration', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('injects active Dreaming memories into getDNAContext for the audited domain', () => {
    const dna: BusinessDNA = {
      name: 'Alpha Dental',
      mission: 'Painless cosmetic dentistry',
      usp: 'Same-day ceramic veneers',
      targetAudience: 'Professionals in Sydney CBD',
      competitors: ['sydneydental.com.au'],
      perceivedGaps: ['Low visibility for emergency veneers'],
      rawContext: 'Premium dental clinic',
    };

    const activeMemories: BusinessMemoryItem[] = [
      {
        id: 'mem_vis_1',
        accountId: 'local',
        domain: 'alphadental.com.au',
        memoryType: 'visibility_profile',
        title: 'Citation Gap in AI Overviews',
        content: 'Perplexity cites sydneydental.com.au for emergency appointments due to clear FAQ schema.',
        structuredData: {},
        confidence: 0.95,
        status: 'active',
        sourceRefs: ['audit_1'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastVerifiedAt: Date.now(),
      },
      {
        id: 'mem_act_1',
        accountId: 'local',
        domain: 'alphadental.com.au',
        memoryType: 'action_memory',
        title: 'Action Implemented',
        content: 'Emergency dental booking schema deployed on 12 Sep with verified citation uptick.',
        structuredData: {},
        confidence: 0.92,
        status: 'active',
        sourceRefs: ['rec_1'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastVerifiedAt: Date.now(),
      },
    ];

    mockLocalStorage.setItem('luminara_dream_memories_v1', JSON.stringify(activeMemories));

    // Access getDNAContext via private method accessor or check query synthesis
    const contextText = (geminiService as any).getDNAContext(dna, 'alphadental.com.au');

    expect(contextText).toContain('[STRATEGIC BUSINESS DNA LINKED]');
    expect(contextText).toContain('Alpha Dental');
    expect(contextText).toContain('[LUMINARA DREAMING: CONSOLIDATED BUSINESS MEMORIES]');
    expect(contextText).toContain('Citation Gap in AI Overviews');
    expect(contextText).toContain('Perplexity cites sydneydental.com.au');
    expect(contextText).toContain('Emergency dental booking schema deployed');
  });

  it('runs offline local fallback in dreamingClient when worker is unavailable', async () => {
    // 1. Enqueue event locally
    const enqueueRes = await dreamingClient.enqueueEvent({
      domain: 'coffee-roasters.com',
      eventType: 'audit_completed',
      payload: { healthScore: 88, topCompetitor: 'starbucks.com' },
    });

    expect(enqueueRes.ok).toBe(true);

    // 2. Check status locally
    const status = await dreamingClient.getStatus('coffee-roasters.com');
    expect(status.ok).toBe(true);
    expect(status.domain).toBe('coffee-roasters.com');
    expect(status.pendingEventsCount).toBe(1);

    // 3. Run dream consolidation locally with force
    const dreamRes = await dreamingClient.runDream('coffee-roasters.com', true);
    expect(dreamRes.ok).toBe(true);
    expect(dreamRes.woke).toBe(true);
    expect(dreamRes.proposals?.length).toBeGreaterThan(0);

    // 4. Retrieve memories locally
    const memories = await dreamingClient.getActiveMemories('coffee-roasters.com');
    expect(memories.length).toBeGreaterThan(0);
  });
});

describe('dreamingClient.runDream when the server refuses the run', () => {
  it('returns the refusal to show, and does not run the consolidation in the browser instead', async () => {
    const refusal = {
      ok: false,
      error: "Run now uses one of your free daily requests on free plans, and today's are used up. Upgrade for unlimited runs, or try again after 00:00 UTC.",
      code: 'QUOTA_EXHAUSTED',
    };
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(refusal), { status: 429, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      mockLocalStorage.clear();
      mockLocalStorage.setItem(
        'luminara_dream_events_v1',
        JSON.stringify([{ id: 'devt_local', domain: 'refused.example', eventType: 'audit_completed', payload: { healthScore: 70 }, signalWeight: 1, createdAt: 1 }]),
      );

      const res = await dreamingClient.runDream('refused.example', true);

      expect(res).toEqual({ ok: false, error: refusal.error });
      expect(mockLocalStorage.getItem('luminara_dream_runs_v1')).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
