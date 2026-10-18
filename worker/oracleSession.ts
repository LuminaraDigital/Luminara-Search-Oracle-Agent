/**
 * Durable Object: Oracle Session & 3-Plane Agent Harness.
 * Adapted from temporal-community/temporal-agent-harness
 * (temporal_agent_harness/harness/agent_workflow.py, MIT License,
 * Copyright (c) 2026 Temporal Technologies Inc.).
 *
 * Implements the three harness planes on Cloudflare Durable Objects:
 * 1. Interface Plane: Two-phase turn admission (`/admit`, `/settle`) with `MidTurnPolicy`
 *    (`enqueue` | `accept` | `reject`) and backward-compatible `/history` & `/append`.
 * 2. Observability Plane: Offset-addressed `AgentEventEnvelope` log (`/events`, `/truncate`)
 *    supporting resumable replay (`?after=offset`).
 * 3. Control Plane: Out-of-band tool approval gates (`/approval` with `remember: boolean`
 *    cascade allow-list), client callbacks (`/callback`), and RFC 6902 observable state (`/state`).
 * No em dashes in copy.
 */

import {
  applyOps,
  cloneJson,
  type JsonPatchOp,
  type JsonValue,
} from '../services/agentCore/jsonPatch';
import {
  isControlPlaneToolName,
  type AgentEventEnvelope,
  type AgentStreamItem,
  type MessageDisposition,
  type MidTurnPolicy,
} from '../services/agentCore/harnessProtocol';

export interface QueuedTurnMessage {
  messageId: string;
  turnId: string;
  turnNumber: number;
  messageType: string;
  content: string;
  admittedAt: number;
}

export interface PendingToolGate {
  toolId: string;
  toolName: string;
  turnId: string;
  turnNumber: number;
  toolInput: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied';
  reason: string | null;
  remember: boolean;
  createdAt: number;
  resolvedAt?: number;
}

export interface PendingCallbackGate {
  toolId: string;
  toolName: string;
  turnId: string;
  turnNumber: number;
  toolInput: Record<string, unknown>;
  status: 'pending' | 'resolved';
  output?: string;
  isError?: boolean;
  createdAt: number;
  resolvedAt?: number;
}

export interface ObservableStateBucket {
  version: number;
  doc: JsonValue;
}

const MAX_STORED_TURNS = 80;
const MAX_STORED_EVENTS = 500;
const MAX_QUEUED_TURNS = 25;
const MAX_GATES = 50;
const KEEP_RESOLVED_GATES = 20;
const MAX_REMEMBERED_TOOLS = 32;
const MAX_TOOL_NAME_LEN = 64;
const MAX_STATE_BUCKETS = 32;
const MAX_STATE_DOC_CHARS = 64 * 1024;
const MAX_EVENT_TEXT_CHARS = 2048;
const STALE_TURN_MS = 10 * 60 * 1000;
const FORBIDDEN_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeRecordKey(key: string): boolean {
  return Boolean(key) && !FORBIDDEN_RECORD_KEYS.has(key);
}

function ownRecordGet<T>(rec: Record<string, T>, key: string): T | undefined {
  return isSafeRecordKey(key) && Object.hasOwn(rec, key) ? rec[key] : undefined;
}

export class OracleSession {
  private state: DurableObjectState;
  private turns: Array<{ role: string; content: string; at: number }> = [];
  private events: AgentEventEnvelope[] = [];
  private nextOffset = 1;
  private currentTurnNumber = 0;
  private activeTurnId: string | null = null;
  /** In-memory only: after a DO restart this is 0, so an inherited active turn is treated as stale. */
  private activeTurnAt = 0;
  private turnQueue: QueuedTurnMessage[] = [];
  private rememberedTools: string[] = [];
  private pendingApprovals: Record<string, PendingToolGate> = {};
  private pendingCallbacks: Record<string, PendingCallbackGate> = {};
  private stateBuckets: Record<string, ObservableStateBucket> = {};

