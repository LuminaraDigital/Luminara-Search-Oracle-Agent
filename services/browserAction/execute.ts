/**
 * Execute browse_* tools against the Patchright session API (Wave B3).
 * Honest not_measured / BROWSER_UNAVAILABLE when the crawler is unset or down.
 *
 * Worker-safe: this module is imported by services/tools/registry.ts from the
 * Cloudflare Worker, so it must not pull browser-only modules (configService,
 * apiClient) into the worker program. The health probe below is a plain fetch
 * against GET /health, which the crawler serves without the auth token.
 */
import type { PaidToolRuntime, ToolResult } from '../tools/types';
import { BrowserActionLoop } from './loop';
import { verifyDone } from './verify';
import type { ObservePayload, ObservedAction, VerifyChecks } from './types';

export type BrowserActionRuntime = PaidToolRuntime & {
  /** Absolute crawler base URL. Empty/unset => BROWSER_UNAVAILABLE. */
  patchrightUrl?: string | null;
  crawlerToken?: string | null;
};

function requireString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function unavailable(detail: string): ToolResult {
  return {
    text: `Browse unavailable: ${detail}. Verdict: not_measured. Configure PATCHRIGHT_URL (and CRAWLER_TOKEN if required) pointing at a healthy crawler; do not invent page interaction outcomes.`,
    structuredContent: {
      measurementStatus: 'not_measured',
      code: 'BROWSER_UNAVAILABLE',
      detail,
    },
  };
}

function resolveBase(rt: BrowserActionRuntime): string | null {
  const raw = (rt.patchrightUrl || '').trim().replace(/\/$/, '');
  return raw || null;
}

function authHeaders(rt: BrowserActionRuntime): Record<string, string> {
  const token = (rt.crawlerToken || '').trim();
  return token ? { 'x-crawler-token': token } : {};
}

function asObserve(raw: unknown): ObservePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.fingerprint !== 'string' || typeof o.url !== 'string') return null;
  const actions = Array.isArray(o.actions)
    ? (o.actions as ObservedAction[]).filter((a) => a && typeof a.id === 'string')
    : [];
  return {
    url: String(o.url),
    title: typeof o.title === 'string' ? o.title : '',
    text: typeof o.text === 'string' ? o.text : '',
    actions,
    fingerprint: o.fingerprint,
    marker: typeof o.marker === 'string' ? o.marker : undefined,
  };
}

async function crawlerFetch(
  rt: BrowserActionRuntime,
  path: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const base = resolveBase(rt);
  if (!base) return { ok: false, status: 0, body: { error: 'PATCHRIGHT_URL unset' } };
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(rt),
        ...(init.headers || {}),
      },
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok && body.success !== false, status: res.status, body };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: { error: err instanceof Error ? err.message : 'fetch failed', code: 'BROWSER_UNAVAILABLE' },
    };
  }
}

async function ensureCrawler(rt: BrowserActionRuntime): Promise<ToolResult | null> {
  const base = resolveBase(rt);
  if (!base) return unavailable('PATCHRIGHT_URL is not configured');
  const health = await crawlerHealth(base);
  if (!health.ok) {
    return unavailable(health.message || 'crawler health check failed');
  }
  return null;
}

/** Bounded GET /health probe (no auth header: crawler exempts /health). */
async function crawlerHealth(base: string): Promise<{ ok: boolean; message?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(`${base}/health`, { method: 'GET', signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    return { ok: true, message: typeof body.message === 'string' ? body.message : undefined };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'health check failed' };
  } finally {
    clearTimeout(timer);
  }
}

function parseChecks(raw: unknown): VerifyChecks | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const out: VerifyChecks = {};
  if (typeof c.urlIncludes === 'string' || Array.isArray(c.urlIncludes)) {
    out.urlIncludes = c.urlIncludes as string | string[];
  }
  if (typeof c.textIncludes === 'string' || Array.isArray(c.textIncludes)) {
    out.textIncludes = c.textIncludes as string | string[];
  }
  if (typeof c.titleIncludes === 'string' || Array.isArray(c.titleIncludes)) {
    out.titleIncludes = c.titleIncludes as string | string[];
  }
  return out;
}

export async function executeBrowserActionTool(
  name: string,
  args: Record<string, unknown>,
  rt: BrowserActionRuntime,
): Promise<ToolResult> {
  switch (name) {
    case 'browse_observe':
      return browseObserve(args, rt);
    case 'browse_act':
      return browseAct(args, rt);
    case 'browse_goal':
      return browseGoal(args, rt);
    case 'browse_close':
      return browseClose(args, rt);
    default:
      return {
        text: `Unknown browse tool: ${name}`,
        structuredContent: { code: 'TOOL_NOT_FOUND' },
        isError: true,
      };
  }
}

