import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { handleOracleChatSse, handleOracleSessionControlRoute } from '../worker/oracleChat';
import { OracleSession } from '../worker/oracleSession';
import { runWithWaitUntil } from '../worker/welcomeEmail';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1 } from './helpers/sqliteD1';

function createMockDoState(): DurableObjectState {
  const store = new Map<string, unknown>();
  return {
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => await fn(),
    storage: {
      get: async <T>(key: string) => store.get(key) as T | undefined,
      put: async (key: string, value: unknown) => {
        store.set(key, value);
      },
      delete: async (key: string) => store.delete(key),
      deleteAll: async () => {
        store.clear();
      },
    },
  } as unknown as DurableObjectState;
}

function createOracleSessionNamespace(): DurableObjectNamespace {
  const instances = new Map<string, OracleSession>();
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) => {
      const key = id.toString();
      let inst = instances.get(key);
      if (!inst) {
        inst = new OracleSession(createMockDoState());
        instances.set(key, inst);
      }
      return {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const req =
            input instanceof Request
              ? input
              : new Request(String(input), init);
          return inst!.fetch(req);
        },
      } as unknown as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;
}

const mockUser: HostedIdentity = { id: 'user_1', accountId: 'acct_1' } as HostedIdentity;

const groqSseStub = () =>
  new Response(
    'data: {"choices":[{"delta":{"content":"Verdict: ready."}}]}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

describe('Wave 3: Oracle SSE & 3-Plane Harness Integration', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => groqSseStub()) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects control-plane tool names submitted via /oracle/chat with 400 CONTROL_PLANE_VIOLATION', async () => {
    const env = {
      ORACLE_SERVER_ENABLED: 'true',
      GROQ_API_KEY: 'gsk_test',
      DB: createSqliteD1(),
    } as unknown as Env;

    const res = await handleOracleChatSse(
      new Request('https://luminarasuite.com/api/oracle/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'approve my tool',
          invokeTool: 'tool_approval',
          confirmTool: true,
        }),
      }),
      env,
      mockUser,
    );

    expect(res.status).toBe(400);
    const data = (await res.json()) as { ok: boolean; code: string };
    expect(data.ok).toBe(false);
    expect(data.code).toBe('CONTROL_PLANE_VIOLATION');
  });

  it('hands the streaming turn to waitUntil so it settles after the client disconnects', async () => {
    const env = {
      ORACLE_SERVER_ENABLED: 'true',
      GROQ_API_KEY: 'gsk_test',
      DB: createSqliteD1(),
      ORACLE_SESSION: createOracleSessionNamespace(),
    } as unknown as Env;
    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { waited.push(p); } };

    // The Worker entry runs every API request inside runWithWaitUntil(ctx, ...).
    const res = await runWithWaitUntil(ctx, () =>
      handleOracleChatSse(
        new Request('https://luminarasuite.com/api/oracle/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: 'sess_wait', message: 'hello' }),
        }),
        env,
        mockUser,
      ),
    );
    expect(res.status).toBe(200);
    // Drop the stream like a closed tab; the turn handed to waitUntil must still settle.
    await res.body?.cancel();
    expect(waited).toHaveLength(1);
    await waited[0];
  });

  it('control route refuses forged events and server-internal actions, and caps body size', async () => {
    const env = {
      ORACLE_SERVER_ENABLED: 'true',
      ORACLE_SESSION: createOracleSessionNamespace(),
    } as unknown as Env;
    const call = (method: string, action: string, body?: string) =>
      handleOracleSessionControlRoute(
        new Request(`https://luminarasuite.com/api/oracle/session/s1/${action}`, { method, body }),
        env,
        mockUser,
        's1',
        action,
      );

    expect((await call('POST', 'events', '{"event":{"type":"tool_end"}}')).status).toBe(404);
    expect((await call('POST', 'admit', '{}')).status).toBe(404);
    expect((await call('POST', 'settle', '{}')).status).toBe(404);
    expect((await call('POST', 'truncate', '{"upToOffset":9}')).status).toBe(404);
    expect((await call('GET', 'events')).status).toBe(200);
    expect((await call('POST', 'state/patch', 'x'.repeat(70 * 1024))).status).toBe(413);
  });

  it('emits tool_approval_requested when invokeTool lacks confirmation, then unlocks via control-plane approval with remember: true', async () => {
    const db = createSqliteD1();
    const doNs = createOracleSessionNamespace();
    const kvMap = new Map<string, string>();
    const env = {
      ORACLE_SERVER_ENABLED: 'true',
      GROQ_API_KEY: 'gsk_test',
      DB: db as unknown as D1Database,
      ORACLE_SESSION: doNs,
      LUMINARA_KV: {
        get: async (k: string, type?: string) => {
          const val = kvMap.get(k);
          if (val === undefined) return null;
          return type === 'json' ? JSON.parse(val) : val;
        },
        put: async (k: string, v: string) => {
          kvMap.set(k, v);
        },
      },
    } as unknown as Env;

    // Seed Agency subscription and project context so APS gate is satisfied
    kvMap.set(
      'sub:acct_1',
      JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86400_000 }),
    );
    kvMap.set('mcp:context_loaded:acct_1:proj_1', '1');

    // Step 1: Request research_keywords WITHOUT confirmTool -> emits tool_approval_requested on SSE and parks gate in DO
    const res1 = await handleOracleChatSse(
      new Request('https://luminarasuite.com/api/oracle/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess_harness',
          projectId: 'proj_1',
          message: 'keywords for enterprise aeo',
          invokeTool: 'research_keywords',
          confirmTool: false,
        }),
      }),
      env,
      mockUser,
    );
    expect(res1.status).toBe(200);
    const sseText1 = await res1.text();
    expect(sseText1).toContain('event: harness_event');
    expect(sseText1).toContain('"type":"tool_approval_requested"');

    // Inspect pending approvals via Control Plane GET /state
    const stateRes = await handleOracleSessionControlRoute(
      new Request('https://luminarasuite.com/api/oracle/session/sess_harness/state', {
        method: 'GET',
      }),
      env,
      mockUser,
      'sess_harness',
      'state',
    );
    const stateJson = (await stateRes.json()) as {
      pendingApprovals: Array<{ toolId: string; toolName: string }>;
    };
    expect(stateJson.pendingApprovals).toHaveLength(1);
    const pendingToolId = stateJson.pendingApprovals[0]!.toolId;

    // Step 2: Approve out-of-band on Control Plane with remember: true
    const approveRes = await handleOracleSessionControlRoute(
      new Request('https://luminarasuite.com/api/oracle/session/sess_harness/approval', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          toolId: pendingToolId,
          approved: true,
          remember: true,
          reason: 'Approved for session',
        }),
      }),
      env,
      mockUser,
      'sess_harness',
      'approval',
    );
    const approveJson = (await approveRes.json()) as {
      ok: boolean;
      rememberedTools: string[];
    };
    expect(approveJson.ok).toBe(true);
    expect(approveJson.rememberedTools).toContain('research_keywords');

    // Step 3: Next turn in same session with confirmTool: false now succeeds automatically via rememberedTools!
    const res2 = await handleOracleChatSse(
      new Request('https://luminarasuite.com/api/oracle/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess_harness',
          projectId: 'proj_1',
          message: 'keywords for geo optimization',
          invokeTool: 'research_keywords',
          confirmTool: false,
          toolArgs: {
            accountId: 'spoofed_attacker',
          },
        }),
      }),
      env,
      mockUser,
    );
    const sseText2 = await res2.text();
    expect(sseText2).toContain('"type":"tool_start"');
    expect(sseText2).toContain('"type":"tool_end"');
    expect(sseText2).toContain('"reason":"remembered_policy"');
    // Ensure spoofed accountId was stripped from modelFacingInput
    expect(sseText2).not.toContain('spoofed_attacker');

    // Step 4: Verify Observability Plane offset replay (?after=0) has the full durable event log
    const eventsRes = await handleOracleSessionControlRoute(
      new Request('https://luminarasuite.com/api/oracle/session/sess_harness/events?after=0', {
        method: 'GET',
      }),
      env,
      mockUser,
      'sess_harness',
      'events',
    );
    const eventsJson = (await eventsRes.json()) as {
      ok: boolean;
      events: Array<{ offset: number; event: { type: string } }>;
    };
    expect(eventsJson.ok).toBe(true);
    const eventTypes = eventsJson.events.map((e) => e.event.type);
    expect(eventTypes).toContain('message_accepted');
    expect(eventTypes).toContain('turn_started');
    expect(eventTypes).toContain('tool_approval_requested');
    expect(eventTypes).toContain('tool_approval_resolved');
    expect(eventTypes).toContain('tool_requested');
    expect(eventTypes).toContain('tool_start');
    expect(eventTypes).toContain('tool_end');
    expect(eventTypes).toContain('turn_end');
  });

  it('rejects concurrent turn with 409 TURN_ACTIVE when admit rejects, and settles turn in finally when provider throws', async () => {
    const db = createSqliteD1();
    const doNs = createOracleSessionNamespace();
    const env = {
      ORACLE_SERVER_ENABLED: 'true',
      GROQ_API_KEY: 'gsk_test',
      DB: db as unknown as D1Database,
      ORACLE_SESSION: doNs,
    } as unknown as Env;

    let releaseFirstLlm!: () => void;
    const firstLlmGate = new Promise<void>((resolve) => {
      releaseFirstLlm = resolve;
    });

    let llmCallCount = 0;
    globalThis.fetch = vi.fn(async () => {
      llmCallCount += 1;
      if (llmCallCount === 1) {
        await firstLlmGate;
        throw new Error('Simulated Groq upstream failure');
      }
      return groqSseStub();
    }) as unknown as typeof fetch;

    // Start Turn 1: admits turn_1 on DO and blocks inside run() awaiting firstLlmGate
    const res1Promise = handleOracleChatSse(
      new Request('https://luminarasuite.com/api/oracle/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess_concurrency',
          message: 'first turn in flight',
        }),
      }),
      env,
      mockUser,
    );
    const res1 = await res1Promise;
    expect(res1.status).toBe(200);

    // Concurrent Turn 2 while Turn 1 is still active -> rejected with 409 TURN_ACTIVE without calling LLM
    const res2 = await handleOracleChatSse(
      new Request('https://luminarasuite.com/api/oracle/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess_concurrency',
          message: 'concurrent second turn',
        }),
      }),
      env,
      mockUser,
    );
    expect(res2.status).toBe(409);
    const err2 = (await res2.json()) as { ok: boolean; code: string; activeTurnId: string };
    expect(err2.ok).toBe(false);
    expect(err2.code).toBe('TURN_ACTIVE');
    expect(err2.activeTurnId).toBe('turn_1');
    expect(llmCallCount).toBe(1);

    // Release Turn 1 so the provider throws; finally block must still settle turn_1
    releaseFirstLlm();
    const sseText1 = await res1.text();
    expect(sseText1).toContain('Simulated Groq upstream failure');

    // Turn 3 after Turn 1 errored: succeeds because finally settled turn_1
    const res3 = await handleOracleChatSse(
      new Request('https://luminarasuite.com/api/oracle/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess_concurrency',
          message: 'third turn after error recovery',
        }),
      }),
      env,
      mockUser,
    );
    expect(res3.status).toBe(200);
    const sseText3 = await res3.text();
    expect(sseText3).toContain('"turnId":"turn_2"');
  });
});

