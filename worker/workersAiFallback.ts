/**
 * Cloudflare Workers AI fallback for the hosted Groq chat-completions path (Track SW, SW0a-11).
 *
 * The relay calls this after NVIDIA (missing, capped, or failed) when hosted Groq cannot
 * answer: no hosted key, a network failure or timeout, an upstream 5xx, or a 429. It answers in the OpenAI
 * ChatCompletion shape (JSON or SSE) and always names the model that wrote the reply.
 * A typed or tool-using call is refused. A long prompt is cut to the byte budget.
 *
 * A prompt over the byte budget is cut to that budget and still answered. Tools and typed
 * output are still refused. It writes one structured log line per outcome and never more than one:
 * `workers_ai_fallback_answer`, `workers_ai_fallback_refused` or `workers_ai_fallback_failed`.
 * The failure line includes a short error. None of them carries the request prompt, the reply, or a user id.
 */
import type { Ai } from './env';

export const WORKERS_AI_FALLBACK_PROVIDER = 'workers-ai';
export const WORKERS_AI_FALLBACK_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

/**
 * Prompt budget for the fallback, in budget units summed over every message's content.
 * One ASCII character is one unit. See `promptBudgetUnits` for other characters.
 *
 * This is a conservative budget chosen by hand. It is not the context window of
 * `@cf/meta/llama-3.1-8b-instruct-fast` (an active text model in the Cloudflare catalogue).
 * It stays low so a prompt which passes should fit with room left for the reply.
 *
 * A prompt over the budget is cut down to it, from the end of the longest message.
 * shortcut: the tail is dropped, upgrade when a later fact has to survive the cut.
 * Replace this with a figure taken from the catalogue once someone has read it.
 */
export const WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET = 8_000;

/** Used when the caller sends no temperature. A temperature that is sent and invalid is refused. */
export const WORKERS_AI_FALLBACK_DEFAULT_TEMPERATURE = 0.7;
/**
 * Temperatures passed through to the binding. 0 to 2 is what the OpenAI-shaped request this
 * replaces allows. The binding's own documented range was not read when this was written.
 */
export const WORKERS_AI_FALLBACK_MIN_TEMPERATURE = 0;
export const WORKERS_AI_FALLBACK_MAX_TEMPERATURE = 2;
/** Reply length cap in tokens. The caller's `max_tokens` is used when it is lower. */
export const WORKERS_AI_FALLBACK_MAX_TOKENS = 2048;

/** Fixed names of the structured log lines. */
export const WORKERS_AI_FALLBACK_EVENT = 'workers_ai_fallback_answer';
export const WORKERS_AI_FALLBACK_REFUSED_EVENT = 'workers_ai_fallback_refused';
export const WORKERS_AI_FALLBACK_FAILED_EVENT = 'workers_ai_fallback_failed';

/** Why the relay turned to the fallback. */
export type WorkersAiFallbackReason = 'provider_not_configured' | 'network_error' | 'upstream_5xx' | 'upstream_429' | 'upstream_4xx';

/** The rule under which the fallback would not answer a request. */
export type WorkersAiFallbackRefusal =
  | 'response_format'
  | 'tools'
  | 'tool_choice'
  | 'non_string_content'
  | 'malformed_message'
  | 'no_messages'
  | 'unsupported_parameter'
  | 'invalid_parameter';

/** Why the fallback tried and produced no answer. */
export type WorkersAiFallbackFailure = 'binding_error' | 'no_text' | 'stream_error';

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

export type FallbackFinishReason = 'stop' | 'length';

export interface OpenAiChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: FallbackFinishReason;
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
  finish_reason: FallbackFinishReason | null;
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
  /** Forwarded only when the caller sent them. */
  topP?: number;
  seed?: number;
}

/** Size of the prompt as the plan saw it. Numbers only: safe to log. */
export interface PromptSize {
  /** Characters of message text. */
  chars: number;
  /** The same text in budget units (see `promptBudgetUnits`). */
  units: number;
}

