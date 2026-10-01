/**
 * Public hostname check shared by the Worker SSRF guard, Telegram deep links,
 * teaser domains, and Instant Audit targets.
 * DNS-shaped, public suffix, not an IP literal, not localhost or special-use.
 */

export function parseIpv4(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;

/**
 * Validates a hostname a user asked us to probe or prefill.
 * Returns the lower-cased hostname, or null when the host is not public.
 */
export function safePublicHostname(input: string): string | null {
  let host = String(input || '').trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^[^@]*@/, '').replace(/:\d+$/, '');
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host || host.length > 253) return null;
  if (parseIpv4(host) || host.includes(':') || host.includes('[')) return null;
  if (!HOSTNAME_RE.test(host)) return null;
  if (host === 'localhost' || host.endsWith('.localhost')) return null;
  if (/\.(local|internal|intranet|home|lan|corp|arpa|onion|test|example|invalid)$/.test(host)) return null;
  return host;
}
