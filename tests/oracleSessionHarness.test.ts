import { describe, expect, it } from 'vitest';
import { OracleSession } from '../worker/oracleSession';
import { PermissionBroker } from '../services/agentCore/permissionBroker';
import { TurnWatchdog } from '../services/agentCore/turnWatchdog';

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

describe('Wave 2: 3-Plane Durable Session & Permission Broker', () => {
  describe('PermissionBroker (ToolApprovalPolicy + remember cascade)', () => {
    it('pauses TurnWatchdog on paid tool and cascades approval when remember: true', () => {
      let stalled = false;
      const watchdog = new TurnWatchdog({
        stallMs: 1000,
        checkMs: 500,
        onStall: () => {
          stalled = true;
        },
      });
      watchdog.watch('thread_1', 'oracle');
      const broker = new PermissionBroker({ watchdog });

      // Free tool is auto-approved
      const freeRes = broker.requestPermission('thread_1', 'oracle', 'whoami', '{}');
      expect(freeRes.granted).toBe(true);

      // Two parallel calls to research_keywords enter pending and pause watchdog
      const p1 = broker.requestPermission('thread_1', 'oracle', 'research_keywords', '{"seeds":["a"]}');
      const p2 = broker.requestPermission('thread_1', 'oracle', 'research_keywords', '{"seeds":["b"]}');
      expect(p1.granted).toBe(false);
      expect(p2.granted).toBe(false);
      expect(watchdog.getTurn('thread_1')?.waitingOnHuman).toBe(true);

      // Resolving p1 with remember: true cascades approval to p2 and resumes watchdog
      const resolved = broker.resolveRequest(p1.requestId!, 'allowed-once', { remember: true });
      expect(resolved).toBe(true);
      expect(broker.isToolRemembered('research_keywords')).toBe(true);
      expect(broker.listPendingForThread('thread_1')).toHaveLength(0);
      expect(watchdog.getTurn('thread_1')?.waitingOnHuman).toBe(false);
      expect(stalled).toBe(false);

      // Subsequent call to research_keywords is immediately granted via remembered policy
      const p3 = broker.requestPermission('thread_1', 'oracle', 'research_keywords', '{"seeds":["c"]}');
      expect(p3.granted).toBe(true);
      expect(p3.remembered).toBe(true);
    });
  });

  describe('OracleSession Durable Object (3 Planes)', () => {
    it('preserves backward-compatible /append and /history', async () => {
      const doInstance = new OracleSession(createMockDoState());
      await doInstance.fetch(
        new Request('https://oracle-session/append', {
          method: 'POST',
          body: JSON.stringify({ role: 'user', content: 'hello' }),
        }),
      );
      const res = await doInstance.fetch(new Request('https://oracle-session/history'));
      const data = (await res.json()) as { turns: Array<{ role: string; content: string }> };
      expect(data.turns).toHaveLength(1);
      expect(data.turns[0]?.content).toBe('hello');
    });

    it('Plane 1 (Interface): two-phase turn admission supports start, enqueue, reject, and settle', async () => {
      const doInstance = new OracleSession(createMockDoState());

      // First message starts turn_1
      const r1 = await doInstance.fetch(
        new Request('https://oracle-session/admit', {
          method: 'POST',
          body: JSON.stringify({ messageId: 'm1', content: 'first' }),
        }),
      );
      const d1 = (await r1.json()) as { disposition: string; turnId: string; turnNumber: number };
      expect(d1.disposition).toBe('started');
      expect(d1.turnId).toBe('turn_1');
      expect(d1.turnNumber).toBe(1);

      // Second message while busy with midTurn: reject returns 409
      const rReject = await doInstance.fetch(
        new Request('https://oracle-session/admit', {
          method: 'POST',
          body: JSON.stringify({ messageId: 'm2', content: 'interrupt', midTurn: 'reject' }),
        }),
      );
      expect(rReject.status).toBe(409);

      // Third message with default midTurn: enqueue queues turn_2
      const rEnqueue = await doInstance.fetch(
        new Request('https://oracle-session/admit', {
          method: 'POST',
          body: JSON.stringify({ messageId: 'm3', content: 'queued' }),
        }),
      );
      const dEnqueue = (await rEnqueue.json()) as { disposition: string; turnId: string };
      expect(dEnqueue.disposition).toBe('enqueued');
      expect(dEnqueue.turnId).toBe('turn_2');

      // Settling turn_1 automatically pops turn_2 and starts it
      const rSettle = await doInstance.fetch(
        new Request('https://oracle-session/settle', {
          method: 'POST',
          body: JSON.stringify({ turnId: 'turn_1' }),
        }),
      );
      const dSettle = (await rSettle.json()) as {
        activeTurnId: string;
        nextQueued: { messageId: string };
      };
      expect(dSettle.activeTurnId).toBe('turn_2');
      expect(dSettle.nextQueued.messageId).toBe('m3');
    });

    it('rejects a stale settle, caps the queue, scopes DELETE, and prunes resolved gates', async () => {
      const doInstance = new OracleSession(createMockDoState());
      const post = (path: string, body: unknown) =>
        doInstance.fetch(
          new Request(`https://oracle-session/${path}`, { method: 'POST', body: JSON.stringify(body) }),
        );

      await post('admit', { messageId: 'a' }); // turn_1 active
      const stale = await post('settle', { turnId: 'turn_9' });
      expect(stale.status).toBe(409);

      for (let i = 0; i < 25; i++) {
        expect((await post('admit', { messageId: `q${i}` })).status).toBe(200);
      }
      expect((await post('admit', { messageId: 'overflow' })).status).toBe(429);

      // Settling twice for the same turn: the second must not end the promoted turn.
      expect((await post('settle', { turnId: 'turn_1' })).status).toBe(200);
      expect((await post('settle', { turnId: 'turn_1' })).status).toBe(409);

      // DELETE on a sub-path must not wipe the session.
      const del = await doInstance.fetch(new Request('https://oracle-session/events', { method: 'DELETE' }));
      expect(del.status).toBe(404);

      // 60 resolved callbacks leave at most 20 behind plus nothing pending.
      for (let i = 0; i < 60; i++) {
        await post('events', { events: [{ type: 'callback_requested', tool_id: `c${i}`, tool_name: 't', tool_input: {} }] });
        await post('callback', { toolId: `c${i}`, output: 'ok' });
      }
      const state = (await (await doInstance.fetch(new Request('https://oracle-session/state'))).json()) as {
        pendingCallbacks: unknown[];
      };
      expect(state.pendingCallbacks).toHaveLength(0);
    });

    it('Plane 2 (Observability) & Plane 3 (Control): offset replay, remember approval cascade, callbacks, and RFC 6902 state patches', async () => {
      const doInstance = new OracleSession(createMockDoState());

      // Publish two pending tool approvals
      await doInstance.fetch(
        new Request('https://oracle-session/events', {
          method: 'POST',
          body: JSON.stringify({
            turnId: 'turn_1',
            turnNumber: 1,
            events: [
              {
                type: 'tool_approval_requested',
                tool_id: 'call_1',
                tool_name: 'research_keywords',
                tool_input: { seeds: ['aeo'] },
              },
              {
                type: 'tool_approval_requested',
                tool_id: 'call_2',
                tool_name: 'research_keywords',
                tool_input: { seeds: ['geo'] },
              },
            ],
          }),
        }),
      );

      // Approve call_1 with remember: true -> cascades to call_2
      const appRes = await doInstance.fetch(
        new Request('https://oracle-session/approval', {
          method: 'POST',
          body: JSON.stringify({
            toolId: 'call_1',
            approved: true,
            remember: true,
            reason: 'Owner approved keyword research for session',
          }),
        }),
      );
      const appData = (await appRes.json()) as {
        ok: boolean;
        rememberedTools: string[];
        cascadedToolIds: string[];
        events: Array<{ offset: number }>;
      };
      expect(appData.ok).toBe(true);
      expect(appData.rememberedTools).toEqual(['research_keywords']);
      expect(appData.cascadedToolIds).toEqual(['call_2']);
      expect(appData.events).toHaveLength(2);

      // Apply RFC 6902 state patch on observable state bucket
      await doInstance.fetch(
        new Request('https://oracle-session/state/patch', {
          method: 'POST',
          body: JSON.stringify({
            key: 'audit_board',
            snapshot: { findings: [], status: 'scanning' },
          }),
        }),
      );
      const patchRes = await doInstance.fetch(
        new Request('https://oracle-session/state/patch', {
          method: 'POST',
          body: JSON.stringify({
            key: 'audit_board',
            ops: [
              { op: 'add', path: '/findings/-', value: { id: 'f1', title: 'Missing Schema' } },
              { op: 'replace', path: '/status', value: 'ready' },
            ],
          }),
        }),
      );
      const patchData = (await patchRes.json()) as {
        ok: boolean;
        version: number;
        doc: { findings: Array<{ id: string }>; status: string };
      };
      expect(patchData.ok).toBe(true);
      expect(patchData.version).toBe(2);
      expect(patchData.doc.status).toBe('ready');
      expect(patchData.doc.findings).toHaveLength(1);

      // Replay stream from offset > 2
      const streamRes = await doInstance.fetch(
        new Request('https://oracle-session/events?after=2'),
      );
      const streamData = (await streamRes.json()) as {
        events: Array<{ offset: number; event: { type: string } }>;
      };
      expect(streamData.events.every((e) => e.offset > 2)).toBe(true);
      expect(streamData.events.map((e) => e.event.type)).toEqual([
        'tool_approval_resolved',
        'tool_approval_resolved',
        'state_snapshot',
        'state_patch',
      ]);

      // Deterministic truncation
      await doInstance.fetch(
        new Request('https://oracle-session/truncate', {
          method: 'POST',
          body: JSON.stringify({ upToOffset: 4 }),
        }),
      );
      const afterTruncRes = await doInstance.fetch(
        new Request('https://oracle-session/events?after=0'),
      );
      const afterTruncData = (await afterTruncRes.json()) as {
        events: Array<{ offset: number }>;
      };
      expect(afterTruncData.events.map((e) => e.offset)).toEqual([5, 6]);
    });

    it('enforces /approval gate validation and caps rememberedTools at 32 unique names (max 64 chars)', async () => {
      const doInstance = new OracleSession(createMockDoState());
      const post = (path: string, body: unknown) =>
        doInstance.fetch(
          new Request(`https://oracle-session/${path}`, {
            method: 'POST',
            body: JSON.stringify(body),
          }),
        );

      // Bare toolName without toolId is rejected with 400
      const bareRes = await post('approval', {
        toolName: 'research_keywords',
        approved: true,
        remember: true,
      });
      expect(bareRes.status).toBe(400);

      // Unknown toolId without a pending gate is rejected with 409
      const unknownGateRes = await post('approval', {
        toolId: 'call_missing',
        toolName: 'research_keywords',
        approved: true,
        remember: true,
      });
      expect(unknownGateRes.status).toBe(409);

      // Register 35 pending gates with valid tool names + 1 overlong (>64 chars)
      const events = [];
      for (let i = 0; i < 35; i++) {
        events.push({
          type: 'tool_approval_requested',
          tool_id: `gate_${i}`,
          tool_name: `custom_tool_${i}`,
          tool_input: {},
        });
      }
      events.push({
        type: 'tool_approval_requested',
        tool_id: 'gate_overlong',
        tool_name: 'x'.repeat(80),
        tool_input: {},
      });
      await post('events', { turnId: 'turn_1', turnNumber: 1, events });

      // Overlong tool name was not registered as a pending gate
      const overlongApprove = await post('approval', {
        toolId: 'gate_overlong',
        approved: true,
        remember: true,
      });
      expect(overlongApprove.status).toBe(409);

      // Mismatched toolName on a valid pending gate is rejected with 400
      const mismatchRes = await post('approval', {
        toolId: 'gate_0',
        toolName: 'wrong_tool_name',
        approved: true,
        remember: true,
      });
      expect(mismatchRes.status).toBe(400);

      // Approve all 35 valid gates with remember: true -> rememberedTools caps at 32
      for (let i = 0; i < 35; i++) {
        const res = await post('approval', {
          toolId: `gate_${i}`,
          approved: true,
          remember: true,
        });
        expect(res.status).toBe(200);
      }

      // Approving an already-resolved gate again is rejected with 409
      const duplicateApprove = await post('approval', {
        toolId: 'gate_0',
        approved: true,
      });
      expect(duplicateApprove.status).toBe(409);

      const stateRes = await doInstance.fetch(new Request('https://oracle-session/state'));
      const stateData = (await stateRes.json()) as { rememberedTools: string[] };
      expect(stateData.rememberedTools).toHaveLength(32);
    });
  });
});