export type WorkersAiFallbackPlanResult =
  | { ok: true; plan: WorkersAiFallbackPlan; prompt: PromptSize }
  | { ok: false; refusal: WorkersAiFallbackRefusal; parameter: string | null; prompt: PromptSize };

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

/** Thrown when the fallback tried and has nothing to send. The caller returns the upstream's error. */
export class WorkersAiFallbackFailedError extends Error {
  constructor(readonly failure: WorkersAiFallbackFailure, cause?: unknown) {
    super(`Workers AI fallback failed: ${failure}`);
    this.name = 'WorkersAiFallbackFailedError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

const utf8 = new TextEncoder();

/**
 * Size of a text in budget units: its UTF-8 byte length. An ASCII character is 1 unit, an
 * accented Latin, Greek or Cyrillic letter is 2, a CJK character is 3, an emoji is 4.
 *
 * Why bytes and not characters: the budget stands in for tokens, and a count of characters does
 * not. Latin text packs several characters into a token, while a CJK character or an emoji can
 * be a token or more by itself, so 8,000 CJK characters are far more tokens than 8,000 Latin
 * ones. A token is never smaller than one byte, so a byte count is an upper bound on tokens for
 * every script. This is a conservative weight, not a tokenizer.
 */
export function promptBudgetUnits(text: string): number {
  return utf8.encode(text).length;
}

/** Longest prefix whose UTF-8 size is within maxUnits. */
export function trimToBudget(text: string, maxUnits: number): string {
  if (maxUnits <= 0) return '';
  if (promptBudgetUnits(text) <= maxUnits) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (promptBudgetUnits(text.slice(0, mid)) <= maxUnits) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
}

function fitMessagesToBudget(
  messages: Array<{ role: string; content: string }>,
  budget: number,
): Array<{ role: string; content: string }> {
  const next = messages.map((message) => ({ ...message }));
  let used = next.reduce((sum, message) => sum + promptBudgetUnits(message.content), 0);
  while (used > budget) {
    let longest = 0;
    for (let i = 1; i < next.length; i++) {
      if (promptBudgetUnits(next[i].content) > promptBudgetUnits(next[longest].content)) longest = i;
    }
    const size = promptBudgetUnits(next[longest].content);
    if (size === 0) break;
    next[longest].content = trimToBudget(next[longest].content, size - (used - budget));
    const after = next.reduce((sum, message) => sum + promptBudgetUnits(message.content), 0);
    if (after >= used) break;
    used = after;
  }
  return next.filter((message) => message.content.length > 0);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Reads the usage block a Workers AI text-generation result carries
 * (`usage: { prompt_tokens, completion_tokens, total_tokens }`, optional in the binding's types).
 * Returns null when the binding reported none. A block of all zeros is treated as not reported:
 * a reply with text did not cost zero tokens, so zeros are a placeholder, not a measurement.
 */
export function readBindingUsage(value: unknown): OpenAiUsage | null {
  const usage = (value as { usage?: unknown } | null | undefined)?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  if (!isCount(u.prompt_tokens) || !isCount(u.completion_tokens)) return null;
  if (u.prompt_tokens === 0 && u.completion_tokens === 0) return null;
  return {
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    total_tokens: isCount(u.total_tokens) && u.total_tokens > 0 ? u.total_tokens : u.prompt_tokens + u.completion_tokens,
  };
}

/**
 * Whether a reply reached the token cap (`'length'`) or not (`'stop'`).
 *
 * `'length'` is reported only on evidence: the binding reported usage and its completion token
 * count reached the cap. With no usage reported the reply is `'stop'`. Its length in characters
 * is not evidence either way, and a guess would put a "cut short" note on complete replies.
 * The structured answer line says which case it was (`usage: 'reported' | 'none'`), so a reader
 * of the logs knows when `'stop'` means "ended" and when it means "not known".
 */
export function fallbackFinishReason(usage: OpenAiUsage | null, maxTokens: number): FallbackFinishReason {
  return usage && usage.completion_tokens >= maxTokens ? 'length' : 'stop';
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
 * Every request field the fallback acts on, one way or another. A field that is not here and
 * carries a value is refused: the fallback does not accept a setting and then ignore it.
 *
 * - Forwarded to the binding: `messages`, `stream`, `temperature`, `max_tokens` /
 *   `max_completion_tokens`, and `top_p` and `seed` (the binding's text-generation input in
 *   `@cloudflare/workers-types` declares both, with the same meaning).
 * - Refused by a rule of their own: `response_format`, `tools`, `functions`, `tool_choice`,
 *   `function_call`.
 * - No effect on the reply: `model` (the fallback names its own model in the reply), `user`
 *   (never forwarded and never logged), and `n` when it is 1.
 *
 * So `stop`, `logprobs`, `top_logprobs` and `logit_bias` are refused: the binding's input type
 * has no such field. `frequency_penalty` and `presence_penalty` are refused too: the type has
 * them, but the OpenAI request allows negative values and nothing in this repository says the
 * binding gives the same number the same meaning. A bare `prompt` is refused: this path takes
 * `messages`.
 */
const HANDLED_FIELDS = new Set([
  'model',
  'messages',
  'stream',
  'temperature',
  'max_tokens',
  'max_completion_tokens',
  'top_p',
  'seed',
  'n',
  'user',
  'response_format',
  'tools',
  'functions',
  'tool_choice',
  'function_call',
]);

/** Field names that may be written to a log. A caller can name a field anything, so any other name is logged as "other". */
const LOGGABLE_FIELDS = new Set([
  ...HANDLED_FIELDS,
  'prompt',
  'stop',
  'logprobs',
  'top_logprobs',
  'logit_bias',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
  'top_k',
  'stream_options',
  'parallel_tool_calls',
]);

function isNumberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Decides whether the fallback may answer this request, and with what settings.
 * Pure: it calls nothing and logs nothing. Every refusal sends the caller back to the upstream's
 * own error. Nothing is defaulted over a value the caller sent: a bad value is a refusal.
 */
export function planWorkersAiChatFallback(body: unknown): WorkersAiFallbackPlanResult {
  const b = parseBody(body);

  // Measure first, so a refusal can say how large the prompt was whatever rule refused it.
  const rawMessages = Array.isArray(b.messages) ? b.messages : [];
  const prompt: PromptSize = { chars: 0, units: 0 };
  for (const raw of rawMessages) {
    const content = (raw as { content?: unknown } | null | undefined)?.content;
    if (typeof content !== 'string') continue;
    prompt.chars += content.length;
    prompt.units += promptBudgetUnits(content);
  }
  const refuse = (refusal: WorkersAiFallbackRefusal, parameter: string | null = null): WorkersAiFallbackPlanResult => ({
    ok: false,
    refusal,
    parameter,
    prompt,
  });

  // A typed or tool-using call would come back as free text.
  if (carries(b.response_format)) return refuse('response_format');
  if (carries(b.tools) || carries(b.functions)) return refuse('tools');
  if (carries(b.tool_choice) || carries(b.function_call)) return refuse('tool_choice');

  const messages: Array<{ role: string; content: string }> = [];
  for (const raw of rawMessages) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return refuse('malformed_message');
    const m = raw as Record<string, unknown>;
    if (m.role === 'tool' || m.role === 'function' || carries(m.tool_calls) || carries(m.tool_call_id)) {
      return refuse('tools');
    }
    // Image parts, content arrays and null content are not turned into text.
    if (typeof m.content !== 'string') return refuse('non_string_content');
    messages.push({ role: typeof m.role === 'string' ? m.role : 'user', content: m.content });
  }
  // The relay's chat path is messages only. A bare `prompt` is not answered.
  if (messages.length === 0) return refuse('no_messages');

  for (const field of Object.keys(b)) {
    if (!HANDLED_FIELDS.has(field) && carries(b[field])) {
      return refuse('unsupported_parameter', LOGGABLE_FIELDS.has(field) ? field : 'other');
    }
  }

  // Only a boolean true streams. "false", 1 and the like are not read as a wish either way.
  if (carries(b.stream) && typeof b.stream !== 'boolean') return refuse('invalid_parameter', 'stream');
  const stream = b.stream === true;

  let temperature = WORKERS_AI_FALLBACK_DEFAULT_TEMPERATURE;
  if (carries(b.temperature)) {
    if (!isNumberIn(b.temperature, WORKERS_AI_FALLBACK_MIN_TEMPERATURE, WORKERS_AI_FALLBACK_MAX_TEMPERATURE)) {
      return refuse('invalid_parameter', 'temperature');
    }
    temperature = b.temperature;
  }

  let maxTokens = WORKERS_AI_FALLBACK_MAX_TOKENS;
  const requested = carries(b.max_tokens) ? b.max_tokens : b.max_completion_tokens;
  if (carries(requested)) {
    if (!isNumberIn(requested, 1, Number.MAX_SAFE_INTEGER)) return refuse('invalid_parameter', 'max_tokens');
    maxTokens = Math.min(Math.floor(requested), WORKERS_AI_FALLBACK_MAX_TOKENS);
  }

  let topP: number | undefined;
  if (carries(b.top_p)) {
    if (!isNumberIn(b.top_p, 0, 1)) return refuse('invalid_parameter', 'top_p');
    topP = b.top_p;
  }

  let seed: number | undefined;
  if (carries(b.seed)) {
    if (!Number.isSafeInteger(b.seed)) return refuse('invalid_parameter', 'seed');
    seed = b.seed as number;
  }

  // The reply is one choice.
  if (carries(b.n) && b.n !== 1) return refuse('invalid_parameter', 'n');

  const fitted = prompt.units > WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET
    ? fitMessagesToBudget(messages, WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET)
    : messages;
  if (fitted.length === 0) return refuse('no_messages');
  if (fitted !== messages) {
    prompt.chars = fitted.reduce((sum, message) => sum + message.content.length, 0);
    prompt.units = fitted.reduce((sum, message) => sum + promptBudgetUnits(message.content), 0);
  }

  return {
    ok: true,
    plan: {
      messages: fitted,
      temperature,
      maxTokens,
      stream,
      ...(topP !== undefined ? { topP } : {}),
      ...(seed !== undefined ? { seed } : {}),
    },
    prompt,
  };
}

function logLine(event: string, context: WorkersAiFallbackContext, fields: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      event,
      provider: WORKERS_AI_FALLBACK_PROVIDER,
      model: WORKERS_AI_FALLBACK_MODEL,
      reason: context.reason,
      upstream_status: typeof context.upstreamStatus === 'number' ? context.upstreamStatus : null,
      ...fields,
    }),
  );
}

/**
 * One line per fallback answer. Until the plan's cost table exists (SW0-6) this line is the only
 * record of what the fallback used.
 */
function logFallbackAnswer(
  context: WorkersAiFallbackContext,
  stream: boolean,
  usage: OpenAiUsage | null,
  finishReason: FallbackFinishReason,
): void {
  logLine(WORKERS_AI_FALLBACK_EVENT, context, {
    stream,
    finish_reason: finishReason,
    // 'none' means the binding reported no usage, so finish_reason 'stop' is not a measurement.
    usage: usage ? 'reported' : 'none',
    prompt_tokens: usage ? usage.prompt_tokens : null,
    completion_tokens: usage ? usage.completion_tokens : null,
    total_tokens: usage ? usage.total_tokens : null,
  });
}

/**
 * One line per refusal: which rule, and how large the prompt was. With the budget as low as it
 * is, this line is how anyone sees how often the fallback could not help.
 */
function logFallbackRefusal(
  context: WorkersAiFallbackContext,
  refused: Extract<WorkersAiFallbackPlanResult, { ok: false }>,
): void {
  logLine(WORKERS_AI_FALLBACK_REFUSED_EVENT, context, {
    refusal: refused.refusal,
    parameter: refused.parameter,
    prompt_chars: refused.prompt.chars,
    prompt_budget_units: refused.prompt.units,
    budget: WORKERS_AI_FALLBACK_PROMPT_CHAR_BUDGET,
  });
}

/** One line when the fallback tried and had no answer to give, or lost one part-way. */
function logFallbackFailure(
  context: WorkersAiFallbackContext,
  stream: boolean,
  failure: WorkersAiFallbackFailure,
  textSent: boolean,
  error: string,
): void {
  logLine(WORKERS_AI_FALLBACK_FAILED_EVENT, context, {
    stream,
    failure,
    text_sent: textSent,
    error: error.replace(/\s+/g, ' ').slice(0, 180),
  });
}

/** The payloads a Workers AI result carries, one at a time. */
interface PayloadSource {
  next(): Promise<{ done: true } | { done: false; value: unknown }>;
  cancel(): Promise<void>;
}

/**
 * Reads a Workers AI result as a sequence of payloads, whatever form it came in:
 * an SSE byte stream, a stream of objects, or one plain result.
 */
function payloadSource(aiResult: unknown): PayloadSource {
  if (!aiResult || typeof (aiResult as { getReader?: unknown }).getReader !== 'function') {
    // A plain result although a stream was asked for.
    let taken = false;
    return {
      async next() {
        if (taken) return { done: true };
        taken = true;
        return { done: false, value: aiResult };
      },
      async cancel() {},
    };
  }

  const reader = (aiResult as ReadableStream).getReader();
  const decoder = new TextDecoder();
  const queue: unknown[] = [];
  let buffer = '';
  let ended = false;

  const takeSseLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      queue.push(JSON.parse(data));
    } catch {
      // Ignore SSE lines that are not JSON.
    }
  };

  return {
    async next() {
      while (queue.length === 0 && !ended) {
        const { done, value } = await reader.read();
        if (done) {
          ended = true;
          takeSseLine(buffer);
          buffer = '';
          break;
        }
        if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
          // The binding (or a test double) handed over an object, not bytes.
          queue.push(value);
          continue;
        }
        buffer += typeof value === 'string' ? value : decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) takeSseLine(line);
      }
      if (queue.length > 0) return { done: false, value: queue.shift() };
      return { done: true };
    },
    async cancel() {
      ended = true;
      try {
        await reader.cancel();
      } catch {
        // The binding's stream is already gone.
      }
    },
  };
}

