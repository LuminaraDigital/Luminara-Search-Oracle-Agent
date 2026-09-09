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
}

export const patchrightClient = PatchrightClient.getInstance();
