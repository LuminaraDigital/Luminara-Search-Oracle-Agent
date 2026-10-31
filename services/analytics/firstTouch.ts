/**
 * First-touch attribution: how a visitor first reached the site, kept in this browser.
 * A utm tag wins, else the referring host, else "direct". No full URLs and no share tokens are kept.
 */

/** Where a visitor came from, in the shape attached to funnel events. */
export interface FirstTouch {
  source: string;
  medium?: string;
  campaign?: string;
  landingPath: string;
  at: number;
}

const STORAGE_KEY = 'luminara_first_touch';
/** Only these routes keep their second path segment; others (e.g. /share/<token>) keep the first only. */
const DETAILED_PATHS = new Set(['check', 'free-tools', 'compare']);
/** Our own hosts and the sign-in and checkout redirects: returning from these is not a new channel. */
const INTERNAL_REFERRERS = /(^|\.)(luminarasuite\.com|firebaseapp\.com|stripe\.com|accounts\.google\.com)$/;

const siteHost = (host: string): string => host.replace(/^www\./, '').toLowerCase();

export function readTouch(href: string, referrer: string, now = Date.now()): FirstTouch {
  const url = new URL(href);
  const tag = (key: string) => url.searchParams.get(key)?.trim().slice(0, 100) || undefined;
  let referrerHost: string | undefined;
  try {
    const host = siteHost(new URL(referrer).hostname);
    if (host && host !== siteHost(url.hostname) && !INTERNAL_REFERRERS.test(host)) referrerHost = host;
  } catch {
    // No referrer, or not a URL
  }
  const [first = '', second] = url.pathname.split('/').filter(Boolean);
  const landingPath = `/${first}${second && DETAILED_PATHS.has(first) ? `/${second}` : ''}`.slice(0, 120);
  return {
    source: tag('utm_source') ?? referrerHost ?? 'direct',
    medium: tag('utm_medium'),
    campaign: tag('utm_campaign'),
    landingPath,
    at: now,
  };
}

/** The first non-direct touch wins. A direct visit is kept only until a tagged or referred visit replaces it. */
export function pickFirstTouch(stored: FirstTouch | null, current: FirstTouch): FirstTouch {
  if (!stored) return current;
  if (stored.source === 'direct' && current.source !== 'direct') return current;
  return stored;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage ?? null : null;
  } catch {
    return null;
  }
}

export function loadFirstTouch(): FirstTouch | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof (parsed as FirstTouch).source === 'string' ? (parsed as FirstTouch) : null;
  } catch {
    return null;
  }
}

/** Call once per page load, before the app rewrites the URL. */
export function rememberFirstTouch(): void {
  try {
    const store = storage();
    if (!store) return;
    const stored = loadFirstTouch();
    const next = pickFirstTouch(stored, readTouch(window.location.href, document.referrer));
    if (next !== stored) store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or URL unavailable
  }
}

export function clearFirstTouch(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}
