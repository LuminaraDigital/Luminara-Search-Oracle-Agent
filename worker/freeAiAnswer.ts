/**
 * One AI answer per free account per UTC day, after a profile has a suburb.
 * Search is Tavily, then Exa. The writer is Groq, then NVIDIA, then Workers AI.
 * A miss, a full cap, or a down meter hides the card. The answer is cached per suburb for 24h.
 * The cache is the Cache API. This module does not write KV.
 */
import type { Env } from './env';
import { invokeDailyQuota, meterName } from './dailyQuota';
import { getActiveSubscription } from './quotaMiddleware';
import { WORKERS_AI_FALLBACK_MODEL } from './workersAiFallback';
import { NVIDIA_FALLBACK_MODEL } from './nvidiaChatFallback';
import { billingId, identify, json } from './workerUtils';
import {
  agenciesFromAnswer,
  cacheUrl,
  cleanPlace,
  FREE_AI_ANSWER_LABEL,
  questionFor,
  realEstateAgentFix,
  userIsNamed,
} from '../services/audit/freeAiAnswer';

const DAY_MS = 24 * 60 * 60 * 1000;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
/** Same values as services/audit/jevVerifier.ts. Imported there, the worker build pulls the browser client. */
export const FREE_ANSWER_JEV_MODEL = 'jev-latest';
export const FREE_ANSWER_JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const FREE_ANSWER_JEV_NOUL_MIN = 0.6;

export interface CitedSource {
  title: string;
  url: string;
  snippet: string;
}

interface CachedAnswer {
  question: string;
  answer: string;
  agencies: string[];
  sources: CitedSource[];
  answeredAt: string;
}

interface AnswerCache {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
}

function hidden(): Response {
  return json({ hidden: true });
}

function spendOk(value: unknown): value is { ok: boolean } {
  return typeof value === 'object' && value !== null && 'ok' in value && typeof value.ok === 'boolean';
}

function answerCache(): AnswerCache | null {
  const box = globalThis as unknown as { caches?: { default?: AnswerCache } };
  return box.caches?.default ?? null;
}

function chatText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return '';
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

function workersText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const response = (value as { response?: unknown }).response;
  return typeof response === 'string' ? response.trim() : '';
}

async function chat(url: string, key: string, model: string, prompt: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 500,
      }),
    });
    if (!res.ok) return '';
    return chatText(await res.json());
  } catch {
    return '';
  }
}

function sourceLine(source: CitedSource, index: number): string {
  return `${index + 1}. ${source.title} ${source.url} ${source.snippet}`;
}

function promptFor(question: string, sources: readonly CitedSource[]): string {
  const results = sources.map(sourceLine).join('\n');
  return [
    'Answer using only the web results. Do not add an agency the results do not name.',
    `Question: ${question}`,
    '',
    'Web results:',
    results,
    '',
    'Write a short answer in plain sentences. End with one line:',
    'AGENCIES: Name; Name',
    'If the results name none, end with:',
    'AGENCIES: none',
  ].join('\n');
}

async function searchTavily(env: Env, query: string): Promise<CitedSource[]> {
  if (!env.TAVILY_API_KEY) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        max_results: 5,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (data.results || []).slice(0, 5).flatMap((row) => {
      if (!row.url || !row.url.startsWith('https://')) return [];
      return [{ title: (row.title || row.url).slice(0, 140), url: row.url, snippet: (row.content || '').slice(0, 400) }];
    });
  } catch {
    return [];
  }
}

async function searchExa(env: Env, query: string): Promise<CitedSource[]> {
  if (!env.EXA_API_KEY) return [];
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.EXA_API_KEY },
      body: JSON.stringify({
        query,
        numResults: 5,
        contents: { text: { maxCharacters: 400 } },
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; text?: string }> };
    return (data.results || []).slice(0, 5).flatMap((row) => {
      if (!row.url || !row.url.startsWith('https://')) return [];
      return [{ title: (row.title || row.url).slice(0, 140), url: row.url, snippet: (row.text || '').slice(0, 400) }];
    });
  } catch {
    return [];
  }
}

async function writeAnswer(env: Env, prompt: string): Promise<string> {
  const groq = env.GROQ_API_KEY || env.GROQ_API_KEY_FALLBACK;
  if (groq) {
    const text = await chat(GROQ_URL, groq, 'llama-3.3-70b-versatile', prompt);
    if (text) return text;
  }
  if (env.NVIDIA_API_KEY) {
    const text = await chat(NVIDIA_URL, env.NVIDIA_API_KEY, NVIDIA_FALLBACK_MODEL, prompt);
    if (text) return text;
  }
  if (!env.AI) return '';
  try {
    const raw = await env.AI.run(WORKERS_AI_FALLBACK_MODEL, {
      messages: [{ role: 'user', content: prompt.slice(0, 8000) }],
      temperature: 0.2,
      max_tokens: 500,
    });
    return workersText(raw);
  } catch {
    return '';
  }
}

function noulOf(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { type?: unknown; noul?: unknown };
  return row.type === 'noul' && typeof row.noul === 'number' ? row.noul : null;
}

