/**
 * Browser caller for POST /api/high-accuracy/schema.
 * The provider key travels only in x-provider-key, never in the JSON body.
 */
import type { ChatModelPreference } from '../llm/chatModelCatalog';
import { GROQ_DEFAULT_MODEL, NIM_DEFAULT_MODEL } from '../llm/nativeModelDefaults';
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import { SCHEMA_HA_ESTIMATE_LABEL, type HaAccuracy, type HaAttempt, type HaUsage } from './contract';

export { SCHEMA_HA_ESTIMATE_LABEL };
export type { HaAccuracy };

export type ChatProviderId = 'groq' | 'nim' | 'ollama' | 'openrouter';

export interface ByokSchemaTarget {
  providerId: ChatProviderId;
  model: string;
  key: string;
  label: string;
}

export interface ByokKeyBag {
  groq: string;
  nim: string;
  nimOrg: string;
  ollama: string;
  ollamaModel: string;
  openrouter: string;
}

const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini';

const LABELS: Record<ChatProviderId, string> = {
  groq: 'Groq',
  nim: 'NVIDIA NIM',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
};

function clean(value: string | undefined): string {
  return (value || '').trim();
}

function modelFor(providerId: ChatProviderId, keys: ByokKeyBag, preferred?: string): string {
  const pref = clean(preferred);
  if (pref && pref !== 'proxy') return pref;
  if (providerId === 'groq') return GROQ_DEFAULT_MODEL;
  if (providerId === 'nim') return NIM_DEFAULT_MODEL;
  if (providerId === 'ollama') return clean(keys.ollamaModel) || 'llama3.2';
  return OPENROUTER_DEFAULT_MODEL;
}

function nimKey(keys: ByokKeyBag): string {
  const key = clean(keys.nim);
  if (!key) return '';
  const org = clean(keys.nimOrg);
  if (!org || key.includes('|')) return key;
  return `${key}|${org}`;
}

function keyFor(providerId: ChatProviderId, keys: ByokKeyBag): string {
  if (providerId === 'groq') return clean(keys.groq);
  if (providerId === 'nim') return nimKey(keys);
  if (providerId === 'ollama') return clean(keys.ollama);
  return clean(keys.openrouter);
}

function target(providerId: ChatProviderId, keys: ByokKeyBag, preferredModel?: string): ByokSchemaTarget | null {
  const key = keyFor(providerId, keys);
  if (!key || key === 'proxy') return null;
  return { providerId, model: modelFor(providerId, keys, preferredModel), key, label: LABELS[providerId] };
}

const AUTO_ORDER: ChatProviderId[] = ['groq', 'nim', 'openrouter', 'ollama'];

/** First real BYOK key. A manual chat pick wins when that provider has a key. Hosted "proxy" is ignored. */
export function resolveByokSchemaTarget(preference: ChatModelPreference, keys: ByokKeyBag): ByokSchemaTarget | null {
  if (preference.mode === 'manual' && preference.provider !== 'freellm') {
    const pinned = target(preference.provider, keys, preference.model);
    if (pinned) return pinned;
  }
  for (const id of AUTO_ORDER) {
    const found = target(id, keys);
    if (found) return found;
  }
  return null;
}

