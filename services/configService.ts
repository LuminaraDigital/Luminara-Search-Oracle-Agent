/**
 * Luminara Unified Configuration & Secrets Service
 * Manages API keys with local storage overrides, environment detection, and live connectivity tests.
 */

export interface ProviderStatus {
  id: string;
  name: string;
  category: 'llm' | 'search' | 'scraping' | 'generative' | 'runtime' | 'tools';
  isConfigured: boolean;
  source: 'env' | 'localStorage' | 'server' | 'none';
  maskedKey: string;
}

import { canUseHostedProviderKey, isSidecarConfiguredOnServer, loadServerHealth, providerFetch, sidecarFetch } from './apiClient';
import { toUserFacingText } from '../utils/userFacingText';

async function readProviderError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text) as { error?: unknown; message?: unknown };
      const detail = toUserFacingText(body.error ?? body.message, '');
      if (detail) return `HTTP ${res.status}: ${detail}`;
    } catch { /* plain text */ }
    return `HTTP ${res.status}: ${text.slice(0, 160)}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Ensure Worker health (and BYOK relay readiness) before a Settings ping. */
async function ensureRelayReady(): Promise<void> {
  try {
    await loadServerHealth();
  } catch { /* relay may still work via static BYOK list */ }
}

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
    // Hosted Worker key. Paid engines (NIM / Ollama Cloud / OpenRouter) only resolve to
    // 'proxy' when the user has an active plan; otherwise free users would look "connected",
    // call hosted NIM first, and get the Stars/TON paywall despite having Groq BYOK.
    if (providerId && canUseHostedProviderKey(providerId)) {
      return { key: 'proxy', source: 'server' };
    }
    return { key: '', source: 'none' };
  }

  /** True when the given provider will be reached through the Worker proxy rather than a local key. */
  public usesProxy(providerId: string): boolean {
    return canUseHostedProviderKey(providerId);
  }

  /** Real bring-your-own key only (never the hosted 'proxy' sentinel). */
  public getByokKey(storageKey: string): string {
    if (typeof window === 'undefined') return '';
    const stored = localStorage.getItem(storageKey);
    return stored && stored.trim() ? stored.trim() : '';
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

  public getCrawlerProvider(): 'auto' | 'patchright' | 'firecrawl' | 'jina' {
    const p = typeof window !== 'undefined' ? (localStorage.getItem('luminara_crawler_provider') || 'auto') : 'auto';
    return ['auto', 'patchright', 'firecrawl', 'jina'].includes(p as any) ? (p as any) : 'auto';
  }

  public setCrawlerProvider(provider: string): void {
    this.setKey('luminara_crawler_provider', provider);
  }

  /**
   * Sitewide Instant Audit evidence:
   * - off: homepage only
   * - smart: map / internal links + selective multi-page scrape (default)
   * - deep: Firecrawl /crawl (BYOK or paid hosted Stars/TON/Stripe plan)
   */
  public getSitewideEvidenceMode(): 'off' | 'smart' | 'deep' {
    try {
      if (typeof localStorage !== 'undefined') {
        const v = localStorage.getItem('luminara_sitewide_evidence') || 'smart';
        if (v === 'off' || v === 'smart' || v === 'deep') return v;
      }
    } catch { /* ignore */ }
    return 'smart';
  }

  public setSitewideEvidenceMode(mode: 'off' | 'smart' | 'deep'): void {
    this.setKey('luminara_sitewide_evidence', mode);
  }

  public getSitewideMaxPages(): number {
    try {
      if (typeof localStorage !== 'undefined') {
        const n = Number(localStorage.getItem('luminara_sitewide_max_pages') || '6');
        if (Number.isFinite(n)) return Math.max(1, Math.min(Math.floor(n), 12));
      }
    } catch { /* ignore */ }
    return 6;
  }

  public setSitewideMaxPages(n: number): void {
    const clamped = Math.max(1, Math.min(Math.floor(n) || 6, 12));
    this.setKey('luminara_sitewide_max_pages', String(clamped));
  }

  public getPatchrightUrl(): string {
    return this.getKey('luminara_patchright_url', 'PATCHRIGHT_URL', 'VITE_PATCHRIGHT_URL').key || 'http://localhost:3001';
  }

  public setPatchrightUrl(url: string): void {
    this.setKey('luminara_patchright_url', url);
  }

  public getLocalSerpUrl(): string {
    return this.getKey('luminara_local_serp_url', 'LOCAL_SERP_URL', 'VITE_LOCAL_SERP_URL').key || this.getPatchrightUrl() || 'http://localhost:3001';
  }

  public setLocalSerpUrl(url: string): void {
    this.setKey('luminara_local_serp_url', url);
  }

  public isLocalSerpEnabled(): boolean {
    try {
      if (typeof window !== 'undefined' || typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('luminara_local_serp_enabled');
        if (stored !== null) return stored === 'true';
      }
    } catch {}
    return true; // Enabled by default as an additive zero-key fallback
  }

  public setLocalSerpEnabled(enabled: boolean): void {
    try {
      if (typeof window !== 'undefined' || typeof localStorage !== 'undefined') {
        localStorage.setItem('luminara_local_serp_enabled', enabled ? 'true' : 'false');
      }
    } catch {}
  }

  public getCrawlerProxy(): string {
    return this.getKey('luminara_crawler_proxy', 'CRAWLER_PROXY', 'VITE_CRAWLER_PROXY').key;
  }

  /** Shared secret for a self-hosted crawler started with CRAWLER_TOKEN (sent as x-crawler-token). */
  public getCrawlerToken(): string {
    return this.getKey('luminara_crawler_token', 'CRAWLER_TOKEN', 'VITE_CRAWLER_TOKEN').key;
  }

  public setCrawlerToken(token: string): void {
    this.setKey('luminara_crawler_token', token);
  }

  /** Headers for calls to the self-hosted crawler / local SERP sidecar. Only ever sent to that endpoint. */
  public crawlerAuthHeaders(): Record<string, string> {
    const token = this.getCrawlerToken();
    return token ? { 'x-crawler-token': token } : {};
  }

  public setCrawlerProxy(proxy: string): void {
    this.setKey('luminara_crawler_proxy', proxy);
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

  public getOllamaModel(): string {
    if (typeof window !== 'undefined') {
      const custom = localStorage.getItem('luminara_ollama_model');
      if (custom && custom.trim()) return custom.trim();
    }
    const envVal = this.readEnv('OLLAMA_MODEL', 'VITE_OLLAMA_MODEL');
    if (envVal && envVal.trim()) return envVal.trim();
    return 'llama3.2';
  }

  public setOllamaModel(model: string): void {
    this.setKey('luminara_ollama_model', model);
  }

  public setOllamaEndpoint(endpoint: string): void {
    this.setKey('luminara_ollama_endpoint', endpoint);
  }

  public getOpenRouterKey(): string {
    return this.getKey('luminara_openrouter_key', 'OPENROUTER_API_KEY', 'VITE_OPENROUTER_API_KEY', 'openrouter').key;
  }

  public setOpenRouterKey(key: string): void {
    this.setKey('luminara_openrouter_key', key);
  }

  /** FreeLLMAPI unified bearer key (BYOK sidecar only; never a Worker-hosted secret). */
  public getFreeLlmKey(): string {
    return this.getKey('luminara_freellm_key', 'FREELLM_API_KEY', 'VITE_FREELLM_API_KEY').key;
  }

  public setFreeLlmKey(key: string): void {
    this.setKey('luminara_freellm_key', key);
  }

  /**
   * OpenAI-compatible base URL for FreeLLMAPI (default local sidecar).
   * Includes the `/v1` suffix, e.g. `http://localhost:3001/v1`.
   */
  public getFreeLlmBaseUrl(): string {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('luminara_freellm_base_url');
      if (stored && stored.trim()) return stored.trim().replace(/\/+$/, '');
    }
    const envVal = this.readEnv('FREELLM_BASE_URL', 'VITE_FREELLM_BASE_URL');
    if (envVal && envVal.trim()) return envVal.trim().replace(/\/+$/, '');
    return 'http://localhost:3001/v1';
  }

  public setFreeLlmBaseUrl(url: string): void {
    if (typeof window === 'undefined') return;
    const cleaned = (url || '').trim().replace(/\/+$/, '');
    if (!cleaned) {
      localStorage.removeItem('luminara_freellm_base_url');
    } else {
      localStorage.setItem('luminara_freellm_base_url', cleaned);
    }
  }

  /**
   * When true and a FreeLLMAPI key is set, freellm is moved to the front of native priority
   * so one unified key can replace wiring Groq/NIM/OpenRouter/Ollama individually.
   */
  public isFreeLlmPreferGateway(): boolean {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem('luminara_freellm_prefer');
    if (stored === null) return true;
    return stored === '1' || stored === 'true';
  }

  public setFreeLlmPreferGateway(prefer: boolean): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem('luminara_freellm_prefer', prefer ? '1' : '0');
    window.dispatchEvent(new CustomEvent('luminara-native-priority-change', {
      detail: { order: this.getNativePriority() },
    }));
  }

  public getGeminiKey(): string {
    return this.getKey('luminara_api_key', 'GEMINI_API_KEY', 'VITE_GEMINI_API_KEY', 'gemini').key;
  }

  // ---- Self-hosted helper tools ("Writing check" / "Results tracking") ----
  // Empty URL = use the hosted relay through the Worker.

  /** Base URL of the grammar service behind "Writing check" (LanguageTool HTTP server). */
  public getLanguageToolUrl(): string {
    return this.getKey('luminara_languagetool_url', 'LANGUAGETOOL_URL', 'VITE_LANGUAGETOOL_URL').key;
  }

  public setLanguageToolUrl(url: string): void {
    this.setKey('luminara_languagetool_url', url);
  }

  /** Base URL of the analytics service behind "Results tracking" (Umami self-hosted or Cloud). */
  public getUmamiUrl(): string {
    return this.getKey('luminara_umami_url', 'UMAMI_URL', 'VITE_UMAMI_URL').key;
  }

  public setUmamiUrl(url: string): void {
    this.setKey('luminara_umami_url', url);
  }

  public getUmamiApiKey(): string {
    return this.getKey('luminara_umami_key', 'UMAMI_API_KEY', 'VITE_UMAMI_API_KEY').key;
  }

  public setUmamiApiKey(key: string): void {
    this.setKey('luminara_umami_key', key);
  }

  private toolStatus(id: string, name: string, storageKey: string, envKey: string, viteKey: string, sidecar: 'languagetool' | 'umami'): ProviderStatus {
    const url = this.getKey(storageKey, envKey, viteKey);
    if (url.key) {
      let host = url.key;
      try { host = new URL(url.key).host; } catch { /* keep raw */ }
      return { id, name, category: 'tools', isConfigured: true, source: url.source, maskedKey: host };
    }
    if (isSidecarConfiguredOnServer(sidecar)) {
      return { id, name, category: 'tools', isConfigured: true, source: 'server', maskedKey: 'server-side' };
    }
    return { id, name, category: 'tools', isConfigured: false, source: 'none', maskedKey: '' };
  }

  private mask(key: string): string {
    if (!key) return '';
    if (key === 'proxy') return 'server-side';
    if (key.length <= 8) return '••••••••';
    return `${key.slice(0, 4)}••••${key.slice(-4)}`;
  }

  public getAllStatuses(): ProviderStatus[] {
    const freellmKey = this.getFreeLlmKey();
    const freellmConfigured = Boolean(freellmKey && freellmKey.trim());
    const providers = [
      {
        id: 'freellm',
        name: 'FreeLLMAPI Gateway (One Key)',
        cat: 'llm' as const,
        key: freellmKey,
        source: (freellmConfigured ? 'localStorage' : 'none') as 'env' | 'localStorage' | 'server' | 'none',
      },
      { id: 'nvidia', name: 'NVIDIA NIM (Native Primary)', cat: 'llm' as const, ...this.getKey('luminara_nvidia_key', 'NVIDIA_API_KEY', 'VITE_NVIDIA_API_KEY', 'nim') },
      { id: 'groq', name: 'Groq Cloud (Native LPU)', cat: 'llm' as const, ...this.getKey('luminara_groq_key', 'GROQ_API_KEY', 'VITE_GROQ_API_KEY', 'groq') },
      { id: 'groq_fallback', name: 'Groq Fallback (Native Auto-Failover)', cat: 'llm' as const, ...this.getKey('luminara_groq_fallback_key', 'GROQ_API_KEY_FALLBACK', 'VITE_GROQ_API_KEY_FALLBACK') },
      { id: 'openrouter', name: 'OpenRouter (Frontier Multi-Model)', cat: 'llm' as const, ...this.getKey('luminara_openrouter_key', 'OPENROUTER_API_KEY', 'VITE_OPENROUTER_API_KEY', 'openrouter') },
      { id: 'ollama', name: 'Ollama (Native Local & Cloud)', cat: 'llm' as const, ...this.getKey('luminara_ollama_key', 'OLLAMA_API_KEY', 'VITE_OLLAMA_API_KEY', 'ollama') },
      { id: 'gemini', name: 'Google Gemini (Optional Fallback)', cat: 'llm' as const, ...this.getKey('luminara_api_key', 'GEMINI_API_KEY', 'VITE_GEMINI_API_KEY', 'gemini') },
      { id: 'tavily', name: 'Tavily Search', cat: 'search' as const, ...this.getKey('luminara_tavily_key', 'TAVILY_API_KEY', 'VITE_TAVILY_API_KEY', 'tavily') },
      { id: 'exa', name: 'Exa.ai Neural Search', cat: 'search' as const, ...this.getKey('luminara_exa_key', 'EXA_API_KEY', 'VITE_EXA_API_KEY', 'exa') },
      { id: 'firecrawl', name: 'Firecrawl Scraper', cat: 'scraping' as const, ...this.getKey('luminara_firecrawl_key', 'FIRECRAWL_API_KEY', 'VITE_FIRECRAWL_API_KEY', 'firecrawl') },
      { id: 'patchright', name: 'Patchright Stealth Crawler', cat: 'scraping' as const, ...this.getKey('luminara_patchright_url', 'PATCHRIGHT_URL', 'VITE_PATCHRIGHT_URL') },
      { id: 'local_serp', name: 'Local Google SERP Scraper', cat: 'search' as const, ...this.getKey('luminara_local_serp_url', 'LOCAL_SERP_URL', 'VITE_LOCAL_SERP_URL') },
      { id: 'browserbase', name: 'Browserbase Headless', cat: 'scraping' as const, ...this.getKey('luminara_browserbase_key', 'BROWSERBASE_API_KEY', 'VITE_BROWSERBASE_API_KEY') },
      { id: 'fal', name: 'Fal.ai Generative', cat: 'generative' as const, ...this.getKey('luminara_fal_key', 'FAL_KEY', 'VITE_FAL_KEY') },
      { id: 'tinker', name: 'Tinker Runtime', cat: 'runtime' as const, ...this.getKey('luminara_tinker_key', 'TINKER_API_KEY', 'VITE_TINKER_API_KEY') },
    ];

    const statuses: ProviderStatus[] = providers.map(p => ({
      id: p.id,
      name: p.name,
      category: p.cat,
      isConfigured: Boolean(p.key && p.key.trim()),
      source: p.source,
      maskedKey: this.mask(p.key)
    }));

    statuses.push(
      this.toolStatus('writing_check', 'Writing check', 'luminara_languagetool_url', 'LANGUAGETOOL_URL', 'VITE_LANGUAGETOOL_URL', 'languagetool'),
      this.toolStatus('results_tracking', 'Results tracking', 'luminara_umami_url', 'UMAMI_URL', 'VITE_UMAMI_URL', 'umami'),
    );
    return statuses;
  }

  /** Pings the grammar service with a tiny sentence that should produce at least one match. */
  public async testWritingCheck(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    const unreachable = 'Not reachable. Start it with docker compose or leave blank to use the hosted one.';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await sidecarFetch('languagetool', '/v2/check', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ text: 'This is an test.', language: 'en-US' }).toString(),
        signal: controller.signal,
      }, { directBase: this.getLanguageToolUrl() || undefined });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      if (!res) return { success: false, message: unreachable, latencyMs };
      if (!res.ok) return { success: false, message: `Writing check answered with an error (HTTP ${res.status}).`, latencyMs };
      const raw = await res.text();
      let data: any;
      try { data = JSON.parse(raw); } catch { return { success: false, message: unreachable, latencyMs }; }
      if (!data || !Array.isArray(data.matches)) return { success: false, message: unreachable, latencyMs };
      const n = data.matches.length;
      return { success: true, message: n >= 1 ? `Connected - found ${n} issue${n === 1 ? '' : 's'} in the test sentence` : 'Connected', latencyMs };
    } catch (e: any) {
      const latencyMs = Date.now() - start;
      return { success: false, message: e?.name === 'AbortError' ? 'Timed out. Is the writing check running?' : unreachable, latencyMs };
    }
  }

  /** Lists tracked sites from the analytics service and reports how many it found. */
  public async testResultsTracking(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    const unreachable = 'Not reachable. Start it with docker compose or leave blank to use the hosted one.';
    try {
      const direct = this.getUmamiUrl();
      const key = this.getUmamiApiKey();
      if (direct && !key) return { success: false, message: 'Add the API key for your results tracking account.', latencyMs: 0 };
      let prefix = '/api';
      if (direct) {
        try { if (new URL(direct).host.toLowerCase() === 'api.umami.is') prefix = '/v1'; } catch { /* keep /api */ }
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await sidecarFetch('umami', `${prefix}/websites`, { signal: controller.signal }, { directBase: direct || undefined, userKey: key || undefined });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      if (!res) return { success: false, message: unreachable, latencyMs };
      if (res.status === 401 || res.status === 403) return { success: false, message: 'The API key was rejected. Check it in your analytics account.', latencyMs };
      if (!res.ok) return { success: false, message: `Results tracking answered with an error (HTTP ${res.status}).`, latencyMs };
      const raw = await res.text();
      let data: any;
      try { data = JSON.parse(raw); } catch { return { success: false, message: unreachable, latencyMs }; }
      const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : null;
      if (!list) return { success: false, message: unreachable, latencyMs };
      return { success: true, message: `Connected - ${list.length} site${list.length === 1 ? '' : 's'} tracked`, latencyMs };
    } catch (e: any) {
      const latencyMs = Date.now() - start;
      return { success: false, message: e?.name === 'AbortError' ? 'Timed out. Is results tracking running?' : unreachable, latencyMs };
    }
  }

  // Live Connection Ping Testers
  public async testGroq(overrideKey?: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const key = (overrideKey && overrideKey.trim()) || this.getGroqKey() || this.getGroqFallbackKey();
    if (!key || key === 'proxy') return { success: false, message: 'No Groq API Key found', latencyMs: 0 };
    await ensureRelayReady();
    const start = Date.now();
    try {
      const res = await providerFetch('groq', '/models', 'https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${key}` }
      }, { userKey: key });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, message: 'Connected to Groq Cloud API', latencyMs };
      }
      return { success: false, message: `Groq error ${await readProviderError(res)}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: toUserFacingText(e, 'Network error (vendor CORS? use the Worker relay)'), latencyMs: Date.now() - start };
    }
  }

  public async testTavily(overrideKey?: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const key = (overrideKey && overrideKey.trim()) || this.getTavilyKey();
    if (!key || key === 'proxy') return { success: false, message: 'No Tavily API Key found', latencyMs: 0 };
    await ensureRelayReady();
    const start = Date.now();
    try {
      const res = await providerFetch('tavily', '/search', 'https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: key, query: 'test', max_results: 1 })
      }, { userKey: key });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, message: 'Connected to Tavily SERP API', latencyMs };
      }
      return { success: false, message: `Tavily error ${await readProviderError(res)}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: toUserFacingText(e, 'Network error (vendor CORS? use the Worker relay)'), latencyMs: Date.now() - start };
    }
  }

  public async testFirecrawl(overrideKey?: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const key = (overrideKey && overrideKey.trim()) || this.getFirecrawlKey();
    if (!key || key === 'proxy') return { success: false, message: 'No Firecrawl API Key found', latencyMs: 0 };
    await ensureRelayReady();
    const start = Date.now();
    try {
      const res = await providerFetch('firecrawl', '/scrape', 'https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({ url: 'https://example.com' })
      }, { userKey: key });
      const latencyMs = Date.now() - start;
      if (res.ok || res.status === 402 || res.status === 200) {
        return { success: true, message: 'Connected to Firecrawl API', latencyMs };
      }
      return { success: false, message: `Firecrawl error ${await readProviderError(res)}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: toUserFacingText(e, 'Network error (vendor CORS? use the Worker relay)'), latencyMs: Date.now() - start };
    }
  }

  public async testPatchright(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const url = this.getPatchrightUrl();
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: controller.signal });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: true, message: `Patchright active (${data.version || 'v1.50.0'})`, latencyMs };
      }
      return { success: false, message: `Crawler HTTP ${res.status}`, latencyMs };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      return { success: false, message: err.name === 'AbortError' ? 'Timeout (>3.5s)' : 'Offline / Connection refused', latencyMs };
    }
  }

  public async testLocalSerp(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const url = this.getLocalSerpUrl();
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: controller.signal });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: true, message: `SERP engine active (${data.engine || 'local-sidecar'})`, latencyMs };
      }
      return { success: false, message: `Sidecar HTTP ${res.status}`, latencyMs };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      return { success: false, message: err.name === 'AbortError' ? 'Timeout (>3.5s)' : 'Offline / Connection refused', latencyMs };
    }
  }

  public async testExa(overrideKey?: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const key = (overrideKey && overrideKey.trim()) || this.getExaKey();
    if (!key || key === 'proxy') return { success: false, message: 'No Exa API Key found', latencyMs: 0 };
    await ensureRelayReady();
    const start = Date.now();
    try {
      const res = await providerFetch('exa', '/search', 'https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key
        },
        body: JSON.stringify({ query: 'test', numResults: 1 })
      }, { userKey: key });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, message: 'Connected to Exa.ai API', latencyMs };
      }
      return { success: false, message: `Exa error ${await readProviderError(res)}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: toUserFacingText(e, 'Network error (vendor CORS? use the Worker relay)'), latencyMs: Date.now() - start };
    }
  }

  public async testNvidia(overrideKey?: string, overrideOrgId?: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const key = (overrideKey && overrideKey.trim()) || this.getNvidiaKey();
    if (!key || key === 'proxy') return { success: false, message: 'No NVIDIA API Key found', latencyMs: 0 };
    const orgId = overrideOrgId !== undefined ? overrideOrgId.trim() : this.getNvidiaOrgId();
    await ensureRelayReady();
    const start = Date.now();
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${key}`
      };
      if (orgId) {
        headers['NV-Organization-ID'] = orgId;
      }
      const res = await providerFetch('nim', '/models', 'https://integrate.api.nvidia.com/v1/models', { headers }, { userKey: orgId ? `${key}|${orgId}` : key });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, message: 'Connected to NVIDIA NIM Enterprise Cloud', latencyMs };
      }
      return { success: false, message: `NVIDIA error ${await readProviderError(res)}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: toUserFacingText(e, 'Network error (vendor CORS? use the Worker relay)'), latencyMs: Date.now() - start };
    }
  }

  public async testOllama(overrideEndpoint?: string, overrideKey?: string): Promise<{ success: boolean; isLocal: boolean; message: string; latencyMs: number; models?: string[] }> {
    const start = Date.now();
    const targetEndpoint = (overrideEndpoint && overrideEndpoint.trim()) ? overrideEndpoint.trim().replace(/\/+$/, '') : this.getOllamaEndpoint();
    // 1. Probe local/remote Ollama daemon at configured endpoint
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${targetEndpoint}/api/tags`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map((m: any) => m.name || m.model);
        const hostName = targetEndpoint.includes('127.0.0.1') || targetEndpoint.includes('localhost') ? 'Local' : targetEndpoint;
        return {
          success: true,
          isLocal: true,
          message: `Connected to ${hostName} Ollama (${models.length} model${models.length === 1 ? '' : 's'} installed)`,
          latencyMs,
          models
        };
      }
    } catch {
      // Local/remote endpoint not running or blocked by CORS, proceed to check Ollama Cloud
    }

    // 2. Check Ollama Cloud via Worker BYOK (or direct) when a cloud key is set
    const cloudKey = overrideKey !== undefined ? overrideKey.trim() : this.getOllamaKey();
    if (cloudKey && cloudKey !== 'proxy') {
      await ensureRelayReady();
      try {
        const res = await providerFetch('ollama', '/api/tags', 'https://ollama.com/api/tags', {
          headers: { Authorization: `Bearer ${cloudKey}` },
        }, { userKey: cloudKey });
        const latencyMs = Date.now() - start;
        if (res.ok) {
          return {
            success: true,
            isLocal: false,
            message: 'Connected to Ollama Cloud',
            latencyMs,
          };
        }
        return {
          success: false,
          isLocal: false,
          message: `Ollama Cloud error ${await readProviderError(res)}`,
          latencyMs,
        };
      } catch (e: any) {
        return {
          success: false,
          isLocal: false,
          message: toUserFacingText(e, 'Ollama Cloud unreachable'),
          latencyMs: Date.now() - start,
        };
      }
    }

    return {
      success: false,
      isLocal: false,
      message: `Ollama daemon not reachable at ${targetEndpoint} and no Cloud Key configured`,
      latencyMs: Date.now() - start
    };
  }

  /** Same-origin proxy for NVIDIA NIM (the public endpoint blocks browser CORS). Empty = not configured. */
  public getNvidiaProxyEndpoint(): string {
    if (typeof window !== 'undefined') {
      const custom = localStorage.getItem('luminara_nvidia_proxy_endpoint');
      if (custom && custom.trim()) return custom.trim();
      if (window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port === '3000') {
        return '/api/nim-proxy';
      }
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

  public async testOpenRouter(overrideKey?: string): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const key = (overrideKey && overrideKey.trim()) || this.getOpenRouterKey();
    if (!key || key === 'proxy') return { success: false, message: 'No OpenRouter API Key found', latencyMs: 0 };
    await ensureRelayReady();
    const start = Date.now();
    try {
      const res = await providerFetch('openrouter', '/models', 'https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': 'https://luminarasuite.com',
          'X-Title': 'Luminara Suite',
        }
      }, { userKey: key });
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, message: 'Connected to OpenRouter API', latencyMs };
      }
      return { success: false, message: `OpenRouter error ${await readProviderError(res)}`, latencyMs };
    } catch (e: any) {
      return { success: false, message: toUserFacingText(e, 'Network error (vendor CORS? use the Worker relay)'), latencyMs: Date.now() - start };
    }
  }

  private static readonly NATIVE_ENGINE_IDS = ['groq', 'nim', 'ollama', 'openrouter', 'freellm'] as const;

  public getNativePriority(): Array<'groq' | 'nim' | 'ollama' | 'openrouter' | 'freellm'> {
    const allowed = ConfigService.NATIVE_ENGINE_IDS as readonly string[];
    let order: Array<'groq' | 'nim' | 'ollama' | 'openrouter' | 'freellm'> = ['nim', 'groq', 'openrouter', 'ollama', 'freellm'];

    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('luminara_native_llm_order');
      if (stored) {
        const parsed = stored.split(',').filter(id => allowed.includes(id)) as Array<'groq' | 'nim' | 'ollama' | 'openrouter' | 'freellm'>;
        if (parsed.length >= 3) order = parsed;
      }
    }

    if (!order.includes('freellm')) {
      order = [...order, 'freellm'];
    }

    // One-key UX: when FreeLLMAPI is configured and prefer-gateway is on, put it first.
    if (this.getFreeLlmKey() && this.isFreeLlmPreferGateway()) {
      order = ['freellm', ...order.filter(id => id !== 'freellm')];
    }

    return order;
  }

  public setNativePriority(order: Array<'groq' | 'nim' | 'ollama' | 'openrouter' | 'freellm'>): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('luminara_native_llm_order', order.join(','));
      window.dispatchEvent(new CustomEvent('luminara-native-priority-change', { detail: { order } }));
    }
  }

  /** Direct ping to FreeLLMAPI `/models` (client-side; never Worker-hosted). */
  public async testFreeLlm(): Promise<{ success: boolean; message: string; latencyMs: number }> {
    const key = this.getFreeLlmKey();
    if (!key) return { success: false, message: 'No FreeLLMAPI unified key found', latencyMs: 0 };
    const base = this.getFreeLlmBaseUrl();
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      if (res.ok) {
        return { success: true, message: `Connected to FreeLLMAPI at ${base}`, latencyMs };
      }
      return { success: false, message: `FreeLLMAPI error HTTP ${res.status}`, latencyMs };
    } catch (e: any) {
      const latencyMs = Date.now() - start;
      const msg = e?.name === 'AbortError'
        ? 'Timed out. Is FreeLLMAPI running (default http://localhost:3001)?'
        : toUserFacingText(e, 'Network error. Start FreeLLMAPI locally, then retry.');
      return { success: false, message: msg, latencyMs };
    }
  }
}

export const configService = ConfigService.getInstance();
