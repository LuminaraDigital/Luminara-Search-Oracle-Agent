/**
 * Additive Patchright session client for indexed DOM observe/act.
 * Does not change scrape() behavior.
 */
import { configService } from '../configService';

export type BrowserActionKind = 'click' | 'fill' | 'select' | 'scroll' | 'wait';

export interface BrowserObservedAction {
  id: string;
  kind: BrowserActionKind;
  label: string;
  role?: string;
  value?: string;
  node?: number;
  current_value?: string;
  checked?: string | boolean;
  selected?: string | boolean;
  expanded?: string | boolean;
  rect?: { x: number; y: number; w: number; h: number };
  delta?: number;
}

export interface BrowserObserveResult {
  success: boolean;
  sessionId: string;
  fingerprint: string;
  url: string;
  title: string;
  text: string;
  actions: BrowserObservedAction[];
  omitted_actions?: number;
  w?: number;
  h?: number;
  latencyMs: number;
  error?: string;
  code?: string;
}

export interface BrowserSessionCreateResult extends BrowserObserveResult {}

export interface BrowserActResult extends BrowserObserveResult {
  historyEntry?: Record<string, unknown>;
  stale?: boolean;
}

function crawlerBase(customEndpoint?: string): string {
  return (customEndpoint || configService.getPatchrightUrl() || 'http://localhost:3001').replace(/\/$/, '');
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...configService.crawlerAuthHeaders(),
  };
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapObserve(
  sessionId: string,
  data: Record<string, unknown>,
  latencyMs: number,
  success: boolean,
  fallbackError?: string,
): BrowserObserveResult {
  const observe = (data.observe as Record<string, unknown> | undefined) || data;
  const actions = Array.isArray(observe.actions)
    ? (observe.actions as BrowserObservedAction[])
    : Array.isArray(data.actions)
      ? (data.actions as BrowserObservedAction[])
      : [];
  return {
    success,
    sessionId: String(data.sessionId || sessionId || ''),
    fingerprint: String(observe.fingerprint || data.fingerprint || ''),
    url: String(observe.url || data.url || ''),
    title: String(observe.title || data.title || ''),
    text: String(observe.text || data.text || ''),
    actions,
    omitted_actions:
      typeof observe.omitted_actions === 'number'
        ? observe.omitted_actions
        : typeof data.omitted_actions === 'number'
          ? data.omitted_actions
          : undefined,
    w: typeof observe.w === 'number' ? observe.w : undefined,
    h: typeof observe.h === 'number' ? observe.h : undefined,
    latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : latencyMs,
    error: success ? undefined : String(data.error || fallbackError || 'Browser action failed'),
    code: typeof data.code === 'string' ? data.code : undefined,
  };
}

import { patchrightClient } from './patchrightClient';

export async function createBrowserSession(
  url: string,
  options: { customEndpoint?: string; timeoutMs?: number; accountKey?: string } = {},
): Promise<BrowserSessionCreateResult> {
  const endpoint = crawlerBase(options.customEndpoint);
  const startTime = performance.now();
  const timeoutMs = options.timeoutMs || 45000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${endpoint}/session`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        url,
        accountKey: options.accountKey,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - startTime);
    const data = await parseJson(res);
    if (!res.ok || data.success === false) {
      return mapObserve('', data, latencyMs, false, `HTTP ${res.status}`);
    }
    return mapObserve(String(data.sessionId || ''), data, latencyMs, true);
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - startTime);
    const message = err instanceof Error ? err.message : 'Session create failed';
    const name = err instanceof Error ? err.name : '';
    return {
      success: false,
      sessionId: '',
      fingerprint: '',
      url,
      title: '',
      text: '',
      actions: [],
      latencyMs,
      error: name === 'AbortError' ? 'Session create timed out' : message,
      code: 'BROWSER_UNAVAILABLE',
    };
  }
}

export async function observeBrowserSession(
  sessionId: string,
  options: { customEndpoint?: string; timeoutMs?: number; screenshot?: boolean } = {},
): Promise<BrowserObserveResult> {
  const endpoint = crawlerBase(options.customEndpoint);
  const startTime = performance.now();
  const timeoutMs = options.timeoutMs || 30000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${endpoint}/session/${encodeURIComponent(sessionId)}/observe`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ screenshot: Boolean(options.screenshot) }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - startTime);
    const data = await parseJson(res);
    if (!res.ok || data.success === false) {
      return mapObserve(sessionId, data, latencyMs, false, `HTTP ${res.status}`);
    }
    return mapObserve(sessionId, data, latencyMs, true);
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - startTime);
    const message = err instanceof Error ? err.message : 'Observe failed';
    return {
      success: false,
      sessionId,
      fingerprint: '',
      url: '',
      title: '',
      text: '',
      actions: [],
      latencyMs,
      error: message,
      code: 'BROWSER_UNAVAILABLE',
    };
  }
}

export async function actBrowserSession(
  sessionId: string,
  body: { fingerprint: string; actionId: string; text?: string },
  options: { customEndpoint?: string; timeoutMs?: number } = {},
): Promise<BrowserActResult> {
  const endpoint = crawlerBase(options.customEndpoint);
  const startTime = performance.now();
  const timeoutMs = options.timeoutMs || 45000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${endpoint}/session/${encodeURIComponent(sessionId)}/act`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - startTime);
    const data = await parseJson(res);
    if (res.status === 409 || data.code === 'STALE_PAGE') {
      const mapped = mapObserve(sessionId, data, latencyMs, false, 'Stale page fingerprint');
      return { ...mapped, stale: true, code: 'STALE_PAGE' };
    }
    if (!res.ok || data.success === false) {
      return mapObserve(sessionId, data, latencyMs, false, `HTTP ${res.status}`);
    }
    return {
      ...mapObserve(sessionId, data, latencyMs, true),
      historyEntry:
        data.historyEntry && typeof data.historyEntry === 'object'
          ? (data.historyEntry as Record<string, unknown>)
          : undefined,
    };
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - startTime);
    const message = err instanceof Error ? err.message : 'Act failed';
    return {
      success: false,
      sessionId,
      fingerprint: '',
      url: '',
      title: '',
      text: '',
      actions: [],
      latencyMs,
      error: message,
      code: 'BROWSER_UNAVAILABLE',
    };
  }
}

export async function closeBrowserSession(
  sessionId: string,
  options: { customEndpoint?: string; timeoutMs?: number } = {},
): Promise<{ success: boolean; error?: string }> {
  const endpoint = crawlerBase(options.customEndpoint);
  const timeoutMs = options.timeoutMs || 15000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${endpoint}/session/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const data = await parseJson(res);
      return { success: false, error: String(data.error || `HTTP ${res.status}`) };
    }
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Close failed',
    };
  }
}

/** Health probe used by MCP/Oracle before offering browse tools. */
export async function isBrowserActionCrawlerAvailable(
  customEndpoint?: string,
): Promise<boolean> {
  const health = await patchrightClient.checkHealth(customEndpoint);
  return health.ok;
}
