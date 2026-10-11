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
import { applyToolsToChatBody, parseToolCallsFromMessage } from '../openaiTools';
import { FallbackAnswerNotAcceptedError, readFallbackAnswer } from '../fallbackAnswer';

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
    // Only a caller that accepts a fallback reply asks the Worker for one.
    const acceptFallback = Boolean(options?.allowFallback);

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
      applyToolsToChatBody(body, options);

      return await providerFetch('groq', '/chat/completions', this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      }, { userKey: apiKey, acceptFallback });
    };

    let response: Response | null = null;
    let lastErrText = '';
    let usedModel = models[0];

    for (const model of models) {
      usedModel = model;
      let apiKey = key || fallbackKey;
      try {
        response = await doFetch(apiKey, model);
        if ((response.status === 429 || response.status === 402 || response.status === 401) && fallbackKey && key !== fallbackKey) {
          console.warn(`[Groq] Received status ${response.status} on primary key, rotating to fallback key...`);
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
    // The Worker may have answered with its fallback model. Groq itself did not answer then, so
    // unless this caller asked for fallback replies it is an error, not a result: the text of a
    // small fallback model must not be stored or shown as if the asked engine wrote it.
    const marker = readFallbackAnswer(response.headers, data);
    if (marker && !options?.allowFallback) throw new FallbackAnswerNotAcceptedError(this.name, marker);
    const fallback =
      marker && data.choices?.[0]?.finish_reason === 'length' ? { ...marker, truncated: true } : marker;

    const text = data.choices?.[0]?.message?.content || '';
    const toolCalls = parseToolCallsFromMessage(data.choices?.[0]?.message);
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
      toolCalls,
      latencyMs,
      ...(fallback ? { fallback } : {}),
    };
  }

  async *streamText(prompt: string, options?: GenerateOptions): AsyncIterable<StreamChunk> {
    const key = this.getActiveApiKey();
    if (!key) throw new Error('Groq API Key not configured');

    const messages = buildChatMessages(prompt, options);
    const models = groqModelCandidates(options?.model);
    // Only a caller that accepts a fallback reply asks the Worker for one.
    const acceptFallback = Boolean(options?.allowFallback);

    let response: Response | null = null;
    let lastErrText = '';
    let usedModel = models[0];

    for (const model of models) {
      usedModel = model;
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: options?.temperature ?? this.config.temperature,
        max_tokens: options?.maxTokens ?? this.config.maxTokens,
        stream: true,
      };
      applyToolsToChatBody(body, options);
      response = await providerFetch('groq', '/chat/completions', this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      }, { userKey: key, acceptFallback });

      const fallbackKey = configService.getGroqFallbackKey();
      if ((response.status === 429 || response.status === 402 || response.status === 401) && fallbackKey && key !== fallbackKey) {
        console.warn(`[Groq] Stream received status ${response.status} on primary key, rotating to fallback key...`);
        response = await providerFetch('groq', '/chat/completions', this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${fallbackKey}`,
          },
          body: JSON.stringify(body),
        }, { userKey: fallbackKey, acceptFallback });
      }

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

    // The fallback marker is in the response headers, which arrive before the stream. A caller
    // that did not ask for fallback replies gets an error before any text, as in generateText.
    const marker = readFallbackAnswer(response.headers);
    if (marker && !options?.allowFallback) {
      try {
        await response.body.cancel();
      } catch {
        /* the stream is already closed */
      }
      throw new FallbackAnswerNotAcceptedError(this.name, marker);
    }

    this.config.model = usedModel;
    // The marker rides on the first text chunk so the chat can label the reply as it starts.
    let unsent = marker;
    for await (const chunk of parseOpenAiSseStream(response)) {
      if (chunk.text) {
        yield unsent ? { text: chunk.text, fallback: unsent } : { text: chunk.text };
        unsent = undefined;
      }
      if (chunk.toolCalls?.length) {
        yield {
          toolCalls: chunk.toolCalls,
          finishReason: (chunk.finishReason as GenerateFinishReason) || 'tool_calls',
        };
      }
      // A fallback reply cut off at its length limit says so in its last chunk.
      if (marker && chunk.finishReason === 'length') {
        yield { fallback: { ...marker, truncated: true }, finishReason: 'length' };
      }
    }
  }
}