export function formatAccuracyReceipt(accuracy: HaAccuracy): string {
  const u = accuracy.usage;
  const calls = `${u.calls} call${u.calls === 1 ? '' : 's'}`;
  const tokens = u.usageMissing
    ? `${u.totalTokens.toLocaleString('en-US')} tokens reported. Tokens not reported by the provider for ${u.usageMissing} call${u.usageMissing === 1 ? '' : 's'}`
    : `${u.totalTokens.toLocaleString('en-US')} tokens (${u.promptTokens.toLocaleString('en-US')} in / ${u.completionTokens.toLocaleString('en-US')} out)`;
  const who = accuracy.winnerIndex === null
    ? 'no candidate passed schema checks'
    : `candidate ${accuracy.winnerIndex + 1} passed schema checks`;
  return `${calls} · ${tokens} · ${who}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function expectedTypeFromSchema(schemaJsonLd: string | undefined): string | undefined {
  if (!schemaJsonLd) return undefined;
  try {
    const parsed: unknown = JSON.parse(schemaJsonLd);
    if (!isRecord(parsed)) return undefined;
    const t = parsed['@type'];
    if (typeof t === 'string' && /^[A-Z][A-Za-z0-9]{0,63}$/.test(t)) return t;
    if (Array.isArray(t)) {
      const first = t.find((item) => typeof item === 'string' && /^[A-Z][A-Za-z0-9]{0,63}$/.test(item));
      return typeof first === 'string' ? first : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface SchemaRequestParts {
  path: string;
  headers: Record<string, string>;
  body: {
    providerId: ChatProviderId;
    model: string;
    pageUrl: string;
    pageTitle?: string;
    evidence: string;
    expectedType?: string;
  };
}

/** Header carries the key. The JSON body does not. */
export function buildSchemaRequest(args: {
  target: ByokSchemaTarget;
  pageUrl: string;
  pageTitle?: string;
  evidence: string;
  expectedType?: string;
}): SchemaRequestParts {
  return {
    path: '/api/high-accuracy/schema',
    headers: {
      'content-type': 'application/json',
      'x-provider-key': args.target.key,
    },
    body: {
      providerId: args.target.providerId,
      model: args.target.model,
      pageUrl: args.pageUrl,
      pageTitle: args.pageTitle,
      evidence: args.evidence.slice(0, 6000),
      expectedType: args.expectedType,
    },
  };
}

export type SchemaCallResult =
  | { ok: true; schemaJsonLd: string; accuracy: HaAccuracy }
  | { ok: false; code: string; error: string; accuracy?: HaAccuracy };

function isUsage(value: unknown): value is HaUsage {
  if (!isRecord(value)) return false;
  return typeof value.calls === 'number'
    && typeof value.failed === 'number'
    && typeof value.usageMissing === 'number'
    && typeof value.promptTokens === 'number'
    && typeof value.completionTokens === 'number'
    && typeof value.totalTokens === 'number';
}

function readAttempts(value: unknown): HaAttempt[] {
  if (!Array.isArray(value)) return [];
  const out: HaAttempt[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.index !== 'number' || typeof item.ok !== 'boolean') continue;
    const reasons = Array.isArray(item.reasons)
      ? item.reasons.filter((reason): reason is string => typeof reason === 'string')
      : [];
    out.push({ index: item.index, ok: item.ok, reasons });
  }
  return out;
}

function readAccuracy(value: unknown): HaAccuracy | undefined {
  if (!isRecord(value) || value.mode !== 'best_of_n' || value.keySource !== 'byok') return undefined;
  if (value.winnerIndex !== null && typeof value.winnerIndex !== 'number') return undefined;
  if (typeof value.estimate !== 'string' || !isUsage(value.usage)) return undefined;
  return {
    mode: 'best_of_n',
    keySource: 'byok',
    winnerIndex: value.winnerIndex,
    estimate: value.estimate,
    usage: value.usage,
    attempts: readAttempts(value.attempts),
  };
}

export function readHighAccuracyResponse(status: number, body: unknown): SchemaCallResult {
  const record = isRecord(body) ? body : {};
  const code = typeof record.code === 'string' ? record.code : (status === 404 ? 'disabled' : 'error');
  const error = typeof record.error === 'string' ? record.error : 'High-accuracy run failed.';
  const accuracy = readAccuracy(record.accuracy);
  if (record.ok === true && typeof record.schemaJsonLd === 'string' && accuracy) {
    return { ok: true, schemaJsonLd: record.schemaJsonLd, accuracy };
  }
  return { ok: false, code, error, accuracy };
}

export function failureNote(result: Extract<SchemaCallResult, { ok: false }>): string {
  if (result.code === 'disabled') return 'High-accuracy mode is off on this server.';
  if (result.code === 'no_credential') return 'Add your own provider key in Settings. High-accuracy does not use a hosted key.';
  if (result.code === 'AUTH_REQUIRED') return 'Sign in to generate a high-accuracy schema.';
  const codes = (result.accuracy?.attempts ?? []).flatMap((attempt) => attempt.reasons);
  const unique = [...new Set(codes)].slice(0, 4);
  const suffix = unique.length ? ` (${unique.join(', ')})` : '';
  return `High-accuracy run didn't improve this result.${suffix}`;
}

export async function requestHighAccuracySchema(args: {
  target: ByokSchemaTarget;
  pageUrl: string;
  pageTitle?: string;
  evidence: string;
  expectedType?: string;
}): Promise<SchemaCallResult> {
  const parts = buildSchemaRequest(args);
  const base = apiBase();
  if (!base) return { ok: false, code: 'no_worker', error: 'The API is not configured in this build.' };
  let res: Response;
  try {
    res = await workerFetchWithAuthRetry(`${base}${parts.path}`, {
      method: 'POST',
      headers: parts.headers,
      body: JSON.stringify(parts.body),
    });
  } catch {
    return { ok: false, code: 'network', error: 'High-accuracy run did not reach the server.' };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return readHighAccuracyResponse(res.status, body);
}
