/**
 * Patchright Stealth Crawler Client
 * 
 * Interacts with the local or containerized Patchright microservice sidecar.
 * Patchright uses AST-patched Chromium via CDP to bypass modern anti-bot protections
 * (Cloudflare Turnstile, DataDome, Akamai) without requiring expensive third-party SaaS tokens.
 */

import { configService } from '../configService';

export interface PatchrightScrapeResponse {
  success: boolean;
  url: string;
  statusCode?: number;
  title?: string;
  description?: string;
  markdown?: string;
  html?: string;
  latencyMs?: number;
  antiBotBypassed?: boolean;
  error?: string;
}

export interface PatchrightHealthResponse {
  ok: boolean;
  version?: string;
  message?: string;
  latencyMs: number;
}

/** Indexed DOM observe payload from crawler /session routes (additive). */
export type PatchrightObservePayload = {
  url: string;
  title: string;
  text: string;
  actions: Array<Record<string, unknown>>;
  fingerprint: string;
  marker?: unknown;
  screenshot?: string;
  [key: string]: unknown;
};

export type PatchrightSessionResponse = {
  success: boolean;
  sessionId?: string;
  observe?: PatchrightObservePayload;
  historyEntry?: Record<string, unknown>;
  closed?: boolean;
  error?: string;
  code?: string;
  latencyMs?: number;
};

export class PatchrightClient {
  private static instance: PatchrightClient;

  private constructor() {}

  public static getInstance(): PatchrightClient {
    if (!PatchrightClient.instance) {
      PatchrightClient.instance = new PatchrightClient();
    }
    return PatchrightClient.instance;
  }