  constructor(state: DurableObjectState) {
    this.state = state;
    void this.state.blockConcurrencyWhile(async () => {
      const [
        storedTurns,
        storedEvents,
        storedOffset,
        storedTurnNumber,
        storedActiveTurnId,
        storedQueue,
        storedRemembered,
        storedApprovals,
        storedCallbacks,
        storedBuckets,
      ] = await Promise.all([
        this.state.storage.get<typeof this.turns>('turns'),
        this.state.storage.get<AgentEventEnvelope[]>('events'),
        this.state.storage.get<number>('nextOffset'),
        this.state.storage.get<number>('currentTurnNumber'),
        this.state.storage.get<string | null>('activeTurnId'),
        this.state.storage.get<QueuedTurnMessage[]>('turnQueue'),
        this.state.storage.get<string[]>('rememberedTools'),
        this.state.storage.get<Record<string, PendingToolGate>>('pendingApprovals'),
        this.state.storage.get<Record<string, PendingCallbackGate>>('pendingCallbacks'),
        this.state.storage.get<Record<string, ObservableStateBucket>>('stateBuckets'),
      ]);

      if (storedTurns) this.turns = storedTurns;
      if (storedEvents) this.events = storedEvents;
      if (typeof storedOffset === 'number' && storedOffset >= 1) this.nextOffset = storedOffset;
      if (typeof storedTurnNumber === 'number') this.currentTurnNumber = storedTurnNumber;
      if (storedActiveTurnId !== undefined) this.activeTurnId = storedActiveTurnId;
      if (storedQueue) this.turnQueue = storedQueue;
      if (storedRemembered) this.rememberedTools = storedRemembered;
      if (storedApprovals) this.pendingApprovals = storedApprovals;
      if (storedCallbacks) this.pendingCallbacks = storedCallbacks;
      if (storedBuckets) this.stateBuckets = storedBuckets;
    });
  }

  private publishInternal(params: {
    agentId?: string;
    turnId?: string;
    turnNumber?: number;
    event: AgentStreamItem;
  }): AgentEventEnvelope {
    const envelope: AgentEventEnvelope = {
      offset: this.nextOffset++,
      agent_id: params.agentId || 'oracle',
      turn_id: params.turnId ?? (this.activeTurnId || `turn_${this.currentTurnNumber}`),
      turn_number: params.turnNumber ?? this.currentTurnNumber,
      timestamp: Date.now(),
      event: params.event,
    };
    this.events.push(envelope);
    if (this.events.length > MAX_STORED_EVENTS) {
      this.events = this.events.slice(-MAX_STORED_EVENTS);
    }
    return envelope;
  }

  /** Keep all pending gates plus the newest resolved ones; resolved history lives in the event log. */
  private pruneGates(): void {
    const prune = <T extends { status: string; resolvedAt?: number }>(rec: Record<string, T>) => {
      const entries = Object.entries(rec);
      if (entries.length <= MAX_GATES) return rec;
      const pending = entries.filter(([, g]) => g.status === 'pending');
      const resolved = entries
        .filter(([, g]) => g.status !== 'pending')
        .sort((a, b) => (b[1].resolvedAt ?? 0) - (a[1].resolvedAt ?? 0))
        .slice(0, KEEP_RESOLVED_GATES);
      return Object.fromEntries([...pending, ...resolved]) as Record<string, T>;
    };
    this.pendingApprovals = prune(this.pendingApprovals);
    this.pendingCallbacks = prune(this.pendingCallbacks);
  }

