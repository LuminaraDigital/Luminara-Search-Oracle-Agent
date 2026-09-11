import { 
  AIProvider, 
  AIProviderType, 
  GenerateOptions, 
  GenerateResult, 
  StreamChunk, 
  GenerateFinishReason,
  NativeEngineId,
  NativeEngineStatus,
  NativeFailoverEvent
} from '../types';
import { configService } from './configService';
import { providerFetch, canRelayWithOwnKey } from './apiClient';
import { classifyProviderFailure, type ProviderFailure } from './resilience/failureClassification';
import {
  createAdaptiveCircuit,
  observeCircuit,
  isCircuitAvailable,
  type AdaptiveCircuit,
} from './resilience/adaptiveCircuit';

import { buildChatMessages } from './chat/messages';
export { buildChatMessages };

/**
 * Defensive JSON parser for open-weight models (NVIDIA NIM, Groq, Ollama).
 * Strips reasoning tokens (<think>...</think>), markdown code fences (```json ... ```),
 * removes extraneous commentary, and safely extracts structured JSON payloads.
 */
export function safeJsonParse<T>(text: string, fallback: T): T {
  if (!text || typeof text !== 'string') return fallback;
  // Strip reasoning model thought blocks (<think>...</think>) from DeepSeek-R1 / QwQ
  let trimmed = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (trimmed.includes('<think>')) {
    trimmed = trimmed.replace(/<think>[\s\S]*$/gi, '').trim();
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
      try {
        return JSON.parse(fenceMatch[1].trim()) as T;
      } catch {}
    }

    // 2. Extract substring between first '{' and last '}'
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
      } catch {}
    }

    // 3. Extract substring between first '[' and last ']'
    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1)) as T;
      } catch {}
    }

    return fallback;
  }
}

/**
 * Base abstract AI Provider
 */
export abstract class BaseAIProvider implements AIProvider {
  abstract id: string;
  abstract name: string;
  abstract type: AIProviderType;
  abstract config: {
    apiKey?: string;
    endpoint?: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
  abstract capabilities: {
    streaming: boolean;
    functionCalling: boolean;
    vision: boolean;
    audio: boolean;
    maxContextLength: number;
  };

  abstract isAvailable(): Promise<boolean>;
  abstract generateText(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;
  abstract streamText(prompt: string, options?: GenerateOptions): AsyncIterable<StreamChunk>;

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

/**
 * Groq Cloud Provider (Ultra-Fast Llama-3.3-70B / DeepSeek-R1)
 */
export class GroqProvider extends BaseAIProvider {
  id = 'groq';
  name = 'Groq Cloud Engine';
  type: AIProviderType = 'groq';
  config = {
    model: 'llama-3.3-70b-versatile',
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
    let key = configService.getGroqKey();
    const fallbackKey = configService.getGroqFallbackKey();
    const model = options?.model || this.config.model;
    const startTime = Date.now();

    const doFetch = async (apiKey: string) => {
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

      return await providerFetch('groq', '/chat/completions', this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      }, { userKey: apiKey });
    };

    let response: Response;
    try {
      response = await doFetch(key || fallbackKey);
      if (response.status === 429 && fallbackKey && key !== fallbackKey) {
        console.warn('[Groq] Rate limit hit on primary key, rotating to fallback key...');
        response = await doFetch(fallbackKey);
      }
    } catch (e: any) {
      if (fallbackKey && key !== fallbackKey) {
        response = await doFetch(fallbackKey);
      } else {
        throw e;
      }
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq inference error (${response.status}): ${errText}`);
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
    if (!key) throw new Error('Groq API Key not configured');

    const model = options?.model || this.config.model;
    const messages = buildChatMessages(prompt, options);

    const response = await providerFetch('groq', '/chat/completions', this.config.endpoint, {
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

    if (!response.ok || !response.body) {
      const errText = await response.text();
      throw new Error(`Groq stream error: ${response.status} ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            yield { text: delta };
          }
        } catch {
          // ignore parse errors on stream boundary
        }
      }
    }
  }
}

/**
 * NVIDIA NIM Provider (Enterprise Accelerated Foundation Inference: Llama-3.3-70B / DeepSeek-R1)
 */
