/**
 * Shared OpenAI chat-completions tool wiring for native providers.
 */
import type { GenerateOptions, ToolCall } from '../../types';
import { toOpenAiToolsPayload } from '../../utils/sse';

export function applyToolsToChatBody(
  body: Record<string, unknown>,
  options?: GenerateOptions,
): void {
  const tools = toOpenAiToolsPayload(options?.tools);
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
}

export function parseToolCallsFromMessage(message: unknown): ToolCall[] | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const toolCalls = (message as { tool_calls?: unknown[] }).tool_calls;
  if (!Array.isArray(toolCalls) || !toolCalls.length) return undefined;
  return toolCalls.map((tc, i) => {
    const t = tc as {
      id?: string;
      function?: { name?: string; arguments?: string };
    };
    let args: Record<string, unknown> = {};
    try {
      args = t.function?.arguments ? JSON.parse(t.function.arguments) : {};
    } catch {
      args = { _raw: t.function?.arguments };
    }
    return {
      id: t.id || `call_${i}`,
      name: t.function?.name || 'unknown',
      arguments: args,
    };
  });
}

export function finishReasonFromChoice(choice: unknown): string | undefined {
  if (!choice || typeof choice !== 'object') return undefined;
  return (choice as { finish_reason?: string }).finish_reason;
}
