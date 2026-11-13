/**
 * First-party A/B assignment and deterministic bucketing for Hermes epistemic stance
 * and bounded JSON contract patterns (`EPISTEMIC_AB_ENABLED`).
 *
 * Follows the repository's `heroExperiment.ts` conventions (cookie format, bot filter,
 * kill-switch semantics) extended with deterministic FNV-1a account bucketing so headless
 * Worker runs (`executeDreamRun`) and HTTP/SSE turns (`oracleChat`) assign the exact same
 * variant for a given `accountId`.
 */

import { requestLooksLikeBot } from '../marketing/heroExperiment';

export const EPISTEMIC_AB_COOKIE = 'lx_epistemic';
export const EPISTEMIC_AB_HEADER = 'x-luminara-epistemic-variant';
export const EPISTEMIC_AB_QUERY_PARAM = 'epistemic';
export const EPISTEMIC_AB_MAX_AGE_SEC = 180 * 24 * 60 * 60;

export type EpistemicVariant = 'baseline' | 'treatment';

export type EpistemicAssignmentSource =
  | 'disabled'
  | 'override'
  | 'bot'
  | 'account'
  | 'cookie'
  | 'random';

export interface EpistemicAssignment {
  enabled: boolean;
  variant: EpistemicVariant;
  setCookie: string | null;
  source: EpistemicAssignmentSource;
  trackExposure: boolean;
}

const VARIANTS: readonly EpistemicVariant[] = ['baseline', 'treatment'];

export function parseEpistemicVariant(raw: string | null | undefined): EpistemicVariant | null {
  const value = raw?.trim().toLowerCase();
  return VARIANTS.find((variant) => variant === value) ?? null;
}

export function epistemicAbEnabled(
  env: { EPISTEMIC_AB_ENABLED?: string } | null | undefined,
): boolean {
  return String(env?.EPISTEMIC_AB_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export function epistemicVariantFromCookie(
  header: string | null | undefined,
): EpistemicVariant | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== EPISTEMIC_AB_COOKIE) continue;
    try {
      return parseEpistemicVariant(decodeURIComponent(part.slice(eq + 1).trim()));
    } catch {
      return null;
    }
  }
  return null;
}

export function epistemicSetCookie(variant: EpistemicVariant, secure = true): string {
  const secureAttr = secure ? '; Secure' : '';
  return `${EPISTEMIC_AB_COOKIE}=${variant}; Max-Age=${EPISTEMIC_AB_MAX_AGE_SEC}; Path=/; SameSite=Lax${secureAttr}`;
}

/** Deterministic 32-bit FNV-1a hash for stable 50/50 account bucketing across surfaces. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function bucketAccountVariant(accountId: string): EpistemicVariant {
  return (fnv1a32(`epistemic_v1:${accountId.trim()}`) & 1) === 1 ? 'treatment' : 'baseline';
}

function extractRequestOverride(request: Request | null | undefined): EpistemicVariant | null {
  if (!request) return null;
  const headerOverride = parseEpistemicVariant(request.headers.get(EPISTEMIC_AB_HEADER));
  if (headerOverride) return headerOverride;
  try {
    const url = new URL(request.url);
    return parseEpistemicVariant(url.searchParams.get(EPISTEMIC_AB_QUERY_PARAM));
  } catch {
    return null;
  }
}

export function assignEpistemicVariant(input: {
  env: { EPISTEMIC_AB_ENABLED?: string } | null | undefined;
  accountId?: string | null;
  request?: Request | null;
  override?: string | null;
  random?: () => number;
}): EpistemicAssignment {
  if (!epistemicAbEnabled(input.env)) {
    return {
      enabled: false,
      variant: 'baseline',
      setCookie: null,
      source: 'disabled',
      trackExposure: false,
    };
  }

  const isSecure = !input.request?.url.startsWith('http://');
  const directOverride = parseEpistemicVariant(input.override) ?? extractRequestOverride(input.request);
  if (directOverride) {
    return {
      enabled: true,
      variant: directOverride,
      setCookie: input.request ? epistemicSetCookie(directOverride, isSecure) : null,
      source: 'override',
      trackExposure: true,
    };
  }

  const userAgent = input.request?.headers.get('user-agent')?.trim() ?? '';
  if (userAgent.length > 0 && requestLooksLikeBot(userAgent)) {
    return {
      enabled: true,
      variant: 'baseline',
      setCookie: null,
      source: 'bot',
      trackExposure: false,
    };
  }

  const cleanAccountId = input.accountId?.trim() ?? '';
  if (cleanAccountId && cleanAccountId !== 'guest') {
    return {
      enabled: true,
      variant: bucketAccountVariant(cleanAccountId),
      setCookie: null,
      source: 'account',
      trackExposure: true,
    };
  }

  const cookieHeader = input.request?.headers.get('cookie') ?? null;
  const existingCookie = epistemicVariantFromCookie(cookieHeader);
  if (existingCookie) {
    return {
      enabled: true,
      variant: existingCookie,
      setCookie: null,
      source: 'cookie',
      trackExposure: true,
    };
  }

  if (!input.request || requestLooksLikeBot(userAgent)) {
    return {
      enabled: true,
      variant: 'baseline',
      setCookie: null,
      source: 'bot',
      trackExposure: false,
    };
  }

  const roll = (input.random ?? Math.random)();
  const variant: EpistemicVariant = roll < 0.5 ? 'treatment' : 'baseline';
  return {
    enabled: true,
    variant,
    setCookie: epistemicSetCookie(variant, isSecure),
    source: 'random',
    trackExposure: true,
  };
}
