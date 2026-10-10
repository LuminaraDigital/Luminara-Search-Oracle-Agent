/**
 * Cloudflare Workers AI fallback for the hosted Groq chat-completions path (Track SW, SW0a-11).
 *
 * The relay calls this when hosted Groq cannot answer: no hosted key, a network failure, or an
 * upstream 5xx. It answers in the OpenAI ChatCompletion shape (JSON or SSE) and always names the
 * model that wrote the reply. It refuses any request it cannot serve faithfully, so a typed,
 * tool-using or long call gets the upstream's own error instead of free text from a smaller model.
 */
import type { Ai } from './env';

export const WORKERS_AI_FALLBACK_PROVIDER = 'workers-ai';
export const WORKERS_AI_FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct';

/**
 * Prompt budget for the fallback: characters of message content, summed over every message.
 *
 * This is a conservative budget chosen by hand. It is NOT the context length that Cloudflare's
 * model catalogue states for @cf/meta/llama-3.1-8b-instruct, and nothing here measured it: the
 * repository does not record that figure, and the session that wrote this could not read the
 * catalogue. It is kept low on purpose so that a prompt which passes should fit the model with
 * room left for the reply. That has not been checked against the catalogue.
 *
 * A prompt over the budget is refused. It is never clipped, summarised or shortened.
 * Replace this with a figure taken from the catalogue once someone has read it.
 */
export const WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET = 8_000;

/** Used when the caller sends no temperature, or one outside the accepted range. */
export const WORKERS_AI_FALLBACK_DEFAULT_TEMPERATURE = 0.7;
/**
 * Temperatures passed through to the binding. 0 to 2 is what the OpenAI-shaped request this
 * replaces allows. The binding's own documented range was not read when this was written, so
 * anything outside 0 to 2 gets the default instead of being forwarded.
 */
export const WORKERS_AI_FALLBACK_MIN_TEMPERATURE = 0;
export const WORKERS_AI_FALLBACK_MAX_TEMPERATURE = 2;
/** Reply length cap. The caller's `max_tokens` is used when it is lower. */
export const WORKERS_AI_FALLBACK_MAX_TOKENS = 2048;

/** Fixed name of the one structured log line written per fallback answer. */
export const WORKERS_AI_FALLBACK_EVENT = 'workers_ai_fallback_answer';

/** Why the relay turned to the fallback. */
export type WorkersAiFallbackReason = 'provider_not_configured' | 'network_error' | 'upstream_5xx';

/** Why the fallback would not answer a request. */
export type WorkersAiFallbackRefusal =
  | 'response_format'
  | 'tools'
  | 'tool_choice'
  | 'non_string_content'
  | 'malformed_message'
  | 'prompt_too_long'
  | 'no_prompt';

export interface WorkersAiFallbackContext {
  reason: WorkersAiFallbackReason;
  /** The upstream's HTTP status when it replied at all. */
  upstreamStatus?: number | null;
}

export interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Marker carried in the JSON body. The OpenAI shape tolerates unknown `x_` fields. */
export interface FallbackMarker {
  provider: string;
  model: string;
  reason: WorkersAiFallbackReason;
}

export interface OpenAiChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

export interface OpenAiChatCompletion {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAiChatCompletionChoice[];
  /** What the binding reported. Left out when it reported nothing: never zeros. */
  usage?: OpenAiUsage;
  x_fallback: FallbackMarker;
}

export interface OpenAiStreamChunkChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
  };
  finish_reason: string | null;
}

export interface OpenAiStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAiStreamChunkChoice[];
  /** Only on the last chunk, and only when the binding reported usage. */
  usage?: OpenAiUsage;
}

export interface WorkersAiFallbackPlan {
  messages: Array<{ role: string; content: string }>;
  temperature: number;
  maxTokens: number;
  stream: boolean;
}

