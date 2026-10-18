import { describe, expect, it } from 'vitest';
import {
  applyOps,
  buildPointer,
  diffJsonPatch,
  escapeToken,
  mutateDraft,
  parsePointer,
  unescapeToken,
  valueAt,
  type JsonValue,
} from '../services/agentCore/jsonPatch';
import {
  bindInjectedToolArgs,
  isControlPlaneToolName,
  sanitizeToolSchemaForLlm,
  type AgentEventEnvelope,
} from '../services/agentCore/harnessProtocol';
import {
  mergeCausalStreams,
} from '../services/agentCore/streamMerge';
import { StateGraph, END_NODE } from '../services/agentCore/stateGraph';

describe('Wave 1: Temporal Agent Harness MIT Core Primitives', () => {
  describe('jsonPatch (RFC 6902)', () => {
    it('escapes and unescapes RFC 6901 tokens in exact order', () => {
      expect(escapeToken('a/b~c')).toBe('a~1b~0c');
      expect(unescapeToken('a~1b~0c')).toBe('a/b~c');
      // ~01 must unescape to ~1, not /
      expect(unescapeToken('~01')).toBe('~1');
      expect(parsePointer('')).toEqual([]);
      expect(parsePointer('/todos/0/title')).toEqual(['todos', '0', 'title']);
      expect(buildPointer(['todos', 0, 'a/b'])).toBe('/todos/0/a~1b');
    });

    it('applies add, replace, remove and resolves /todos/- append pointers', () => {
      const doc: JsonValue = { todos: [{ text: 'first', done: false }], status: 'idle' };
      const res = applyOps(doc, [
        { op: 'add', path: '/todos/-', value: { text: 'second', done: false } },
        { op: 'replace', path: '/todos/0/done', value: true },
        { op: 'replace', path: '/status', value: 'active' },
      ]);

      expect(res.error).toBeNull();
      expect(res.applied).toHaveLength(3);
      expect(res.applied[0]?.resolved).toBe('/todos/1');
      expect(res.applied[1]?.before).toBe(false);
      expect(valueAt(res.doc, '/todos/1/text')).toBe('second');
      expect(valueAt(res.doc, '/todos/0/done')).toBe(true);
    });

    it('rejects __proto__, intermediate constructor/prototype traversal, leading-zero array indices, and unsupported ops without throwing', () => {
      const doc: JsonValue = { safe: true, arr: ['a', 'b'] };
      const protoRes = applyOps(doc, [{ op: 'add', path: '/__proto__/polluted', value: 'yes' }]);
      expect(protoRes.error).toContain('__proto__');

      const intermediateProtoRes = applyOps(doc, [
        { op: 'add', path: '/constructor/prototype/polluted', value: 'yes' },
      ]);
      expect(intermediateProtoRes.error).toContain('constructor');

      const leadingZeroRes = applyOps(doc, [
        { op: 'replace', path: '/arr/01', value: 'bad' },
      ]);
      expect(leadingZeroRes.error).toContain('outside an array');

      const badOpRes = applyOps(doc, [
        { op: 'move' as 'add', path: '/safe', value: false },
      ]);
      expect(badOpRes.ok).toBe(false);
      expect(badOpRes.error).toContain('unsupported op');
    });

    it('enforces RFC 6902: rejects replace on missing key, add/replace without value, root remove, and strips forbidden keys in diffJsonPatch', () => {
      const doc: JsonValue = { existing: 1 };

      const missingKeyReplace = applyOps(doc, [
        { op: 'replace', path: '/nonexistent', value: 2 },
      ]);
      expect(missingKeyReplace.ok).toBe(false);
      expect(missingKeyReplace.error).toContain('no such key');
      expect(doc).toEqual({ existing: 1 });

      const missingAddValue = applyOps(doc, [
        { op: 'add', path: '/newKey', value: undefined },
      ]);
      expect(missingAddValue.ok).toBe(false);
      expect(missingAddValue.error).toContain('requires a value');

      const missingReplaceValue = applyOps(doc, [
        { op: 'replace', path: '/existing' } as { op: 'replace'; path: string; value: JsonValue },
      ]);
      expect(missingReplaceValue.ok).toBe(false);
      expect(missingReplaceValue.error).toContain('requires a value');

      const rootRemove = applyOps(doc, [{ op: 'remove', path: '' }]);
      expect(rootRemove.ok).toBe(false);
      expect(rootRemove.error).toContain('root');

      const prevObj = Object.assign(Object.create(null), { safe: 1, constructor: 'bad' });
      const nextObj = Object.assign(Object.create(null), { safe: 2, prototype: 'worse' });
      const diffOps = diffJsonPatch(prevObj, nextObj);
      expect(diffOps).toEqual([{ op: 'replace', path: '/safe', value: 2 }]);
    });

    it('computes minimal diffJsonPatch and mutateDraft skips version increment when clean', () => {
      const initial = { count: 1, items: ['a', 'b'], meta: { ok: true } };

      // No-op draft mutation burns no version and emits zero ops
      const clean = mutateDraft(initial, 5, () => {
        /* no changes */
      });
      expect(clean.dirty).toBe(false);
      expect(clean.version).toBe(5);
      expect(clean.ops).toEqual([]);
      expect(clean.state).toBe(initial);

      // Dirty mutation increments version and emits reconstructible RFC 6902 patch
      const dirty = mutateDraft(initial, 5, (d) => {
        d.count = 2;
        d.items.push('c');
      });
      expect(dirty.dirty).toBe(true);
      expect(dirty.version).toBe(6);
      expect(dirty.ops.length).toBeGreaterThan(0);

      const clone: JsonValue = JSON.parse(JSON.stringify(initial));
      const applied = applyOps(clone, dirty.ops);
      expect(applied.error).toBeNull();
      expect(applied.doc).toEqual(dirty.state);

      // Array shrink diff
      const shrinkOps = diffJsonPatch({ list: [1, 2, 3] }, { list: [1] });
      const shrinkClone: JsonValue = { list: [1, 2, 3] };
      expect(applyOps(shrinkClone, shrinkOps).doc).toEqual({ list: [1] });
    });
  });

  describe('harnessProtocol (Injected<T> & Control Plane Isolation)', () => {
    it('strips injected context keys from LLM-facing tool JSON schemas', () => {
      const rawSchema = {
        type: 'object' as const,
        properties: {
          accountId: { type: 'string' },
          projectId: { type: 'string' },
          dataForSeoCredential: { type: 'string' },
          seeds: { type: 'array', items: { type: 'string' } },
          locationCode: { type: 'number' },
        },
        required: ['accountId', 'projectId', 'seeds'],
      };

      const sanitized = sanitizeToolSchemaForLlm(rawSchema);
      expect(Object.keys(sanitized.properties || {})).toEqual(['seeds', 'locationCode']);
      expect(sanitized.required).toEqual(['seeds']);
    });

    it('prevents model-supplied args from overriding injected context or __proto__', () => {
      const bound = bindInjectedToolArgs(
        {
          seeds: ['aeo audit'],
          accountId: 'spoofed_attacker_account',
          projectId: 'spoofed_project',
        },
        {
          accountId: 'acct_verified_owner',
          projectId: 'proj_verified_1',
        },
      );

      expect(bound.modelFacingInput).toEqual({ seeds: ['aeo audit'] });
      expect(bound.executionArgs).toEqual({
        seeds: ['aeo audit'],
        accountId: 'acct_verified_owner',
        projectId: 'proj_verified_1',
      });
    });

    it('identifies reserved control-plane tool names', () => {
      expect(isControlPlaneToolName('tool_approval')).toBe(true);
      expect(isControlPlaneToolName('provide_callback_result')).toBe(true);
      expect(isControlPlaneToolName('research_keywords')).toBe(false);
    });
  });

  describe('streamMerge (Clock-Free K-Way Causal Brackets)', () => {
    it('holds child turn events until parent subagent_message_sent and holds parent reply until child turn_end', () => {
      const rootEvents: AgentEventEnvelope[] = [
        {
          offset: 1,
          agent_id: 'root',
          turn_id: 't1',
          turn_number: 1,
          timestamp: 100,
          event: { type: 'turn_started' },
        },
        {
          offset: 2,
          agent_id: 'root',
          turn_id: 't1',
          turn_number: 1,
          timestamp: 101,
          event: {
            type: 'subagent_message_sent',
            subagent_id: 'scout',
            agent_key: 'scout',
            workflow_id: 'wf_scout',
            subagent_turn: 1,
            from_offset: 1,
          },
        },
        {
          offset: 3,
          agent_id: 'root',
          turn_id: 't1',
          turn_number: 1,
          timestamp: 102,
          event: {
            type: 'subagent_reply_received',
            subagent_id: 'scout',
            agent_key: 'scout',
            workflow_id: 'wf_scout',
            subagent_turn: 1,
          },
        },
        {
          offset: 4,
          agent_id: 'root',
          turn_id: 't1',
          turn_number: 1,
          timestamp: 103,
          event: { type: 'turn_end' },
        },
      ];

      const childEvents: AgentEventEnvelope[] = [
        {
          offset: 1,
          agent_id: 'scout',
          turn_id: 'c1',
          turn_number: 1,
          timestamp: 50, // Deliberately skewed earlier clock to prove clock-free ordering
          event: { type: 'turn_started' },
        },
        {
          offset: 2,
          agent_id: 'scout',
          turn_id: 'c1',
          turn_number: 1,
          timestamp: 51,
          event: { type: 'reply_delta', delta: 'crawled 3 pages' },
        },
        {
          offset: 3,
          agent_id: 'scout',
          turn_id: 'c1',
          turn_number: 1,
          timestamp: 52,
          event: { type: 'turn_end' },
        },
      ];

      const merged = mergeCausalStreams([
        { workflowId: 'wf_root', isChild: false, events: rootEvents },
        { workflowId: 'wf_scout', subagentId: 'scout', isChild: true, events: childEvents },
      ]);

      const sequence = merged.map((e) => `${e.agent_id}:${e.event.type}`);
      expect(sequence).toEqual([
        'root:turn_started',
        'root:subagent_message_sent',
        'scout:turn_started',
        'scout:reply_delta',
        'scout:turn_end',
        'root:subagent_reply_received',
        'root:turn_end',
      ]);
    });

    it('synthesizes subagent_stream_unavailable and releases parent close gate when child stalls', () => {
      const rootEvents: AgentEventEnvelope[] = [
        {
          offset: 1,
          agent_id: 'root',
          turn_id: 't1',
          turn_number: 1,
          timestamp: 100,
          event: {
            type: 'subagent_message_sent',
            subagent_id: 'radar',
            agent_key: 'radar',
            workflow_id: 'wf_radar',
            subagent_turn: 1,
            from_offset: 1,
          },
        },
        {
          offset: 2,
          agent_id: 'root',
          turn_id: 't1',
          turn_number: 1,
          timestamp: 101,
          event: {
            type: 'subagent_reply_received',
            subagent_id: 'radar',
            agent_key: 'radar',
            workflow_id: 'wf_radar',
            subagent_turn: 1,
          },
        },
      ];

      // Child crashed before emitting turn_end
      const stalledChildEvents: AgentEventEnvelope[] = [
        {
          offset: 1,
          agent_id: 'radar',
          turn_id: 'c1',
          turn_number: 1,
          timestamp: 100,
          event: { type: 'turn_started' },
        },
      ];

      const merged = mergeCausalStreams([
        { workflowId: 'wf_root', isChild: false, events: rootEvents },
        { workflowId: 'wf_radar', subagentId: 'radar', isChild: true, events: stalledChildEvents },
      ]);

      const sequence = merged.map((e) => `${e.agent_id}:${e.event.type}`);
      expect(sequence).toEqual([
        'root:subagent_message_sent',
        'radar:turn_started',
        'radar:subagent_stream_unavailable',
        'root:subagent_reply_received',
      ]);
    });
  });

  describe('StateGraph RFC 6902 Checkpointing', () => {
    it('records patchOps and increments stateVersion only when node mutates context', async () => {
      const graph = new StateGraph<{ step: number; notes: string[] }>({ maxIterations: 5 });
      graph
        .addNode('noop', 'No-Op Node', async () => ({}))
        .addNode('mutate', 'Mutate Node', async (ctx) => ({
          step: ctx.step + 1,
          notes: [...ctx.notes, 'updated'],
        }))
        .setEntryPoint('noop')
        .addEdge('noop', 'mutate')
        .addEdge('mutate', END_NODE);

      const { checkpoints } = await graph.run({ step: 0, notes: [] });
      expect(checkpoints).toHaveLength(3);
      // Initial checkpoint before noop
      expect(checkpoints[0]?.stateVersion).toBe(0);
      expect(checkpoints[0]?.patchOps).toEqual([]);
      // Checkpoint before mutate (after noop made no changes) -> version still 0
      expect(checkpoints[1]?.stateVersion).toBe(0);
      expect(checkpoints[1]?.patchOps).toEqual([]);
      // Final checkpoint after mutate -> version 1 with RFC 6902 patchOps
      expect(checkpoints[2]?.stateVersion).toBe(1);
      expect(checkpoints[2]?.patchOps?.length).toBeGreaterThan(0);
    });
  });
});