async function browseObserve(
  args: Record<string, unknown>,
  rt: BrowserActionRuntime,
): Promise<ToolResult> {
  const blocked = await ensureCrawler(rt);
  if (blocked) return blocked;

  const sessionId = requireString(args, 'sessionId');
  const url = requireString(args, 'url');

  if (sessionId) {
    const res = await crawlerFetch(rt, `/session/${encodeURIComponent(sessionId)}/observe`, {
      method: 'POST',
      body: JSON.stringify({ screenshot: false }),
    });
    if (!res.ok) {
      return unavailable(String(res.body.error || `observe HTTP ${res.status}`));
    }
    const observe = asObserve(res.body.observe);
    return {
      text: [
        `Observed session ${sessionId}.`,
        `URL: ${observe?.url || '(unknown)'}`,
        `Actions: ${observe?.actions.length ?? 0}`,
        'Use returned action ids only. Never invent selectors.',
      ].join('\n'),
      structuredContent: {
        measurementStatus: 'measured',
        sessionId,
        observe,
      },
    };
  }

  if (!url) {
    return { text: 'url or sessionId required for browse_observe', isError: true };
  }

  const res = await crawlerFetch(rt, '/session', {
    method: 'POST',
    body: JSON.stringify({ url, accountKey: rt.accountId }),
  });
  if (!res.ok) {
    return unavailable(String(res.body.error || `session create HTTP ${res.status}`));
  }
  const newId = String(res.body.sessionId || '');
  const observe = asObserve(res.body.observe);
  return {
    text: [
      `Opened browse session ${newId}.`,
      `URL: ${observe?.url || url}`,
      `Actions: ${observe?.actions.length ?? 0}`,
      'Next: browse_act / browse_goal with action ids from this observe; browse_close when finished.',
    ].join('\n'),
    structuredContent: {
      measurementStatus: 'measured',
      sessionId: newId,
      observe,
    },
  };
}

async function browseAct(
  args: Record<string, unknown>,
  rt: BrowserActionRuntime,
): Promise<ToolResult> {
  if (!rt.canUsePaid) {
    return {
      text: 'browse_act requires Agency apiAccess or hosted crawler entitlement / BYOK path.',
      structuredContent: { code: 'PAID_TOOL_FORBIDDEN' },
      isError: true,
    };
  }
  const blocked = await ensureCrawler(rt);
  if (blocked) return blocked;

  const sessionId = requireString(args, 'sessionId');
  const fingerprint = requireString(args, 'fingerprint');
  const actionId = requireString(args, 'actionId');
  if (!sessionId || !fingerprint || !actionId) {
    return { text: 'sessionId, fingerprint, and actionId are required', isError: true };
  }
  const text = typeof args.text === 'string' ? args.text : undefined;

  const res = await crawlerFetch(rt, `/session/${encodeURIComponent(sessionId)}/act`, {
    method: 'POST',
    body: JSON.stringify({ fingerprint, actionId, ...(text !== undefined ? { text } : {}) }),
  });
  if (!res.ok) {
    const code = typeof res.body.code === 'string' ? res.body.code : undefined;
    return {
      text: `browse_act failed: ${String(res.body.error || res.status)}. Re-observe before retrying a mutation.`,
      structuredContent: {
        measurementStatus: 'not_measured',
        code: code || 'ACT_FAILED',
        sessionId,
      },
      isError: true,
    };
  }
  const observe = asObserve(res.body.observe);
  return {
    text: [
      `Acted ${actionId} on session ${sessionId}.`,
      `URL: ${observe?.url || '(unknown)'}`,
      `Actions now: ${observe?.actions.length ?? 0}`,
    ].join('\n'),
    structuredContent: {
      measurementStatus: 'measured',
      sessionId,
      historyEntry: res.body.historyEntry,
      observe,
    },
  };
}

