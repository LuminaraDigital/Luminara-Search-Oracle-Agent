import { describe, it, expect, beforeEach } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import {
  enqueueDreamEvent,
  getPendingDreamEvents,
} from '../worker/dreamingQueue';
import {
  executeDreamRun,
  getActiveBusinessMemories,
  reviewDreamProposal,
  rollbackDreamRun,
  handleDreamingRoute,
} from '../worker/dreamingService';
import type { HostedIdentity } from '../worker/userTypes';

describe('Luminara Dreaming Service & D1 Engine', () => {
  let db: any;
  let env: Env;
  const testUser: HostedIdentity = {
    id: 'user_123',
    account_id: 'acct_dream_1',
    provider: 'telegram',
    plan: 'growth',
  };

  beforeEach(() => {
    db = createSqliteD1();
    env = {
      DB: db,
    } as unknown as Env;
  });

  it('enqueues events and enforces 15-minute payload deduplication', async () => {
    const res1 = await enqueueDreamEvent(env, {
      accountId: 'acct_dream_1',
      domain: 'myclinic.com.au',
      eventType: 'audit_completed',
      payload: { healthScore: 82, citationRatePercent: 65 },
    });

    expect(res1.ok).toBe(true);
    if (!res1.ok) return;
    expect(res1.duplicate).toBe(false);
    expect(res1.event.domain).toBe('myclinic.com.au');
    expect(res1.event.signalWeight).toBe(1.0);

    // Immediate duplicate attempt
    const res2 = await enqueueDreamEvent(env, {
      accountId: 'acct_dream_1',
      domain: 'myclinic.com.au',
      eventType: 'audit_completed',
      payload: { healthScore: 82, citationRatePercent: 65 },
    });

    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    expect(res2.duplicate).toBe(true);

    const pending = await getPendingDreamEvents(env, 'acct_dream_1', 'myclinic.com.au');
    expect(pending.length).toBe(1);
  });

  it('executes a Dream run, auto-applies routine updates and queues high-impact changes', async () => {
    // 1. Enqueue high-signal profile change
    await enqueueDreamEvent(env, {
      accountId: 'acct_dream_1',
      domain: 'myclinic.com.au',
      eventType: 'client_profile_changed',
      payload: {
        name: 'Melbourne Sports Physio',
        usp: 'ACL rehabilitation without surgery',
        competitors: ['rivalphysio.com.au'],
      },
    });

    // 2. Enqueue audit event
    await enqueueDreamEvent(env, {
      accountId: 'acct_dream_1',
      domain: 'myclinic.com.au',
      eventType: 'audit_completed',
      payload: { healthScore: 75, topCompetitor: 'rivalphysio.com.au' },
    });

    // 3. Execute Dream Run
    const runRes = await executeDreamRun(
      env,
      'acct_dream_1',
      'myclinic.com.au',
      'manual_user',
      { force: true },
    );

    expect(runRes.ok).toBe(true);
    if (!runRes.ok || !runRes.woke) return;

    expect(runRes.run.eventsEvaluatedCount).toBe(2);
    expect(runRes.proposals.length).toBeGreaterThan(0);
    expect(runRes.proposals.length).toBeLessThanOrEqual(5);

    // Business DNA proposal requires human review
    const dnaProp = runRes.proposals.find((p) => p.memoryType === 'business_dna');
    expect(dnaProp).toBeDefined();
    expect(dnaProp?.requiresApproval).toBe(true);
    expect(dnaProp?.status).toBe('pending');

    // Visibility profile proposal auto-applies
    const visProp = runRes.proposals.find((p) => p.memoryType === 'visibility_profile');
    if (visProp) {
      expect(visProp.requiresApproval).toBe(false);
      expect(visProp.status).toBe('auto_applied');
    }

    // Pending events are now consolidated
    const remainingPending = await getPendingDreamEvents(env, 'acct_dream_1', 'myclinic.com.au');
    expect(remainingPending.length).toBe(0);

    // Auto-applied memories are active
    const activeMemories = await getActiveBusinessMemories(env, 'acct_dream_1', 'myclinic.com.au');
    expect(activeMemories.some((m) => m.memoryType === 'visibility_profile')).toBe(true);
  });

  it('supports human review approval and rejection workflows', async () => {
    // Seed a pending proposal
    await enqueueDreamEvent(env, {
      accountId: 'acct_dream_1',
      domain: 'lawfirm.com',
      eventType: 'client_profile_changed',
      payload: { name: 'Apex Law', usp: 'Corporate Tax Defense' },
    });

    const runRes = await executeDreamRun(env, 'acct_dream_1', 'lawfirm.com', 'manual_user', { force: true });
    expect(runRes.ok && runRes.woke).toBe(true);
    if (!runRes.ok || !runRes.woke) return;

    const pendingProp = runRes.proposals.find((p) => p.status === 'pending');
    expect(pendingProp).toBeDefined();
    if (!pendingProp) return;

    // Approve the proposal with edited content
    const reviewRes = await reviewDreamProposal(
      env,
      'acct_dream_1',
      pendingProp.id,
      'approve',
      'lawyer_admin',
      'Approved: Apex Law - Premier Corporate Tax Defense',
    );

    expect(reviewRes.ok).toBe(true);
    if (!reviewRes.ok) return;
    expect(reviewRes.proposal.status).toBe('approved');
    expect(reviewRes.proposal.proposedContent).toContain('Apex Law - Premier');

    // Verify it is now in active business memories
    const memories = await getActiveBusinessMemories(env, 'acct_dream_1', 'lawfirm.com');
    const matched = memories.find((m) => m.title === pendingProp.title);
    expect(matched).toBeDefined();
    expect(matched?.content).toContain('Apex Law - Premier');
  });

  it('performs atomic rollbacks, reverting mutations to their prior snapshot state', async () => {
    // 1. Create an initial memory
    await db.prepare(
      `INSERT INTO business_memories (
        id, account_id, project_id, domain, memory_type, title, content,
        structured_data_json, confidence, status, source_refs_json,
        created_at, updated_at, last_verified_at, expires_at
      ) VALUES ('mem_initial', 'acct_dream_1', NULL, 'saas.io', 'business_dna', 'Original Title', 'Original Content', '{}', 1.0, 'active', '[]', 1000, 1000, 1000, NULL)`,
    ).run();

    // 2. Queue an update event
    await enqueueDreamEvent(env, {
      accountId: 'acct_dream_1',
      domain: 'saas.io',
      eventType: 'client_profile_changed',
      payload: { name: 'Mutated Title', usp: 'Mutated Content' },
    });

    // 3. Run dream consolidation
    const runRes = await executeDreamRun(env, 'acct_dream_1', 'saas.io', 'manual_user', { force: true });
    expect(runRes.ok && runRes.woke).toBe(true);
    if (!runRes.ok || !runRes.woke) return;

    const prop = runRes.proposals[0];
    // Approve it to mutate the record
    await reviewDreamProposal(env, 'acct_dream_1', prop.id, 'approve', 'user_1');

    // Verify it was mutated
    let mems = await getActiveBusinessMemories(env, 'acct_dream_1', 'saas.io');
    expect(mems[0].title).not.toBe('Original Title');

    // 4. Rollback the run
    const rollbackRes = await rollbackDreamRun(env, 'acct_dream_1', runRes.run.id);
    expect(rollbackRes.ok).toBe(true);

    // Verify original content is restored
    mems = await getActiveBusinessMemories(env, 'acct_dream_1', 'saas.io');
    expect(mems[0].title).toBe('Original Title');
    expect(mems[0].content).toBe('Original Content');
  });

  it('exposes HTTP REST API endpoints via handleDreamingRoute', async () => {
    // 1. GET /api/dreaming/status
    const statusReq = new Request('https://api.luminara.ai/dreaming/status?domain=store.com', {
      method: 'GET',
    });
    const statusRes = await handleDreamingRoute(statusReq, env, testUser, '/dreaming/status');
    expect(statusRes?.status).toBe(200);
    const statusData = await statusRes?.json();
    expect(statusData.ok).toBe(true);
    expect(statusData.domain).toBe('store.com');

    // 2. POST /api/dreaming/events
    const eventReq = new Request('https://api.luminara.ai/dreaming/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        domain: 'store.com',
        eventType: 'feedback_received',
        payload: { note: 'Client prefers concise briefs' },
      }),
    });
    const eventRes = await handleDreamingRoute(eventReq, env, testUser, '/dreaming/events');
    expect(eventRes?.status).toBe(201);

    // 3. POST /api/dreaming/run
    const runReq = new Request('https://api.luminara.ai/dreaming/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'store.com', force: true }),
    });
    const runRes = await handleDreamingRoute(runReq, env, testUser, '/dreaming/run');
    expect(runRes?.status).toBe(200);
    const runData = await runRes?.json();
    expect(runData.ok).toBe(true);
    expect(runData.woke).toBe(true);
  });
});