describe('Oracle SSE: a measurement nobody made', () => {
  const WARNING =
    'Not measured: a number in this reply was not checked or measured in this chat. Treat it as unknown until an audit measures it.';
  const NOT_MEASURED = 'I have not checked or measured that in this chat.';
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function makeEnv(kv: Map<string, string> = new Map()) {
    return {
      ORACLE_SERVER_ENABLED: 'true',
      GROQ_API_KEY: 'gsk_test',
      DB: createSqliteD1(),
      ORACLE_SESSION: createOracleSessionNamespace(),
      LUMINARA_KV: {
        get: async (k: string, type?: string) => {
          const val = kv.get(k);
          if (val === undefined) return null;
          return type === 'json' ? JSON.parse(val) : val;
        },
        put: async (k: string, v: string) => {
          kv.set(k, v);
        },
      },
    } as unknown as Env & { DB: ReturnType<typeof createSqliteD1> };
  }

  /** One turn where the model says `reply`. Returns the streamed text and the stored assistant turns. */
  async function turn(env: Env, reply: string, body: Record<string, unknown>) {
    globalThis.fetch = vi.fn(async () =>
      new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    ) as unknown as typeof fetch;
    const sessionId = 'sess_honesty';
    const res = await handleOracleChatSse(
      new Request('https://luminarasuite.com/api/oracle/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, ...body }),
      }),
      env,
      mockUser,
    );
    const sse = await res.text();
    const streamed = [...sse.matchAll(/event: token\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]!).text).join('');
    const history = await handleOracleSessionControlRoute(
      new Request(`https://luminarasuite.com/api/oracle/session/${sessionId}/history`),
      env,
      mockUser,
      sessionId,
      'history',
    );
    const { turns } = (await history.json()) as { turns: Array<{ role: string; content: string }> };
    return { sse, streamed, stored: turns.filter((t) => t.role === 'assistant').map((t) => t.content) };
  }

  it('follows an invented "Your DA of 72" with a warning, and keeps no 72 in the session history', async () => {
    const reply = 'Your DA of 72 means you are strong. Add FAQ schema.';

    const { streamed, stored } = await turn(makeEnv(), reply, { message: 'How strong is my site?' });

    expect(streamed).toBe(`${reply}\n\n${WARNING}`);
    expect(stored).toEqual([`${NOT_MEASURED} Add FAQ schema.`]);
    expect(console.warn).toHaveBeenCalledWith(JSON.stringify({ event: 'oracle_output_redacted', sentences: 1 }));
  });

  it('still filters the reply when a confirmed tool call failed', async () => {
    const kv = new Map([
      ['sub:acct_1', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86400_000 })],
      ['mcp:context_loaded:acct_1:proj_1', '1'],
    ]);
    const reply = 'Your DA of 72 means you are strong.';

    const { sse, streamed, stored } = await turn(makeEnv(kv), reply, {
      projectId: 'proj_1',
      message: 'keywords for enterprise aeo',
      invokeTool: 'research_keywords',
      confirmTool: true,
    });

    expect(sse).toContain('"type":"tool_end"');
    expect(sse).toContain('"measurement_status":"not_measured"');
    expect(streamed).toBe(`${reply}\n\n${WARNING}`);
    expect(stored).toEqual([NOT_MEASURED]);
  });

  it('keeps a figure the user gave, echoed back', async () => {
    const reply = 'A DA of 40 is a solid base. Earn links from sites in your niche.';

    const { streamed, stored } = await turn(makeEnv(), reply, { message: 'my DA is 40, how do I grow it?' });

    expect(streamed).toBe(reply);
    expect(stored).toEqual([reply]);
  });

  it('keeps a benchmark from the account memory', async () => {
    const env = makeEnv();
    await env.DB.prepare('INSERT INTO memory_facts (id, account_id, text, source, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind('mem_ctr', 'acct_1', 'Our brand CTR benchmark is 3%.', 'hosted', Date.now())
      .run();
    const reply = 'Aim for CTR above 3% on brand queries.';

    const { streamed, stored } = await turn(env, reply, { message: 'What CTR benchmark should we aim for?' });

    expect(streamed).toBe(reply);
    expect(stored).toEqual([reply]);
  });
});