export type WorkersAiFallbackOutcome =
  | { answered: false; refusal: WorkersAiFallbackRefusal }
  | {
      answered: true;
      streaming: false;
      model: string;
      reason: WorkersAiFallbackReason;
      completion: OpenAiChatCompletion;
    }
  | {
      answered: true;
      streaming: true;
      model: string;
      reason: WorkersAiFallbackReason;
      stream: ReadableStream<Uint8Array>;
    };

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Reads the usage block a Workers AI text-generation result carries
 * (`usage: { prompt_tokens, completion_tokens, total_tokens }`, optional in the binding's types).
 * Returns null when the binding reported none.
 */
export function readBindingUsage(value: unknown): OpenAiUsage | null {
  const usage = (value as { usage?: unknown } | null | undefined)?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  if (!isCount(u.prompt_tokens) || !isCount(u.completion_tokens)) return null;
  return {
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    total_tokens: isCount(u.total_tokens) ? u.total_tokens : u.prompt_tokens + u.completion_tokens,
  };
}

/** Text carried by one binding payload: a whole result or one stream event. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const v = value as {
    response?: unknown;
    text?: unknown;
    choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
  };
  if (typeof v.response === 'string') return v.response;
  const choice = v.choices?.[0];
  if (typeof choice?.delta?.content === 'string') return choice.delta.content;
  if (typeof choice?.message?.content === 'string') return choice.message.content;
  if (typeof v.text === 'string') return v.text;
  return '';
}

function carries(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function parseBody(body: unknown): Record<string, unknown> {
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  return {};
}

/**
 * Decides whether the fallback may answer this request, and with what settings.
 * Pure: it calls nothing. Every refusal sends the caller back to the upstream's own error.
 */
export function planWorkersAiChatFallback(
  body: unknown,
): { ok: true; plan: WorkersAiFallbackPlan } | { ok: false; refusal: WorkersAiFallbackRefusal } {
  const b = parseBody(body);

  // A typed or tool-using call would come back as free text. Refuse it.
  if (carries(b.response_format)) return { ok: false, refusal: 'response_format' };
  if (carries(b.tools) || carries(b.functions)) return { ok: false, refusal: 'tools' };
  if (carries(b.tool_choice) || carries(b.function_call)) return { ok: false, refusal: 'tool_choice' };

  const messages: Array<{ role: string; content: string }> = [];
  if (Array.isArray(b.messages) && b.messages.length > 0) {
    for (const raw of b.messages) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, refusal: 'malformed_message' };
      const m = raw as Record<string, unknown>;
      if (m.role === 'tool' || m.role === 'function' || carries(m.tool_calls) || carries(m.tool_call_id)) {
        return { ok: false, refusal: 'tools' };
      }
      // Image parts, content arrays and null content are not turned into text.
      if (typeof m.content !== 'string') return { ok: false, refusal: 'non_string_content' };
      messages.push({ role: typeof m.role === 'string' ? m.role : 'user', content: m.content });
    }
  } else if (typeof b.prompt === 'string' && b.prompt.trim()) {
    messages.push({ role: 'user', content: b.prompt.trim() });
  }
  if (messages.length === 0) return { ok: false, refusal: 'no_prompt' };

  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (promptChars > WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET) return { ok: false, refusal: 'prompt_too_long' };

  const t = b.temperature;
  const temperature =
    typeof t === 'number' &&
    Number.isFinite(t) &&
    t >= WORKERS_AI_FALLBACK_MIN_TEMPERATURE &&
    t <= WORKERS_AI_FALLBACK_MAX_TEMPERATURE
      ? t
      : WORKERS_AI_FALLBACK_DEFAULT_TEMPERATURE;

  const requested = carries(b.max_tokens) ? b.max_tokens : b.max_completion_tokens;
  const maxTokens =
    typeof requested === 'number' && Number.isFinite(requested) && requested >= 1
      ? Math.min(Math.floor(requested), WORKERS_AI_FALLBACK_MAX_TOKENS)
      : WORKERS_AI_FALLBACK_MAX_TOKENS;

  return { ok: true, plan: { messages, temperature, maxTokens, stream: Boolean(b.stream) } };
}

/**
 * One structured line per fallback answer. Until the plan's cost table exists (SW0-6) this line
 * is the only record of what the fallback used. It carries no prompt text and no user id.
 */
function logFallbackAnswer(context: WorkersAiFallbackContext, stream: boolean, usage: OpenAiUsage | null): void {
  console.log(
    JSON.stringify({
      event: WORKERS_AI_FALLBACK_EVENT,
      provider: WORKERS_AI_FALLBACK_PROVIDER,
      model: WORKERS_AI_FALLBACK_MODEL,
      reason: context.reason,
      upstream_status: typeof context.upstreamStatus === 'number' ? context.upstreamStatus : null,
      stream,
      prompt_tokens: usage ? usage.prompt_tokens : null,
      completion_tokens: usage ? usage.completion_tokens : null,
      total_tokens: usage ? usage.total_tokens : null,
    }),
  );
}

