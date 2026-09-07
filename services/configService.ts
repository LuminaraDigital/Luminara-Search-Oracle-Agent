/**
 * Luminara Unified Configuration & Secrets Service
 * Manages API keys with local storage overrides, environment detection, and live connectivity tests.
 */

export interface ProviderStatus {
  id: string;
  name: string;
  category: 'llm' | 'search' | 'scraping' | 'generative' | 'runtime';
  isConfigured: boolean;
  source: 'env' | 'localStorage' | 'server' | 'none';
  maskedKey: string;
}

import { isProviderConfiguredOnServer, isProxyMode, providerFetch } from './apiClient';

export class ConfigService {
  private static instance: ConfigService;

  private constructor() {}

  public static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  private readEnv(_key: string, viteKey: string): string {
    // Only VITE_-prefixed variables reach the browser (and they are visible to every visitor).
    const env = (import.meta as any).env;
    const val = env ? env[viteKey] : '';
    return typeof val === 'string' ? val : '';
  }

  private getKey(storageKey: string, envKey: string, viteKey: string, providerId?: string): { key: string; source: 'env' | 'localStorage' | 'server' | 'none' } {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(storageKey);
      if (stored && stored.trim()) {
        return { key: stored.trim(), source: 'localStorage' };
      }
    }
    const envVal = this.readEnv(envKey, viteKey);
    if (envVal && envVal.trim()) {
      return { key: envVal.trim(), source: 'env' };
    }
    // Served by the Cloudflare Worker: the key lives server-side and requests are proxied.
    if (providerId && isProxyMode() && isProviderConfiguredOnServer(providerId)) {
      return { key: 'proxy', source: 'server' };
    }
    return { key: '', source: 'none' };
  }

  /** True when the given provider will be reached through the Worker proxy rather than a local key. */
  public usesProxy(providerId: string): boolean {
    return isProxyMode() && isProviderConfiguredOnServer(providerId);
  }

  public setKey(storageKey: string, value: string): void {
    if (typeof window !== 'undefined') {
      if (value && value.trim()) {
        localStorage.setItem(storageKey, value.trim());
      } else {
        localStorage.removeItem(storageKey);
      }
    }
  }

  public clearKey(storageKey: string): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(storageKey);
    }
  }

  // Key Accessors
  public getTavilyKey(): string {
    return this.getKey('luminara_tavily_key', 'TAVILY_API_KEY', 'VITE_TAVILY_API_KEY', 'tavily').key;
  }

  public getFirecrawlKey(): string {
    return this.getKey('luminara_firecrawl_key', 'FIRECRAWL_API_KEY', 'VITE_FIRECRAWL_API_KEY', 'firecrawl').key;
  }

  public getTinkerKey(): string {
    return this.getKey('luminara_tinker_key', 'TINKER_API_KEY', 'VITE_TINKER_API_KEY').key;
  }

  public getBrowserbaseKey(): string {
    return this.getKey('luminara_browserbase_key', 'BROWSERBASE_API_KEY', 'VITE_BROWSERBASE_API_KEY').key;
  }

  public getGroqKey(): string {
    return this.getKey('luminara_groq_key', 'GROQ_API_KEY', 'VITE_GROQ_API_KEY', 'groq').key;
  }

  public getGroqFallbackKey(): string {
    return this.getKey('luminara_groq_fallback_key', 'GROQ_API_KEY_FALLBACK', 'VITE_GROQ_API_KEY_FALLBACK').key;
  }

  public getExaKey(): string {
    return this.getKey('luminara_exa_key', 'EXA_API_KEY', 'VITE_EXA_API_KEY', 'exa').key;
  }

  public getFalKey(): string {
    return this.getKey('luminara_fal_key', 'FAL_KEY', 'VITE_FAL_KEY').key;
  }

  public getNvidiaKey(): string {
    return this.getKey('luminara_nvidia_key', 'NVIDIA_API_KEY', 'VITE_NVIDIA_API_KEY', 'nim').key;
  }

  public getNvidiaOrgId(): string {
    return this.getKey('luminara_nvidia_org_id', 'NVIDIA_ORG_ID', 'VITE_NVIDIA_ORG_ID').key;
  }

  public getOllamaKey(): string {
    return this.getKey('luminara_ollama_key', 'OLLAMA_API_KEY', 'VITE_OLLAMA_API_KEY', 'ollama').key;
  }

  public getGeminiKey(): string {
    return this.getKey('luminara_api_key', 'GEMINI_API_KEY', 'VITE_GEMINI_API_KEY', 'gemini').key;
  }

  private mask(key: string): string {
    if (!key) return '';
    if (key === 'proxy') return 'server-side';
    if (key.length <= 8) return '••••••••';
    return `${key.slice(0, 4)}••••${key.slice(-4)}`;
  }

  public getAllStatuses(): ProviderStatus[] {
    const providers = [
      { id: 'groq', name: 'Groq (Primary)', cat: 'llm' as const, ...this.getKey('luminara_groq_key', 'GROQ_API_KEY', 'VITE_GROQ_API_KEY', 'groq') },
      { id: 'groq_fallback', name: 'Groq (Fallback)', cat: 'llm' as const, ...this.getKey('luminara_groq_fallback_key', 'GROQ_API_KEY_FALLBACK', 'VITE_GROQ_API_KEY_FALLBACK') },
      { id: 'nvidia', name: 'NVIDIA NIM', cat: 'llm' as const, ...this.getKey('luminara_nvidia_key', 'NVIDIA_API_KEY', 'VITE_NVIDIA_API_KEY', 'nim') },
      { id: 'ollama', name: 'Ollama Cloud', cat: 'llm' as const, ...this.getKey('luminara_ollama_key', 'OLLAMA_API_KEY', 'VITE_OLLAMA_API_KEY', 'ollama') },
      { id: 'gemini', name: 'Google Gemini', cat: 'llm' as const, ...this.getKey('luminara_api_key', 'GEMINI_API_KEY', 'VITE_GEMINI_API_KEY', 'gemini') },
      { id: 'tavily', name: 'Tavily Search', cat: 'search' as const, ...this.getKey('luminara_tavily_key', 'TAVILY_API_KEY', 'VITE_TAVILY_API_KEY', 'tavily') },
      { id: 'exa', name: 'Exa.ai Neural Search', cat: 'search' as const, ...this.getKey('luminara_exa_key', 'EXA_API_KEY', 'VITE_EXA_API_KEY', 'exa') },
      { id: 'firecrawl', name: 'Firecrawl Scraper', cat: 'scraping' as const, ...this.getKey('luminara_firecrawl_key', 'FIRECRAWL_API_KEY', 'VITE_FIRECRAWL_API_KEY', 'firecrawl') },
      { id: 'browserbase', name: 'Browserbase Headless', cat: 'scraping' as const, ...this.getKey('luminara_browserbase_key', 'BROWSERBASE_API_KEY', 'VITE_BROWSERBASE_API_KEY') },
      { id: 'fal', name: 'Fal.ai Generative', cat: 'generative' as const, ...this.getKey('luminara_fal_key', 'FAL_KEY', 'VITE_FAL_KEY') },
      { id: 'tinker', name: 'Tinker Runtime', cat: 'runtime' as const, ...this.getKey('luminara_tinker_key', 'TINKER_API_KEY', 'VITE_TINKER_API_KEY') },
    ];

    return providers.map(p => ({
      id: p.id,
      name: p.name,
      category: p.cat,
      isConfigured: Boolean(p.key && p.key.trim()),
      source: p.source,
      maskedKey: this.mask(p.key)
    }));
  }

  // Live Connection Ping Testers
  public async testGroq(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const key = this.getGroqKey() || this.getGroqFallbackKey();
    if (!key) return { success: false, message: 'No Groq API Key found', latencyMs: 0 };
    const start = Date.now();
    try {
      const res = await providerFetch('groq', '/models', 'https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` }
      });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, message: 'Connected to Groq Cloud API', latencyMs };
      }
      return { success: false, message: `Groq error HTTP ${res.status}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Network error', latencyMs: Date.now() - start };
    }
  }

  public async testTavily(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const key = this.getTavilyKey();
    if (!key) return { success: false, message: 'No Tavily API Key found', latencyMs: 0 };
    const start = Date.now();
    try {
      const res = await providerFetch('tavily', '/search', 'https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, query: 'test', max_results: 1 })
      });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, message: 'Connected to Tavily SERP API', latencyMs };
      }
      return { success: false, message: `Tavily error HTTP ${res.status}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Network error', latencyMs: Date.now() - start };
    }
  }

  public async testFirecrawl(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const key = this.getFirecrawlKey();
    if (!key) return { success: false, message: 'No Firecrawl API Key found', latencyMs: 0 };
    const start = Date.now();
    try {
      const res = await providerFetch('firecrawl', '/scrape', 'https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({ url: 'https://example.com' })
      });
      const latencyMs = Date.now() - start;
      if (res.ok || res.status === 402 || res.status === 200) {
        return { success: true, message: 'Connected to Firecrawl API', latencyMs };
      }
      return { success: false, message: `Firecrawl error HTTP ${res.status}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Network error', latencyMs: Date.now() - start };
    }
  }

  public async testExa(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const key = this.getExaKey();
    if (!key) return { success: false, message: 'No Exa API Key found', latencyMs: 0 };
    const start = Date.now();
    try {
      const res = await providerFetch('exa', '/search', 'https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key
        },
        body: JSON.stringify({ query: 'test', numResults: 1 })
      });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, message: 'Connected to Exa.ai API', latencyMs };
      }
      return { success: false, message: `Exa error HTTP ${res.status}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Network error', latencyMs: Date.now() - start };
    }
  }

  public async testNvidia(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const key = this.getNvidiaKey();
    if (!key) return { success: false, message: 'No NVIDIA API Key found', latencyMs: 0 };
    const orgId = this.getNvidiaOrgId();
    const start = Date.now();
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${key}`
      };
      if (orgId) {
        headers['NV-Organization-ID'] = orgId;
      }
      const res = await providerFetch('nim', '/models', 'https://integrate.api.nvidia.com/v1/models', { headers });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, message: 'Connected to NVIDIA NIM Enterprise Cloud', latencyMs };
      }
      return { success: false, message: `NVIDIA error HTTP ${res.status}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Network error', latencyMs: Date.now() - start };
    }
  }

  public async testOllama(): Promise<{ success: boolean; isLocal: boolean; message: string; latencyMs: number; models?: string[] }> {
    const start = Date.now();
    // 1. Probe local Ollama daemon
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const localEndpoint = this.getOllamaLocalEndpoint();
      const res = await fetch(`${localEndpoint}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map((m: any) => m.name || m.model);
        return {
          success: true,
          isLocal: true,
          message: `Connected to Local Ollama (${models.length} models installed)`,
          latencyMs,
          models
        };
      }
    } catch {
      // Local not running or blocked by CORS, proceed to check Ollama Cloud
    }

    // 2. Check Ollama Cloud / custom endpoint
    const cloudKey = this.getOllamaKey();
    if (cloudKey) {
      const latencyMs = Date.now() - start;
      return {
        success: true,
        isLocal: false,
        message: 'Ollama Cloud Gateway Configured & Ready',
        latencyMs
      };
    }

    return {
      success: false,
      isLocal: false,
      message: 'Local Ollama daemon not running at :11434 and no Cloud Key configured',
      latencyMs: Date.now() - start
    };
  }

  /** Same-origin proxy for NVIDIA NIM (the public endpoint blocks browser CORS). Empty = not configured. */
  public getNvidiaProxyEndpoint(): string {
    if (typeof window !== 'undefined') {
      const custom = localStorage.getItem('luminara_nvidia_proxy_endpoint');
      if (custom && custom.trim()) return custom.trim();
    }
    return '';
  }

  public getOllamaLocalEndpoint(): string {
    return 'http://127.0.0.1:11434';
  }

  public getOllamaEndpoint(): string {
    if (typeof window !== 'undefined') {
      const custom = localStorage.getItem('luminara_ollama_endpoint');
      if (custom && custom.trim()) return custom.trim();
    }
    return this.getOllamaLocalEndpoint();
  }

  public getNativePriority(): Array<'groq' | 'nim' | 'ollama'> {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('luminara_native_llm_order');
      if (stored) {
        const parsed = stored.split(',').filter(id => ['groq', 'nim', 'ollama'].includes(id)) as Array<'groq' | 'nim' | 'ollama'>;
        if (parsed.length === 3) return parsed;
      }
    }
    return ['groq', 'nim', 'ollama'];
  }

  public setNativePriority(order: Array<'groq' | 'nim' | 'ollama'>): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('luminara_native_llm_order', order.join(','));
      window.dispatchEvent(new CustomEvent('luminara-native-priority-change', { detail: { order } }));
    }
  }
}

export const configService = ConfigService.getInstance();