export class NvidiaNimProvider extends BaseAIProvider {
  id = 'nim';
  name = 'NVIDIA NIM Enterprise';
  type: AIProviderType = 'nim';
  config = {
    model: 'meta/llama-3.3-70b-instruct',
    endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
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

  async isAvailable(): Promise<boolean> {
    const key = configService.getNvidiaKey();
    if (!key) return false;
    // Hosted NIM without a plan is not usable (Worker returns TIER_UPGRADE_REQUIRED).
    if (key === 'proxy') return configService.usesProxy('nim');
    // BYOK: Desktop Electron bypasses CORS; browsers need Worker relay or a same-origin proxy.
    if (typeof window !== 'undefined' && Boolean((window as any).luminaraDesktop)) return true;
    if (typeof window !== 'undefined' && !configService.getNvidiaProxyEndpoint() && !canRelayWithOwnKey('nim')) return false;
    return true;
  }

  private endpointUrl(): string {
    const proxy = configService.getNvidiaProxyEndpoint();
    return proxy ? `${proxy.replace(/\/$/, '')}/v1/chat/completions` : this.config.endpoint;
  }

  private ownKey(): string {
    // Prefer explicit BYOK from Settings so a free user with their own NVIDIA key never
    // silently falls through to hosted 'proxy' and the Stars/TON paywall.
    const byok = configService.getByokKey('luminara_nvidia_key');
    const key = byok || configService.getNvidiaKey();
    const org = configService.getByokKey('luminara_nvidia_org_id') || configService.getNvidiaOrgId();
    return key && key !== 'proxy' && org ? `${key}|${org}` : key;
  }

  private buildHeaders(): Record<string, string> {
    const key = configService.getNvidiaKey();
    if (!key) throw new Error('NVIDIA NIM API Key not configured');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    };
    const orgId = configService.getNvidiaOrgId();
    if (orgId) {
      headers['NV-Organization-ID'] = orgId;
    }
    return headers;
  }

