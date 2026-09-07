import type { ChatTurn, GenerateOptions } from '../../types';

export const MAX_HISTORY_TURNS = 20;

/** OpenAI-style message array: system, then trimmed prior turns, then the new user prompt. */
export function buildChatMessages(prompt: string, options?: Pick<GenerateOptions, 'systemPrompt' | 'history'>): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (options?.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  const history = (options?.history ?? []).filter(t => t.content && t.content.trim()).slice(-MAX_HISTORY_TURNS);
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

/** Convert stored chat messages into provider-neutral turns (drops empty/error placeholders). */
export const toChatHistory = (messages: Array<{ role: string; content: string; isError?: boolean }>): ChatTurn[] =>
  messages
    .filter(m => !m.isError && (m.role === 'user' || m.role === 'model' || m.role === 'assistant') && m.content && m.content.trim())
    .map(m => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.content }));