/** Drop a name Jev rejects. A Jev error keeps the source-backed names. */
async function confirmNames(env: Env, names: string[], sources: readonly CitedSource[]): Promise<string[]> {
  if (!env.TYPESAFE_API_KEY || names.length === 0) return names;
  const questions: Record<string, unknown> = {};
  names.forEach((name, index) => {
    questions[`name_${index}`] = {
      type: 'noul',
      instructions: `Does the evidence name this real estate agency: ${name}?`,
    };
  });
  try {
    const res = await fetch(FREE_ANSWER_JEV_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
      },
      body: JSON.stringify({
        model: FREE_ANSWER_JEV_MODEL,
        state: {
          pages: sources.slice(0, 5).map((source) => ({
            url: source.url.slice(0, 200),
            status: 200,
            excerpt: `${source.title} ${source.snippet}`.slice(0, 400),
          })),
          files: [],
        },
        questions,
      }),
    });
    if (!res.ok) return names;
    const parsed = (await res.json()) as { answers?: unknown };
    if (!parsed.answers || typeof parsed.answers !== 'object') return names;
    const answers = parsed.answers as Record<string, unknown>;
    return names.filter((name, index) => {
      const noul = noulOf(answers[`name_${index}`]);
      return noul == null || noul >= FREE_ANSWER_JEV_NOUL_MIN;
    });
  } catch {
    return names;
  }
}

async function readCached(url: string): Promise<CachedAnswer | null> {
  const cache = answerCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(url);
    if (!hit) return null;
    const body = (await hit.json()) as CachedAnswer;
    if (!body || typeof body.answer !== 'string' || typeof body.answeredAt !== 'string') return null;
    if (Date.now() - Date.parse(body.answeredAt) > DAY_MS) return null;
    return body;
  } catch {
    return null;
  }
}

async function writeCached(url: string, body: CachedAnswer): Promise<void> {
  const cache = answerCache();
  if (!cache) return;
  try {
    await cache.put(url, new Response(JSON.stringify(body), {
      headers: { 'Cache-Control': 'public, max-age=86400', 'Content-Type': 'application/json' },
    }));
  } catch {
    /* a cache miss next time is fine */
  }
}

function displayAnswer(body: CachedAnswer): string {
  const prose = body.answer.replace(/^\s*AGENCIES:.*$/gim, '').trim();
  if (prose) return prose;
  if (body.agencies.length === 0) return 'The live results did not name an agency.';
  return `The live results name ${body.agencies.join(', ')}.`;
}

function present(body: CachedAnswer, brand: string, suburb: string, state: string): Response {
  return json({
    hidden: false,
    label: FREE_AI_ANSWER_LABEL,
    question: body.question,
    answer: displayAnswer(body),
    agencies: body.agencies,
    userNamed: userIsNamed(body.answer, brand),
    sources: body.sources.map((source) => ({ title: source.title, url: source.url })),
    answeredAt: body.answeredAt,
    fix: realEstateAgentFix(brand, suburb, state),
  });
}

export async function handleFreeAiAnswer(request: Request, env: Env): Promise<Response> {
  const who = await identify(request, env);
  if (who.error || !who.user) return json({ hidden: true, error: who.error || 'Sign in required.' }, 401);
  let payload: { suburb?: unknown; state?: unknown; brandName?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ hidden: true, error: 'Invalid JSON body' }, 400);
  }
  const suburb = cleanPlace(payload.suburb);
  const state = cleanPlace(payload.state);
  const brand = typeof payload.brandName === 'string' ? payload.brandName.slice(0, 80) : '';
  if (!suburb || !state) return json({ hidden: true, error: 'Add a suburb and state to the business profile.' }, 400);
  if (await getActiveSubscription(env, who.user)) return hidden();

  const meter = meterName(`${billingId(who.user)}:ai-answer`);
  const spent = await invokeDailyQuota(env, meter, 'spend', 1);
  if (!spendOk(spent) || !spent.ok) return hidden();

  const key = cacheUrl(suburb, state);
  const cached = await readCached(key);
  if (cached) return present(cached, brand, suburb, state);

  const question = questionFor(suburb, state);
  const sources = await searchTavily(env, question);
  const grounded = sources.length > 0 ? sources : await searchExa(env, question);
  const answer = grounded.length > 0 ? await writeAnswer(env, promptFor(question, grounded)) : '';
  if (!answer) {
    await invokeDailyQuota(env, meter, 'refund', 1);
    return hidden();
  }
  const sourceText = grounded.map((source) => `${source.title} ${source.snippet}`).join('\n');
  const named = await confirmNames(env, agenciesFromAnswer(answer, sourceText), grounded);
  const body: CachedAnswer = {
    question,
    answer,
    agencies: named,
    sources: grounded,
    answeredAt: new Date().toISOString(),
  };
  await writeCached(key, body);
  console.info(JSON.stringify({ event: 'free_ai_answer', cached: false }));
  return present(body, brand, suburb, state);
}
