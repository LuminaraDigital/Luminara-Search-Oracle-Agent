import { 
  AIProvider, 
  GenerateOptions, 
  GenerateResult, 
  StreamChunk, 
  NativeEngineId,
  NativeEngineStatus,
  NativeFailoverEvent,
  InferenceRouterUsage,
  InferenceRouterUsageProvider,
} from '../types';
import { configService } from './configService';
import { classifyProviderFailure } from './resilience/failureClassification';
import {
  createAdaptiveCircuit,
  observeCircuit,
  isCircuitAvailable,
  type AdaptiveCircuit,
} from './resilience/adaptiveCircuit';

import { buildChatMessages } from './chat/messages';
import { toUserFacingText } from '../utils/userFacingText';
import {
  GROQ_DEFAULT_MODEL,
  NIM_DEFAULT_MODEL,
} from './llm/nativeModelDefaults';

import {
  BaseAIProvider,
  GroqProvider,
  NvidiaNimProvider,
  OllamaNativeProvider,
  FreeLlmProvider,
  OpenRouterProvider,
} from './llm/providers';
import { safeJsonParse } from './llm/safeJsonParse';

export { buildChatMessages };
export {
  GROQ_DEFAULT_MODEL,
  GROQ_FALLBACK_MODELS,
  NIM_DEFAULT_MODEL,
  NIM_FALLBACK_MODELS,
} from './llm/nativeModelDefaults';
export { safeJsonParse };
export {
  BaseAIProvider,
  GroqProvider,
  NvidiaNimProvider,
  OllamaNativeProvider,
  FreeLlmProvider,
  OpenRouterProvider,
};

export const USAGE_STORAGE_KEY = 'luminara_inference_usage_v1';

export const PROVIDER_COST_PER_MILLION_TOKENS: Record<string, { prompt: number; completion: number }> = {
  groq: { prompt: 0.05, completion: 0.08 },
  nim: { prompt: 0.15, completion: 0.15 },
  openrouter: { prompt: 0.50, completion: 0.50 },
  ollama: { prompt: 0.0, completion: 0.0 },
  freellm: { prompt: 0.0, completion: 0.0 },
};

export function emptyInferenceRouterUsage(): InferenceRouterUsage {
  const empty = (): InferenceRouterUsageProvider => ({
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0,
    lastUsedAt: null,
    averageLatencyMs: 0,
  });
  return {
    schemaVersion: 1,
    providers: {
      groq: empty(),
      nim: empty(),
      openrouter: empty(),
      ollama: empty(),
      freellm: empty(),
    },
    totals: {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    },
  };
}

/**
 * Unified AI Provider Service
 * Native Orchestrator: Groq LPU, NVIDIA NIM, OpenRouter, Ollama, and optional FreeLLMAPI BYOK gateway.
 * With automatic engine searching, 429 cooldowns, Grok-Bot usage tracking, and seamless pop-up failovers.
 */
export class AIProviderService {
  private static instance: AIProviderService;
  private providers: Map<string, AIProvider> = new Map();
  private lastActiveEngine: NativeEngineId = 'groq';
  /** providerId -> cooldown-until epoch ms (rate-limit / 5xx soft skip) */
  private cooldowns: Map<string, number> = new Map();
  /** providerId -> adaptive circuit breaker state */
  private circuits: Map<string, AdaptiveCircuit> = new Map();
  private static readonly COOLDOWN_MS = 60_000;

  private usage: InferenceRouterUsage = emptyInferenceRouterUsage();
  private usageListeners = new Set<(usage: InferenceRouterUsage) => void>();

  private constructor() {
    this.registerProvider(new NvidiaNimProvider());
    this.registerProvider(new GroqProvider());
    this.registerProvider(new OpenRouterProvider());
    this.registerProvider(new OllamaNativeProvider());
    this.registerProvider(new FreeLlmProvider());
    this.loadUsage();
  }