  private async persistEvents(): Promise<void> {
    this.pruneGates();
    await Promise.all([
      this.state.storage.put('events', this.events),
      this.state.storage.put('nextOffset', this.nextOffset),
    ]);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // -------------------------------------------------------------------------
    // Legacy & Turn History Endpoints (100% backward compatible)
    // -------------------------------------------------------------------------
    if (request.method === 'GET' && pathname.endsWith('/history')) {
      return Response.json({
        turns: this.turns.slice(-40),
        rememberedTools: this.rememberedTools,
        currentTurnNumber: this.currentTurnNumber,
        activeTurnId: this.activeTurnId,
        nextOffset: this.nextOffset,
      });
    }

    if (request.method === 'POST' && pathname.endsWith('/append')) {
      const body = (await request.json().catch(() => ({}))) as {
        role?: string;
        content?: string;
      };
      if (body.role && body.content) {
        this.turns.push({ role: body.role, content: body.content, at: Date.now() });
        if (this.turns.length > MAX_STORED_TURNS) {
          this.turns = this.turns.slice(-MAX_STORED_TURNS);
        }
        await this.state.storage.put('turns', this.turns);
      }
      return Response.json({ ok: true, count: this.turns.length });
    }

    if (request.method === 'DELETE' && (pathname === '/' || pathname === '')) {
      this.turns = [];
      this.events = [];
      this.nextOffset = 1;
      this.currentTurnNumber = 0;
      this.activeTurnId = null;
      this.turnQueue = [];
      this.rememberedTools = [];
      this.pendingApprovals = {};
      this.pendingCallbacks = {};
      this.stateBuckets = {};
      await this.state.storage.deleteAll();
      return Response.json({ ok: true });
    }

    // -------------------------------------------------------------------------
    // Plane 1: Interface Plane - Two-Phase Turn Admission (`/admit` & `/settle`)
    // -------------------------------------------------------------------------
    if (request.method === 'POST' && pathname.endsWith('/admit')) {
      const body = (await request.json().catch(() => ({}))) as {
        messageId?: string;
        messageType?: string;
        content?: string;
        midTurn?: MidTurnPolicy;
      };
      const midTurn: MidTurnPolicy =
        body.midTurn === 'accept' || body.midTurn === 'reject' ? body.midTurn : 'enqueue';
      const messageId = String(body.messageId || `msg_${Date.now()}`).slice(0, 128);
      const messageType = String(body.messageType || 'user_message').slice(0, 64);
      const content = String(body.content || '');

      const isBusy =
        this.activeTurnId !== null && Date.now() - this.activeTurnAt < STALE_TURN_MS;
      if (isBusy && midTurn === 'reject') {
        const rejectedEnv = this.publishInternal({
          event: {
            type: 'message_accepted',
            message_id: messageId,
            message_type: messageType,
            disposition: 'rejected',
          },
        });
        await this.persistEvents();
        return Response.json(
          {
            ok: false,
            accepted: false,
            disposition: 'rejected' as MessageDisposition,
            turnId: this.activeTurnId,
            activeTurnId: this.activeTurnId,
            turnNumber: this.currentTurnNumber,
            acceptedOffset: rejectedEnv.offset,
          },
          { status: 409 },
        );
      }

      let disposition: MessageDisposition;
      let turnId: string;
      let turnNumber: number;

      if (!isBusy) {
        this.currentTurnNumber += 1;
        turnNumber = this.currentTurnNumber;
        turnId = `turn_${turnNumber}`;
        this.activeTurnId = turnId;
        this.activeTurnAt = Date.now();
        disposition = 'started';
      } else if (midTurn === 'accept') {
        turnNumber = this.currentTurnNumber;
        turnId = this.activeTurnId!;
        disposition = 'joined';
        this.activeTurnAt = Date.now();
      } else {
        if (this.turnQueue.length >= MAX_QUEUED_TURNS) {
          return Response.json(
            { ok: false, accepted: false, error: 'Turn queue is full', code: 'QUEUE_FULL' },
            { status: 429 },
          );
        }
        turnNumber = this.currentTurnNumber + this.turnQueue.length + 1;
        turnId = `turn_${turnNumber}`;
        disposition = 'enqueued';
        this.turnQueue.push({
          messageId,
          turnId,
          turnNumber,
          messageType,
          content,
          admittedAt: Date.now(),
        });
      }

      const acceptedEnv = this.publishInternal({
        turnId,
        turnNumber,
        event: {
          type: 'message_accepted',
          message_id: messageId,
          message_type: messageType,
          disposition,
        },
      });

      if (disposition === 'started') {
        this.publishInternal({
          turnId,
          turnNumber,
          event: { type: 'turn_started' },
        });
      }

      await Promise.all([
        this.persistEvents(),
        this.state.storage.put('currentTurnNumber', this.currentTurnNumber),
        this.state.storage.put('activeTurnId', this.activeTurnId),
        this.state.storage.put('turnQueue', this.turnQueue),
      ]);

      return Response.json({
        ok: true,
        accepted: true,
        disposition,
        turnId,
        turnNumber,
        acceptedOffset: acceptedEnv.offset,
      });
    }

    if (request.method === 'POST' && pathname.endsWith('/settle')) {
      const body = (await request.json().catch(() => ({}))) as {
        turnId?: string;
      };
      if (!this.activeTurnId || (body.turnId && body.turnId !== this.activeTurnId)) {
        return Response.json(
          { ok: false, error: 'Turn not active or already settled', code: 'TURN_NOT_ACTIVE' },
          { status: 409 },
        );
      }
      const targetTurnId = this.activeTurnId;
      const endedEnv = this.publishInternal({
        turnId: targetTurnId,
        turnNumber: this.currentTurnNumber,
        event: { type: 'turn_end' },
      });

      let nextQueued: QueuedTurnMessage | null = null;
      if (this.turnQueue.length > 0) {
        nextQueued = this.turnQueue.shift()!;
        this.currentTurnNumber = nextQueued.turnNumber;
        this.activeTurnId = nextQueued.turnId;
        this.activeTurnAt = Date.now();
        this.publishInternal({
          turnId: nextQueued.turnId,
          turnNumber: nextQueued.turnNumber,
          event: { type: 'turn_started' },
        });
      } else {
        this.activeTurnId = null;
      }

      await Promise.all([
        this.persistEvents(),
        this.state.storage.put('currentTurnNumber', this.currentTurnNumber),
        this.state.storage.put('activeTurnId', this.activeTurnId),
        this.state.storage.put('turnQueue', this.turnQueue),
      ]);

      return Response.json({
        ok: true,
        endedOffset: endedEnv.offset,
        activeTurnId: this.activeTurnId,
        nextQueued,
      });
    }

    // -------------------------------------------------------------------------
    // Plane 2: Observability Plane - Durable AgentEvent Stream (`/events` & `/truncate`)
    // -------------------------------------------------------------------------
    if (request.method === 'GET' && pathname.endsWith('/events')) {
      const afterParam = Number(url.searchParams.get('after') || 0);
      const afterOffset = Number.isFinite(afterParam) && afterParam > 0 ? afterParam : 0;
      const filtered = this.events.filter((e) => e.offset > afterOffset);
      return Response.json({
        ok: true,
        events: filtered,
        nextOffset: this.nextOffset,
        activeTurnId: this.activeTurnId,
        rememberedTools: this.rememberedTools,
      });
    }

    if (request.method === 'POST' && pathname.endsWith('/events')) {
      const body = (await request.json().catch(() => ({}))) as {
        agentId?: string;
        turnId?: string;
        turnNumber?: number;
        event?: AgentStreamItem;
        events?: AgentStreamItem[];
      };
      const items: AgentStreamItem[] = Array.isArray(body.events)
        ? body.events
        : body.event
          ? [body.event]
          : [];
      if (items.length === 0) {
        return Response.json({ ok: false, error: 'event or events required' }, { status: 400 });
      }

      const published: AgentEventEnvelope[] = [];
      for (const rawItem of items) {
        const item =
          rawItem.type === 'tool_end' && typeof rawItem.tool_output === 'string'
            ? { ...rawItem, tool_output: rawItem.tool_output.slice(0, MAX_EVENT_TEXT_CHARS) }
            : rawItem;
        if (item.type === 'tool_approval_requested' && isSafeRecordKey(item.tool_id)) {
          const requestedToolName = String(item.tool_name || '').trim();
          if (
            requestedToolName &&
            requestedToolName.length <= MAX_TOOL_NAME_LEN &&
            !isControlPlaneToolName(requestedToolName)
          ) {
            this.pendingApprovals[item.tool_id] = {
              toolId: item.tool_id,
              toolName: requestedToolName,
              turnId: body.turnId || this.activeTurnId || `turn_${this.currentTurnNumber}`,
              turnNumber: body.turnNumber ?? this.currentTurnNumber,
              toolInput: item.tool_input || {},
              status: 'pending',
              reason: null,
              remember: false,
              createdAt: Date.now(),
            };
          }
        } else if (item.type === 'callback_requested' && isSafeRecordKey(item.tool_id)) {
          this.pendingCallbacks[item.tool_id] = {
            toolId: item.tool_id,
            toolName: String(item.tool_name || 'callback_tool').slice(0, MAX_TOOL_NAME_LEN),
            turnId: body.turnId || this.activeTurnId || `turn_${this.currentTurnNumber}`,
            turnNumber: body.turnNumber ?? this.currentTurnNumber,
            toolInput: item.tool_input || {},
            status: 'pending',
            createdAt: Date.now(),
          };
        }
        published.push(
          this.publishInternal({
            agentId: body.agentId,
            turnId: body.turnId,
            turnNumber: body.turnNumber,
            event: item,
          }),
        );
      }

      await Promise.all([
        this.persistEvents(),
        this.state.storage.put('pendingApprovals', this.pendingApprovals),
        this.state.storage.put('pendingCallbacks', this.pendingCallbacks),
      ]);

      return Response.json({
        ok: true,
        published,
        nextOffset: this.nextOffset,
      });
    }

    if (request.method === 'POST' && pathname.endsWith('/truncate')) {
      const body = (await request.json().catch(() => ({}))) as {
        upToOffset?: number;
      };
      const upToOffset = Number(body.upToOffset ?? 0);
      if (Number.isFinite(upToOffset) && upToOffset > 0) {
        this.events = this.events.filter((e) => e.offset > upToOffset);
        await this.state.storage.put('events', this.events);
      }
      return Response.json({
        ok: true,
        remainingCount: this.events.length,
        nextOffset: this.nextOffset,
      });
    }

    // -------------------------------------------------------------------------
    // Plane 3: Control Plane - Out-of-Band Tool Approvals, Callbacks, & State
    // -------------------------------------------------------------------------
    if (request.method === 'POST' && pathname.endsWith('/approval')) {
      const body = (await request.json().catch(() => ({}))) as {
        toolId?: string;
        toolName?: string;
        approved?: boolean;
        remember?: boolean;
        reason?: string | null;
      };
      const toolId = String(body.toolId || '').trim();
      if (!toolId || !isSafeRecordKey(toolId)) {
        return Response.json(
          { ok: false, error: 'valid toolId required', code: 'BAD_REQUEST' },
          { status: 400 },
        );
      }
      const gate = ownRecordGet(this.pendingApprovals, toolId);
      if (!gate || gate.status !== 'pending') {
        return Response.json(
          { ok: false, error: 'No pending approval gate for toolId', code: 'NO_PENDING_GATE' },
          { status: 409 },
        );
      }

      const toolName = String(gate.toolName || '').trim();
      if (
        !toolName ||
        toolName.length > MAX_TOOL_NAME_LEN ||
        isControlPlaneToolName(toolName) ||
        (body.toolName !== undefined && String(body.toolName).trim() !== toolName)
      ) {
        return Response.json(
          { ok: false, error: 'Invalid or mismatched toolName', code: 'BAD_REQUEST' },
          { status: 400 },
        );
      }

      const approved = Boolean(body.approved);
      const remember = Boolean(body.remember && approved);
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 512) : null;

      const resolvedEnvelopes: AgentEventEnvelope[] = [];
      const now = Date.now();

      gate.status = approved ? 'approved' : 'denied';
      gate.reason = reason;
      gate.remember = remember;
      gate.resolvedAt = now;
      resolvedEnvelopes.push(
        this.publishInternal({
          turnId: gate.turnId,
          turnNumber: gate.turnNumber,
          event: {
            type: 'tool_approval_resolved',
            tool_id: gate.toolId,
            tool_name: gate.toolName,
            approved,
            reason,
            remember,
          },
        }),
      );

      // Temporal Harness "remember" cascade: allow-list the tool for the session
      // and auto-approve any other pending gates for the same tool.
      const cascadedToolIds: string[] = [];
      if (remember && toolName.length <= MAX_TOOL_NAME_LEN) {
        if (
          !this.rememberedTools.includes(toolName) &&
          this.rememberedTools.length < MAX_REMEMBERED_TOOLS
        ) {
          this.rememberedTools.push(toolName);
        }
        for (const sibling of Object.values(this.pendingApprovals)) {
          if (sibling.toolName === toolName && sibling.status === 'pending') {
            sibling.status = 'approved';
            sibling.reason = 'auto-approved by remembered policy';
            sibling.remember = false;
            sibling.resolvedAt = now;
            cascadedToolIds.push(sibling.toolId);
            resolvedEnvelopes.push(
              this.publishInternal({
                turnId: sibling.turnId,
                turnNumber: sibling.turnNumber,
                event: {
                  type: 'tool_approval_resolved',
                  tool_id: sibling.toolId,
                  tool_name: sibling.toolName,
                  approved: true,
                  reason: sibling.reason,
                  remember: false,
                },
              }),
            );
          }
        }
      }

      await Promise.all([
        this.persistEvents(),
        this.state.storage.put('pendingApprovals', this.pendingApprovals),
        this.state.storage.put('rememberedTools', this.rememberedTools),
      ]);

      return Response.json({
        ok: true,
        toolName,
        approved,
        remember,
        rememberedTools: this.rememberedTools,
        cascadedToolIds,
        events: resolvedEnvelopes,
      });
    }

