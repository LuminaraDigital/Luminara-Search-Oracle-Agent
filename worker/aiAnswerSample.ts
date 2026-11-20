/**
 * Live Tavily answer sample for the free check.
 * One sample per anonymous IP per UTC day, three for a signed-in free account.
 * Results are cached per domain for 24 hours. FREE_AI_SAMPLE_DAILY_BUDGET=0 pauses calls.
 * The probe route already rate-limits by IP. There is no Turnstile in this Worker.
 * Tavily's include_answer is the web-grounded answer. The label names Tavily only.
 */
import {
  AI_SAMPLE_ANON_DAILY,
  AI_SAMPLE_FREE_DAILY,
  AI_SAMPLE_PROVIDER,
  answerNamesAgency,
  buyerPrompts,
  citedDomains,
  sampleBudget,
  sampleLabel,
  sampleNextStep,
  urlsInText,
  type AiAnswerSample,
  type AiSamplePrompt,
  type AiSampleReasonCode,
} from '../services/audit/aiAnswerSample';
import type { Env } from './env';
import { safeLog } from './logRedaction';
import { meterDailyUse } from './securityHardening';
import { clientIp } from './security';
import { getActiveSubscription } from './quotaMiddleware';
import { billingId, identify } from './workerUtils';

const DAY_MS = 24 * 60 * 60 * 1000;
const IP_PREFIX = 'free_ai_sample_ip';
const ACCT_PREFIX = 'free_ai_sample_acct';
const BUDGET_PREFIX = 'free_ai_sample_budget';
const BUDGET_ID = 'all';

type Tier = 'guest' | 'free' | 'paid';

type CachedSample = {
  answeredAt: string;
  named: boolean;
  citedDomains: string[];
  prompts: AiSamplePrompt[];
};

type AnswerCache = {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrompt(value: unknown): value is AiSamplePrompt {
  if (!isRecord(value)) return false;
  return typeof value.prompt === 'string'
    && typeof value.answer === 'string'
    && typeof value.named === 'boolean'
    && Array.isArray(value.citedDomains)
    && value.citedDomains.every((item) => typeof item === 'string');
}

function isCached(value: unknown): value is CachedSample {
  if (!isRecord(value) || typeof value.answeredAt !== 'string' || typeof value.named !== 'boolean') return false;
  if (!Array.isArray(value.prompts) || !value.prompts.every(isPrompt)) return false;
  return Array.isArray(value.citedDomains) && value.citedDomains.every((item) => typeof item === 'string');
}

function isCache(value: unknown): value is AnswerCache {
  return isRecord(value) && typeof value.match === 'function' && typeof value.put === 'function';
}

function answerCache(): AnswerCache | null {
  const host: unknown = globalThis;
  if (!isRecord(host) || !isRecord(host.caches) || !isCache(host.caches.default)) return null;
  return host.caches.default;
}

function cacheKey(host: string): string {
  return `https://ai-sample-cache.invalid/v1/${encodeURIComponent(host)}`;
}

function missed(code: AiSampleReasonCode, reason: string, tier: Tier): AiAnswerSample {
  return {
    status: 'not_measured',
    label: 'Not measured',
    reasonCode: code,
    reason,
    nextStep: sampleNextStep(tier),
  };
}

function present(body: CachedSample, tier: Tier): AiAnswerSample {
  return {
    status: 'measured',
    label: sampleLabel(body.prompts.length, body.answeredAt),
    provider: AI_SAMPLE_PROVIDER,
    answeredAt: body.answeredAt,
    named: body.named,
    citedDomains: body.citedDomains,
    prompts: body.prompts,
    nextStep: sampleNextStep(tier),
  };
}

async function readCached(host: string): Promise<CachedSample | null> {
  const cache = answerCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(cacheKey(host));
    if (!hit) return null;
    const body: unknown = await hit.json();
    if (!isCached(body)) return null;
    if (Date.now() - Date.parse(body.answeredAt) > DAY_MS) return null;
    return body;
  } catch {
    return null;
  }
}

async function writeCached(host: string, body: CachedSample): Promise<void> {
  const cache = answerCache();
  if (!cache) return;
  try {
    await cache.put(cacheKey(host), new Response(JSON.stringify(body), {
      headers: { 'Cache-Control': 'public, max-age=86400', 'Content-Type': 'application/json' },
    }));
  } catch {
    /* the next caller asks again */
  }
}

async function dailyUsed(env: Env, prefix: string, id: string): Promise<number | null> {
  if (!env.LUMINARA_KV) return null;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const raw = await env.LUMINARA_KV.get(`${prefix}:${id}:${day}`);
    if (raw == null) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return null;
  }
}

async function callerOf(request: Request, env: Env): Promise<{ tier: Tier; accountId: string; ip: string }> {
  const ip = clientIp(request);
  try {
    const who = await identify(request, env);
    if (!who.user) return { tier: 'guest', accountId: '', ip };
    const sub = await getActiveSubscription(env, who.user);
    if (sub) return { tier: 'paid', accountId: billingId(who.user), ip };
    return { tier: 'free', accountId: billingId(who.user), ip };
  } catch {
    return { tier: 'guest', accountId: '', ip };
  }
}

