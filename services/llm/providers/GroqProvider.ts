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
  isHostedRateLimit,
  isMissingModelStatus,
} from '../nativeModelDefaults';
import { parseOpenAiSseStream } from '../../../utils/sse';
import { BaseAIProvider } from './BaseAIProvider';
import { applyToolsToChatBody, parseToolCallsFromMessage } from '../openaiTools';
import { readFallbackAnswer } from '../fallbackAnswer';

/** A missing model and a per-model token cap both have another candidate. The last candidate stops. */
function shouldTryNextGroqModel(status: number, body: string, model: string, models: readonly string[]): boolean {
  if (model === models[models.length - 1]) return false;
  return isMissingModelStatus(status, body) || isHostedRateLimit(status, body);
}

const GROQ_TOKEN_MARGIN = 80;

/** One wait, and only for a large call. Groq names the second the cap will allow that request. */
function groqRetryDelayMs(body: string): number | null {
  const delay = /try again in ([0-9.]+)s/i.exec(body);
  const requested = /Requested (\d+)/.exec(body);
  if (!delay || !requested || Number(requested[1]) < 6000) return null;
  const seconds = Number(delay[1]);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 55) return null;
  return Math.ceil(seconds * 1000) + 750;
}

/**
 * Groq's on_demand cap is per model and counts the completion budget up front.
 * Shrink max_tokens when the prompt fits the room that is left. A prompt that
 * does not fit returns null so the caller tries the next model.
 */
function shrunkGroqMaxTokens(body: string, maxTokens: number): number | null {
  const limit = /Limit (\d+)/.exec(body);
  const requested = /Requested (\d+)/.exec(body);
  if (!limit || !requested) return null;
  const used = /Used (\d+)/.exec(body);
  const room = Number(limit[1]) - (used ? Number(used[1]) : 0) - GROQ_TOKEN_MARGIN;
  const prompt = Number(requested[1]) - maxTokens;
  const next = room - prompt;
  if (next < 256 || next >= maxTokens) return null;
  return next;
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
    const acceptFallback = Boolean(options?.allowFallback);

    const startingMax = options?.maxTokens ?? this.config.maxTokens;
    const doFetch = async (apiKey: string, model: string, maxTokens: number) => {
      const body: any = {
        model,
        messages,
        temperature: options?.temperature ?? this.config.temperature,
        max_tokens: maxTokens,
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
    let waited = false;

    for (const model of models) {
      usedModel = model;
      let apiKey = key || fallbackKey;
      let maxTokens = startingMax;
      let shrunk = false;
      let tryNextModel = false;
      while (!tryNextModel) {
        try {
          response = await doFetch(apiKey, model, maxTokens);
          if ((response.status === 429 || response.status === 402 || response.status === 401) && fallbackKey && key !== fallbackKey) {
            console.warn(`[Groq] Received status ${response.status} on primary key, rotating to fallback key...`);
            response = await doFetch(fallbackKey, model, maxTokens);
            apiKey = fallbackKey;
          }
        } catch (e: any) {
          if (fallbackKey && key !== fallbackKey) {
            response = await doFetch(fallbackKey, model, maxTokens);
          } else {
            throw e;
          }
        }

        if (response.ok) break;
        lastErrText = await response.text();
        if (!waited && isHostedRateLimit(response.status, lastErrText)) {
          const delay = groqRetryDelayMs(lastErrText);
          if (delay) {
            waited = true;
            console.warn(`[Groq] Token cap on ${model}; retrying in ${delay}ms.`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }
        const smaller = !shrunk && isHostedRateLimit(response.status, lastErrText)
          ? shrunkGroqMaxTokens(lastErrText, maxTokens)
          : null;
        if (smaller) {
          shrunk = true;
          maxTokens = smaller;
          console.warn(`[Groq] Model ${model} over the token cap; retrying with max_tokens ${smaller}.`);
          continue;
        }
        if (shouldTryNextGroqModel(response.status, lastErrText, model, models)) {
          console.warn(`[Groq] Model ${model} unavailable (${response.status}); trying next candidate...`);
          tryNextModel = true;
          break;
        }
        throw new Error(`Groq inference error (${response.status}): ${lastErrText}`);
      }
      if (response?.ok) break;
    }

    if (!response || !response.ok) {
      throw new Error(`Groq inference error: ${lastErrText || 'no response'}`);
    }

    const data = await response.json();
    // A Workers AI reply keeps the text and names the model on `fallback`. Hosted audit calls
    // do not opt in, and throwing the text away would drop the only answer.
    const marker = readFallbackAnswer(response.headers, data);
    const fallback =
      marker && data.choices?.[0]?.finish_reason === 'length' ? { ...marker, truncated: true } : marker;

    const message = data.choices?.[0]?.message;
    const content = typeof message?.content === 'string' ? message.content : '';
    const reasoning = typeof message?.reasoning === 'string' ? message.reasoning : '';
    const text = content.trim() ? content : reasoning;
    const toolCalls = parseToolCallsFromMessage(data.choices?.[0]?.message);
    const latencyMs = Date.now() - startTime;
    const usage = data.usage || {};
    this.config.model = fallback?.model || usedModel;

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
      if (shouldTryNextGroqModel(response.status, lastErrText, model, models)) {
        console.warn(`[Groq] Model ${model} unavailable (${response.status}); trying next candidate...`);
        continue;
      }
      throw new Error(`Groq stream error: ${response.status} ${lastErrText}`);
    }

    if (!response?.ok || !response.body) {
      throw new Error(`Groq stream error: ${lastErrText || 'no response body'}`);
    }

    // The marker is in the headers, which arrive before the stream, and rides on the first chunk.
    const marker = readFallbackAnswer(response.headers);

    this.config.model = marker?.model || usedModel;
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
