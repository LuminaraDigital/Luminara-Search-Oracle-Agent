/**
 * Frontend client service for Luminara Dreaming.
 * Talks to Worker endpoints (/api/dreaming/*) with offline localStorage resilience.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import type {
  BusinessMemoryItem,
  DreamEvent,
  DreamEventType,
  DreamProposal,
  DreamRun,
  DreamTriggerReason,
  DreamWakeGateResult,
} from '../../types';
import { evaluateWakeGate } from '../../worker/dreamingWakeGate';
import { deterministicDreamConsolidator } from '../../worker/dreamAgent';

export interface DreamStatusResult {
  ok: boolean;
  domain: string;
  wake: DreamWakeGateResult;
  pendingEventsCount: number;
  activeMemoriesCount: number;
  pendingProposalsCount: number;
  lastRun: DreamRun | null;
}

const LOCAL_STORAGE_MEMORIES_KEY = 'luminara_dream_memories_v1';
const LOCAL_STORAGE_PROPOSALS_KEY = 'luminara_dream_proposals_v1';
const LOCAL_STORAGE_EVENTS_KEY = 'luminara_dream_events_v1';
const LOCAL_STORAGE_RUNS_KEY = 'luminara_dream_runs_v1';

function canStorage(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem('__dream_probe__', '1');
    localStorage.removeItem('__dream_probe__');
    return true;
  } catch {
    return false;
  }
}

function getLocal<T>(key: string, fallback: T): T {
  if (!canStorage()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setLocal<T>(key: string, val: T): void {
  if (!canStorage()) return;
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore */
  }
}

export class DreamingClient {
  private static instance: DreamingClient;

  public static getInstance(): DreamingClient {
    if (!DreamingClient.instance) {
      DreamingClient.instance = new DreamingClient();
    }
    return DreamingClient.instance;
  }