/**
 * Turns a Workers AI result (an SSE byte stream, a stream of objects, or a plain result) into an
 * OpenAI-compatible SSE stream. `onEnd` is called exactly once, when the stream has finished or
 * failed, with the usage the binding reported along the way (null when it reported none).
 */
export function createOpenAiSseReadableStream(
  aiResult: unknown,
  id: string,
  created: number,
  onEnd?: (usage: OpenAiUsage | null) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let usage: OpenAiUsage | null = null;

      const send = (delta: OpenAiStreamChunkChoice['delta'], finishReason: string | null) => {
        const chunk: OpenAiStreamChunk = {
          id,
          object: 'chat.completion.chunk',
          created,
          model: WORKERS_AI_FALLBACK_MODEL,
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        };
        if (finishReason && usage) chunk.usage = usage;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };

      /** One binding payload: remember its usage, forward its text. */
      const take = (payload: unknown) => {
        const reported = readBindingUsage(payload);
        if (reported) usage = reported;
        const content = textOf(payload);
        if (content) send({ content }, null);
      };

      const takeSseLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        try {
          take(JSON.parse(data));
        } catch {
          // Ignore SSE lines that are not JSON.
        }
      };

      try {
        if (aiResult && typeof (aiResult as { getReader?: unknown }).getReader === 'function') {
          const reader = (aiResult as ReadableStream).getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
              // The binding (or a test double) handed over an object, not bytes.
              take(value);
              continue;
            }

            buffer += typeof value === 'string' ? value : decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) takeSseLine(line);
          }
          takeSseLine(buffer);
        } else {
          // A plain result although a stream was asked for.
          take(aiResult);
        }

        send({}, 'stop');
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        onEnd?.(usage);
      }
    },
  });
}

/**
 * Answers a chat-completions request with the fallback model, or refuses.
 *
 * The caller (the relay) decides when a fallback is allowed at all: only the groq
 * chat-completions path, and only for a missing hosted key, a network failure or an upstream 5xx.
 * This function decides whether the request itself can be answered faithfully.
 * A thrown error means the binding failed; the caller then returns the upstream's own error.
 */
export async function runWorkersAiChatFallback(
  ai: Ai,
  body: unknown,
  context: WorkersAiFallbackContext,
): Promise<WorkersAiFallbackOutcome> {
  const planned = planWorkersAiChatFallback(body);
  if (!planned.ok) return { answered: false, refusal: planned.refusal };
  const { messages, temperature, maxTokens, stream } = planned.plan;

  const aiResult: unknown = await ai.run(WORKERS_AI_FALLBACK_MODEL, {
    messages,
    temperature,
    max_tokens: maxTokens,
    stream,
  });

  const now = Date.now();
  const id = `chatcmpl-cf-${now}`;
  const created = Math.floor(now / 1000);

  if (stream) {
    return {
      answered: true,
      streaming: true,
      model: WORKERS_AI_FALLBACK_MODEL,
      reason: context.reason,
      stream: createOpenAiSseReadableStream(aiResult, id, created, (usage) => {
        logFallbackAnswer(context, true, usage);
      }),
    };
  }

  const responseText = textOf(aiResult);
  // No text is not an answer. Let the caller return the upstream's error instead of an empty reply.
  if (!responseText) throw new Error('Workers AI returned no text');

  const usage = readBindingUsage(aiResult);
  const completion: OpenAiChatCompletion = {
    id,
    object: 'chat.completion',
    created,
    model: WORKERS_AI_FALLBACK_MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: responseText,
        },
        finish_reason: 'stop',
      },
    ],
    ...(usage ? { usage } : {}),
    x_fallback: {
      provider: WORKERS_AI_FALLBACK_PROVIDER,
      model: WORKERS_AI_FALLBACK_MODEL,
      reason: context.reason,
    },
  };
  logFallbackAnswer(context, false, usage);

  return {
    answered: true,
    streaming: false,
    model: WORKERS_AI_FALLBACK_MODEL,
    reason: context.reason,
    completion,
  };
}
