/**
 * The Worker answers a hosted Groq chat call with its fallback model when Groq itself cannot
 * (see worker/workersAiFallback.ts). It marks such a reply with response headers and, on a JSON
 * reply, an `x_fallback` field. This module reads that marker and words the line the chat shows,
 * so a founder always sees which model wrote what they are reading.
 */
import type { FallbackAnswerInfo } from '../../types';

export const FALLBACK_ANSWER_LABEL = 'Answered by a fallback model';

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
  return reason ? { model, reason } : { model };
}

/**
 * The line shown with a reply the fallback wrote: the label and the model's name.
 * Returns null for any other reply, so the caller renders nothing.
 */
export function fallbackAnswerLine(info: FallbackAnswerInfo | null | undefined): string | null {
  if (!info || typeof info !== 'object') return null;
  const model = clean(info.model);
  return model ? `${FALLBACK_ANSWER_LABEL}: ${model}` : FALLBACK_ANSWER_LABEL;
}
