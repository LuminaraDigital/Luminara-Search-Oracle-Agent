/**
 * The Worker answers a hosted Groq chat call with NVIDIA or Workers AI when Groq cannot
 * (see worker/nvidiaChatFallback.ts). It marks such a reply with response headers and, on a JSON
 * reply, an `x_fallback` field. This module reads that marker and words the line the chat shows,
 * so a founder always sees which model wrote what they are reading.
 *
 * Hosted Groq chat falls back on the server. The client keeps the text and this marker, including
 * Instant Audit, which does not send `x-accept-fallback`. `FallbackAnswerNotAcceptedError` remains
 * for a caller that rejects a fallback reply itself.
 */
import type { FallbackAnswerInfo } from '../../types';

export const FALLBACK_ANSWER_LABEL = 'Answered by a fallback model';
/** Shown only when the Worker reported `finish_reason: 'length'`, which it does only on the binding's own token count. */
export const FALLBACK_ANSWER_CUT_OFF_NOTE = 'This answer reached the length limit of the fallback model and may be incomplete.';

const MAX_FIELD_CHARS = 120;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_FIELD_CHARS) : '';
}

/**
 * Reads the fallback marker from a provider response. Headers come first because they are there
 * for a streamed reply too; the JSON body is the second source. Returns undefined for a reply
 * the asked engine wrote itself.
 */
export function readFallbackAnswer(
  headers: Pick<Headers, 'get'> | null | undefined,
  body?: unknown,
): FallbackAnswerInfo | undefined {
  const marker = (body as { x_fallback?: unknown } | null | undefined)?.x_fallback;
  const fromBody = marker && typeof marker === 'object' ? (marker as Record<string, unknown>) : null;
  if (!clean(headers?.get('x-provider-fallback')) && !fromBody) return undefined;

  const model =
    clean(headers?.get('x-provider-fallback-model')) ||
    clean(fromBody?.model) ||
    (fromBody ? clean((body as { model?: unknown }).model) : '');
  const reason = clean(headers?.get('x-provider-fallback-reason')) || clean(fromBody?.reason);
  const providerName = clean(headers?.get('x-provider-fallback')) || clean(fromBody?.provider);
  if (providerName === 'nvidia') {
    return reason ? { model, provider: 'nvidia', reason } : { model, provider: 'nvidia' };
  }
  return reason ? { model, reason } : { model };
}

/**
 * Thrown when the fallback model answered a call that did not ask to accept a fallback reply.
 * The asked engine did not answer, so callers treat this like that engine being down: the
 * failover service moves to the next engine, and a direct caller reports the failure. The
 * fallback's text is not on this error and is never handed to the caller.
 */
export class FallbackAnswerNotAcceptedError extends Error {
  readonly code = 'FALLBACK_ANSWER_NOT_ACCEPTED';

  constructor(
    engineName: string,
    readonly fallback: FallbackAnswerInfo,
  ) {
    super(
      `${engineName} did not answer. A fallback model${fallback.model ? ` (${fallback.model})` : ''} replied in its place, and this request does not use fallback replies.`,
    );
    this.name = 'FallbackAnswerNotAcceptedError';
  }
}

/**
 * The line shown with a reply the fallback wrote: the label, the model's name, and a note when
 * the reply was reported as cut off. Returns null for any other reply, so the caller renders nothing.
 */
export function fallbackAnswerLine(info: FallbackAnswerInfo | null | undefined): string | null {
  if (!info || typeof info !== 'object') return null;
  const model = clean(info.model);
  const named = info.provider === 'nvidia' ? (model ? `NVIDIA (${model})` : 'NVIDIA') : model;
  const line = named ? `${FALLBACK_ANSWER_LABEL}: ${named}` : FALLBACK_ANSWER_LABEL;
  return info.truncated === true ? `${line}. ${FALLBACK_ANSWER_CUT_OFF_NOTE}` : line;
}