  async generateText(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const headers = this.buildHeaders();
    const model = options?.model || this.config.model;
    const startTime = Date.now();

    const messages = buildChatMessages(prompt, options);

    const response = await providerFetch('nim', '/chat/completions', this.endpointUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: options?.temperature ?? this.config.temperature,
        max_tokens: options?.maxTokens ?? this.config.maxTokens,
      }),
    }, { userKey: this.ownKey() });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`NVIDIA NIM error (${response.status}): ${err}`);
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
    const headers = this.buildHeaders();
    const model = options?.model || this.config.model;
    const messages = buildChatMessages(prompt, options);

    const response = await providerFetch('nim', '/chat/completions', this.endpointUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: options?.temperature ?? this.config.temperature,
        max_tokens: options?.maxTokens ?? this.config.maxTokens,
        stream: true,
      }),
    }, { userKey: this.ownKey() });

    if (!response.ok || !response.body) {
      const err = await response.text();
      throw new Error(`NVIDIA NIM stream error (${response.status}): ${err}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            yield { text: delta };
          }
        } catch {
          // ignore chunk boundary parses
        }
      }
    }
  }
}

/**
 * Ollama Native Provider (Dual-Mode: Local Daemon at :11434 & Sovereign Cloud Gateway)
 */
export class OllamaNativeProvider extends BaseAIProvider {
  id = 'ollama';
  name = 'Ollama Sovereign SLM';
  type: AIProviderType = 'ollama';
  config = {
    model: 'llama3.2',
    endpoint: 'http://127.0.0.1:11434',
    temperature: 0.7,
    maxTokens: 4096,
  };
  capabilities = {
    streaming: true,
    functionCalling: true,
    vision: false,
    audio: false,
    maxContextLength: 32000,
  };

  private cachedIsLocal: boolean | null = null;
  private lastProbeTime = 0;

  private resolveActiveModel(optionsModel?: string, probeModels?: string[]): string {
    if (optionsModel && optionsModel.trim()) return optionsModel.trim();
    const configured = configService.getOllamaModel();
    if (configured && configured.trim()) return configured.trim();
    if (probeModels && probeModels.length > 0) return probeModels[0];
    return this.config.model;
  }

  async isAvailable(): Promise<boolean> {
    const status = await this.probeStatus();
    return status.available;
  }

  public async probeStatus(): Promise<{ available: boolean; isLocal: boolean; endpoint: string; models: string[] }> {
    const now = Date.now();
    const endpoint = configService.getOllamaEndpoint();
    const preferredModel = configService.getOllamaModel();
    if (this.cachedIsLocal !== null && now - this.lastProbeTime < 5000) {
      return {
        available: true,
        isLocal: this.cachedIsLocal,
        endpoint: this.cachedIsLocal ? endpoint : 'https://ollama.com',
        models: [preferredModel],
      };
    }

    // 1. Probe local or remote Ollama daemon at configured endpoint
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${endpoint}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map((m: any) => m.name || m.model);
        this.cachedIsLocal = true;
        this.lastProbeTime = now;
        return { available: true, isLocal: true, endpoint, models };
      }
    } catch {
      // Local not running or blocked by CORS
    }

    // 2. Cloud Ollama (BYOK or hosted with an active plan)
    if (configService.getOllamaKey()) {
      this.cachedIsLocal = false;
      this.lastProbeTime = now;
      return {
        available: true,
        isLocal: false,
        endpoint: 'https://ollama.com',
        models: [preferredModel, 'llama3.2', 'deepseek-r1', 'mistral'],
      };
    }

    this.cachedIsLocal = null;
    return { available: false, isLocal: false, endpoint: '', models: [] };
  }

  async generateText(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const probe = await this.probeStatus();
    const startTime = Date.now();
    const model = this.resolveActiveModel(options?.model, probe.models);

    const messages = buildChatMessages(prompt, options);

    if (probe.isLocal) {
      const url = `${probe.endpoint}/v1/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          temperature: options?.temperature ?? this.config.temperature,
          stream: false,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Local Ollama error (${response.status}): ${err}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      const latencyMs = Date.now() - startTime;

      return {
        text,
        tokenUsage: {
          prompt: this.estimateTokens(prompt),
          completion: this.estimateTokens(text),
          total: this.estimateTokens(prompt) + this.estimateTokens(text),
        },
        finishReason: 'stop',
        latencyMs,
      };
    } else {
      const key = configService.getOllamaKey();
      const response = await providerFetch('ollama', '/v1/chat/completions', 'https://ollama.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Ollama Cloud error (${response.status}): ${err}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || data.message?.content || '';
      const latencyMs = Date.now() - startTime;

      return {
        text,
        tokenUsage: {
          prompt: this.estimateTokens(prompt),
          completion: this.estimateTokens(text),
          total: this.estimateTokens(prompt) + this.estimateTokens(text),
        },
        finishReason: 'stop',
        latencyMs,
      };
    }
  }

  async *streamText(prompt: string, options?: GenerateOptions): AsyncIterable<StreamChunk> {
    const probe = await this.probeStatus();
    const model = this.resolveActiveModel(options?.model, probe.models);

    const messages = buildChatMessages(prompt, options);

    const targetUrl = probe.isLocal 
      ? `${probe.endpoint}/v1/chat/completions`
      : 'https://ollama.com/v1/chat/completions';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!probe.isLocal) {
      const key = configService.getOllamaKey();
      if (key) headers.Authorization = `Bearer ${key}`;
    }

    const response = probe.isLocal
      ? await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, messages, temperature: options?.temperature ?? this.config.temperature, stream: true }),
        })
      : await providerFetch('ollama', '/v1/chat/completions', targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, messages, temperature: options?.temperature ?? this.config.temperature, stream: true }),
        }, { userKey: configService.getOllamaKey() });

    if (!response.ok || !response.body) {
      const err = await response.text();
      throw new Error(`Ollama stream error (${response.status}): ${err}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            yield { text: delta };
          }
        } catch {
          // ignore parse errors on stream chunk boundary
        }
      }
    }
  }
}

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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            yield { text: delta };
          }
        } catch {
          // ignore chunk boundary parse errors
        }
      }
    }
  }
}

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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            yield { text: delta };
          }
        } catch {
          // ignore chunk boundary parse errors
        }
      }
    }
  }
}

/**
 * Unified AI Provider Service
 * Native Orchestrator: Groq LPU, NVIDIA NIM, OpenRouter, Ollama, and optional FreeLLMAPI BYOK gateway.
 * With automatic engine searching, 429 cooldowns, and seamless pop-up failovers.
 */
export class AIProviderService {
  private static instance: AIProviderService;
  private providers: Map<string, AIProvider> = new Map();
  private lastActiveEngine: NativeEngineId = 'nim';
  /** providerId -> cooldown-until epoch ms (rate-limit / 5xx soft skip) */
  private cooldowns: Map<string, number> = new Map();
  /** providerId -> adaptive circuit breaker state */
  private circuits: Map<string, AdaptiveCircuit> = new Map();
  private static readonly COOLDOWN_MS = 60_000;

  private constructor() {
    this.registerProvider(new NvidiaNimProvider());
    this.registerProvider(new GroqProvider());
    this.registerProvider(new OpenRouterProvider());
    this.registerProvider(new OllamaNativeProvider());
    this.registerProvider(new FreeLlmProvider());
  }

  public static getInstance(): AIProviderService {
    if (!AIProviderService.instance) {
      AIProviderService.instance = new AIProviderService();
    }
    return AIProviderService.instance;
  }

  public registerProvider(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  public getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  public getLastActiveEngine(): NativeEngineId {
    return this.lastActiveEngine;
  }

  private isCoolingDown(providerId: string): boolean {
    const circuit = this.circuits.get(providerId);
    if (circuit && !isCircuitAvailable(circuit)) {
      return true;
    }
    const until = this.cooldowns.get(providerId);
    if (!until) return false;
    if (Date.now() >= until) {
      this.cooldowns.delete(providerId);
      return false;
    }
    return true;
  }

  private markCooldown(providerId: string, err?: unknown): void {
    const msg = String((err as any)?.message || err || '');
    const failure = classifyProviderFailure({
      providerId,
      message: msg,
    });

    let circuit = this.circuits.get(providerId) || createAdaptiveCircuit();
    const cooldownMs = failure.retryAfter
      ? failure.retryAfter * 1000
      : failure.type === 'quota_exhausted' || failure.type === 'authentication_error'
      ? 5 * 60_000 // 5-minute lockout for exhausted balances or invalid credentials
      : AIProviderService.COOLDOWN_MS;

    circuit = observeCircuit(circuit, 'failure', {
      cooldownMs,
      failureThreshold: failure.retryable ? 2 : 1, // Non-retryable errors trip immediately
      reason: failure.message,
    });
    this.circuits.set(providerId, circuit);
    this.cooldowns.set(providerId, Date.now() + cooldownMs);
  }

  private markSuccess(providerId: string): void {
    const circuit = this.circuits.get(providerId);
    if (circuit) {
      this.circuits.set(providerId, observeCircuit(circuit, 'success'));
    }
    this.cooldowns.delete(providerId);
  }

  /** Exposed for tests and HUD diagnostics. */
  public getCircuit(providerId: string): AdaptiveCircuit | undefined {
    return this.circuits.get(providerId);
  }

  /** Exposed for tests and HUD diagnostics. */
  public getCooldownRemainingMs(providerId: string): number {
    const until = this.cooldowns.get(providerId);
    if (!until) return 0;
    return Math.max(0, until - Date.now());
  }

  /**
   * Search and probe all native engines concurrently
   * Returns live availability, local/cloud flag, and ping latency
   */
  public async searchAndProbeNativeProviders(): Promise<NativeEngineStatus[]> {
    const results: NativeEngineStatus[] = [];

    // 1. Probe NVIDIA NIM
    const nim = this.getProvider('nim') as NvidiaNimProvider;
    const hasNim = await nim?.isAvailable();
    let nimLatency = 0;
    if (hasNim) {
      const ping = await configService.testNvidia();
      nimLatency = ping.latencyMs;
    }
    results.push({
      id: 'nim',
      name: 'NVIDIA NIM Enterprise',
      provider: 'NVIDIA',
      model: 'meta/llama-3.3-70b-instruct',
      isAvailable: Boolean(hasNim) && !this.isCoolingDown('nim'),
      isLocal: false,
      endpoint: 'integrate.api.nvidia.com/v1',
      latencyMs: nimLatency,
      tokenSpeed: '95 tok/s',
      lastChecked: Date.now(),
    });

    // 2. Probe Groq
    const groq = this.getProvider('groq') as GroqProvider;
    const hasGroq = await groq?.isAvailable();
    let groqLatency = 0;
    if (hasGroq) {
      const ping = await configService.testGroq();
      groqLatency = ping.latencyMs;
    }
    results.push({
      id: 'groq',
      name: 'Groq Cloud LPU',
      provider: 'Groq',
      model: 'llama-3.3-70b-versatile',
      isAvailable: Boolean(hasGroq) && !this.isCoolingDown('groq'),
      isLocal: false,
      endpoint: 'api.groq.com/openai/v1',
      latencyMs: groqLatency,
      tokenSpeed: '285 tok/s',
      lastChecked: Date.now(),
    });

    // 3. Probe OpenRouter
    const openrouter = this.getProvider('openrouter') as OpenRouterProvider;
    const hasOpenRouter = await openrouter?.isAvailable();
    let openrouterLatency = 0;
    if (hasOpenRouter) {
      const ping = await configService.testOpenRouter();
      openrouterLatency = ping.latencyMs;
    }
    results.push({
      id: 'openrouter',
      name: 'OpenRouter Frontier Intelligence',
      provider: 'OpenRouter',
      model: 'openai/gpt-4o',
      isAvailable: Boolean(hasOpenRouter) && !this.isCoolingDown('openrouter'),
      isLocal: false,
      endpoint: 'openrouter.ai/api/v1',
      latencyMs: openrouterLatency,
      tokenSpeed: '120 tok/s',
      lastChecked: Date.now(),
    });

    // 4. Probe Ollama (Local daemon & Cloud gateway)
    const ollama = this.getProvider('ollama') as OllamaNativeProvider;
    const ollamaProbe = await ollama?.probeStatus();
    results.push({
      id: 'ollama',
      name: ollamaProbe?.isLocal ? 'Ollama Local Daemon' : 'Ollama Cloud Gateway',
      provider: 'Ollama',
      model: 'llama3.2',
      isAvailable: Boolean(ollamaProbe?.available) && !this.isCoolingDown('ollama'),
      isLocal: Boolean(ollamaProbe?.isLocal),
      endpoint: ollamaProbe?.isLocal ? configService.getOllamaEndpoint() : 'ollama.com',
      latencyMs: 0,
      tokenSpeed: ollamaProbe?.isLocal ? 'Local GPU/CPU' : '45 tok/s',
      lastChecked: Date.now(),
      detectedModels: ollamaProbe?.models || [],
    });

    // 5. Probe FreeLLMAPI BYOK gateway
    const freellm = this.getProvider('freellm') as FreeLlmProvider;
    const hasFreeLlm = await freellm?.isAvailable();
    let freellmLatency = 0;
    if (hasFreeLlm) {
      const ping = await configService.testFreeLlm();
      freellmLatency = ping.latencyMs;
    }
    const freellmBase = configService.getFreeLlmBaseUrl();
    results.push({
      id: 'freellm',
      name: 'FreeLLMAPI Gateway',
      provider: 'FreeLLMAPI',
      model: 'auto',
      isAvailable: Boolean(hasFreeLlm) && !this.isCoolingDown('freellm'),
      isLocal: /localhost|127\.0\.0\.1/i.test(freellmBase),
      endpoint: freellmBase.replace(/^https?:\/\//, ''),
      latencyMs: freellmLatency,
      tokenSpeed: 'auto:fast / auto:smart',
      lastChecked: Date.now(),
    });

    return results;
  }

  /**
   * Determine best available native provider in priority order.
   * Skips engines in 429/5xx cooldown so mid-run audits keep progressing.
   */
  public async getBestAvailableProvider(): Promise<AIProvider | null> {
    const order = configService.getNativePriority();

    for (const providerId of order) {
      if (this.isCoolingDown(providerId)) continue;
      const provider = this.getProvider(providerId);
      if (provider && (await provider.isAvailable())) {
        this.lastActiveEngine = providerId as NativeEngineId;
        return provider;
      }
    }

    return null;
  }

  /**
   * Dispatches the 'luminara-llm-failover' event so UI components automatically pop up
   */
  public dispatchFailover(event: NativeFailoverEvent): void {
    if (typeof window !== 'undefined') {
      console.warn(
        `[Native Trinity Failover] ${event.failedProvider} failed (${event.reason}) -> Automatically popped up ${event.activatedProvider} (${event.activatedModel})`
      );
      window.dispatchEvent(new CustomEvent('luminara-llm-failover', { detail: event }));
    }
  }

  /**
   * Dispatches the 'luminara-llm-active-engine' event
   */
  public dispatchActiveEngine(providerId: string, model: string): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('luminara-llm-active-engine', {
        detail: { providerId, model, timestamp: Date.now() }
      }));
    }
  }

  /**
   * Automatic failover text generation with rate-limit cooldown.
   */
  public async generateWithFallback(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    return this.generateWithFailover(prompt, options);
  }

  public async generateWithFailover(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const order = configService.getNativePriority();
    let lastError: any = null;

    for (let i = 0; i < order.length; i++) {
      const providerId = order[i];
      if (this.isCoolingDown(providerId)) continue;
      const provider = this.getProvider(providerId);

      if (!provider || !(await provider.isAvailable())) {
        continue;
      }

      const start = Date.now();
      try {
        const result = await provider.generateText(prompt, options);
        this.markSuccess(providerId);
        this.lastActiveEngine = providerId as NativeEngineId;
        this.dispatchActiveEngine(provider.id, options?.model || provider.config.model);
        return result;
      } catch (err: any) {
        lastError = err;
        this.markCooldown(providerId, err);
        const nextId = order.slice(i + 1).find(id => !this.isCoolingDown(id) && this.getProvider(id));
        const nextProvider = nextId ? this.getProvider(nextId) : null;

        if (nextProvider) {
          const reason = err?.message || 'Execution Error';
          this.dispatchFailover({
            failedProvider: provider.name,
            failedModel: options?.model || provider.config.model,
            reason: reason.length > 80 ? `${reason.slice(0, 77)}...` : reason,
            activatedProvider: nextProvider.name,
            activatedModel: nextProvider.config.model,
            latencyMs: Date.now() - start,
            timestamp: Date.now(),
          });
        }
      }
    }

    throw lastError || new Error('No native AI providers (Groq, NVIDIA NIM, Ollama, FreeLLMAPI) available or responsive.');
  }

  /**
   * Automatic failover streaming with rate-limit cooldown.
   */
  public async *streamWithFallback(prompt: string, options?: GenerateOptions): AsyncIterable<StreamChunk> {
    yield* this.streamWithFailover(prompt, options);
  }

  public async *streamWithFailover(prompt: string, options?: GenerateOptions): AsyncIterable<StreamChunk> {
    const order = configService.getNativePriority();
    let streamSucceeded = false;
    let lastError: any = null;

    for (let i = 0; i < order.length; i++) {
      const providerId = order[i];
      if (this.isCoolingDown(providerId)) continue;
      const provider = this.getProvider(providerId);

      if (!provider || !(await provider.isAvailable())) {
        continue;
      }

      const start = Date.now();
      let yieldedAny = false;

      try {
        for await (const chunk of provider.streamText(prompt, options)) {
          yieldedAny = true;
          streamSucceeded = true;
          yield chunk;
        }

        if (streamSucceeded) {
          this.markSuccess(providerId);
          this.lastActiveEngine = providerId as NativeEngineId;
          this.dispatchActiveEngine(provider.id, options?.model || provider.config.model);
          return;
        }
      } catch (err: any) {
        lastError = err;
        this.markCooldown(providerId, err);
        // If we already yielded tokens to the user, we cannot seamlessly restart from scratch without duplicate content
        if (yieldedAny) {
          console.error(`[Stream Mid-Flight Failure] ${provider.name} stream was severed:`, err);
          yield { text: `\n\n*[Connection with ${provider.name} interrupted: ${err?.message || 'Stream error'}*` };
          return;
        }

        const nextId = order.slice(i + 1).find(id => !this.isCoolingDown(id) && this.getProvider(id));
        const nextProvider = nextId ? this.getProvider(nextId) : null;

        if (nextProvider) {
          const reason = err?.message || 'Connection Refused / Rate Limited';
          this.dispatchFailover({
            failedProvider: provider.name,
            failedModel: options?.model || provider.config.model,
            reason: reason.length > 80 ? `${reason.slice(0, 77)}...` : reason,
            activatedProvider: nextProvider.name,
            activatedModel: nextProvider.config.model,
            latencyMs: Date.now() - start,
            timestamp: Date.now(),
          });
        }
      }
    }

    if (!streamSucceeded) {
      throw lastError || new Error('All native inference providers (Groq, NVIDIA NIM, Ollama, FreeLLMAPI) failed.');
    }
  }
}

export const aiProviderService = AIProviderService.getInstance();