  /**
   * Health check to test if the Patchright crawler sidecar is reachable.
   */
  public async checkHealth(customEndpoint?: string): Promise<PatchrightHealthResponse> {
    const endpoint = (customEndpoint || configService.getPatchrightUrl() || 'http://localhost:3001').replace(/\/$/, '');
    const startTime = performance.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${endpoint}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - startTime);

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return {
          ok: true,
          version: data.version || 'patchright-v1.0.0',
          message: data.message || 'Patchright Stealth Runner connected',
          latencyMs,
        };
      }

      return {
        ok: false,
        message: `HTTP ${res.status}: ${res.statusText}`,
        latencyMs,
      };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        ok: false,
        message: err.name === 'AbortError' ? 'Connection timed out (>3.5s)' : (err.message || 'Connection refused'),
        latencyMs,
      };
    }
  }

  /**
   * Dispatches a scrape job to the stealth runner.
   */
  public async scrape(
    url: string,
    options: {
      waitFor?: number;
      proxy?: string;
      customEndpoint?: string;
      timeoutMs?: number;
    } = {}
  ): Promise<PatchrightScrapeResponse> {
    const endpoint = (options.customEndpoint || configService.getPatchrightUrl() || 'http://localhost:3001').replace(/\/$/, '');
    const startTime = performance.now();
    const timeoutMs = options.timeoutMs || 25000;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`${endpoint}/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...configService.crawlerAuthHeaders(),
        },
        body: JSON.stringify({
          url,
          waitFor: options.waitFor ?? 1500,
          proxy: options.proxy || configService.getCrawlerProxy() || undefined,
          stealth: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - startTime);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          success: false,
          url,
          statusCode: res.status,
          latencyMs,
          error: `Patchright crawler error: HTTP ${res.status} ${errText}`.trim(),
        };
      }

      const data = await res.json();
      return {
        success: true,
        url: data.url || url,
        statusCode: data.statusCode || 200,
        title: data.title,
        description: data.description,
        markdown: data.markdown || '',
        html: data.html || '',
        latencyMs: data.latencyMs || latencyMs,
        antiBotBypassed: Boolean(data.antiBotBypassed ?? true),
      };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        success: false,
        url,
        latencyMs,
        error: err.name === 'AbortError' ? 'Scrape timed out' : (err.message || 'Scrape failed'),
      };
    }
  }

  private resolveEndpoint(customEndpoint?: string): string {
    return (customEndpoint || configService.getPatchrightUrl() || 'http://localhost:3001').replace(/\/$/, '');
  }

  /**
   * Open an interactive session and return the first observe payload.
   * Additive to scrape(); does not change Instant Audit behavior.
   */
  public async createSession(opts: {
    url: string;
    accountKey?: string;
    customEndpoint?: string;
    timeoutMs?: number;
  }): Promise<PatchrightSessionResponse> {
    const endpoint = this.resolveEndpoint(opts.customEndpoint);
    const startTime = performance.now();
    const timeoutMs = opts.timeoutMs || 60_000;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${endpoint}/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...configService.crawlerAuthHeaders(),
        },
        body: JSON.stringify({
          url: opts.url,
          ...(opts.accountKey ? { accountKey: opts.accountKey } : {}),
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - startTime);
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.success === false) {
        return {
          success: false,
          sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
          error:
            (typeof data.error === 'string' && data.error) ||
            `Patchright session create error: HTTP ${res.status}`,
          code: typeof data.code === 'string' ? data.code : undefined,
          latencyMs,
        };
      }
      return {
        success: true,
        sessionId: String(data.sessionId || ''),
        observe: data.observe as PatchrightObservePayload | undefined,
        latencyMs,
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Math.round(performance.now() - startTime),
        error: err.name === 'AbortError' ? 'Session create timed out' : (err.message || 'Session create failed'),
        code: 'BROWSER_UNAVAILABLE',
      };
    }
  }

  public async observeSession(
    sessionId: string,
    options: { screenshot?: boolean; customEndpoint?: string; timeoutMs?: number } = {},
  ): Promise<PatchrightSessionResponse> {
    const endpoint = this.resolveEndpoint(options.customEndpoint);
    const startTime = performance.now();
    const timeoutMs = options.timeoutMs || 30_000;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${endpoint}/session/${encodeURIComponent(sessionId)}/observe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...configService.crawlerAuthHeaders(),
        },
        body: JSON.stringify({ screenshot: options.screenshot === true }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - startTime);
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.success === false) {
        return {
          success: false,
          sessionId,
          error:
            (typeof data.error === 'string' && data.error) ||
            `Patchright observe error: HTTP ${res.status}`,
          code: typeof data.code === 'string' ? data.code : undefined,
          latencyMs,
        };
      }
      return {
        success: true,
        sessionId,
        observe: data.observe as PatchrightObservePayload | undefined,
        latencyMs,
      };
    } catch (err: any) {
      return {
        success: false,
        sessionId,
        latencyMs: Math.round(performance.now() - startTime),
        error: err.name === 'AbortError' ? 'Observe timed out' : (err.message || 'Observe failed'),
        code: 'BROWSER_UNAVAILABLE',
      };
    }
  }

  public async actSession(
    sessionId: string,
    opts: {
      fingerprint: string;
      actionId: string;
      text?: string;
      customEndpoint?: string;
      timeoutMs?: number;
    },
  ): Promise<PatchrightSessionResponse> {
    const endpoint = this.resolveEndpoint(opts.customEndpoint);
    const startTime = performance.now();
    const timeoutMs = opts.timeoutMs || 45_000;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${endpoint}/session/${encodeURIComponent(sessionId)}/act`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...configService.crawlerAuthHeaders(),
        },
        body: JSON.stringify({
          fingerprint: opts.fingerprint,
          actionId: opts.actionId,
          ...(typeof opts.text === 'string' ? { text: opts.text } : {}),
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - startTime);
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.success === false) {
        return {
          success: false,
          sessionId,
          observe: data.observe as PatchrightObservePayload | undefined,
          historyEntry: data.historyEntry as Record<string, unknown> | undefined,
          error:
            (typeof data.error === 'string' && data.error) ||
            `Patchright act error: HTTP ${res.status}`,
          code: typeof data.code === 'string' ? data.code : undefined,
          latencyMs,
        };
      }
      return {
        success: true,
        sessionId,
        observe: data.observe as PatchrightObservePayload | undefined,
        historyEntry: data.historyEntry as Record<string, unknown> | undefined,
        latencyMs,
      };
    } catch (err: any) {
      return {
        success: false,
        sessionId,
        latencyMs: Math.round(performance.now() - startTime),
        error: err.name === 'AbortError' ? 'Act timed out' : (err.message || 'Act failed'),
        code: 'BROWSER_UNAVAILABLE',
      };
    }
  }

  public async closeSession(
    sessionId: string,
    options: { customEndpoint?: string; timeoutMs?: number } = {},
  ): Promise<PatchrightSessionResponse> {
    const endpoint = this.resolveEndpoint(options.customEndpoint);
    const startTime = performance.now();
    const timeoutMs = options.timeoutMs || 15_000;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${endpoint}/session/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: {
          ...configService.crawlerAuthHeaders(),
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - startTime);
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.success === false) {
        return {
          success: false,
          sessionId,
          error:
            (typeof data.error === 'string' && data.error) ||
            `Patchright close error: HTTP ${res.status}`,
          code: typeof data.code === 'string' ? data.code : undefined,
          latencyMs,
        };
      }
      return {
        success: true,
        sessionId,
        closed: true,
        latencyMs,
      };
    } catch (err: any) {
      return {
        success: false,
        sessionId,
        latencyMs: Math.round(performance.now() - startTime),
        error: err.name === 'AbortError' ? 'Close timed out' : (err.message || 'Close failed'),
        code: 'BROWSER_UNAVAILABLE',
      };
    }
  }
}

export const patchrightClient = PatchrightClient.getInstance();
