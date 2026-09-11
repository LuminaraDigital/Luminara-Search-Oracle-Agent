/**
 * Coerce unknown API / Error values into a safe string for React children and UI copy.
 * Prevents React #31 crashes when vendors return `{ message, code, metadata }` (or similar)
 * and callers accidentally render the object instead of a string.
 */
export function toUserFacingText(value: unknown, fallback = 'Something went wrong'): string {
  return coerce(value, fallback, 0);
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
