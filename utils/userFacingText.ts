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
  if (msg.includes('402') || msg.includes('HOSTED_PROVIDER_DEPLETED') || /payment required/i.test(msg)) {
    return 'The AI provider is temporarily unavailable due to upstream credit limits. Add your own API key in Settings to continue.';
  }
  if (msg.includes('FreeLLMAPI') || (msg.includes('native inference providers') && msg.includes('failed'))) {
    return 'AI services are currently busy or unavailable. Please try again shortly or configure an API key in Settings.';
  }
  if (/Groq inference error/i.test(msg)) {
    return 'The hosted Groq service is temporarily unavailable. Please try again in a moment or add your own key in Settings.';
  }
  return msg;
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
    if (nested) return nested;
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
