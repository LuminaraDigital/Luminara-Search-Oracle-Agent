import { describe, expect, it, vi } from 'vitest';
import { accumulateToolCallDeltas, finalizeToolCalls, parseOpenAiSseStream } from '../utils/sse';
import { runToolLoop } from '../services/tools/runToolLoop';
import { applyToolsToChatBody, parseToolCallsFromMessage } from '../services/llm/openaiTools';
import type { BaseAIProvider } from '../services/llm/providers/BaseAIProvider';
import type { GenerateResult, ToolDefinition } from '../types';

describe('openai tools helpers', () => {
  it('applies tools to chat body', () => {
    const body: Record<string, unknown> = { model: 'x', messages: [] };
    applyToolsToChatBody(body, {
      tools: [{ name: 'live_search', description: 'search', parameters: { type: 'object' } }],
    });
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toBe('auto');
  });

  it('parses tool_calls from completion message', () => {
    const calls = parseToolCallsFromMessage({
      tool_calls: [
        {
          id: 'c1',
          function: { name: 'live_search', arguments: '{"query":"seo"}' },
        },
      ],
    });
    expect(calls?.[0]?.name).toBe('live_search');
    expect(calls?.[0]?.arguments).toEqual({ query: 'seo' });
  });
});

describe('SSE tool_calls accumulation', () => {
  it('merges deltas into tool calls', () => {
    const acc = new Map();
    accumulateToolCallDeltas(acc, [
      { index: 0, id: 'c1', function: { name: 'live_', arguments: '' } },
      { index: 0, function: { name: 'search', arguments: '{"q"' } },
      { index: 0, function: { arguments: ':"x"}' } },
    ]);
    const calls = finalizeToolCalls(acc);
    expect(calls[0]?.name).toBe('live_search');
    expect(calls[0]?.arguments).toEqual({ q: 'x' });
  });

  it('parseOpenAiSseStream yields toolCalls', async () => {
    const payload = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"1","function":{"name":"live_search","arguments":"{\\"query\\":\\"a\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const response = new Response(payload, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const chunks = [];
    for await (const c of parseOpenAiSseStream(response)) chunks.push(c);
    expect(chunks.some((c) => c.toolCalls?.length)).toBe(true);
  });
});

describe('runToolLoop', () => {
  it('invokes registry-style executor on tool_calls then returns text', async () => {
    let round = 0;
    const provider = {
      generateText: vi.fn(async (): Promise<GenerateResult> => {
        round += 1;
        if (round === 1) {
          return {
            text: '',
            tokenUsage: { prompt: 1, completion: 0, total: 1 },
            finishReason: 'tool_calls',
            toolCalls: [{ id: '1', name: 'live_search', arguments: { query: 'test' } }],
          };
        }
        return {
          text: 'Final answer',
          tokenUsage: { prompt: 1, completion: 2, total: 3 },
          finishReason: 'stop',
        };
      }),
    } as unknown as BaseAIProvider;

    const tools: ToolDefinition[] = [
      { name: 'live_search', description: 'search', parameters: { type: 'object' } },
    ];
    const result = await runToolLoop({
      provider,
      prompt: 'hello',
      tools,
      executeTool: async (call) => ({ output: `ran ${call.name}` }),
      maxRounds: 3,
    });
    expect(result.toolExecutions).toHaveLength(1);
    expect(result.toolExecutions[0]?.tool).toBe('live_search');
    expect(result.text).toBe('Final answer');
    expect(result.rounds).toBe(2);
  });
});
