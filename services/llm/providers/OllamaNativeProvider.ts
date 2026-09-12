import { 
  AIProviderType, 
  GenerateOptions, 
  GenerateResult, 
  StreamChunk 
} from '../../../types';
import { configService } from '../../configService';
import { providerFetch } from '../../apiClient';
import { buildChatMessages } from '../../chat/messages';
import { parseOpenAiSseStream } from '../../../utils/sse';
import { BaseAIProvider } from './BaseAIProvider';

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
  private cachedModels: string[] = [];

  private resolveActiveModel(optionsModel?: string, probeModels?: string[]): string {
    if (optionsModel && optionsModel.trim()) return optionsModel.trim();
    const configured = configService.getOllamaModel();
    if (configured && configured.trim()) return configured.trim();
    if (probeModels && probeModels.length > 0) return probeModels[0];
    return this.config.model;
  }

  /** Prefer BYOK so free users never hit the hosted Stars/TON gate. */
  private ownCloudKey(): string {
    return configService.getByokKey('luminara_ollama_key') || configService.getOllamaKey();
  }

  async isAvailable(): Promise<boolean> {
    const status = await this.probeStatus();
    return status.available;
  }

  public async probeStatus(): Promise<{ available: boolean; isLocal: boolean; endpoint: string; models: string[] }> {
    const now = Date.now();
    const endpoint = configService.getOllamaEndpoint();
    if (this.cachedIsLocal !== null && now - this.lastProbeTime < 5_000 && this.cachedModels.length > 0) {
      return {
        available: true,
        isLocal: this.cachedIsLocal,
        endpoint: this.cachedIsLocal ? endpoint : 'https://ollama.com',
        models: this.cachedModels,
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
        const models = (data.models || []).map((m: any) => m.name || m.model).filter(Boolean);
        this.cachedIsLocal = true;
        this.cachedModels = models;
        this.lastProbeTime = now;
        return { available: true, isLocal: true, endpoint, models };
      }
    } catch {
      // Local not running or blocked by CORS
    }

    // 2. Cloud Ollama (BYOK or hosted with an active plan) - list every available model
    const cloudKey = this.ownCloudKey();
    if (cloudKey) {
      try {
        const userKey = cloudKey !== 'proxy' ? cloudKey : undefined;
        const res = await providerFetch(
          'ollama',
          '/api/tags',
          'https://ollama.com/api/tags',
          {
            headers: cloudKey !== 'proxy' ? { Authorization: `Bearer ${cloudKey}` } : {},
          },
          userKey ? { userKey } : {},
        );
        if (res.ok) {
          const data = await res.json().catch(() => null);
          const models = ((data as any)?.models || [])
            .map((m: any) => m.name || m.model)
            .filter(Boolean);
          this.cachedIsLocal = false;
          this.cachedModels = models.length > 0 ? models : [configService.getOllamaModel()];
          this.lastProbeTime = now;
          return {
            available: true,
            isLocal: false,
            endpoint: 'https://ollama.com',
            models: this.cachedModels,
          };
        }
      } catch {
        /* fall through */
      }
      // Key present even if listing failed: still mark cloud available for chat attempts.
      this.cachedIsLocal = false;
      this.cachedModels = [configService.getOllamaModel()];
      this.lastProbeTime = now;
      return {
        available: true,
        isLocal: false,
        endpoint: 'https://ollama.com',
        models: this.cachedModels,
      };
    }

    this.cachedIsLocal = null;
    this.cachedModels = [];
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
      const key = this.ownCloudKey();
      const response = await providerFetch('ollama', '/v1/chat/completions', 'https://ollama.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key && key !== 'proxy' ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
        }),
      }, key && key !== 'proxy' ? { userKey: key } : {});

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
    const cloudKey = !probe.isLocal ? this.ownCloudKey() : '';
    if (!probe.isLocal && cloudKey && cloudKey !== 'proxy') {
      headers.Authorization = `Bearer ${cloudKey}`;
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
        }, cloudKey && cloudKey !== 'proxy' ? { userKey: cloudKey } : {});

    if (!response.ok || !response.body) {
      const err = await response.text();
      throw new Error(`Ollama stream error (${response.status}): ${err}`);
    }

    for await (const chunk of parseOpenAiSseStream(response)) {
      if (chunk.text) {
        yield { text: chunk.text };
      }
    }
  }
}
