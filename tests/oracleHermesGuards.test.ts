import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DUPLICATE_RESULT_STUB_MIN_CHARS,
  ToolLoopGuardrail,
} from '../services/oracle/toolLoopGuardrails';
import { EmptyResponseGuard } from '../services/oracle/emptyResponseGuard';
import { VerificationLedger } from '../services/oracle/verificationLedger';
import type { DurableObjectNamespace } from '@cloudflare/workers-types';
import {
  SNAPSHOT_TTL_MS,
  resolveSessionMemorySnapshot,
  type SessionStateStub,
} from '../worker/oracleMemorySnapshot';
import { OracleSession } from '../worker/oracleSession';
import {
  guardOracleToolExecution,
  streamGroqChatWithEmptyGuard,
} from '../worker/oracleHermesTurn';
import { handleOracleSessionControlRoute } from '../worker/oracleChat';
import { GroundedCitationLedger } from '../services/audit/groundedCitations';
import { runAllValidators } from '../worker/agentOutputValidators';
import { withoutUnmeasuredClaims } from '../worker/chatHonesty';
import { BrowserActionLoop } from '../services/browserAction/loop';
import type { ObservePayload } from '../services/browserAction/types';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';

function makeSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`),
        );
      }
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        ),
      );
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function makeInMemorySessionStub(): SessionStateStub {
  const buckets = new Map<string, { version: number; doc: unknown }>();
  return {
    async fetch(input: string, init?: RequestInit): Promise<Response> {
      const url = new URL(input);
      if (url.pathname.endsWith('/state') && (!init?.method || init.method === 'GET')) {
        const key = url.searchParams.get('key') || 'default';
        const hit = buckets.get(key) ?? { version: 0, doc: null };
        return Response.json({ ok: true, key, ...hit });
      }
      if (url.pathname.endsWith('/state/patch') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body || '{}')) as { key: string; snapshot: unknown };
        const prev = buckets.get(body.key)?.version ?? 0;
        buckets.set(body.key, { version: prev + 1, doc: body.snapshot });
        return Response.json({ ok: true, key: body.key, version: prev + 1, doc: body.snapshot });
      }
      return new Response('Not found', { status: 404 });
    },
  };
}

describe('Phase 4: Tool Loop Guardrails, Empty Response Guard, Frozen Memory & Verification Ledger', () => {
  it('contains zero em dashes (U+2014) across all Phase 4 modules', () => {
    for (const rel of [
      'services/oracle/toolLoopGuardrails.ts',
      'services/oracle/emptyResponseGuard.ts',
      'services/oracle/verificationLedger.ts',
      'worker/oracleMemorySnapshot.ts',
      'worker/oracleHermesTurn.ts',
    ]) {
      const text = readFileSync(resolve(process.cwd(), rel), 'utf8');
      expect(text, `${rel} must not contain U+2014`).not.toContain('\u2014');
    }
  });

  it('detects 3x identical triplets, stubs >= 512-char duplicates, catches A-B-A-B cycles, and exempts pollers', () => {
    const guard = new ToolLoopGuardrail();

    // Poller calls never stall even when repeated 4 times.
    for (let i = 0; i < 4; i++) {
      const poll = guard.observeCall({
        toolName: 'dream_status',
        args: { domain: 'acme.com' },
        resultText: 'Idle',
      });
      expect(poll.stalled).toBe(false);
    }

    // Canonical key ordering: {b:2,a:1} matches {a:1,b:2} and stubs >= 512-char duplicate output.
    const bigPayload = 'K'.repeat(DUPLICATE_RESULT_STUB_MIN_CHARS + 40);
    const firstBig = guard.observeCall({
      toolName: 'research_keywords',
      args: { b: 2, a: 1 },
      resultText: bigPayload,
    });
    expect(firstBig.anomaly).toBeNull();

    const secondBig = guard.observeCall({
      toolName: 'research_keywords',
      args: { a: 1, b: 2 },
      resultText: bigPayload,
    });
    expect(secondBig.anomaly).toBe('duplicate_large_output');
    expect(secondBig.effectiveOutput).toContain('[Duplicate tool output omitted');
    expect(secondBig.stalled).toBe(false);

    const thirdBig = guard.observeCall({
      toolName: 'research_keywords',
      args: { a: 1, b: 2 },
      resultText: bigPayload,
    });
    expect(thirdBig.stalled).toBe(true);
    expect(thirdBig.anomaly).toBe('identical_triplet');
    expect(thirdBig.effectiveOutput).toContain('[Loop guard:');

    // Period-2 A -> B -> A -> B cycle detection.
    const cycleGuard = new ToolLoopGuardrail();
    expect(cycleGuard.observeCall({ toolName: 'open_tab', args: { id: 'a' }, resultText: 'fp_a' }).stalled).toBe(false);
    expect(cycleGuard.observeCall({ toolName: 'open_tab', args: { id: 'b' }, resultText: 'fp_b' }).stalled).toBe(false);
    expect(cycleGuard.observeCall({ toolName: 'open_tab', args: { id: 'a' }, resultText: 'fp_a' }).stalled).toBe(false);
    const fourth = cycleGuard.observeCall({ toolName: 'open_tab', args: { id: 'b' }, resultText: 'fp_b' });
    expect(fourth.stalled).toBe(true);
    expect(fourth.anomaly).toBe('periodic_cycle');
    expect(fourth.period).toBe(2);
  });

  it('halts BrowserActionLoop on A -> B -> A -> B modal oscillation when enableLoopGuardrails=true', async () => {
    const pageA: ObservePayload = {
      url: 'https://acme.com/pricing',
      title: 'Pricing A',
      fingerprint: 'fp_modal_a',
      visibleText: 'Open FAQ',
      actions: [
        { id: 'A1', kind: 'click', label: 'Open FAQ', role: 'button' },
        { id: 'A2', kind: 'click', label: 'Close FAQ', role: 'button' },
      ],
    };
    const pageB: ObservePayload = {
      ...pageA,
      title: 'Pricing B',
      fingerprint: 'fp_modal_b',
    };

    let idx = 0;
    const choices = ['A1', 'A2', 'A1', 'A2'] as const;
    const loop = new BrowserActionLoop({
      goal: 'Verify enterprise plan',
      initialPage: pageA,
      enableLoopGuardrails: true,
      observe: async () => pageA,
      executeAct: async ({ actionId }) => (actionId === 'A1' ? pageB : pageA),
      chooseFn: async () => {
        const choice = choices[idx++] ?? 'DONE';
        return {
          choice,
          operation: 'CLICK',
          target: choice,
          confidence: 0.9,
          probabilities: { [choice]: 0.9 },
          operation_probabilities: { CLICK: 0.9 },
        };
      },
    });

    await loop.tick(); // A1 -> fp_modal_b (page_changed: true)
    await loop.tick(); // A2 -> fp_modal_a (page_changed: true)
    await loop.tick(); // A1 -> fp_modal_b (page_changed: true)
    const fourth = await loop.tick(); // A2 -> fp_modal_a -> periodic_cycle blocks loop!
    expect(fourth.status).toBe('blocked');
  });

  it('enforces cost-aware EmptyResponseGuard budgets and retries empty Groq stream when ORACLE_LOOP_GUARDS_ENABLED=true', async () => {
    // 1. Reasoning-only tokens fail open (not treated as zero-output empty).
    const g1 = new EmptyResponseGuard();
    expect(
      g1.evaluate({
        provider: 'groq',
        model: 'gpt-oss-120b',
        finishReason: 'length',
        content: '',
        reasoningTokens: 250,
      }).isZeroOutputEmpty,
    ).toBe(false);

    // 2. Two consecutive empties on identical (provider, model, finishReason) trigger immediate fallback.
    const g2 = new EmptyResponseGuard();
    const first = g2.evaluate({ provider: 'groq', model: 'm1', finishReason: 'stop', content: '' });
    expect(first.shouldRetry).toBe(true);
    expect(first.shouldFallbackImmediately).toBe(false);
    const second = g2.evaluate({ provider: 'groq', model: 'm1', finishReason: 'stop', content: '' });
    expect(second.shouldRetry).toBe(false);
    expect(second.shouldFallbackImmediately).toBe(true);
    expect(second.reason).toBe('consecutive_tuple_fallback');

    // 3. >= $0.25 single attempt drops retry budget 3 -> 1.
    const g3 = new EmptyResponseGuard({ maxRetries: 3 });
    const expensive1 = g3.evaluate({
      provider: 'openrouter',
      model: 'claude-opus',
      finishReason: 'stop',
      content: '',
      estimatedCostUsd: 0.31,
    });
    expect(expensive1.costCapped).toBe(true);
    expect(expensive1.effectiveMaxRetries).toBe(1);
    expect(expensive1.shouldRetry).toBe(true);

    const expensive2 = g3.evaluate({
      provider: 'openrouter',
      model: 'claude-sonnet',
      finishReason: 'length',
      content: '',
      estimatedCostUsd: 0.05,
    });
    expect(expensive2.shouldRetry).toBe(false);
    expect(expensive2.reason).toBe('retry_budget_exhausted');

    // 4. streamGroqChatWithEmptyGuard switches to fallback key on empty stream when enabled.
    const seenAuth: string[] = [];
    const mockFetcher: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      seenAuth.push(headers.get('Authorization') || '');
      return seenAuth.length === 1 ? makeSseResponse([]) : makeSseResponse(['Recovered ', 'answer.']);
    };

    const deltas: string[] = [];
    const res = await streamGroqChatWithEmptyGuard({
      env: {
        GROQ_API_KEY: 'gsk_primary',
        GROQ_API_KEY_FALLBACK: 'gsk_backup',
        ORACLE_LOOP_GUARDS_ENABLED: 'true',
      } as Env,
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'Audit acme.com' }],
      onDelta: async (d) => {
        deltas.push(d);
      },
      fetcher: mockFetcher,
    });
    expect(res).toEqual({ ok: true, fullText: 'Recovered answer.', retriedEmpty: true });
    expect(deltas.join('')).toBe('Recovered answer.');
    expect(seenAuth).toEqual(['Bearer gsk_primary', 'Bearer gsk_backup']);
  });

  it('freezes both memory block and facts across OracleSession turns so withoutUnmeasuredClaims preserves user numbers', async () => {
    const sessionStub = makeInMemorySessionStub();
    const env = { ORACLE_LOOP_GUARDS_ENABLED: 'true' } as Env;
    let liveCallCount = 0;

    const turn1 = await resolveSessionMemorySnapshot({
      env,
      sessionStub,
      accountId: 'acct_mem_1',
      message: 'How is our conversion baseline?',
      loadLiveMemory: async () => {
        liveCallCount += 1;
        return {
          block: '## Workspace Memory\n- Baseline conversion rate is 4.7%.',
          facts: ['Baseline conversion rate is 4.7%.'],
        };
      },
    });
    expect(turn1.fromSnapshot).toBe(false);
    expect(liveCallCount).toBe(1);

    // Mid-session memory mutates, but turn 2 keeps the frozen prefix AND frozen facts[].
    const turn2 = await resolveSessionMemorySnapshot({
      env,
      sessionStub,
      accountId: 'acct_mem_1',
      message: 'What next?',
      loadLiveMemory: async () => {
        liveCallCount += 1;
        return {
          block: '## Workspace Memory\n- Mutated mid-session prompt.',
          facts: [],
        };
      },
    });
    expect(turn2.fromSnapshot).toBe(true);
    expect(liveCallCount).toBe(1);
    expect(turn2.block).toBe(turn1.block);
    expect(turn2.facts).toEqual(['Baseline conversion rate is 4.7%.']);

    // Verify withoutUnmeasuredClaims honors the frozen facts[] on turn 2 without redacting 4.7%.
    const honest = withoutUnmeasuredClaims(
      'Your baseline conversion rate is 4.7% as stored in workspace memory.',
      turn2.facts,
      [],
    );
    expect(honest.replaced).toBe(0);
  });

  it('flags unqualified live completion claims in VerificationLedger unless measured evidence exists', () => {
    const emptyLedger = new VerificationLedger();
    const bad = emptyLedger.evaluateResponse(
      'The JSON-LD schema is now valid and the fix is live on your homepage.',
    );
    expect(bad.ok).toBe(false);
    expect(bad.unverifiedCompletionClaims).toHaveLength(1);
    expect(bad.nudgeNote).toContain('not_measured');

    // Conditional / hedged guidance passes cleanly even with 0 measured tools.
    const hedged = emptyLedger.evaluateResponse(
      'Once you deploy the template, check whether the fix is live using browse_observe.',
    );
    expect(hedged.ok).toBe(true);

    // Recording a measured tool observation clears the completion check.
    const measuredLedger = new VerificationLedger();
    measuredLedger.recordToolObservation({
      toolName: 'get_serp_results',
      measurementStatus: 'measured',
    });
    const verified = measuredLedger.evaluateResponse('The fix is live and verified live in SERP.');
    expect(verified.ok).toBe(true);
  });

  it('blocks client writes to reserved session keys (memory_snapshot, tool_guard_history) on state/patch and tracks reasoning tokens + grounded URLs', async () => {
    const stub = makeInMemorySessionStub();
    const doNamespace = {
      idFromName: (name: string) => name,
      get: () => stub,
    } as unknown as DurableObjectNamespace;
    const env: Env = {
      ORACLE_SERVER_ENABLED: 'true',
      ORACLE_SESSION: doNamespace,
      ORACLE_LOOP_GUARDS_ENABLED: 'true',
    };
    const user: HostedIdentity = {
      id: 'usr_sec_1',
      accountId: 'acct_sec_1',
      email: 'sec@example.com',
      plan: 'agency',
    };

    for (const reservedKey of ['memory_snapshot', 'tool_guard_history']) {
      const blockedRes = await handleOracleSessionControlRoute(
        new Request(`https://luminarasuite.com/api/oracle/session/sess_1/state/patch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: reservedKey, snapshot: { poisoned: true } }),
        }),
        env,
        user,
        'sess_1',
        'state/patch',
      );
      expect(blockedRes.status).toBe(403);
      expect(((await blockedRes.json()) as { code: string }).code).toBe('RESERVED_STATE_KEY');
    }

    const allowedRes = await handleOracleSessionControlRoute(
      new Request(`https://luminarasuite.com/api/oracle/session/sess_1/state/patch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'ui_draft', snapshot: { step: 2 } }),
      }),
      env,
      user,
      'sess_1',
      'state/patch',
    );
    expect(allowedRes.status).toBe(200);

    // Reasoning-only SSE stream with zero visible content retries once on fallback (max_tokens=4096) and returns 502 rather than emitting a blank assistant bubble; non-retryable content_filter fails immediately without retry.
    let reasoningFetches = 0;
    const reasoningEncoder = new TextEncoder();
    const reasoningFetcher: typeof fetch = async () => {
      reasoningFetches += 1;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            reasoningEncoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'Thinking deeply about schema...' } }] })}\n\n` +
                `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })}\n\ndata: [DONE]\n\n`,
            ),
          );
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };

    const reasoningOut = await streamGroqChatWithEmptyGuard({
      env: {
        GROQ_API_KEY: 'gsk_primary',
        GROQ_API_KEY_FALLBACK: 'gsk_backup',
        ORACLE_LOOP_GUARDS_ENABLED: 'true',
      } as Env,
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'Think' }],
      onDelta: async () => {},
      fetcher: reasoningFetcher,
    });
    expect(reasoningOut).toMatchObject({ ok: false, status: 502 });
    expect(reasoningFetches).toBe(2);

    let filterFetches = 0;
    const filteredOut = await streamGroqChatWithEmptyGuard({
      env: {
        GROQ_API_KEY: 'gsk_primary',
        GROQ_API_KEY_FALLBACK: 'gsk_backup',
        ORACLE_LOOP_GUARDS_ENABLED: 'true',
      } as Env,
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'Filtered' }],
      onDelta: async () => {},
      fetcher: async () => {
        filterFetches += 1;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(
                reasoningEncoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'content_filter' }] })}\n\ndata: [DONE]\n\n`,
                ),
              );
              c.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    expect(filteredOut).toMatchObject({ ok: false, status: 502 });
    expect(filterFetches).toBe(1);

    // Attempt 0 leading whitespace is buffered until non-whitespace arrives so reasoning-exhausted retries never emit stray newlines.
    const wsRetryDeltas: string[] = [];
    let wsAttempts = 0;
    const wsOut = await streamGroqChatWithEmptyGuard({
      env: {
        GROQ_API_KEY: 'gsk_primary',
        GROQ_API_KEY_FALLBACK: 'gsk_backup',
        ORACLE_LOOP_GUARDS_ENABLED: 'true',
      } as Env,
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'Summarize' }],
      onDelta: async (d) => {
        wsRetryDeltas.push(d);
      },
      fetcher: async () => {
        wsAttempts += 1;
        const payload =
          wsAttempts === 1
            ? `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'thinking', content: '\n\n' }, finish_reason: 'length' }] })}\n\ndata: [DONE]\n\n`
            : `data: ${JSON.stringify({ choices: [{ delta: { content: 'Clean answer.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(reasoningEncoder.encode(payload));
              c.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    expect(wsOut).toEqual({ ok: true, fullText: 'Clean answer.', retriedEmpty: true });
    expect(wsRetryDeltas.join('')).toBe('Clean answer.');

    // GroundedCitationLedger captures tool output URLs and flags hallucinated [99] markers.
    const groundedLedger = new GroundedCitationLedger();
    await guardOracleToolExecution({
      env,
      accountId: 'acct_sec_1',
      sessionId: 'sess_1',
      sessionStub: stub,
      toolName: 'research_keywords',
      args: { seeds: ['crm'] },
      rawToolText: 'Top SERP URL: https://acme.com/pricing ranks #2 for crm software.',
      measurementStatus: 'measured',
      verificationLedger: new VerificationLedger(),
      groundedLedger,
    });
    expect(groundedLedger.list()).toHaveLength(1);
    const badGrounded = runAllValidators(
      'According to SERP data, https://acme.com/pricing ranks well [99].',
      { groundedLedger },
    );
    expect(badGrounded.ok).toBe(false);
    expect(badGrounded.findings.some((f) => f.validator === 'groundedCitationsHonesty')).toBe(true);
  });

  it('skips empty memory snapshots, expires stale snapshots after TTL, isolates internal DO state keys, and catches hardened edge cases', async () => {
    const stub = makeInMemorySessionStub();
    const env = { ORACLE_LOOP_GUARDS_ENABLED: 'true' } as Env;
    let calls = 0;

    // Empty turn 1 block must NOT freeze an empty snapshot over later populated memories.
    const emptyTurn = await resolveSessionMemorySnapshot({
      env,
      sessionStub: stub,
      accountId: 'acct_ttl',
      message: 'First message',
      now: 1_000,
      loadLiveMemory: async () => {
        calls += 1;
        return { block: '   ', facts: [] };
      },
    });
    expect(emptyTurn.fromSnapshot).toBe(false);

    const populatedTurn = await resolveSessionMemorySnapshot({
      env,
      sessionStub: stub,
      accountId: 'acct_ttl',
      message: 'Second message',
      now: 2_000,
      loadLiveMemory: async () => {
        calls += 1;
        return { block: '## Memory\n- Target CPA is $45.', facts: ['Target CPA is $45.'] };
      },
    });
    expect(populatedTurn.fromSnapshot).toBe(false);
    expect(calls).toBe(2);

    const cachedTurn = await resolveSessionMemorySnapshot({
      env,
      sessionStub: stub,
      accountId: 'acct_ttl',
      message: 'Third message',
      now: 2_000 + SNAPSHOT_TTL_MS - 1_000,
      loadLiveMemory: async () => {
        calls += 1;
        return { block: '## Memory\n- New CPA', facts: [] };
      },
    });
    expect(cachedTurn.fromSnapshot).toBe(true);
    expect(calls).toBe(2);

    // After SNAPSHOT_TTL_MS, live memory refreshes cleanly.
    const refreshedTurn = await resolveSessionMemorySnapshot({
      env,
      sessionStub: stub,
      accountId: 'acct_ttl',
      message: 'Fourth message',
      now: 2_000 + SNAPSHOT_TTL_MS + 1_000,
      loadLiveMemory: async () => {
        calls += 1;
        return { block: '## Memory\n- Refreshed CPA is $40.', facts: ['Refreshed CPA is $40.'] };
    },
    });
    expect(refreshedTurn.fromSnapshot).toBe(false);
    expect(refreshedTurn.block).toContain('$40');
    expect(calls).toBe(3);

    // VerificationLedger catches temporal prepositions ("After ..., the fix is live") and "has been fixed".
    const vLedger = new VerificationLedger();
    expect(vLedger.evaluateResponse('After our update, the fix is live on your homepage.').ok).toBe(false);
    expect(vLedger.evaluateResponse('The canonical redirect loop has been fixed in production.').ok).toBe(false);

    // Cross-turn guardOracleToolExecution preserves rawToolText on 2nd call, preserves balanced URL parens, and warns on 3rd.
    const crossStub = makeInMemorySessionStub();
    const bigWikiOut = `${'S'.repeat(600)} Reference: https://en.wikipedia.org/wiki/SEO_(marketing) and (https://acme.com/guide).`;
    const gLedger = new GroundedCitationLedger();
    const t2 = await guardOracleToolExecution({
      env,
      accountId: 'acct_x',
      sessionId: 'sess_x',
      sessionStub: crossStub,
      toolName: 'research_keywords',
      args: { seeds: ['seo'] },
      rawToolText: bigWikiOut,
      measurementStatus: 'measured',
      verificationLedger: new VerificationLedger(),
      groundedLedger: gLedger,
    });
    expect(t2.effectiveToolText).toContain('https://en.wikipedia.org/wiki/SEO_(marketing)');
    expect(gLedger.list().map((s) => s.url)).toContain('https://en.wikipedia.org/wiki/SEO_(marketing)');

    const secondTurnSameTool = await guardOracleToolExecution({
      env,
      accountId: 'acct_x',
      sessionId: 'sess_x',
      sessionStub: crossStub,
      toolName: 'research_keywords',
      args: { seeds: ['seo'] },
      rawToolText: bigWikiOut,
      measurementStatus: 'measured',
      verificationLedger: new VerificationLedger(),
    });
    expect(secondTurnSameTool.effectiveToolText).toContain('Reference: https://en.wikipedia.org/wiki/SEO_(marketing)');
    expect(secondTurnSameTool.stalled).toBe(false);

    const thirdTurnSameTool = await guardOracleToolExecution({
      env,
      accountId: 'acct_x',
      sessionId: 'sess_x',
      sessionStub: crossStub,
      toolName: 'research_keywords',
      args: { seeds: ['seo'] },
      rawToolText: bigWikiOut,
      measurementStatus: 'measured',
      verificationLedger: new VerificationLedger(),
    });
    expect(thirdTurnSameTool.stalled).toBe(true);
    expect(thirdTurnSameTool.effectiveToolText).toContain('[Loop guard:');

    // streamGroqChatWithEmptyGuard switches openai/gpt-oss-120b -> openai/gpt-oss-20b via groqModelCandidates and returns 502 if both are empty.
    const seenCalls: Array<{ model: string; maxTokens: number }> = [];
    const bothEmptyRes = await streamGroqChatWithEmptyGuard({
      env: {
        GROQ_API_KEY: 'gsk_primary',
        GROQ_API_KEY_FALLBACK: 'gsk_backup',
        ORACLE_LOOP_GUARDS_ENABLED: 'true',
      } as Env,
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'Hello' }],
      onDelta: async () => {},
      fetcher: async (_input, init) => {
        const parsed = JSON.parse(String(init?.body || '{}')) as { model?: string; max_tokens?: number };
        seenCalls.push({ model: parsed.model || '', maxTokens: parsed.max_tokens || 0 });
        return makeSseResponse([]);
      },
    });
    expect(seenCalls).toEqual([
      { model: 'openai/gpt-oss-120b', maxTokens: 2048 },
      { model: 'openai/gpt-oss-20b', maxTokens: 4096 },
    ]);
    expect(bothEmptyRes).toMatchObject({ ok: false, status: 502 });

    // Reasoning-exhausted primary stream (finish_reason='length', reasoning_tokens>0, content='') retries on fallback model with max_tokens=4096 instead of emitting a blank assistant reply.
    const encoder = new TextEncoder();
    const reasoningOnlySse = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  choices: [{ delta: { reasoning: 'Thinking deeply...' }, finish_reason: 'length' }],
                  usage: { completion_tokens: 2048, completion_tokens_details: { reasoning_tokens: 2048 } },
                })}\n\ndata: [DONE]\n\n`,
              ),
            );
            c.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );

    let rAttempt = 0;
    const reasoningRecovered = await streamGroqChatWithEmptyGuard({
      env: {
        GROQ_API_KEY: 'gsk_primary',
        GROQ_API_KEY_FALLBACK: 'gsk_backup',
        ORACLE_LOOP_GUARDS_ENABLED: 'true',
      } as Env,
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'Complex multi-page schema plan' }],
      onDelta: async () => {},
      fetcher: async () => {
        rAttempt += 1;
        return rAttempt === 1 ? reasoningOnlySse() : makeSseResponse(['Actionable schema plan.']);
      },
    });
    expect(reasoningRecovered).toEqual({
      ok: true,
      fullText: 'Actionable schema plan.',
      retriedEmpty: true,
    });

    // Real OracleSession DO isolates internal keys from 32-bucket exhaustion, unfiltered GET /state, and Plane-1 events.
    const storageMap = new Map<string, unknown>();
    const doInstance = new OracleSession({
      blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
      storage: {
        get: async <T>(k: string) => storageMap.get(k) as T | undefined,
        put: async (k: string, v: unknown) => {
          storageMap.set(k, v);
        },
      },
    } as unknown as DurableObjectState);

    for (let i = 0; i < 32; i++) {
      const r = await doInstance.fetch(
        new Request('https://oracle-session/state/patch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: `client_${i}`, snapshot: { i } }),
        }),
      );
      expect(r.status).toBe(200);
    }
    const internalWriteRes = await doInstance.fetch(
      new Request('https://oracle-session/state/patch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'memory_snapshot',
          snapshot: { block: 'secret-rag', facts: [], frozenAt: 1_000 },
        }),
      }),
    );
    expect(internalWriteRes.status).toBe(200);

    const stateDump = (await (
      await doInstance.fetch(new Request('https://oracle-session/state'))
    ).json()) as { states: Record<string, unknown> };
    expect(stateDump.states.memory_snapshot).toBeUndefined();
  });
});
