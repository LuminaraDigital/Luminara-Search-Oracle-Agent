/**
 * The one place the Oracle tool loop calls a model. Track SW's SW1b replaces this function
 * with its hardened call (timeout, fallback, live model); nothing else in the loop talks to a provider.
 */
import type { Env } from '../env';
import { GROQ_DEFAULT_MODEL, GROQ_FALLBACK_MODELS } from '../../services/llm/nativeModelDefaults';

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ModelToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ModelToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ModelToolSpec = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ModelRequest = {
  messages: ChatMessage[];
  tools?: ModelToolSpec[];
  /** "none" forces a text answer (grace call). */
  toolChoice?: 'auto' | 'none';
  /** Use the fallback model (after a rate limit). */
  fallback?: boolean;
  /** Free-plan traffic uses the fallback key so it cannot rate-limit paid users. */
  preferFallbackKey?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
};

export type ModelResponse =
  | { ok: true; text: string; toolCalls: ModelToolCall[] }
  | { ok: false; status: number; code: 'NO_LLM' | 'RATE_LIMITED' | 'TOOLS_REJECTED' | 'TIMEOUT' | 'UPSTREAM'; detail: string };

export type CallModel = (env: Env, req: ModelRequest) => Promise<ModelResponse>;

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function groqKey(env: Env, preferFallbackKey: boolean): string | undefined {
  if (preferFallbackKey) return env.GROQ_API_KEY_FALLBACK || env.GROQ_API_KEY;
  return env.GROQ_API_KEY || env.GROQ_API_KEY_FALLBACK;
}

/** Read tool calls defensively: a malformed entry is dropped, never thrown. */
export function parseToolCalls(raw: unknown): ModelToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: ModelToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const fn = (item as { function?: { name?: unknown; arguments?: unknown } }).function;
    const id = (item as { id?: unknown }).id;
    if (!fn || typeof fn.name !== 'string' || !fn.name) continue;
    out.push({
      id: typeof id === 'string' && id ? id.slice(0, 80) : `call_${crypto.randomUUID()}`,
      type: 'function',
      function: { name: fn.name.slice(0, 64), arguments: typeof fn.arguments === 'string' ? fn.arguments : '{}' },
    });
  }
  return out;
}

export const callOracleModel: CallModel = async (env, req) => {
  const key = groqKey(env, Boolean(req.preferFallbackKey));
  if (!key) return { ok: false, status: 0, code: 'NO_LLM', detail: 'Hosted Groq key not configured' };
  const body: Record<string, unknown> = {
    model: req.fallback ? GROQ_FALLBACK_MODELS[0] : GROQ_DEFAULT_MODEL,
    messages: req.messages,
    temperature: 0.4,
    max_tokens: req.maxTokens ?? 2048,
    reasoning_effort: 'low',
    stream: false,
  };
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools;
    body.tool_choice = req.toolChoice ?? 'auto';
    body.parallel_tool_calls = false;
  }
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeoutMs ?? 9000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, status: 0, code: timedOut ? 'TIMEOUT' : 'UPSTREAM', detail: timedOut ? 'model call timed out' : 'model call failed' };
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    if (res.status === 429 || res.status === 413) return { ok: false, status: res.status, code: 'RATE_LIMITED', detail };
    if (res.status === 400 && req.tools && /tool/i.test(detail)) return { ok: false, status: 400, code: 'TOOLS_REJECTED', detail };
    return { ok: false, status: res.status, code: 'UPSTREAM', detail };
  }
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
  } | null;
  const message = data?.choices?.[0]?.message;
  // The reasoning field is never read: it is not fed back and never shown.
  return {
    ok: true,
    text: typeof message?.content === 'string' ? message.content : '',
    toolCalls: parseToolCalls(message?.tool_calls),
  };
};
