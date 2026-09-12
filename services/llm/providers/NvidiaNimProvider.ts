import { 
  AIProviderType, 
  GenerateOptions, 
  GenerateResult, 
  StreamChunk, 
  GenerateFinishReason 
} from '../../../types';
import { configService } from '../../configService';
import { providerFetch, canRelayWithOwnKey } from '../../apiClient';
import { buildChatMessages } from '../../chat/messages';
import {
  NIM_DEFAULT_MODEL,
  nimModelCandidates,
  isMissingModelStatus,
} from '../nativeModelDefaults';
import { parseOpenAiSseStream } from '../../../utils/sse';
import { BaseAIProvider } from './BaseAIProvider';

/**
 * NVIDIA NIM Provider (Enterprise Accelerated Foundation Inference)
 * Default model: Llama 3.2 11B Vision. Llama 3.3 70B Instruct reached EOL on 2026-08-26.
 */
export class NvidiaNimProvider extends BaseAIProvider {
  id = 'nim';
  name = 'NVIDIA NIM Enterprise';
  type: AIProviderType = 'nim';
  config = {
    model: NIM_DEFAULT_MODEL,
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
    const startTime = Date.now();
    const messages = buildChatMessages(prompt, options);
    const models = nimModelCandidates(options?.model);

    let response: Response | null = null;
    let lastErr = '';
    let usedModel = models[0];

    for (const model of models) {
      usedModel = model;
      response = await providerFetch('nim', '/chat/completions', this.endpointUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          temperature: options?.temperature ?? this.config.temperature,
          max_tokens: options?.maxTokens ?? this.config.maxTokens,
        }),
      }, { userKey: this.ownKey() });

      if (response.ok) break;
      lastErr = await response.text();
      if (isMissingModelStatus(response.status, lastErr) && model !== models[models.length - 1]) {
        console.warn(`[NIM] Model ${model} unavailable (${response.status}); trying next candidate...`);
        continue;
      }
      throw new Error(`NVIDIA NIM error (${response.status}): ${lastErr}`);
    }

    if (!response || !response.ok) {
      throw new Error(`NVIDIA NIM error: ${lastErr || 'no response'}`);
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
    const headers = this.buildHeaders();
    const messages = buildChatMessages(prompt, options);
    const models = nimModelCandidates(options?.model);

    let response: Response | null = null;
    let lastErr = '';
    let usedModel = models[0];

    for (const model of models) {
      usedModel = model;
      response = await providerFetch('nim', '/chat/completions', this.endpointUrl(), {
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

      if (response.ok && response.body) break;
      lastErr = await response.text();
      if (isMissingModelStatus(response.status, lastErr) && model !== models[models.length - 1]) {
        console.warn(`[NIM] Model ${model} unavailable (${response.status}); trying next candidate...`);
        continue;
      }
      throw new Error(`NVIDIA NIM stream error (${response.status}): ${lastErr}`);
    }

    if (!response?.ok || !response.body) {
      throw new Error(`NVIDIA NIM stream error: ${lastErr || 'no response body'}`);
    }

    this.config.model = usedModel;
    for await (const chunk of parseOpenAiSseStream(response)) {
      if (chunk.text) {
        yield { text: chunk.text };
      }
    }
  }
}
