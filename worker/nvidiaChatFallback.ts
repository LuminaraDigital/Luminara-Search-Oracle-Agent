/**
 * NVIDIA NIM step on the hosted Groq chat path, after both Groq keys and before Workers AI.
 * Direct `/providers/nim` stays paid-tier. This step is for every tier.
 * Free accounts share a global daily cap and a per-account cap. Paid plans are not counted.
 * A missing key, a cap, or no KV skips this step. The caller then tries Workers AI.
 * The cap is a KV get-then-put. KV has no atomic add, so overlapping calls can pass together
 * and the count can exceed the cap by about the number of calls in flight. A later read
 * repairs a write that landed lower, so a stale write cannot reset the counter.
 * A call NVIDIA does not answer gives the slot back. Paid plans are not counted.
 */
import type { Env } from './env';
import type { QuotaStatus } from './quotaMiddleware';
import type { WorkersAiFallbackReason } from './workersAiFallback';
import { json } from './workerUtils';

export const NVIDIA_FALLBACK_PROVIDER = 'nvidia';
/** Text model. meta/llama-3.3-70b-instruct reached EOL on 2026-08-26 and answers 410. */
export const NVIDIA_FALLBACK_MODEL = 'nvidia/llama-3.1-nemotron-70b-instruct';
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

const SLOT_TTL = { expirationTtl: 2 * 86400 };

async function addCap(kv: NonNullable<Env['LUMINARA_KV']>, key: string, cap: number): Promise<'ok' | 'cap'> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const used = Number((await kv.get(key)) || 0);
    if (!Number.isFinite(used) || used >= cap) return 'cap';
    const next = used + 1;
    await kv.put(key, String(next), SLOT_TTL);
    const seen = Number((await kv.get(key)) || 0);
    if (seen >= next) return 'ok';
    await kv.put(key, String(Math.max(Number.isFinite(seen) ? seen : 0, next)), SLOT_TTL);
  }
  return 'cap';
}

async function releaseCap(kv: NonNullable<Env['LUMINARA_KV']>, key: string): Promise<void> {
  const used = Number((await kv.get(key)) || 0);
  if (!Number.isFinite(used) || used <= 0) return;
  const next = used - 1;
  await kv.put(key, String(next), SLOT_TTL);
  const seen = Number((await kv.get(key)) || 0);
  if (Number.isFinite(seen) && seen < next) await kv.put(key, String(next), SLOT_TTL);
}

function slotKeys(accountId: string): { globalKey: string; userKey: string } {
  const day = dayStamp();
  return {
    globalKey: `nvidia-fallback:global:${day}`,
    userKey: `nvidia-fallback:user:${accountId}:${day}`,
  };
}

async function nvidiaSlot(env: Env, accountId: string, paid: boolean): Promise<'call' | NvidiaSkip> {
  const key = env.NVIDIA_API_KEY?.trim() || '';
  if (!key) return 'missing_key';
  if (paid) return 'call';
  if (!env.LUMINARA_KV) return 'no_kv';
  const globalCap = capFromEnv(env.NVIDIA_FALLBACK_DAILY_CAP, NVIDIA_FALLBACK_DAILY_CAP_DEFAULT);
  const userCap = capFromEnv(env.NVIDIA_FALLBACK_USER_DAILY_CAP, NVIDIA_FALLBACK_USER_DAILY_CAP_DEFAULT);
  const { globalKey, userKey } = slotKeys(accountId);
  try {
    if (await addCap(env.LUMINARA_KV, globalKey, globalCap) !== 'ok') return 'global_cap';
    if (await addCap(env.LUMINARA_KV, userKey, userCap) !== 'ok') {
      await releaseCap(env.LUMINARA_KV, globalKey);
      return 'user_cap';
    }
    return 'call';
  } catch {
    return 'no_kv';
  }
}

async function releaseNvidiaSlot(env: Env, accountId: string): Promise<void> {
  if (!env.LUMINARA_KV) return;
  const { globalKey, userKey } = slotKeys(accountId);
  try {
    await releaseCap(env.LUMINARA_KV, globalKey);
    await releaseCap(env.LUMINARA_KV, userKey);
  } catch {
    /* a missed release leaves the slot spent */
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
    console.warn(JSON.stringify({ event: 'nvidia_fallback_skipped', reason: slot }));
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
      body: JSON.stringify({ ...source, model: NVIDIA_FALLBACK_MODEL }),
    });
  } catch {
    if (!input.paid) await releaseNvidiaSlot(input.env, input.accountId);
    console.warn(JSON.stringify({ event: 'nvidia_fallback_failed', status: 0 }));
    return null;
  }
  if (!res.ok) {
    if (!input.paid) await releaseNvidiaSlot(input.env, input.accountId);
    console.warn(JSON.stringify({ event: 'nvidia_fallback_failed', status: res.status }));
    return null;
  }

  const marker = {
    'X-Provider-Fallback': NVIDIA_FALLBACK_PROVIDER,
    'X-Provider-Fallback-Model': NVIDIA_FALLBACK_MODEL,
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
  if (!parsed || !messageText(parsed)) {
    if (!input.paid) await releaseNvidiaSlot(input.env, input.accountId);
    console.warn(JSON.stringify({ event: 'nvidia_fallback_failed', status: res.status, reason: 'no_text' }));
    return null;
  }
  const model = typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : NVIDIA_FALLBACK_MODEL;
  parsed.x_fallback = { provider: NVIDIA_FALLBACK_PROVIDER, model, reason: input.reason };
  return json(parsed, 200, { ...marker, 'X-Provider-Fallback-Model': model });
}
