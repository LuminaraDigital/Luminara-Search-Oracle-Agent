/**
 * Clock-Free K-Way Causal Subagent Stream Merge.
 * Adapted from temporal-community/temporal-agent-harness
 * (temporal_agent_harness/harness/stream_merge/gates.py & merge.py, MIT License,
 * Copyright (c) 2026 Temporal Technologies Inc.).
 *
 * Enforces two happens-before brackets without relying on wall-clock timestamps:
 * 1. Open Gate: A child stream's events for `turn_number > 0` are held until the parent
 *    emits `subagent_message_sent(workflow_id, subagent_turn)`.
 * 2. Close Gate: A parent's `subagent_reply_received(workflow_id, subagent_turn)` is held
 *    until the child emits `turn_end` for that turn, or the child is marked `gone`
 *    (which synthesizes `subagent_stream_unavailable` so a dead subagent never wedges the parent).
 * No em dashes in copy.
 */

import type { AgentEventEnvelope } from './harnessProtocol';

export interface MountChildInstruction {
  kind: 'mount';
  workflow_id: string;
  from_offset: number;
  subagent_id: string;
}

export interface UnmountChildInstruction {
  kind: 'unmount';
  workflow_id: string;
}

export type GateDirective = MountChildInstruction | UnmountChildInstruction | null;

function turnKey(workflowId: string, turnNumber: number): string {
  return `${workflowId}#${turnNumber}`;
}

export class CausalStreamGates {
  readonly opened = new Set<string>();
  readonly childTurnEnded = new Set<string>();
  readonly gone = new Set<string>();

  /**
   * Record that a child stream is unreachable or stalled so its close gates release.
   */
  markGone(workflowId: string): void {
    this.gone.add(workflowId);
  }

