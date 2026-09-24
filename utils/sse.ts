/**
 * OpenAI-compatible SSE helpers including tool_calls deltas.
 */
import type { ToolCall } from '../types';

export interface SseChunk {
  text?: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
  raw?: unknown;
}

/**
 * Parses raw SSE response into string event payloads (lines following 'data: ').
 * Terminates automatically when '[DONE]' sentinel is encountered.
 */
export async function* parseSseDataLines(response: Response): AsyncIterable<string> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') return;
        yield dataStr;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

type ToolCallAcc = {
  id: string;
  name: string;
  arguments: string;
};

/**
 * Merge streamed tool_calls deltas into complete ToolCall objects.
 */
export function accumulateToolCallDeltas(
  acc: Map<number, ToolCallAcc>,
  deltas: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>,
): void {
  for (const d of deltas) {
    const idx = typeof d.index === 'number' ? d.index : 0;
    const cur = acc.get(idx) || { id: '', name: '', arguments: '' };
    if (d.id) cur.id = d.id;
    if (d.function?.name) cur.name = (cur.name || '') + d.function.name;
    if (d.function?.arguments) cur.arguments += d.function.arguments;
    acc.set(idx, cur);
  }
}

export function finalizeToolCalls(acc: Map<number, ToolCallAcc>): ToolCall[] {
  const out: ToolCall[] = [];
  for (const [, v] of [...acc.entries()].sort((a, b) => a[0] - b[0])) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = v.arguments ? JSON.parse(v.arguments) : {};
    } catch {
      parsed = { _raw: v.arguments };
    }
    out.push({
      id: v.id || `call_${out.length}`,
      name: v.name || 'unknown',
      arguments: parsed,
    });
  }
  return out;
}

/**
 * Parses an OpenAI-compatible SSE text stream (Groq, NVIDIA NIM, FreeLLM, OpenRouter, Ollama).
 * Yields text tokens and finalized toolCalls when the stream ends with tool_calls.
 */
export async function* parseOpenAiSseStream(response: Response): AsyncIterable<SseChunk> {
  const toolAcc = new Map<number, ToolCallAcc>();
  let finishReason: string | undefined;

  for await (const dataStr of parseSseDataLines(response)) {
    try {
      const parsed = JSON.parse(dataStr);
      const choice = parsed.choices?.[0];
      const delta = choice?.delta;
      if (delta?.content) {
        yield { text: delta.content, raw: parsed };
      }
      if (Array.isArray(delta?.tool_calls)) {
        accumulateToolCallDeltas(toolAcc, delta.tool_calls);
      }
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }
    } catch {
      // Ignore parse errors on partial stream chunks
    }
  }

  if (toolAcc.size > 0) {
    yield {
      toolCalls: finalizeToolCalls(toolAcc),
      finishReason: finishReason || 'tool_calls',
    };
  } else if (finishReason) {
    yield { finishReason };
  }
}

/** Map GenerateOptions.tools to OpenAI chat tools payload. */
export function toOpenAiToolsPayload(
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: 'object', properties: {} },
    },
  }));
}
