import { 
  AIProviderType, 
  GenerateOptions, 
  GenerateResult, 
  StreamChunk, 
  GenerateFinishReason 
} from '../../../types';
import { configService } from '../../configService';
import { buildChatMessages } from '../../chat/messages';
import { parseOpenAiSseStream } from '../../../utils/sse';
import { BaseAIProvider } from './BaseAIProvider';

/**
 * FreeLLMAPI Gateway Provider (BYOK sidecar)
 * OpenAI-compatible `/v1` against a local or self-hosted FreeLLMAPI router.
 * Uses direct browser fetch (not Worker-hosted keys) so localhost sidecars work.
 */
export class FreeLlmProvider extends BaseAIProvider {
  id = 'freellm';
  name = 'FreeLLMAPI Gateway';
  type: AIProviderType = 'freellm';
  config = {
    model: 'auto',
    endpoint: 'http://localhost:3001/v1/chat/completions',
    temperature: 0.7,
    maxTokens: 4096,
  };
  capabilities = {
    streaming: true,
    functionCalling: true,
    vision: true,
    audio: true,
    maxContextLength: 128000,
  };

  private getActiveApiKey(): string {
    return configService.getFreeLlmKey();
  }

  private chatUrl(): string {
    return `${configService.getFreeLlmBaseUrl()}/chat/completions`;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.getActiveApiKey());
  }

  async generateText(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const key = this.getActiveApiKey();
    const model = options?.model || this.config.model;
    const startTime = Date.now();
    const messages = buildChatMessages(prompt, options);

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options?.temperature ?? this.config.temperature,
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
    };

    if (options?.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(this.chatUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`FreeLLMAPI error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const latencyMs = Date.now() - startTime;
    const usage = data.usage || {};

    return {
      text,
      tokenUsage: {
        prompt: usage.prompt_tokens || this.estimateTokens(prompt),
        completion: usage.completion_tokens || this.estimateTokens(text),
        total: usage.total_tokens || (this.estimateTokens(prompt) + this.estimateTokens(text)),
      },
      finishReason: (data.choices?.[0]?.finish_reason as GenerateFinishReason) || 'stop',
      latencyMs,
    };
  }

  async *streamText(prompt: string, options?: GenerateOptions): AsyncIterable<StreamChunk> {
    const key = this.getActiveApiKey();
    const model = options?.model || this.config.model;
    const messages = buildChatMessages(prompt, options);

    const response = await fetch(this.chatUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options?.temperature ?? this.config.temperature,
        max_tokens: options?.maxTokens ?? this.config.maxTokens,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const errText = await response.text();
      throw new Error(`FreeLLMAPI stream error (${response.status}): ${errText}`);
    }

    for await (const chunk of parseOpenAiSseStream(response)) {
      if (chunk.text) {
        yield { text: chunk.text };
      }
    }
  }
}
