/**
 * Durable Agent Harness Protocol & Tool Context Injection.
 * Adapted from temporal-community/temporal-agent-harness (packages/client/src/protocol.ts
 * and temporal_agent_harness/harness/agent.py, MIT License,
 * Copyright (c) 2026 Temporal Technologies Inc.).
 *
 * Defines the three harness planes:
 * 1. Interface Plane: Two-phase turn admission (`MidTurnPolicy`, `MessageDisposition`)
 * 2. Observability Plane: Offset-indexed `AgentEventEnvelope` and `AgentStreamItem` union
 * 3. Control Plane: Out-of-band tool approvals (`tool_approval_requested` / `resolved`),
 *    client callbacks (`callback_requested` / `resolved`), and `Injected<T>` schema stripping.
 * No em dashes in copy.
 */

import type { JsonPatchOp, JsonValue } from './jsonPatch';

export type MeasurementStatus = 'measured' | 'estimated' | 'not_measured' | 'unknown';

export type MidTurnPolicy = 'enqueue' | 'accept' | 'reject';
export type MessageDisposition = 'started' | 'enqueued' | 'joined' | 'rejected';

export interface MessageAcceptedEvent {
  type: 'message_accepted';
  message_id: string | null;
  message_type: string;
  disposition: MessageDisposition;
}

export interface TurnStartedEvent {
  type: 'turn_started';
}

export interface TurnEndedEvent {
  type: 'turn_end';
}

