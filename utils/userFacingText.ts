/**
 * Coerce unknown API / Error values into a safe string for React children and UI copy.
 * Prevents React #31 crashes when vendors return `{ message, code, metadata }` (or similar)
 * and callers accidentally render the object instead of a string.
 */
export function toUserFacingText(value: unknown, fallback = 'Something went wrong'): string {
  const raw = coerce(value, fallback, 0);
  return sanitizeErrorMessage(raw, fallback);
}

function sanitizeErrorMessage(msg: string, fallback: string): string {
  if (!msg) return fallback;

  // Normalised AI unavailable / zero-charge string
  if (msg.includes('AI_UNAVAILABLE') || msg.includes('Nothing was charged')) {
    return 'Luminara could not answer right now. Nothing was charged. Try again in a minute.';
  }

  // Raw JSON error strings (e.g. {"error":{"message":...}} or {"code":...})
  const trimmed = msg.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.error?.message) {
        return sanitizeErrorMessage(parsed.error.message, fallback);
      }
      if (parsed?.message) {
        return sanitizeErrorMessage(parsed.message, fallback);
      }
    } catch {
      // not parseable
    }
    return 'The AI service encountered an error. Please try again shortly.';
  }

  // Credit / payment required / 402
  if (
    msg.includes('402') ||
    msg.includes('HOSTED_PROVIDER_DEPLETED') ||
    /payment required/i.test(msg) ||
    /credit balance/i.test(msg)
  ) {
    return 'The AI provider is temporarily unavailable due to upstream credit limits. Add your own API key in Settings to continue.';
  }

  // Request too large / 413 / tokens exceeded
  if (
    msg.includes('413') ||
    /request too large/i.test(msg) ||
    /rate_limit_exceeded.*tokens/i.test(msg) ||
    /tpm limit/i.test(msg)
  ) {
    return 'Your question and context were too long for the engine. Please try a shorter question or start a fresh thread.';
  }

  // Rate limits / 429
  if (msg.includes('429') || /rate limit/i.test(msg)) {
    return 'AI services are currently busy. Please try again shortly or configure an API key in Settings.';
  }

  // Generic FreeLLMAPI / Busy
  if (msg.includes('FreeLLMAPI') || (msg.includes('native inference providers') && msg.includes('failed'))) {
    return 'AI services are currently busy or unavailable. Please try again shortly or configure an API key in Settings.';
  }

  // Groq inference error / Groq down
  if (/Groq inference error/i.test(msg) || /Groq stream error/i.test(msg) || /Groq down/i.test(msg)) {
    return 'The AI service is temporarily unavailable. Please try again in a moment or add your own key in Settings.';
  }

  // General provider redactions for UI safety: sanitize provider names and raw status codes
  let clean = msg;
  // If clean contains raw JSON fragments, sanitize them out
  if (clean.includes('{"') && clean.includes('"}')) {
    clean = clean.replace(/\{"[^"]+":[^}]+\}/g, '').trim();
    if (!clean) return 'The AI service encountered an error. Please try again.';
  }

  return clean;
}

function coerce(value: unknown, fallback: string, depth: number): string {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'symbol') return value.description || fallback;
  if (value instanceof Error) {
    const msg = coerce(value.message, '', depth + 1);
    return msg || fallback;
  }
  if (typeof value !== 'object' || depth > 4) return fallback;

  const obj = value as Record<string, unknown>;

  if ('message' in obj) {
    const msg = coerce(obj.message, '', depth + 1);
    if (msg) {
      const code =
        typeof obj.code === 'string' || typeof obj.code === 'number' ? ` (${obj.code})` : '';
      return `${msg}${code}`;
    }
  }

  if ('error' in obj) {
    const nested = coerce(obj.error, '', depth + 1);
    if (nested) {
      const code =
        typeof obj.code === 'string' || typeof obj.code === 'number' ? ` (${obj.code})` : '';
      return `${nested}${code}`;
    }
  }

  if ('reason' in obj) {
    const nested = coerce(obj.reason, '', depth + 1);
    if (nested) return nested;
  }

  if ('detail' in obj) {
    const nested = coerce(obj.detail, '', depth + 1);
    if (nested) return nested;
  }

  try {
    const json = JSON.stringify(value);
    if (json && json !== '{}' && json !== '[]') return json.slice(0, 240);
  } catch {
    /* circular or non-serializable */
  }
  return fallback;
}
