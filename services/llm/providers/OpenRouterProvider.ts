import { 
  AIProviderType, 
  GenerateOptions, 
  GenerateResult, 
  StreamChunk, 
  GenerateFinishReason 
} from '../../../types';
import { configService } from '../../configService';
import { providerFetch } from '../../apiClient';
import { buildChatMessages } from '../../chat/messages';
import { parseOpenAiSseStream } from '../../../utils/sse';
import { BaseAIProvider } from './BaseAIProvider';

/**
 * OpenRouter Provider (Frontier Multi-Model Router: Claude 3.5, GPT-4o, DeepSeek R1, Llama 3.3)
 */
export class OpenRouterProvider extends BaseAIProvider {
  id = 'openrouter';
  name = 'OpenRouter Frontier Intelligence';
  type: AIProviderType = 'openrouter';
  config = {
    model: 'openai/gpt-4o',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    temperature: 0.7,
    maxTokens: 4096,
  };
  capabilities = {
    streaming: true,
    functionCalling: true,
    vision: true,
    audio: false,
    maxContextLength: 128000,
  };

  private getActiveApiKey(): string {
    const byok = configService.getByokKey('luminara_openrouter_key');
    return byok || configService.getOpenRouterKey();
  }

  async isAvailable(): Promise<boolean> {
    const key = this.getActiveApiKey();
    if (!key) return false;
    if (key === 'proxy') return configService.usesProxy('openrouter');
    return true;
  }

  async generateText(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const key = this.getActiveApiKey();
    const model = options?.model || this.config.model;
    const startTime = Date.now();
    const messages = buildChatMessages(prompt, options);

    const body: any = {
      model,
      messages,
      temperature: options?.temperature ?? this.config.temperature,
      max_tokens: options?.maxTokens ?? this.config.maxTokens,
    };

    if (options?.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://luminarasuite.com',
      'X-Title': 'Luminara Suite',
    };
    if (key && key !== 'proxy') {
      headers.Authorization = `Bearer ${key}`;
    }

    const response = await providerFetch('openrouter', '/chat/completions', this.config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, { userKey: key });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter error (${response.status}): ${errText}`);
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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://luminarasuite.com',
      'X-Title': 'Luminara Suite',
    };
    if (key && key !== 'proxy') {
      headers.Authorization = `Bearer ${key}`;
    }

    const response = await providerFetch('openrouter', '/chat/completions', this.config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: options?.temperature ?? this.config.temperature,
        max_tokens: options?.maxTokens ?? this.config.maxTokens,
        stream: true,
      }),
    }, { userKey: key });

    if (!response.ok || !response.body) {
      const errText = await response.text();
      throw new Error(`OpenRouter stream error (${response.status}): ${errText}`);
    }

    for await (const chunk of parseOpenAiSseStream(response)) {
      if (chunk.text) {
        yield { text: chunk.text };
      }
    }
  }
}
