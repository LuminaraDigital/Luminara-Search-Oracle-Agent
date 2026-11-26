/**
 * Multi-round OpenAI-style tool calling loop.
 */
import type { ChatTurn, GenerateOptions, StreamChunk, ToolCall, ToolDefinition, ToolExecution } from '../../types';
import type { BaseAIProvider } from '../llm/providers/BaseAIProvider';
import { UNTRUSTED_CONTENT_RULE, wrapUntrustedContent } from '../../utils/untrustedContent';

export type ToolExecutor = (call: ToolCall) => Promise<{
  output: string;
  structured?: Record<string, unknown>;
  isError?: boolean;
}>;

export type ToolLoopOptions = {
  provider: BaseAIProvider;
  prompt: string;
  generateOptions?: GenerateOptions;
  tools: ToolDefinition[];
  executeTool: ToolExecutor;
  maxRounds?: number;
  /** Yield intermediate stream chunks (text + toolExecution). */
  onChunk?: (chunk: StreamChunk) => void;
};

export type ToolLoopResult = {
  text: string;
  toolExecutions: ToolExecution[];
  rounds: number;
};

/**
 * Run generate -> tool_calls -> execute -> continue until text finish or maxRounds.
 * Uses non-streaming generateText for tool rounds (simpler + reliable across providers).
 */
export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  const maxRounds = opts.maxRounds ?? 4;
  const toolExecutions: ToolExecution[] = [];
  let history: ChatTurn[] = [...(opts.generateOptions?.history || [])];
  let prompt = opts.prompt;
  let rounds = 0;
  let finalText = '';

  // Extra messages for tool results (OpenAI format) appended via systemPrompt injection is lossy.
  // Providers that only accept ChatTurn[] need an extension; we fold tool results into the next user prompt.
  let toolContext = '';

  const baseSystemPrompt = opts.generateOptions?.systemPrompt || '';
  const systemPrompt = baseSystemPrompt.includes(UNTRUSTED_CONTENT_RULE)
    ? baseSystemPrompt
    : baseSystemPrompt
      ? `${baseSystemPrompt}\n\n${UNTRUSTED_CONTENT_RULE}`
      : UNTRUSTED_CONTENT_RULE;

  while (rounds < maxRounds) {
    rounds += 1;
    const genOpts: GenerateOptions = {
      ...opts.generateOptions,
      history,
      tools: opts.tools,
      systemPrompt,
    };

    const effectivePrompt = toolContext
      ? `${prompt}\n\n[Tool results from prior round]\n${toolContext}`
      : prompt;

    const result = await opts.provider.generateText(effectivePrompt, genOpts);
    if (result.toolCalls?.length) {
      const results: Array<{ call: ToolCall; output: string }> = [];
      for (const call of result.toolCalls) {
        const exec = await opts.executeTool(call);
        const output = exec.output;
        toolExecutions.push({
          tool: call.name,
          args: call.arguments,
          output,
        });
        opts.onChunk?.({
          toolExecution: { tool: call.name, args: call.arguments, output },
        });
        results.push({ call, output });
      }
      toolContext = results
        .map((r) => wrapUntrustedContent(`TOOL_RESULT_${r.call.name}`, r.output, { nonce: true }))
        .filter(Boolean)
        .join('\n');
      history = [
        ...history,
        { role: 'user', content: prompt },
        { role: 'assistant', content: result.text || `(called ${result.toolCalls.map((c) => c.name).join(', ')})` },
      ];
      prompt = 'Continue with the tool results above and answer the user.';
      continue;
    }

    finalText = result.text || '';
    if (finalText) opts.onChunk?.({ text: finalText, finishReason: result.finishReason });
    break;
  }

  return { text: finalText, toolExecutions, rounds };
}