function tavilyHit(value: unknown): { answer: string; urls: string[] } | null {
  if (!isRecord(value) || typeof value.answer !== 'string') return null;
  const answer = value.answer.trim().slice(0, 500);
  if (!answer) return null;
  const urls = urlsInText(answer);
  if (Array.isArray(value.results)) {
    for (const row of value.results.slice(0, 5)) {
      if (!isRecord(row) || typeof row.url !== 'string' || !row.url.startsWith('https://')) continue;
      urls.push(row.url);
    }
  }
  return { answer, urls };
}

async function askTavily(key: string, query: string): Promise<{ answer: string; urls: string[] } | null> {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        include_answer: true,
        max_results: 5,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return tavilyHit(await res.json());
  } catch {
    return null;
  }
}

export async function collectAiAnswerSample(
  request: Request,
  env: Env,
  input: { host: string; agencyName: string; suburb: string },
): Promise<AiAnswerSample> {
  const caller = await callerOf(request, env);
  const cached = await readCached(input.host);
  if (cached) return present(cached, caller.tier);

  const prompts = buyerPrompts(input);
  if (prompts.length === 0) {
    return missed('no_signal', 'The homepage did not name a suburb or an agency, so no buyer question was asked.', caller.tier);
  }
  if (!env.TAVILY_API_KEY) {
    return missed('no_key', 'The live sample needs the server search key.', caller.tier);
  }
  const budget = sampleBudget(env.FREE_AI_SAMPLE_DAILY_BUDGET);
  if (budget === 0) return missed('paused', 'Live samples are paused.', caller.tier);
  if (!env.LUMINARA_KV) return missed('unavailable', 'Live samples are unavailable right now.', caller.tier);
  if (caller.tier === 'paid') {
    return missed('paid', 'This free live sample is for anonymous and free accounts.', caller.tier);
  }

  const ipLimit = caller.tier === 'guest' ? AI_SAMPLE_ANON_DAILY : AI_SAMPLE_FREE_DAILY;
  // shortcut: the counter is read then written, so two requests can both pass. Same limit as MCP metering.
  const ipUsed = await dailyUsed(env, IP_PREFIX, caller.ip);
  if (ipUsed == null) return missed('unavailable', 'Live samples are unavailable right now.', caller.tier);
  if (ipUsed >= ipLimit) return missed('cap', "Today's free live sample is used.", caller.tier);
  if (caller.tier === 'free') {
    const acctUsed = await dailyUsed(env, ACCT_PREFIX, caller.accountId);
    if (acctUsed == null) return missed('unavailable', 'Live samples are unavailable right now.', caller.tier);
    if (acctUsed >= AI_SAMPLE_FREE_DAILY) return missed('cap', "Today's free live sample is used.", caller.tier);
  }
  const budgetUsed = await dailyUsed(env, BUDGET_PREFIX, BUDGET_ID);
  if (budgetUsed == null) return missed('unavailable', 'Live samples are unavailable right now.', caller.tier);
  if (budgetUsed >= budget) return missed('budget', 'The daily live-sample budget is used.', caller.tier);

  const key = env.TAVILY_API_KEY;
  const rows: AiSamplePrompt[] = [];
  const cited = new Set<string>();
  for (const prompt of prompts) {
    const spent = await meterDailyUse(env, BUDGET_PREFIX, BUDGET_ID, budget, 'Live sample', false, true);
    if (!spent.ok) break;
    const hit = await askTavily(key, prompt);
    if (!hit) continue;
    const domains = citedDomains(hit.urls, input.host);
    for (const domain of domains) cited.add(domain);
    rows.push({
      prompt,
      answer: hit.answer,
      named: answerNamesAgency({
        domain: input.host,
        agencyName: input.agencyName,
        answer: hit.answer,
        urls: hit.urls,
      }),
      citedDomains: domains,
    });
  }
  if (rows.length === 0) {
    safeLog('free_ai_sample', { outcome: 'empty' });
    return missed('empty', 'The live sample did not return an answer.', caller.tier);
  }

  await meterDailyUse(env, IP_PREFIX, caller.ip, ipLimit, 'Live sample', false, true);
  if (caller.tier === 'free') {
    await meterDailyUse(env, ACCT_PREFIX, caller.accountId, AI_SAMPLE_FREE_DAILY, 'Live sample', false, true);
  }
  const body: CachedSample = {
    answeredAt: new Date().toISOString(),
    named: rows.some((row) => row.named),
    citedDomains: [...cited].slice(0, 8),
    prompts: rows,
  };
  await writeCached(input.host, body);
  safeLog('free_ai_sample', { outcome: 'measured', prompts: rows.length });
  return present(body, caller.tier);
}