async function browseClose(
  args: Record<string, unknown>,
  rt: BrowserActionRuntime,
): Promise<ToolResult> {
  const sessionId = requireString(args, 'sessionId');
  if (!sessionId) return { text: 'sessionId required', isError: true };
  if (!resolveBase(rt)) {
    return unavailable('PATCHRIGHT_URL is not configured');
  }
  const res = await crawlerFetch(rt, `/session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    return unavailable(String(res.body.error || `close HTTP ${res.status}`));
  }
  return {
    text: `Closed browse session ${sessionId}.`,
    structuredContent: { measurementStatus: 'measured', sessionId, closed: true },
  };
}

async function browseGoal(
  args: Record<string, unknown>,
  rt: BrowserActionRuntime,
): Promise<ToolResult> {
  if (!rt.canUsePaid) {
    return {
      text: 'browse_goal requires Agency apiAccess or hosted crawler entitlement / BYOK path.',
      structuredContent: { code: 'PAID_TOOL_FORBIDDEN' },
      isError: true,
    };
  }
  const blocked = await ensureCrawler(rt);
  if (blocked) return blocked;

  const goal = requireString(args, 'goal');
  if (!goal) return { text: 'goal required', isError: true };
  const projectId = requireString(args, 'projectId');
  const url = requireString(args, 'url');
  let sessionId = requireString(args, 'sessionId');
  const maxSteps =
    typeof args.maxSteps === 'number' && Number.isFinite(args.maxSteps)
      ? Math.max(1, Math.min(30, Math.floor(args.maxSteps)))
      : 15;
  const checks = parseChecks(args.checks);

  if (!rt.llmGenerate) {
    return unavailable('No LLM configured for browse_goal (OPENROUTER_API_KEY / provider relay)');
  }

  let observe: ObservePayload | null = null;
  if (!sessionId) {
    if (!url) return { text: 'url or sessionId required for browse_goal', isError: true };
    const created = await crawlerFetch(rt, '/session', {
      method: 'POST',
      body: JSON.stringify({ url, accountKey: rt.accountId }),
    });
    if (!created.ok) {
      return unavailable(String(created.body.error || 'session create failed'));
    }
    sessionId = String(created.body.sessionId || '');
    observe = asObserve(created.body.observe);
  } else {
    const obs = await crawlerFetch(rt, `/session/${encodeURIComponent(sessionId)}/observe`, {
      method: 'POST',
      body: JSON.stringify({ screenshot: false }),
    });
    if (!obs.ok) return unavailable(String(obs.body.error || 'observe failed'));
    observe = asObserve(obs.body.observe);
  }

  if (!observe || !sessionId) {
    return unavailable('No observe payload from crawler');
  }

  const sid = sessionId;
  const loop = new BrowserActionLoop({
    goal,
    initialPage: observe,
    maxSteps,
    observe: async () => {
      const res = await crawlerFetch(rt, `/session/${encodeURIComponent(sid)}/observe`, {
        method: 'POST',
        body: JSON.stringify({ screenshot: false }),
      });
      const next = asObserve(res.body.observe);
      if (!res.ok || !next) throw new Error(String(res.body.error || 're-observe failed'));
      return next;
    },
    executeAct: async (request) => {
      const res = await crawlerFetch(rt, `/session/${encodeURIComponent(sid)}/act`, {
        method: 'POST',
        body: JSON.stringify({
          fingerprint: request.fingerprint,
          actionId: request.actionId,
          ...(request.text !== undefined ? { text: request.text } : {}),
        }),
      });
      const next = asObserve(res.body.observe);
      if (!res.ok || !next) {
        const err = new Error(String(res.body.error || 'act failed'));
        (err as Error & { code?: string }).code = String(res.body.code || 'ACT_FAILED');
        throw err;
      }
      return next;
    },
    chooseLlm: rt.llmGenerate,
    fieldLlm: rt.llmGenerate,
  });

  let steps = 0;
  while (steps < maxSteps && loop.state.status !== 'done' && loop.state.status !== 'blocked') {
    // act() inside tick() is what sets status to done/blocked, but TS keeps the
    // while-guard narrowing on loop.state.status across the await. The LoopState
    // returned by tick() carries the full status union, so read it from there.
    const after = await loop.tick();
    steps += 1;
    if (after.decision?.choice === 'DONE' || after.status === 'done') break;
    if (after.decision?.choice === 'BLOCKED' || after.status === 'blocked') break;
  }

  const finalPage = loop.state.page;
  const claimedDone = loop.state.status === 'done';
  const verify = verifyDone({
    goal,
    observe: finalPage,
    checks: claimedDone ? checks : checks,
  });

  const summary = [
    `browse_goal: ${goal}`,
    `session=${sid}`,
    `status=${loop.state.status}`,
    `steps=${loop.state.history.length}`,
    `verifier=${verify.status}`,
    `url=${finalPage.url}`,
  ].join('. ');

  if (projectId && verify.ok) {
    try {
      await rt.appendResearchLog(projectId, summary);
    } catch {
      /* research log is best-effort */
    }
  }

  return {
    text: [
      summary,
      claimedDone && !verify.ok
        ? 'Agent claimed DONE but independent verifier did not pass; treat as not_verified.'
        : '',
      'Agent DONE is not proof. Prefer verifier status.',
    ]
      .filter(Boolean)
      .join('\n'),
    structuredContent: {
      measurementStatus: verify.ok ? 'measured' : verify.status === 'not_measured' ? 'not_measured' : 'estimated',
      sessionId: sid,
      status: loop.state.status,
      history: loop.state.history,
      observe: finalPage,
      verify,
    },
    isError: loop.state.status === 'blocked' && !verify.ok,
  };
}
