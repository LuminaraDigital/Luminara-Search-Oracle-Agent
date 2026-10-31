/**
 * A typed link as an absolute http(s) URL, or null. A bare host gets https://.
 * Any other scheme (ftp:, javascript:, mailto:) is rejected, never re-prefixed.
 */
export function toHttpUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[^:/]+:\d/.test(value);
  try {
    const url = new URL(hasScheme ? value : `https://${value}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