/**
 * Turns a Workers AI stream into an OpenAI-compatible SSE stream.
 *
 * It waits for the first piece of text before it returns. A stream that ends or breaks before
 * any text is not an answer: this throws `WorkersAiFallbackFailedError` and nothing is sent, so
 * the caller can still return the upstream's own error. Once text exists the reply is committed:
 * `onEnd` is called once when it finishes, or `onFail` once if the binding's stream breaks
 * part-way, in which case the client's stream is errored and not closed as if complete.
 */
export async function openFallbackSseStream(
  aiResult: unknown,
  opts: {
    id: string;
    created: number;
    maxTokens: number;
    onEnd?: (usage: OpenAiUsage | null, finishReason: FallbackFinishReason) => void;
    onFail?: () => void;
  },
): Promise<ReadableStream<Uint8Array>> {
  const source = payloadSource(aiResult);
  let usage: OpenAiUsage | null = null;

  /** Pulls payloads until one carries text. Returns '' when the source is exhausted. */
  const nextText = async (): Promise<string> => {
    while (true) {
      const next = await source.next();
      if (next.done) return '';
      const reported = readBindingUsage(next.value);
      if (reported) usage = reported;
      const content = textOf(next.value);
      if (content) return content;
    }
  };

  let first: string;
  try {
    first = await nextText();
  } catch (err) {
    await source.cancel();
    throw new WorkersAiFallbackFailedError('stream_error', err);
  }
  if (!first) throw new WorkersAiFallbackFailedError('no_text');

  const encoder = new TextEncoder();
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: OpenAiStreamChunk) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };
      const chunkOf = (delta: OpenAiStreamChunkChoice['delta'], finishReason: FallbackFinishReason | null): OpenAiStreamChunk => ({
        id: opts.id,
        object: 'chat.completion.chunk',
        created: opts.created,
        model: WORKERS_AI_FALLBACK_MODEL,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      });

      try {
        let content = first;
        while (content && !cancelled) {
          send(chunkOf({ content }, null));
          content = await nextText();
        }

        const finishReason = fallbackFinishReason(usage, opts.maxTokens);
        if (!cancelled) {
          const last = chunkOf({}, finishReason);
          if (usage) last.usage = usage;
          send(last);
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
        opts.onEnd?.(usage, finishReason);
      } catch (err) {
        if (cancelled) {
          // The client left. What it received was an answer.
          opts.onEnd?.(usage, fallbackFinishReason(usage, opts.maxTokens));
          return;
        }
        controller.error(err);
        opts.onFail?.();
      }
    },
    cancel() {
      cancelled = true;
      return source.cancel();
    },
  });
}

