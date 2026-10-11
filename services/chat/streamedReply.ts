/**
 * Builds the chat message for one reply from the stream chunks that arrive for it.
 *
 * Pure: no React, no storage. App.tsx makes a new reply for every send and folds each chunk in,
 * so what a reply carries (its text, its sources, its tool runs, and the marker that says a
 * fallback model wrote it) can only come from that reply's own chunks.
 */
import type { FallbackAnswerInfo, Message, StreamChunk, ToolExecution } from '../../types';

export interface StreamedReply {
  text: string;
  groundingUrls: Array<{ uri: string; title: string }>;
  toolExecutions: ToolExecution[];
  /** Set when a chunk said the Worker's fallback model is writing this reply. */
  fallback?: FallbackAnswerInfo;
}

export function newStreamedReply(): StreamedReply {
  return { text: '', groundingUrls: [], toolExecutions: [] };
}

/** Folds one chunk into a reply and returns the new reply. The one passed in is not changed. */
export function addStreamChunk(reply: StreamedReply, chunk: StreamChunk): StreamedReply {
  const next: StreamedReply = { ...reply };
  if (chunk.toolExecution) next.toolExecutions = [...reply.toolExecutions, chunk.toolExecution];
  if (chunk.groundingUrls?.length) {
    const seen = new Set(reply.groundingUrls.map((u) => u.uri));
    const added = chunk.groundingUrls.filter((u) => {
      if (seen.has(u.uri)) return false;
      seen.add(u.uri);
      return true;
    });
    if (added.length) next.groundingUrls = [...reply.groundingUrls, ...added];
  }
  // A later marker replaces an earlier one: the last chunk may add that the reply was cut off.
  if (chunk.fallback) next.fallback = chunk.fallback;
  if (chunk.text) next.text = reply.text + chunk.text;
  return next;
}

/**
 * The chat message as it should be shown for this reply. `done` ends the streaming state;
 * `stopped` is the user pressing stop, which leaves a "Stopped." note when nothing had arrived.
 */
export function replyToMessage(
  message: Message,
  reply: StreamedReply,
  state: { done: boolean; stopped?: boolean },
): Message {
  return {
    ...message,
    content: state.done ? reply.text || (state.stopped ? '*Stopped.*' : '') : reply.text,
    groundingUrls: reply.groundingUrls.length ? reply.groundingUrls : undefined,
    toolExecutions: reply.toolExecutions.length ? reply.toolExecutions : undefined,
    fallback: reply.fallback,
    ...(state.done ? { isStreaming: false } : {}),
  };
}

/**
 * Whether a finished reply may be kept as a chat insight in brand memory. A reply the fallback
 * model wrote is not: the memory entry has no place for the "fallback model" label, and without
 * it the text would be stored as if the asked engine had written it.
 */
export function replyIsMemorable(reply: StreamedReply, state: { stopped: boolean; skipSearch?: boolean }): boolean {
  return Boolean(reply.text) && !state.stopped && !state.skipSearch && !reply.fallback;
}
