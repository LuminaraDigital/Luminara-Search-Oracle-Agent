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

import { buildChatMessages } from './chat/messages';
export { buildChatMessages };

/**
 * Defensive JSON parser for open-weight models (NVIDIA NIM, Groq, Ollama).
 * Strips markdown code fences (```json ... ```), removes extraneous prose,
 * and safely extracts structured JSON payloads.
 */
export function safeJsonParse<T>(text: string, fallback: T): T {
  if (!text || typeof text !== 'string') return fallback;
  const trimmed = text.trim();
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
    if (!configService.getNvidiaKey()) return false;
    // integrate.api.nvidia.com sends no Access-Control-Allow-Origin header, so direct browser calls
    // always fail the CORS preflight. In a browser we need a same-origin proxy to reach NIM.
    // In a browser NIM only works via a relay: the Luminara Worker (with the user's own key or a hosted key)
    // or a custom same-origin proxy endpoint.
    if (typeof window !== 'undefined' && !configService.getNvidiaProxyEndpoint() && !configService.usesProxy('nim') && !canRelayWithOwnKey('nim')) return false;
    return true;
  }

  private endpointUrl(): string {
    const proxy = configService.getNvidiaProxyEndpoint();
    return proxy ? `${proxy.replace(/\/$/, '')}/v1/chat/completions` : this.config.endpoint;
  }

  private ownKey(): string {
    const key = configService.getNvidiaKey();
    const org = configService.getNvidiaOrgId();
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

  async isAvailable(): Promise<boolean> {
    const status = await this.probeStatus();
    return status.available;
  }

  public async probeStatus(): Promise<{ available: boolean; isLocal: boolean; endpoint: string; models: string[] }> {
    const now = Date.now();
    if (this.cachedIsLocal !== null && now - this.lastProbeTime < 5000) {
      return {
        available: true,
        isLocal: this.cachedIsLocal,
        endpoint: this.cachedIsLocal ? configService.getOllamaEndpoint() : 'https://ollama.com',
        models: ['llama3.2'],
      };
    }

    // 1. Probe local daemon
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 900);
      const localBase = configService.getOllamaEndpoint();
      const res = await fetch(`${localBase}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map((m: any) => m.name || m.model);
        this.cachedIsLocal = true;
        this.lastProbeTime = now;
        return { available: true, isLocal: true, endpoint: localBase, models };
      }
    } catch {
      // Local not running
    }

    // 2. Check cloud key
    if (configService.getOllamaKey()) {
      this.cachedIsLocal = false;
      this.lastProbeTime = now;
      return {
        available: true,
        isLocal: false,
        endpoint: 'https://ollama.com',
        models: ['llama3.2', 'deepseek-r1', 'mistral'],
      };
    }

    this.cachedIsLocal = null;
    return { available: false, isLocal: false, endpoint: '', models: [] };
  }

  async generateText(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const probe = await this.probeStatus();
    const startTime = Date.now();
    const model = options?.model || this.config.model;

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
    const model = options?.model || this.config.model;

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
 * Unified AI Provider Service
 * Native Trinity Orchestrator: Groq LPU, NVIDIA NIM, and Ollama Local/Cloud
 * With automatic engine searching and seamless pop-up failovers.
 */
export class AIProviderService {
  private static instance: AIProviderService;
  private providers: Map<string, AIProvider> = new Map();
  private lastActiveEngine: NativeEngineId = 'nim';

  private constructor() {
    this.registerProvider(new NvidiaNimProvider());
    this.registerProvider(new GroqProvider());
    this.registerProvider(new OllamaNativeProvider());
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

  /**
   * Search and probe all 3 native engines concurrently
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
      isAvailable: Boolean(hasNim),
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
      isAvailable: Boolean(hasGroq),
      isLocal: false,
      endpoint: 'api.groq.com/openai/v1',
      latencyMs: groqLatency,
      tokenSpeed: '285 tok/s',
      lastChecked: Date.now(),
    });

    // 3. Probe Ollama (Local daemon & Cloud gateway)
    const ollama = this.getProvider('ollama') as OllamaNativeProvider;
    const ollamaProbe = await ollama?.probeStatus();
    results.push({
      id: 'ollama',
      name: ollamaProbe?.isLocal ? 'Ollama Local Daemon' : 'Ollama Cloud Gateway',
      provider: 'Ollama',
      model: 'llama3.2',
      isAvailable: Boolean(ollamaProbe?.available),
      isLocal: Boolean(ollamaProbe?.isLocal),
      endpoint: ollamaProbe?.isLocal ? configService.getOllamaEndpoint() : 'ollama.com',
      latencyMs: 0,
      tokenSpeed: ollamaProbe?.isLocal ? 'Local GPU/CPU' : '45 tok/s',
      lastChecked: Date.now(),
      detectedModels: ollamaProbe?.models || [],
    });

    return results;
  }

  /**
   * Determine best available native provider in priority order:
   * Defaults to: Groq -> NVIDIA NIM -> Ollama
   * Or user customized order via configService.getNativePriority()
   */
  public async getBestAvailableProvider(): Promise<AIProvider | null> {
    const order = configService.getNativePriority();

    for (const providerId of order) {
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
        `[Native Trinity Failover] 🚨 ${event.failedProvider} failed (${event.reason}) ➜ Automatically popped up ${event.activatedProvider} (${event.activatedModel})`
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
   * Automatic failover text generation:
   * Focuses natively on Groq, NVIDIA NIM, and Ollama.
   * When one fails, the other automatically pops up!
   */
  public async generateWithFallback(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    return this.generateWithFailover(prompt, options);
  }

  public async generateWithFailover(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const order = configService.getNativePriority();
    let lastError: any = null;

    for (let i = 0; i < order.length; i++) {
      const providerId = order[i];
      const provider = this.getProvider(providerId);

      if (!provider || !(await provider.isAvailable())) {
        continue;
      }

      const start = Date.now();
      try {
        const result = await provider.generateText(prompt, options);
        this.lastActiveEngine = providerId as NativeEngineId;
        this.dispatchActiveEngine(provider.id, provider.config.model);
        return result;
      } catch (err: any) {
        lastError = err;
        const nextId = order[i + 1];
        const nextProvider = nextId ? this.getProvider(nextId) : null;

        if (nextProvider) {
          const reason = err?.message || 'Execution Error';
          this.dispatchFailover({
            failedProvider: provider.name,
            failedModel: provider.config.model,
            reason: reason.length > 80 ? `${reason.slice(0, 77)}...` : reason,
            activatedProvider: nextProvider.name,
            activatedModel: nextProvider.config.model,
            latencyMs: Date.now() - start,
            timestamp: Date.now(),
          });
        }
      }
    }

    throw lastError || new Error('No native AI providers (Groq, NVIDIA NIM, Ollama) available or responsive.');
  }

  /**
   * Automatic failover streaming:
   * Prioritizes Groq, NVIDIA NIM, and Ollama.
   * When one fails, the other automatically pops up and fulfills the stream!
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
          this.lastActiveEngine = providerId as NativeEngineId;
          this.dispatchActiveEngine(provider.id, provider.config.model);
          return;
        }
      } catch (err: any) {
        lastError = err;
        // If we already yielded tokens to the user, we cannot seamlessly restart from scratch without duplicate content
        if (yieldedAny) {
          console.error(`[Stream Mid-Flight Failure] ${provider.name} stream was severed:`, err);
          yield { text: `\n\n*[Connection with ${provider.name} interrupted: ${err?.message || 'Stream error'}*` };
          return;
        }

        // Before any tokens yielded: trigger immediate auto-failover to next native provider!
        const nextId = order[i + 1];
        const nextProvider = nextId ? this.getProvider(nextId) : null;

        if (nextProvider) {
          const reason = err?.message || 'Connection Refused / Rate Limited';
          this.dispatchFailover({
            failedProvider: provider.name,
            failedModel: provider.config.model,
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
      throw lastError || new Error('All native inference providers (Groq, NVIDIA NIM, Ollama) failed.');
    }
  }
}

export const aiProviderService = AIProviderService.getInstance();

