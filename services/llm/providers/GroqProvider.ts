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
import {
  GROQ_DEFAULT_MODEL,
  groqModelCandidates,
  isMissingModelStatus,
} from '../nativeModelDefaults';
import { parseOpenAiSseStream } from '../../../utils/sse';
import { BaseAIProvider } from './BaseAIProvider';

function isGroqModelMissingStatus(status: number, body: string): boolean {
  return isMissingModelStatus(status, body);
}

/**
 * Groq Cloud Provider (Ultra-Fast LPU: GPT-OSS / Qwen)
 */
export class GroqProvider extends BaseAIProvider {
  id = 'groq';
  name = 'Groq Cloud Engine';
  type: AIProviderType = 'groq';
  config = {
    model: GROQ_DEFAULT_MODEL,
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    temperature: 0.7,
    maxTokens: 4096,
  };
  capabilities = {
    streaming: true,
    functionCalling: true,
    vision: false,
    audio: false,
    maxContextLength: 128000,
  };

  private getActiveApiKey(): string {
    return configService.getGroqKey() || configService.getGroqFallbackKey();
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.getActiveApiKey());
  }

  async generateText(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const key = configService.getGroqKey();
    const fallbackKey = configService.getGroqFallbackKey();
    const startTime = Date.now();
    const messages = buildChatMessages(prompt, options);
    const models = groqModelCandidates(options?.model);

    const doFetch = async (apiKey: string, model: string) => {
      const body: any = {
        model,
        messages,
        temperature: options?.temperature ?? this.config.temperature,
        max_tokens: options?.maxTokens ?? this.config.maxTokens,
      };

      if (options?.jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      return await providerFetch('groq', '/chat/completions', this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      }, { userKey: apiKey });
    };

    let response: Response | null = null;
    let lastErrText = '';
    let usedModel = models[0];

    for (const model of models) {
      usedModel = model;
      let apiKey = key || fallbackKey;
      try {
        response = await doFetch(apiKey, model);
        if (response.status === 429 && fallbackKey && key !== fallbackKey) {
          console.warn('[Groq] Rate limit hit on primary key, rotating to fallback key...');
          response = await doFetch(fallbackKey, model);
          apiKey = fallbackKey;
        }
      } catch (e: any) {
        if (fallbackKey && key !== fallbackKey) {
          response = await doFetch(fallbackKey, model);
        } else {
          throw e;
        }
      }

      if (response.ok) break;
      lastErrText = await response.text();
      if (isGroqModelMissingStatus(response.status, lastErrText) && model !== models[models.length - 1]) {
        console.warn(`[Groq] Model ${model} unavailable (${response.status}); trying next candidate...`);
        continue;
      }
      throw new Error(`Groq inference error (${response.status}): ${lastErrText}`);
    }

    if (!response || !response.ok) {
      throw new Error(`Groq inference error: ${lastErrText || 'no response'}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    const latencyMs = Date.now() - startTime;
    const usage = data.usage || {};
    this.config.model = usedModel;

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
    if (!key) throw new Error('Groq API Key not configured');

    const messages = buildChatMessages(prompt, options);
    const models = groqModelCandidates(options?.model);

    let response: Response | null = null;
    let lastErrText = '';
    let usedModel = models[0];

    for (const model of models) {
      usedModel = model;
      response = await providerFetch('groq', '/chat/completions', this.config.endpoint, {
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
      }, { userKey: key });

      if (response.ok && response.body) break;
      lastErrText = await response.text();
      if (isGroqModelMissingStatus(response.status, lastErrText) && model !== models[models.length - 1]) {
        console.warn(`[Groq] Model ${model} unavailable (${response.status}); trying next candidate...`);
        continue;
      }
      throw new Error(`Groq stream error: ${response.status} ${lastErrText}`);
    }

    if (!response?.ok || !response.body) {
      throw new Error(`Groq stream error: ${lastErrText || 'no response body'}`);
    }

    this.config.model = usedModel;
    for await (const chunk of parseOpenAiSseStream(response)) {
      if (chunk.text) {
        yield { text: chunk.text };
      }
    }
  }
}
