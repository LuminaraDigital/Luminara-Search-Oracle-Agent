/**
 * NVIDIA NIM step on the hosted Groq chat path, after both Groq keys and before Workers AI.
 * Direct `/providers/nim` stays paid-tier. This step is for every tier.
 * Free accounts share a global daily cap and a per-account cap. Paid plans are not counted.
 * A missing key, a cap, or no KV skips this step. The caller then tries Workers AI.
 * shortcut: KV get-then-put can let a few calls past the cap, upgrade when the counter is atomic.
 */
import type { Env } from './env';
import type { QuotaStatus } from './quotaMiddleware';
import type { WorkersAiFallbackReason } from './workersAiFallback';
import { json } from './workerUtils';
import { NIM_DEFAULT_MODEL } from '../services/llm/nativeModelDefaults';

export const NVIDIA_FALLBACK_PROVIDER = 'nvidia';
export const NVIDIA_FALLBACK_DAILY_CAP_DEFAULT = 200;
export const NVIDIA_FALLBACK_USER_DAILY_CAP_DEFAULT = 5;
const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

type NvidiaSkip = 'missing_key' | 'global_cap' | 'user_cap' | 'no_kv';

function capFromEnv(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function dayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function messageText(body: Record<string, unknown>): string {
  const choices = body.choices;
  if (!Array.isArray(choices)) return '';
  const first = recordOf(choices[0]);
  const message = first ? recordOf(first.message) : null;
  return typeof message?.content === 'string' ? message.content.trim() : '';
}

function quotaHeaders(quotaGate: QuotaStatus | null): Record<string, string> {
  if (!quotaGate) return {};
  if (quotaGate.isUnlimited) {
    return { 'X-Quota-Limit': 'unlimited', 'X-Quota-Remaining': 'unlimited' };
  }
  if (quotaGate.limit <= 0) return {};
  const headers: Record<string, string> = {
    'X-Quota-Limit': String(quotaGate.limit),
    'X-Quota-Remaining': String(quotaGate.remaining),
    'X-Quota-Reset': String(quotaGate.resetSec),
  };
  if (typeof quotaGate.bonusRemaining === 'number') {
    headers['X-Quota-Bonus'] = String(quotaGate.bonusRemaining);
  }
  return headers;
}

async function nvidiaSlot(env: Env, accountId: string, paid: boolean): Promise<'call' | NvidiaSkip> {
  const key = env.NVIDIA_API_KEY?.trim() || '';
  if (!key) return 'missing_key';
  if (paid) return 'call';
  if (!env.LUMINARA_KV) return 'no_kv';
  const globalCap = capFromEnv(env.NVIDIA_FALLBACK_DAILY_CAP, NVIDIA_FALLBACK_DAILY_CAP_DEFAULT);
  const userCap = capFromEnv(env.NVIDIA_FALLBACK_USER_DAILY_CAP, NVIDIA_FALLBACK_USER_DAILY_CAP_DEFAULT);
  const day = dayStamp();
  const globalKey = `nvidia-fallback:global:${day}`;
  const userKey = `nvidia-fallback:user:${accountId}:${day}`;
  try {
    const globalUsed = Number((await env.LUMINARA_KV.get(globalKey)) || 0);
    const userUsed = Number((await env.LUMINARA_KV.get(userKey)) || 0);
    if (globalUsed >= globalCap) return 'global_cap';
    if (userUsed >= userCap) return 'user_cap';
    const ttl = { expirationTtl: 2 * 86400 };
    await env.LUMINARA_KV.put(globalKey, String(globalUsed + 1), ttl);
    await env.LUMINARA_KV.put(userKey, String(userUsed + 1), ttl);
    return 'call';
  } catch {
    return 'no_kv';
  }
}

/**
 * Answers with NVIDIA, or returns null so the caller tries Workers AI.
 * A null return has not written a client response. The cap is taken only when a call is sent.
 */
export async function tryNvidiaChatFallback(input: {
  env: Env;
  body: unknown;
  reason: WorkersAiFallbackReason;
  accountId: string;
  paid: boolean;
  quotaGate: QuotaStatus | null;
}): Promise<Response | null> {
  const source = recordOf(input.body);
  if (!source) return null;
  const slot = await nvidiaSlot(input.env, input.accountId, input.paid);
  if (slot !== 'call') {
    if (slot !== 'missing_key') {
      console.warn(JSON.stringify({ event: 'nvidia_fallback_skipped', reason: slot }));
    }
    return null;
  }

  const headers = new Headers({
    'content-type': 'application/json',
    authorization: `Bearer ${input.env.NVIDIA_API_KEY?.trim()}`,
  });
  const org = input.env.NVIDIA_ORG_ID?.trim();
  if (org) headers.set('NV-Organization-ID', org);

  let res: Response;
  try {
    res = await fetch(NVIDIA_CHAT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...source, model: NIM_DEFAULT_MODEL }),
    });
  } catch {
    console.warn(JSON.stringify({ event: 'nvidia_fallback_failed', status: 0 }));
    return null;
  }
  if (!res.ok) {
    console.warn(JSON.stringify({ event: 'nvidia_fallback_failed', status: res.status }));
    return null;
  }

  const marker = {
    'X-Provider-Fallback': NVIDIA_FALLBACK_PROVIDER,
    'X-Provider-Fallback-Model': NIM_DEFAULT_MODEL,
    'X-Provider-Fallback-Reason': input.reason,
    ...quotaHeaders(input.quotaGate),
  };
  const streaming = source.stream === true || (res.headers.get('content-type') || '').includes('text/event-stream');
  if (streaming) {
    return new Response(res.body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', ...marker },
    });
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = recordOf(JSON.parse(await res.text()));
  } catch {
    parsed = null;
  }
  if (!parsed || !messageText(parsed)) return null;
  const model = typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : NIM_DEFAULT_MODEL;
  parsed.x_fallback = { provider: NVIDIA_FALLBACK_PROVIDER, model, reason: input.reason };
  return json(parsed, 200, { ...marker, 'X-Provider-Fallback-Model': model });
}
