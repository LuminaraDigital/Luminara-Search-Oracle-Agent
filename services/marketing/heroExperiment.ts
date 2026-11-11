/**
 * Homepage hero experiment. The worker assigns lx_hero on the first HTML
 * response for /. React reads that same cookie. See docs/runbooks/hero-ab.md.
 */

export const HERO_AB_COOKIE = 'lx_hero';
export const HERO_AB_MAX_AGE_SEC = 180 * 24 * 60 * 60;
export const HERO_EXPOSURE_STORAGE_KEY = 'lx_hero_exposed';

export type HeroVariant = 'answer' | 'employee';

const VARIANTS: readonly HeroVariant[] = ['answer', 'employee'];

/** A cookieless crawler stays on employee and is not assigned. */
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|wget|curl/i;

export function parseHeroVariant(raw: string | null | undefined): HeroVariant | null {
  const value = raw?.trim().toLowerCase();
  return VARIANTS.find((variant) => variant === value) ?? null;
}

export function heroAbEnabled(env: { HERO_AB_ENABLED?: string } | null | undefined): boolean {
  return String(env?.HERO_AB_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export function heroVariantFromCookie(header: string | null | undefined): HeroVariant | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== HERO_AB_COOKIE) continue;
    try {
      return parseHeroVariant(decodeURIComponent(part.slice(eq + 1).trim()));
    } catch {
      return null;
    }
  }
  return null;
}

export function heroSetCookie(variant: HeroVariant): string {
  return `${HERO_AB_COOKIE}=${variant}; Max-Age=${HERO_AB_MAX_AGE_SEC}; Path=/; SameSite=Lax; Secure`;
}

export function requestLooksLikeBot(userAgent: string | null | undefined): boolean {
  const ua = userAgent?.trim() ?? '';
  if (!ua) return true;
  return BOT_UA.test(ua);
}

export interface HeroAssignment {
  variant: HeroVariant;
  setCookie: string | null;
}

/**
 * Kill switch off: employee, and the cookie is left alone.
 * A valid cookie is kept. ?hero=answer or ?hero=employee replaces it while the flag is on.
 * Otherwise a non-bot is assigned once, 50/50.
 */
export function assignHomeHero(input: {
  enabled: boolean;
  cookieHeader: string | null;
  heroQuery: string | null;
  userAgent: string | null;
  random?: () => number;
}): HeroAssignment {
  if (!input.enabled) return { variant: 'employee', setCookie: null };
  const override = parseHeroVariant(input.heroQuery);
  if (override) return { variant: override, setCookie: heroSetCookie(override) };
  const existing = heroVariantFromCookie(input.cookieHeader);
  if (existing) return { variant: existing, setCookie: null };
  if (requestLooksLikeBot(input.userAgent)) return { variant: 'employee', setCookie: null };
  const roll = (input.random ?? Math.random)();
  const variant: HeroVariant = roll < 0.5 ? 'answer' : 'employee';
  return { variant, setCookie: heroSetCookie(variant) };
}

/** One exposure per stored variant. Null means do not send. */
export function claimHeroExposure(input: {
  experimentOn: boolean;
  variant: HeroVariant;
  seen: string | null;
}): HeroVariant | null {
  if (!input.experimentOn) return null;
  if (input.seen === input.variant) return null;
  return input.variant;
}

/** Marks the document so React can tell the kill switch from a missing cookie. */
export function stampHeroAbFlag(html: string, enabled: boolean): string {
  const value = enabled ? 'on' : 'off';
  return html.replace(/<html\b([^>]*)>/i, (_full, attrs: string) => {
    const rest = attrs ?? '';
    if (/\bdata-hero-ab="/.test(rest)) {
      return `<html${rest.replace(/\bdata-hero-ab="[^"]*"/, `data-hero-ab="${value}"`)}>`;
    }
    return `<html data-hero-ab="${value}"${rest}>`;
  });
}