export interface ToolRequestedEvent {
  type: 'tool_requested';
  tool_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface ToolApprovalRequestedEvent {
  type: 'tool_approval_requested';
  tool_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  risk_tier?: string;
}

export interface ToolApprovalResolvedEvent {
  type: 'tool_approval_resolved';
  tool_id: string;
  tool_name: string;
  approved: boolean;
  reason: string | null;
  remember: boolean;
}

export interface ToolStartEvent {
  type: 'tool_start';
  tool_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface ToolProgressDeltaEvent {
  type: 'tool_progress_delta';
  tool_id: string;
  tool_name: string;
  progress_delta: string;
}

export interface ToolEndEvent {
  type: 'tool_end';
  tool_id: string;
  tool_name: string;
  tool_output: string;
  measurement_status?: MeasurementStatus;
}

export interface ToolErrorEvent {
  type: 'tool_error';
  tool_id: string;
  tool_name: string;
  message: string;
}

export interface CallbackRequestedEvent {
  type: 'callback_requested';
  tool_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface CallbackResolvedEvent {
  type: 'callback_resolved';
  tool_id: string;
  tool_name: string;
  output: string;
  is_error: boolean;
}

export interface SubagentStartedEvent {
  type: 'subagent_started';
  subagent_id: string;
  agent_key: string;
  workflow_id: string;
}

export interface SubagentMessageSentEvent {
  type: 'subagent_message_sent';
  subagent_id: string;
  agent_key: string;
  workflow_id: string;
  subagent_turn: number;
  from_offset: number;
}

export interface SubagentReplyReceivedEvent {
  type: 'subagent_reply_received';
  subagent_id: string;
  agent_key: string;
  workflow_id: string;
  subagent_turn: number;
}

export interface SubagentStoppedEvent {
  type: 'subagent_stopped';
  subagent_id: string;
  agent_key: string;
  workflow_id: string;
}

export interface SubagentStreamUnavailableEvent {
  type: 'subagent_stream_unavailable';
  subagent_id: string;
  workflow_id: string;
  reason: string;
}

export interface ReplyDeltaEvent {
  type: 'reply_delta';
  delta: string;
}

export interface AgentStateSnapshotEvent {
  type: 'state_snapshot';
  state_key: string;
  version: number;
  snapshot: JsonValue;
}

export interface AgentStatePatchEvent {
  type: 'state_patch';
  state_key: string;
  version: number;
  ops: JsonPatchOp[];
}

export type AgentStreamItem =
  | MessageAcceptedEvent
  | TurnStartedEvent
  | TurnEndedEvent
  | ToolRequestedEvent
  | ToolApprovalRequestedEvent
  | ToolApprovalResolvedEvent
  | ToolStartEvent
  | ToolProgressDeltaEvent
  | ToolEndEvent
  | ToolErrorEvent
  | CallbackRequestedEvent
  | CallbackResolvedEvent
  | SubagentStartedEvent
  | SubagentMessageSentEvent
  | SubagentReplyReceivedEvent
  | SubagentStoppedEvent
  | SubagentStreamUnavailableEvent
  | ReplyDeltaEvent
  | AgentStateSnapshotEvent
  | AgentStatePatchEvent;

export type AgentEventType = AgentStreamItem['type'];

/**
 * Durable event envelope persisted in `OracleSession` with monotonic offset.
 */
export interface AgentEventEnvelope {
  offset: number;
  agent_id: string;
  turn_id: string;
  turn_number: number;
  timestamp: number;
  event: AgentStreamItem;
}

// ============================================================================
// Context Injection & Control-Plane Isolation (`Injected<T>`)
// ============================================================================

/**
 * Parameters that are injected by the server/workflow context and must NEVER
 * be exposed in LLM-facing tool schemas or overridden by model-supplied arguments.
 */
export const INJECTED_CONTEXT_KEYS: ReadonlySet<string> = new Set([
  'accountId',
  'account_id',
  'userId',
  'user_id',
  'projectId',
  'project_id',
  'dataForSeoCredential',
  'pagespeedApiKey',
  'runId',
  'run_id',
  'sessionId',
  'session_id',
  '__injected',
]);

/**
 * Control-plane operations that must never be listed in the LLM tool catalogue
 * so a parent agent or model can never rubber-stamp a tool approval gate.
 */
export const CONTROL_PLANE_RESERVED_NAMES: ReadonlySet<string> = new Set([
  'tool_approval',
  'approve_tool',
  'deny_tool',
  'provide_callback_result',
  'set_approval_policy',
  'close_session',
]);

export function isControlPlaneToolName(name: string): boolean {
  return CONTROL_PLANE_RESERVED_NAMES.has(String(name || '').trim().toLowerCase());
}

export interface ToolJsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Strips `INJECTED_CONTEXT_KEYS` from a tool's JSON schema before presenting it to an LLM.
 */
export function sanitizeToolSchemaForLlm(schema: ToolJsonSchema): ToolJsonSchema {
  const rawProps = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const cleanProps: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawProps)) {
    if (!INJECTED_CONTEXT_KEYS.has(k)) {
      cleanProps[k] = v;
    }
  }
  const cleanRequired = Array.isArray(schema.required)
    ? schema.required.filter((k) => !INJECTED_CONTEXT_KEYS.has(k))
    : undefined;

  return {
    ...schema,
    type: 'object',
    properties: cleanProps,
    ...(cleanRequired ? { required: cleanRequired } : {}),
  };
}

/**
 * Strips any model-supplied injected keys from `modelArgs` (model-visible input for approval cards)
 * and binds authoritative `injections` for actual tool execution.
 */
export function bindInjectedToolArgs(
  modelArgs: Record<string, unknown> | undefined | null,
  injections: Record<string, unknown>,
): {
  modelFacingInput: Record<string, unknown>;
  executionArgs: Record<string, unknown>;
} {
  const safeModelInput: Record<string, unknown> = {};
  if (modelArgs && typeof modelArgs === 'object') {
    for (const [k, v] of Object.entries(modelArgs)) {
      if (
        !INJECTED_CONTEXT_KEYS.has(k) &&
        k !== '__proto__' &&
        k !== 'constructor' &&
        k !== 'prototype'
      ) {
        safeModelInput[k] = v;
      }
    }
  }
  return {
    modelFacingInput: safeModelInput,
    executionArgs: {
      ...safeModelInput,
      ...injections,
    },
  };
}