/**
 * Answers a chat-completions request with the fallback model, or refuses.
 *
 * The caller (the relay) decides when a fallback is allowed at all: only the groq
 * chat-completions path, and only for a missing hosted key, a network failure or an upstream 5xx.
 * This function decides whether the request itself can be answered faithfully.
 *
 * A thrown error means the binding failed or produced no text. A failure line is logged and the
 * caller returns 503. An empty or broken fallback is never sent as an answer.
 */
export async function runWorkersAiChatFallback(
  ai: Ai,
  body: unknown,
  context: WorkersAiFallbackContext,
): Promise<WorkersAiFallbackOutcome> {
  const planned = planWorkersAiChatFallback(body);
  if (!planned.ok) {
    logFallbackRefusal(context, planned);
    return { answered: false, refusal: planned.refusal };
  }
  const { messages, temperature, maxTokens, stream, topP, seed } = planned.plan;

  let aiResult: unknown;
  try {
    aiResult = await ai.run(WORKERS_AI_FALLBACK_MODEL, {
      messages,
      temperature,
      max_tokens: maxTokens,
      stream,
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(seed !== undefined ? { seed } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logFallbackFailure(context, stream, 'binding_error', false, message);
    throw new WorkersAiFallbackFailedError('binding_error', err);
  }

  const now = Date.now();
  const id = `chatcmpl-cf-${now}`;
  const created = Math.floor(now / 1000);

  if (stream) {
    let sse: ReadableStream<Uint8Array>;
    try {
      sse = await openFallbackSseStream(aiResult, {
        id,
        created,
        maxTokens,
        onEnd: (usage, finishReason) => logFallbackAnswer(context, true, usage, finishReason),
        onFail: () => logFallbackFailure(context, true, 'stream_error', true, 'stream error'),
      });
    } catch (err) {
      const failure = err instanceof WorkersAiFallbackFailedError ? err.failure : 'stream_error';
      const message = err instanceof Error ? err.message : String(err);
      logFallbackFailure(context, true, failure, false, message);
      throw err;
    }
    return { answered: true, streaming: true, model: WORKERS_AI_FALLBACK_MODEL, reason: context.reason, stream: sse };
  }

  const responseText = textOf(aiResult);
  // No text is not an answer. The caller returns the upstream's error instead of an empty reply.
  if (!responseText) {
    logFallbackFailure(context, false, 'no_text', false, 'no text');
    throw new WorkersAiFallbackFailedError('no_text');
  }

  const usage = readBindingUsage(aiResult);
  const finishReason = fallbackFinishReason(usage, maxTokens);
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
        finish_reason: finishReason,
      },
    ],
    ...(usage ? { usage } : {}),
    x_fallback: {
      provider: WORKERS_AI_FALLBACK_PROVIDER,
      model: WORKERS_AI_FALLBACK_MODEL,
      reason: context.reason,
    },
  };
  logFallbackAnswer(context, false, usage, finishReason);

  return {
    answered: true,
    streaming: false,
    model: WORKERS_AI_FALLBACK_MODEL,
    reason: context.reason,
    completion,
  };
}