    if (request.method === 'POST' && pathname.endsWith('/callback')) {
      const body = (await request.json().catch(() => ({}))) as {
        toolId?: string;
        toolName?: string;
        output?: string;
        isError?: boolean;
      };
      const toolId = String(body.toolId || '').trim();
      if (!isSafeRecordKey(toolId)) {
        return Response.json({ ok: false, error: 'valid toolId required', code: 'BAD_REQUEST' }, { status: 400 });
      }
      const gate = ownRecordGet(this.pendingCallbacks, toolId);
      const toolName = String(gate?.toolName || body.toolName || 'callback_tool').slice(
        0,
        MAX_TOOL_NAME_LEN,
      );
      const output = String(body.output ?? '').slice(0, MAX_EVENT_TEXT_CHARS);
      const isError = Boolean(body.isError);

      if (gate) {
        gate.status = 'resolved';
        gate.output = output;
        gate.isError = isError;
        gate.resolvedAt = Date.now();
      }

      const resolvedEnv = this.publishInternal({
        turnId: gate?.turnId,
        turnNumber: gate?.turnNumber,
        event: {
          type: 'callback_resolved',
          tool_id: toolId,
          tool_name: toolName,
          output,
          is_error: isError,
        },
      });

      await Promise.all([
        this.persistEvents(),
        this.state.storage.put('pendingCallbacks', this.pendingCallbacks),
      ]);

      return Response.json({
        ok: true,
        toolId,
        toolName,
        event: resolvedEnv,
      });
    }