  private canStorage(): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem('__usage_probe__', '1');
      localStorage.removeItem('__usage_probe__');
      return true;
    } catch {
      return false;
    }
  }

  private loadUsage(): void {
    if (!this.canStorage()) return;
    try {
      const raw = localStorage.getItem(USAGE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.schemaVersion === 1 && parsed.providers && parsed.totals) {
          this.usage = parsed;
          return;
        }
      }
    } catch {
      /* ignore */
    }
    this.usage = emptyInferenceRouterUsage();
  }

  private saveUsage(): void {
    if (this.canStorage()) {
      try {
        localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(this.usage));
      } catch {
        /* ignore */
      }
    }
    this.notifyUsage();
  }

  private notifyUsage(): void {
    const snapshot = this.getUsageStats();
    this.usageListeners.forEach((cb) => {
      try {
        cb(snapshot);
      } catch {
        /* listener error */
      }
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('luminara-inference-usage', { detail: snapshot }));
    }
  }

  public getUsageStats(): InferenceRouterUsage {
    return JSON.parse(JSON.stringify(this.usage));
  }

  public resetUsageStats(): void {
    this.usage = emptyInferenceRouterUsage();
    this.saveUsage();
  }

  public subscribeToUsage(cb: (usage: InferenceRouterUsage) => void): () => void {
    this.usageListeners.add(cb);
    return () => this.usageListeners.delete(cb);
  }

  public recordUsage(
    providerId: string,
    tokens: { prompt?: number; completion?: number; cacheRead?: number; cacheWrite?: number },
    latencyMs = 0,
    _model?: string
  ): void {
    const id = providerId as NativeEngineId;
    if (!this.usage.providers[id]) {
      this.usage.providers[id] = {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCostUsd: 0,
        lastUsedAt: null,
        averageLatencyMs: 0,
      };
    }
    const prov = this.usage.providers[id];
    const inp = Math.max(0, tokens.prompt || 0);
    const outp = Math.max(0, tokens.completion || 0);
    const cr = Math.max(0, tokens.cacheRead || 0);
    const cw = Math.max(0, tokens.cacheWrite || 0);

    const prevReqs = prov.requests;
    prov.requests += 1;
    prov.inputTokens += inp;
    prov.outputTokens += outp;
    prov.cacheReadTokens += cr;
    prov.cacheWriteTokens += cw;
    prov.lastUsedAt = Date.now();
    prov.averageLatencyMs = prevReqs === 0 ? latencyMs : Math.round((prov.averageLatencyMs * prevReqs + latencyMs) / (prevReqs + 1));

    const rates = PROVIDER_COST_PER_MILLION_TOKENS[id] || { prompt: 0, completion: 0 };
    const costIncrement = (inp / 1_000_000) * rates.prompt + (outp / 1_000_000) * rates.completion;
    prov.estimatedCostUsd = Number((prov.estimatedCostUsd + costIncrement).toFixed(6));

    this.usage.totals.requests += 1;
    this.usage.totals.inputTokens += inp;
    this.usage.totals.outputTokens += outp;
    this.usage.totals.estimatedCostUsd = Number((this.usage.totals.estimatedCostUsd + costIncrement).toFixed(6));

    this.saveUsage();
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

  /** Test helper: drop rate-limit cooldowns and circuits between vitest cases. */
  public clearCooldowns(): void {
    this.cooldowns.clear();
    this.circuits.clear();
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
    let nimModels: string[] = [];
    if (hasNim) {
      const ping = await configService.testNvidia();
      nimLatency = ping.latencyMs;
      nimModels = ping.models || [];
    }
    results.push({
      id: 'nim',
      name: 'NVIDIA NIM Enterprise',
      provider: 'NVIDIA',
      model: NIM_DEFAULT_MODEL,
      isAvailable: Boolean(hasNim) && !this.isCoolingDown('nim'),
      isLocal: false,
      endpoint: 'integrate.api.nvidia.com/v1',
      latencyMs: nimLatency,
      tokenSpeed: '120 tok/s',
      lastChecked: Date.now(),
      detectedModels: nimModels,
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
      model: GROQ_DEFAULT_MODEL,
      isAvailable: Boolean(hasGroq) && !this.isCoolingDown('groq'),
      isLocal: false,
      endpoint: 'api.groq.com/openai/v1',
      latencyMs: groqLatency,
      tokenSpeed: '~500 tok/s',
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
   * Composer manual picks pin that provider first without rewriting Settings order.
   */
  public async getBestAvailableProvider(preferredProvider?: NativeEngineId): Promise<AIProvider | null> {
    const order = this.resolveProviderOrder(preferredProvider);

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

  /** Merge sticky composer preference into call options (explicit opts win). */
  private resolveChatInferenceOptions(options?: GenerateOptions): {
    order: NativeEngineId[];
    preferredProvider?: NativeEngineId;
    preferredModel?: string;
  } {
    const pref = configService.getChatModelPreference();
    const preferredProvider =
      options?.preferredProvider ||
      (pref.mode === 'manual' ? pref.provider : undefined);
    const preferredModel =
      (options?.model && options.model.trim()) ||
      (pref.mode === 'manual' ? pref.model : undefined);
    return {
      order: this.resolveProviderOrder(preferredProvider),
      preferredProvider,
      preferredModel,
    };
  }

  private resolveProviderOrder(preferredProvider?: NativeEngineId): NativeEngineId[] {
    const order = [...configService.getNativePriority()] as NativeEngineId[];
    if (preferredProvider && order.includes(preferredProvider)) {
      return [preferredProvider, ...order.filter((id) => id !== preferredProvider)];
    }
    return order;
  }

  private optionsForProvider(
    providerId: string,
    options: GenerateOptions | undefined,
    preferredProvider: NativeEngineId | undefined,
    preferredModel: string | undefined,
  ): GenerateOptions {
    const base = { ...(options || {}) };
    delete (base as { preferredProvider?: NativeEngineId }).preferredProvider;
    // Only the pinned provider gets the composer model id (avoid sending Groq ids to NIM, etc.).
    if (preferredProvider && preferredModel) {
      base.model = providerId === preferredProvider ? preferredModel : undefined;
    } else if (preferredModel && !preferredProvider) {
      base.model = preferredModel;
    }
    return base;
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
    const { order, preferredProvider, preferredModel } = this.resolveChatInferenceOptions(options);
    let lastError: any = null;

    for (let i = 0; i < order.length; i++) {
      const providerId = order[i];
      if (this.isCoolingDown(providerId)) continue;
      const provider = this.getProvider(providerId);

      if (!provider || !(await provider.isAvailable())) {
        continue;
      }

      const callOpts = this.optionsForProvider(providerId, options, preferredProvider, preferredModel);
      const start = Date.now();
      try {
        const result = await provider.generateText(prompt, callOpts);
        const latencyMs = Date.now() - start;
        this.markSuccess(providerId);
        this.lastActiveEngine = providerId as NativeEngineId;
        this.dispatchActiveEngine(provider.id, callOpts.model || provider.config.model);
        const promptTokens = result.tokenUsage?.prompt || Math.max(1, Math.ceil(prompt.length / 4));
        const completionTokens = result.tokenUsage?.completion || Math.max(1, Math.ceil(result.text.length / 4));
        this.recordUsage(
          providerId,
          { prompt: promptTokens, completion: completionTokens },
          latencyMs,
          callOpts.model || provider.config.model
        );
        return result;
      } catch (err: any) {
        lastError = err;
        this.markCooldown(providerId, err);
        const nextId = order.slice(i + 1).find(id => !this.isCoolingDown(id) && this.getProvider(id));
        const nextProvider = nextId ? this.getProvider(nextId) : null;

        if (nextProvider) {
          const reason = toUserFacingText(err, 'Execution Error');
          this.dispatchFailover({
            failedProvider: provider.name,
            failedModel: callOpts.model || provider.config.model,
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
    const { order, preferredProvider, preferredModel } = this.resolveChatInferenceOptions(options);
    let streamSucceeded = false;
    let lastError: any = null;

    for (let i = 0; i < order.length; i++) {
      const providerId = order[i];
      if (this.isCoolingDown(providerId)) continue;
      const provider = this.getProvider(providerId);

      if (!provider || !(await provider.isAvailable())) {
        continue;
      }

      const callOpts = this.optionsForProvider(providerId, options, preferredProvider, preferredModel);
      const start = Date.now();
      let yieldedAny = false;

      let accumulatedText = '';
      let chunkTokenUsage: { prompt: number; completion: number; total: number } | undefined;

      try {
        for await (const chunk of provider.streamText(prompt, callOpts)) {
          yieldedAny = true;
          streamSucceeded = true;
          if (chunk.text) accumulatedText += chunk.text;
          if (chunk.tokenUsage) chunkTokenUsage = chunk.tokenUsage;
          yield chunk;
        }

        if (streamSucceeded) {
          const latencyMs = Date.now() - start;
          this.markSuccess(providerId);
          this.lastActiveEngine = providerId as NativeEngineId;
          this.dispatchActiveEngine(provider.id, callOpts.model || provider.config.model);
          const promptTokens = chunkTokenUsage?.prompt || Math.max(1, Math.ceil(prompt.length / 4));
          const completionTokens = chunkTokenUsage?.completion || Math.max(1, Math.ceil(accumulatedText.length / 4));
          this.recordUsage(
            providerId,
            { prompt: promptTokens, completion: completionTokens },
            latencyMs,
            callOpts.model || provider.config.model
          );
          return;
        }
      } catch (err: any) {
        lastError = err;
        this.markCooldown(providerId, err);
        // If we already yielded tokens to the user, we cannot seamlessly restart from scratch without duplicate content
        if (yieldedAny) {
          console.error(`[Stream Mid-Flight Failure] ${provider.name} stream was severed:`, err);
          yield { text: `\n\n*[Connection with ${provider.name} interrupted: ${toUserFacingText(err, 'Stream error')}*` };
          return;
        }

        const nextId = order.slice(i + 1).find(id => !this.isCoolingDown(id) && this.getProvider(id));
        const nextProvider = nextId ? this.getProvider(nextId) : null;

        if (nextProvider) {
          const reason = toUserFacingText(err, 'Connection Refused / Rate Limited');
          this.dispatchFailover({
            failedProvider: provider.name,
            failedModel: callOpts.model || provider.config.model,
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
