/**
 * One Oracle chat turn in tool-loop mode, as worker/oracleChat.ts uses it: run the loop with its
 * events mapped onto the chat's SSE frames and harness events, then, after the caller's checks,
 * send the answer. The caller owns admission, history and the done frame.
 */
import type { Env } from '../env';
import type { AgentStreamItem } from '../../services/agentCore/harnessProtocol';
import { parkAction } from './approvals';
import { runAgentLoop, stripUncheckedUrls, type LoopEvent, type LoopResult } from './loop';
import type { ChatMessage } from './modelCall';
import type { AgentToolContext } from './types';

type Write = (event: string, data: unknown) => Promise<void>;
type SessionStub = { fetch: (input: string, init?: RequestInit) => Promise<Response> };

/** No new tool round starts after this long; the loop then writes its answer (Blueprint s13 item 7). */
export const AGENT_TURN_BUDGET_MS = 30_000;
/** Cap for tool output copied into the harness event log. */
const HARNESS_OUTPUT_CHARS = 2048;
/** Answer frames: large enough to be few, small enough to render as a stream. */
const ANSWER_CHUNK_CHARS = 1000;
/**
 * History the tool loop sees: the last three exchanges, earlier answers shortened. On staging a
 * long history of similar answers made the model repeat an earlier answer instead of answering
 * the new question (Blueprint section 15).
 */
export const AGENT_HISTORY_TURNS = 6;
export const AGENT_HISTORY_ANSWER_CHARS = 800;

export function agentHistory<T extends { role: string; content: string }>(turns: T[]): T[] {
  return turns.slice(-AGENT_HISTORY_TURNS).map((turn) =>
    turn.role === 'assistant' && turn.content.length > AGENT_HISTORY_ANSWER_CHARS
      ? { ...turn, content: `${turn.content.slice(0, AGENT_HISTORY_ANSWER_CHARS)} [earlier answer shortened]` }
      : turn,
  );
}

function eventMapper(write: Write, emitHarnessEvents: (items: AgentStreamItem[]) => Promise<void>) {
  return async (ev: LoopEvent): Promise<void> => {
    switch (ev.type) {
      case 'status':
        await write('status', { stage: 'working', text: ev.text });
        return;
      case 'tool_running':
        await emitHarnessEvents([{ type: 'tool_start', tool_id: ev.callId, tool_name: ev.tool, tool_input: ev.args }]);
        await write('tool', { tool: ev.tool, toolId: ev.callId, stage: 'running' });
        return;
      case 'tool_done':
        await emitHarnessEvents([
          {
            type: 'tool_end',
            tool_id: ev.callId,
            tool_name: ev.tool,
            tool_output: ev.output.slice(0, HARNESS_OUTPUT_CHARS),
            measurement_status: ev.receipt.measured ? 'measured' : 'not_measured',
          },
        ]);
        await write('tool', {
          tool: ev.tool,
          toolId: ev.callId,
          stage: ev.receipt.status === 'error' ? 'error' : 'done',
          summary: ev.receipt.summary,
          measured: ev.receipt.measured,
        });
        return;
      case 'tool_blocked':
        await write('tool', { tool: ev.tool, toolId: ev.callId, stage: 'blocked', reason: ev.reason });
        return;
      case 'needs_approval':
        await write('tool', {
          tool: ev.tool,
          toolId: ev.callId,
          stage: 'needs_approval',
          actionId: ev.actionId,
          preview: ev.preview,
          costNote: ev.costNote,
          // Every slice-1 card is marked (approvals.ts); the client shows the warning from this.
          tainted: true,
          expiresAt: ev.expiresAt,
        });
        return;
    }
  };
}

export async function runAgentChatTurn(opts: {
  env: Env;
  ctx: AgentToolContext;
  messages: ChatMessage[];
  write: Write;
  emitHarnessEvents: (items: AgentStreamItem[]) => Promise<void>;
  sessionStub: SessionStub | null;
  turnId: string;
  isClientGone: () => boolean;
}): Promise<LoopResult> {
  const { ctx, sessionStub } = opts;
  return runAgentLoop({
    env: opts.env,
    ctx,
    messages: opts.messages,
    emit: eventMapper(opts.write, opts.emitHarnessEvents),
    park: (tool, prepared) =>
      sessionStub
        ? parkAction({ stub: sessionStub, tool, prepared, ctx, turnId: opts.turnId })
        : Promise.resolve({ ok: false as const, error: 'approval cards need the session store' }),
    isClientGone: opts.isClientGone,
    deadlineAt: Date.now() + AGENT_TURN_BUDGET_MS,
  });
}

/**
 * Send a checked answer: links not from this turn's tools, the project or Luminara are removed,
 * then the text and any warnings go out. Returns the text as sent, without the warnings.
 */
export async function sendAgentAnswer(opts: {
  text: string;
  warnings: string[];
  sourceUrls: string[];
  projectDomain: string | null;
  write: Write;
}): Promise<string> {
  const sourced = stripUncheckedUrls(opts.text, { sourceUrls: opts.sourceUrls, projectDomain: opts.projectDomain });
  if (sourced.removed > 0) console.warn(JSON.stringify({ event: 'oracle_link_removed', links: sourced.removed }));
  const outgoing = [sourced.text, ...opts.warnings].filter(Boolean).join('\n\n');
  for (let i = 0; i < outgoing.length; i += ANSWER_CHUNK_CHARS) {
    await opts.write('token', { text: outgoing.slice(i, i + ANSWER_CHUNK_CHARS) });
  }
  return sourced.text;
}