    if (request.method === 'GET' && pathname.endsWith('/state')) {
      const stateKey = url.searchParams.get('key');
      if (stateKey) {
        if (!isSafeRecordKey(stateKey)) {
          return Response.json({ ok: false, error: 'invalid state key', code: 'BAD_REQUEST' }, { status: 400 });
        }
        const bucket = ownRecordGet(this.stateBuckets, stateKey) ?? { version: 0, doc: null };
        return Response.json({ ok: true, key: stateKey, ...bucket });
      }
      return Response.json({
        ok: true,
        states: this.stateBuckets,
        pendingApprovals: Object.values(this.pendingApprovals).filter((a) => a.status === 'pending'),
        pendingCallbacks: Object.values(this.pendingCallbacks).filter((c) => c.status === 'pending'),
        rememberedTools: this.rememberedTools,
      });
    }

    if (request.method === 'POST' && pathname.endsWith('/state/patch')) {
      const body = (await request.json().catch(() => ({}))) as {
        key?: string;
        ops?: JsonPatchOp[];
        snapshot?: JsonValue;
      };
      const stateKey = String(body.key || 'default').slice(0, 64);
      if (!isSafeRecordKey(stateKey)) {
        return Response.json({ ok: false, error: 'invalid state key', code: 'BAD_REQUEST' }, { status: 400 });
      }
      if (
        !Object.hasOwn(this.stateBuckets, stateKey) &&
        Object.keys(this.stateBuckets).length >= MAX_STATE_BUCKETS
      ) {
        return Response.json(
          { ok: false, error: 'Too many state buckets', code: 'STATE_BUCKETS_LIMIT' },
          { status: 400 },
        );
      }
      const current = ownRecordGet(this.stateBuckets, stateKey) ?? { version: 0, doc: {} };

      if (body.snapshot !== undefined) {
        const snapshotClone = cloneJson(body.snapshot);
        if (JSON.stringify(snapshotClone).length > MAX_STATE_DOC_CHARS) {
          return Response.json(
            { ok: false, error: 'State document exceeds 64 KB limit', code: 'STATE_TOO_LARGE' },
            { status: 413 },
          );
        }
        const nextVersion = current.version + 1;
        this.stateBuckets[stateKey] = {
          version: nextVersion,
          doc: snapshotClone,
        };
        const snapEnv = this.publishInternal({
          event: {
            type: 'state_snapshot',
            state_key: stateKey,
            version: nextVersion,
            snapshot: this.stateBuckets[stateKey]!.doc,
          },
        });
        await Promise.all([
          this.persistEvents(),
          this.state.storage.put('stateBuckets', this.stateBuckets),
        ]);
        return Response.json({
          ok: true,
          key: stateKey,
          version: nextVersion,
          doc: this.stateBuckets[stateKey]!.doc,
          event: snapEnv,
        });
      }

      const ops = Array.isArray(body.ops) ? body.ops : [];
      if (ops.length === 0) {
        return Response.json({
          ok: true,
          key: stateKey,
          version: current.version,
          doc: current.doc,
          dirty: false,
        });
      }

      const result = applyOps(cloneJson(current.doc), ops);
      if (result.error) {
        return Response.json(
          { ok: false, error: result.error, code: 'INVALID_PATCH' },
          { status: 400 },
        );
      }
      if (JSON.stringify(result.doc).length > MAX_STATE_DOC_CHARS) {
        return Response.json(
          { ok: false, error: 'State document exceeds 64 KB limit', code: 'STATE_TOO_LARGE' },
          { status: 413 },
        );
      }

      const nextVersion = current.version + 1;
      this.stateBuckets[stateKey] = {
        version: nextVersion,
        doc: result.doc,
      };
      const patchEnv = this.publishInternal({
        event: {
          type: 'state_patch',
          state_key: stateKey,
          version: nextVersion,
          ops,
        },
      });

      await Promise.all([
        this.persistEvents(),
        this.state.storage.put('stateBuckets', this.stateBuckets),
      ]);

      return Response.json({
        ok: true,
        key: stateKey,
        version: nextVersion,
        doc: result.doc,
        applied: result.applied,
        dirty: true,
        event: patchEnv,
      });
    }

    return new Response('Not found', { status: 404 });
  }
}
