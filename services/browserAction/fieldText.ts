/**
 * TYPE_TEXT helper: strict JSON {"text": string} gate (Jev field_text port).
 */
import type { FieldContext, HistoryEntry, LlmFn, ObservePayload, ObservedAction } from './types';
import { ValueError } from './choose';

const TEXT_SYSTEM =
  'Return exactly one JSON object: {"text":"<value to type>"}. No other keys. Non-empty string, max 2000 characters. Do not invent credentials or secrets.';

export function fieldContext(
  goal: string,
  action: ObservedAction,
  page: Pick<ObservePayload, 'title' | 'text'>,
  history: HistoryEntry[],
): FieldContext {
  return {
    goal,
    field: {
      label: action.label,
      role: action.role,
      value: action.value,
    },
    page: {
      title: page.title,
      text: page.text.slice(0, 6000),
    },
    recent_actions: history.slice(-6).map((h) => ({
      action: h.action,
      text: h.text,
    })),
  };
}

/**
 * Require exactly {"text": string} non-empty and length <= 2000.
 */
export function parseFieldTextResponse(raw: unknown): string {
  let output: Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const trimmed = raw.trim();
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      const slice = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
      output = JSON.parse(slice) as Record<string, unknown>;
    } catch {
      throw new ValueError('Text helper returned no valid field value; nothing typed.');
    }
  } else if (raw && typeof raw === 'object') {
    output = raw as Record<string, unknown>;
  } else {
    throw new ValueError('Text helper returned no valid field value; nothing typed.');
  }

  const keys = Object.keys(output);
  const value = output.text;
  if (
    keys.length !== 1 ||
    keys[0] !== 'text' ||
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 2000
  ) {
    throw new ValueError('Text helper returned no valid field value; nothing typed.');
  }
  return value;
}

export async function fieldTextWithLlm(
  context: FieldContext,
  llmFn: LlmFn,
): Promise<{ text: string; raw: string }> {
  const prompt = [
    TEXT_SYSTEM,
    '',
    'Context:',
    JSON.stringify(context),
  ].join('\n');
  const raw = await llmFn(prompt);
  const text = parseFieldTextResponse(raw);
  return { text, raw };
}

/** Stable cache key for pending TYPE_TEXT helper input (entire context must match). */
export function fieldContextCacheKey(context: FieldContext): string {
  return JSON.stringify(context);
}