  /**
   * True when `ev` from `sourceWorkflowId` satisfies all causal brackets and may be emitted now.
   */
  ready(opts: {
    isChild: boolean;
    sourceWorkflowId: string;
    ev: AgentEventEnvelope;
  }): boolean {
    const { isChild, sourceWorkflowId, ev } = opts;

    // OPEN gate: child turn > 0 waits for parent's subagent_message_sent.
    // Turn 0 is exempt (initial state snapshot / setup outside any turn bracket).
    if (
      isChild &&
      ev.turn_number !== 0 &&
      !this.opened.has(turnKey(sourceWorkflowId, ev.turn_number))
    ) {
      return false;
    }

    // CLOSE gate: parent's subagent_reply_received waits for child's turn_end (unless child is gone).
    if (ev.event.type === 'subagent_reply_received') {
      const targetWf = ev.event.workflow_id;
      const key = turnKey(targetWf, ev.event.subagent_turn);
      if (!this.childTurnEnded.has(key) && !this.gone.has(targetWf)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Record that `ev` was emitted on the merged stream and return mount/unmount directives.
   */
  onEmit(opts: {
    isChild: boolean;
    sourceWorkflowId: string;
    ev: AgentEventEnvelope;
  }): GateDirective {
    const { isChild, sourceWorkflowId, ev } = opts;

    if (ev.event.type === 'subagent_message_sent') {
      this.opened.add(turnKey(ev.event.workflow_id, ev.event.subagent_turn));
      return {
        kind: 'mount',
        workflow_id: ev.event.workflow_id,
        from_offset: ev.event.from_offset,
        subagent_id: ev.event.subagent_id,
      };
    }

    if (ev.event.type === 'subagent_stopped') {
      return {
        kind: 'unmount',
        workflow_id: ev.event.workflow_id,
      };
    }

    if (isChild && ev.event.type === 'turn_end') {
      this.childTurnEnded.add(turnKey(sourceWorkflowId, ev.turn_number));
    }

    return null;
  }

  /**
   * True if `workflowId` had an opened turn that never emitted `turn_end`.
   */
  abandonedTurn(workflowId: string): boolean {
    const prefix = `${workflowId}#`;
    for (const k of this.opened) {
      if (k.startsWith(prefix) && !this.childTurnEnded.has(k)) {
        return true;
      }
    }
    return false;
  }
}

export interface StreamSource {
  workflowId: string;
  subagentId?: string;
  isChild: boolean;
  events: readonly AgentEventEnvelope[];
}

/**
 * Deterministically merge a root agent stream and child subagent streams using causal brackets.
 * Any child stream that ends or is missing before satisfying an open turn is marked `gone`,
 * emitting a synthetic `subagent_stream_unavailable` frame and unblocking the parent stream.
 */
export function mergeCausalStreams(sources: readonly StreamSource[]): AgentEventEnvelope[] {
  const gates = new CausalStreamGates();
  const cursors = new Map<string, { source: StreamSource; index: number }>();
  const subagentIds = new Map<string, string>();
  const availableChildSources = new Map<string, StreamSource>();

  for (const src of sources) {
    if (src.subagentId) {
      subagentIds.set(src.workflowId, src.subagentId);
    }
    if (!src.isChild) {
      cursors.set(src.workflowId, { source: src, index: 0 });
    } else {
      availableChildSources.set(src.workflowId, src);
    }
  }

  const output: AgentEventEnvelope[] = [];

  const giveUpOnChild = (workflowId: string) => {
    if (gates.gone.has(workflowId)) {
      cursors.delete(workflowId);
      return;
    }
    if (gates.abandonedTurn(workflowId)) {
      const subId = subagentIds.get(workflowId) || workflowId;
      output.push({
        offset: 0,
        agent_id: subId,
        turn_id: '',
        turn_number: 0,
        timestamp: 0,
        event: {
          type: 'subagent_stream_unavailable',
          subagent_id: subId,
          workflow_id: workflowId,
          reason: 'subagent stream unavailable or stalled before delivering turn_end',
        },
      });
    }
    gates.markGone(workflowId);
    cursors.delete(workflowId);
  };

  while (true) {
    let progressed = false;

    for (const [wfId, cursor] of [...cursors.entries()]) {
      while (cursor.index < cursor.source.events.length) {
        const head = cursor.source.events[cursor.index]!;
        if (
          !gates.ready({
            isChild: cursor.source.isChild,
            sourceWorkflowId: wfId,
            ev: head,
          })
        ) {
          break;
        }

        cursor.index++;
        output.push(head);
        progressed = true;

        const directive = gates.onEmit({
          isChild: cursor.source.isChild,
          sourceWorkflowId: wfId,
          ev: head,
        });

        if (directive?.kind === 'mount') {
          subagentIds.set(directive.workflow_id, directive.subagent_id);
          if (!cursors.has(directive.workflow_id) && !gates.gone.has(directive.workflow_id)) {
            const childSrc = availableChildSources.get(directive.workflow_id);
            if (childSrc) {
              const startIdx = childSrc.events.findIndex((e) => e.offset >= directive.from_offset);
              cursors.set(directive.workflow_id, {
                source: childSrc,
                index: startIdx >= 0 ? startIdx : childSrc.events.length,
              });
            } else {
              giveUpOnChild(directive.workflow_id);
            }
          }
        } else if (directive?.kind === 'unmount') {
          cursors.delete(directive.workflow_id);
        }
      }
    }

    if (progressed) continue;

    // No cursor could advance. Check if any parent is blocked on a child's close gate.
    const blockedChildWfIds: string[] = [];
    for (const [wfId, cursor] of cursors.entries()) {
      const head = cursor.source.events[cursor.index];
      if (
        head &&
        head.event.type === 'subagent_reply_received' &&
        !gates.ready({ isChild: cursor.source.isChild, sourceWorkflowId: wfId, ev: head })
      ) {
        blockedChildWfIds.push(head.event.workflow_id);
      }
    }

    if (blockedChildWfIds.length > 0) {
      for (const stuckWfId of blockedChildWfIds) {
        giveUpOnChild(stuckWfId);
      }
      continue;
    }

    break;
  }

  return output;
}
