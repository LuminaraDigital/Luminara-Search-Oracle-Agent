/** Normalize a website/domain string to a bare host for project identity. */
export function normalizeProjectDomain(input: string): string {
  let raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const host = new URL(raw).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .split('?')[0]
      .trim();
  }
}

export function randomId(prefix: string, bytes = 12): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

export function isoDateUTC(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}