  public async getStatus(domain: string): Promise<DreamStatusResult> {
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
    try {
      const res = await workerFetchWithAuthRetry(
        `${apiBase()}/api/dreaming/status?domain=${encodeURIComponent(clean)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as DreamStatusResult;
        return data;
      }
    } catch {
      /* fallback to local storage */
    }

    const allEvents = getLocal<DreamEvent[]>(LOCAL_STORAGE_EVENTS_KEY, []).filter(
      (e) => e.domain === clean && !e.dreamRunId,
    );
    const allMemories = getLocal<BusinessMemoryItem[]>(LOCAL_STORAGE_MEMORIES_KEY, []).filter(
      (m) => m.domain === clean && m.status === 'active',
    );
    const allProposals = getLocal<DreamProposal[]>(LOCAL_STORAGE_PROPOSALS_KEY, []).filter(
      (p) => p.domain === clean && p.status === 'pending',
    );
    const runs = getLocal<DreamRun[]>(LOCAL_STORAGE_RUNS_KEY, []).filter((r) => r.domain === clean);
    const lastRun = runs.length > 0 ? runs[runs.length - 1] : null;

    const wake = evaluateWakeGate({
      pendingEvents: allEvents,
      activeMemories: allMemories,
      triggerReason: 'post_audit',
    });

    return {
      ok: true,
      domain: clean,
      wake,
      pendingEventsCount: allEvents.length,
      activeMemoriesCount: allMemories.length,
      pendingProposalsCount: allProposals.length,
      lastRun,
    };
  }

  public async enqueueEvent(opts: {
    domain: string;
    eventType: DreamEventType;
    sourceId?: string | null;
    payload?: Record<string, unknown>;
    signalWeight?: number;
  }): Promise<{ ok: boolean; event?: DreamEvent; error?: string }> {
    const clean = opts.domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
    try {
      const res = await workerFetchWithAuthRetry(`${apiBase()}/api/dreaming/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...opts, domain: clean }),
      });
      if (res.ok) {
        return (await res.json()) as { ok: boolean; event?: DreamEvent };
      }
    } catch {
      /* fallback */
    }

    const allEvents = getLocal<DreamEvent[]>(LOCAL_STORAGE_EVENTS_KEY, []);
    const event: DreamEvent = {
      id: `devt_local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      accountId: 'local',
      domain: clean,
      eventType: opts.eventType,
      sourceId: opts.sourceId || null,
      payload: opts.payload || {},
      contentHash: `hash_${Date.now()}`,
      signalWeight: opts.signalWeight ?? 1.0,
      dreamRunId: null,
      createdAt: Date.now(),
    };
    allEvents.push(event);
    setLocal(LOCAL_STORAGE_EVENTS_KEY, allEvents);
    return { ok: true, event };
  }

  public async runDream(
    domain: string,
    force = false,
    triggerReason: DreamTriggerReason = 'manual_user',
  ): Promise<{
    ok: boolean;
    woke?: boolean;
    reason?: string;
    run?: DreamRun;
    proposals?: DreamProposal[];
    error?: string;
  }> {
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
    try {
      const res = await workerFetchWithAuthRetry(`${apiBase()}/api/dreaming/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: clean, force, triggerReason }),
      });
      if (res.ok) {
        return (await res.json()) as {
          ok: boolean;
          woke?: boolean;
          reason?: string;
          run?: DreamRun;
          proposals?: DreamProposal[];
        };
      }
    } catch {
      /* fallback */
    }

    // Local execution fallback
    const allEvents = getLocal<DreamEvent[]>(LOCAL_STORAGE_EVENTS_KEY, []);
    const pendingEvents = allEvents.filter((e) => e.domain === clean && !e.dreamRunId);
    const allMemories = getLocal<BusinessMemoryItem[]>(LOCAL_STORAGE_MEMORIES_KEY, []);
    const activeMemories = allMemories.filter((m) => m.domain === clean && m.status === 'active');

    const wake = evaluateWakeGate({
      pendingEvents,
      activeMemories,
      triggerReason,
    });

    if (!wake.shouldWake && !force) {
      return { ok: true, woke: false, reason: wake.reason };
    }

    const agentOutput = deterministicDreamConsolidator({
      domain: clean,
      pendingEvents,
      activeMemories,
      expiredMemoryIds: wake.expiredMemoryIds,
    });

    const runId = `drun_local_${Date.now()}`;
    const now = Date.now();
    const createdProposals: DreamProposal[] = [];
    const allProposals = getLocal<DreamProposal[]>(LOCAL_STORAGE_PROPOSALS_KEY, []);

    for (const p of agentOutput.proposals) {
      const proposalId = `dprop_local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const requiresApproval = p.requiresApproval !== false;
      const initialStatus = requiresApproval ? 'pending' : 'auto_applied';

      if (!requiresApproval && p.action === 'create') {
        allMemories.push({
          id: `mem_local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          accountId: 'local',
          domain: clean,
          memoryType: p.memoryType,
          title: p.title,
          content: p.content,
          structuredData: p.structuredData || {},
          confidence: p.confidence,
          status: 'active',
          sourceRefs: p.sourceRefs,
          createdAt: now,
          updatedAt: now,
          lastVerifiedAt: now,
          expiresAt: null,
        });
      }

      const proposal: DreamProposal = {
        id: proposalId,
        dreamRunId: runId,
        accountId: 'local',
        domain: clean,
        action: p.action,
        memoryId: p.memoryId || null,
        memoryType: p.memoryType,
        title: p.title,
        proposedContent: p.content,
        structuredData: p.structuredData || {},
        confidence: p.confidence,
        requiresApproval,
        status: initialStatus,
        rationale: p.rationale,
        sourceRefs: p.sourceRefs,
        createdAt: now,
      };
      allProposals.push(proposal);
      createdProposals.push(proposal);
    }

    // Mark pending events as consolidated
    for (const evt of allEvents) {
      if (evt.domain === clean && !evt.dreamRunId) {
        evt.dreamRunId = runId;
      }
    }

    const run: DreamRun = {
      id: runId,
      accountId: 'local',
      domain: clean,
      triggerReason,
      eventsEvaluatedCount: pendingEvents.length,
      proposalsCount: createdProposals.length,
      autoAppliedCount: createdProposals.filter((p) => p.status === 'auto_applied').length,
      pendingReviewCount: createdProposals.filter((p) => p.status === 'pending').length,
      rejectedCount: 0,
      summary: agentOutput.summary,
      modelId: 'gemini-2.5-flash',
      durationMs: 50,
      createdAt: now,
    };

    const allRuns = getLocal<DreamRun[]>(LOCAL_STORAGE_RUNS_KEY, []);
    allRuns.push(run);

    setLocal(LOCAL_STORAGE_EVENTS_KEY, allEvents);
    setLocal(LOCAL_STORAGE_MEMORIES_KEY, allMemories);
    setLocal(LOCAL_STORAGE_PROPOSALS_KEY, allProposals);
    setLocal(LOCAL_STORAGE_RUNS_KEY, allRuns);

    return { ok: true, woke: true, run, proposals: createdProposals };
  }

  public async getActiveMemories(domain: string): Promise<BusinessMemoryItem[]> {
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
    try {
      const res = await workerFetchWithAuthRetry(
        `${apiBase()}/api/dreaming/memories?domain=${encodeURIComponent(clean)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { memories?: BusinessMemoryItem[] };
        return data.memories || [];
      }
    } catch {
      /* fallback */
    }
    const allMemories = getLocal<BusinessMemoryItem[]>(LOCAL_STORAGE_MEMORIES_KEY, []);
    return allMemories.filter((m) => m.domain === clean && m.status === 'active');
  }

  public async getProposals(domain: string): Promise<DreamProposal[]> {
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
    try {
      const res = await workerFetchWithAuthRetry(
        `${apiBase()}/api/dreaming/proposals?domain=${encodeURIComponent(clean)}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { proposals?: DreamProposal[] };
        return data.proposals || [];
      }
    } catch {
      /* fallback */
    }
    const allProposals = getLocal<DreamProposal[]>(LOCAL_STORAGE_PROPOSALS_KEY, []);
    return allProposals.filter((p) => p.domain === clean);
  }

  public async reviewProposal(
    proposalId: string,
    action: 'approve' | 'reject',
    editedContent?: string,
  ): Promise<{ ok: boolean; proposal?: DreamProposal; error?: string }> {
    try {
      const res = await workerFetchWithAuthRetry(
        `${apiBase()}/api/dreaming/proposals/${encodeURIComponent(proposalId)}/review`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, editedContent }),
        },
      );
      if (res.ok) {
        return (await res.json()) as { ok: boolean; proposal?: DreamProposal };
      }
    } catch {
      /* fallback */
    }

    const allProposals = getLocal<DreamProposal[]>(LOCAL_STORAGE_PROPOSALS_KEY, []);
    const proposal = allProposals.find((p) => p.id === proposalId);
    if (!proposal) return { ok: false, error: 'Proposal not found' };

    const now = Date.now();
    const finalContent = editedContent !== undefined ? editedContent : proposal.proposedContent;
    proposal.status = action === 'approve' ? 'approved' : 'rejected';
    proposal.proposedContent = finalContent;
    proposal.reviewedAt = now;

    if (action === 'approve') {
      const allMemories = getLocal<BusinessMemoryItem[]>(LOCAL_STORAGE_MEMORIES_KEY, []);
      if (proposal.action === 'create') {
        allMemories.push({
          id: `mem_local_${Date.now()}`,
          accountId: proposal.accountId,
          domain: proposal.domain,
          memoryType: proposal.memoryType,
          title: proposal.title,
          content: finalContent,
          structuredData: proposal.structuredData,
          confidence: proposal.confidence,
          status: 'active',
          sourceRefs: proposal.sourceRefs,
          createdAt: now,
          updatedAt: now,
          lastVerifiedAt: now,
          expiresAt: null,
        });
      } else if (proposal.action === 'update' && proposal.memoryId) {
        const mem = allMemories.find((m) => m.id === proposal.memoryId);
        if (mem) {
          mem.title = proposal.title;
          mem.content = finalContent;
          mem.updatedAt = now;
          mem.lastVerifiedAt = now;
        }
      } else if (proposal.action === 'deprecate' && proposal.memoryId) {
        const mem = allMemories.find((m) => m.id === proposal.memoryId);
        if (mem) {
          mem.status = 'archived';
          mem.updatedAt = now;
        }
      }
      setLocal(LOCAL_STORAGE_MEMORIES_KEY, allMemories);
    }

    setLocal(LOCAL_STORAGE_PROPOSALS_KEY, allProposals);
    return { ok: true, proposal };
  }

  public async rollbackRun(
    runId: string,
  ): Promise<{ ok: boolean; revertedCount?: number; error?: string }> {
    try {
      const res = await workerFetchWithAuthRetry(
        `${apiBase()}/api/dreaming/runs/${encodeURIComponent(runId)}/rollback`,
        { method: 'POST' },
      );
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; revertedProposalsCount?: number };
        return { ok: true, revertedCount: data.revertedProposalsCount };
      }
    } catch {
      /* fallback */
    }

    const allRuns = getLocal<DreamRun[]>(LOCAL_STORAGE_RUNS_KEY, []);
    const run = allRuns.find((r) => r.id === runId);
    if (!run) return { ok: false, error: 'Run not found' };

    run.rolledBackAt = Date.now();
    const allProposals = getLocal<DreamProposal[]>(LOCAL_STORAGE_PROPOSALS_KEY, []);
    const relevant = allProposals.filter(
      (p) => p.dreamRunId === runId && (p.status === 'approved' || p.status === 'auto_applied'),
    );

    for (const p of relevant) {
      p.status = 'rolled_back';
    }

    setLocal(LOCAL_STORAGE_RUNS_KEY, allRuns);
    setLocal(LOCAL_STORAGE_PROPOSALS_KEY, allProposals);
    return { ok: true, revertedCount: relevant.length };
  }
}

export const dreamingClient = DreamingClient.getInstance();
