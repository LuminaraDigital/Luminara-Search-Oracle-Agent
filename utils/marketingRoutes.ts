import { AppView } from '../types';
import { parseUrlSwapRoute } from './urlSwapRouting';

/** Canonical public paths for crawlable marketing surfaces. */
export const MARKETING_PATH_BY_VIEW: Partial<Record<AppView, string>> = {
  [AppView.LANDING]: '/',
  [AppView.INFRASTRUCTURE]: '/how-it-works',
  [AppView.INTELLIGENCE]: '/ai',
  [AppView.WHY_US]: '/why',
  [AppView.PRICING]: '/pricing',
  [AppView.PRIVACY]: '/privacy',
  [AppView.TERMS]: '/terms',
};

/** Path aliases accepted on entry (redirected to the canonical path via replaceState). */
const PATH_ALIASES: Record<string, AppView> = {
  '': AppView.LANDING,
  'how-it-works': AppView.INFRASTRUCTURE,
  infrastructure: AppView.INFRASTRUCTURE,
  modules: AppView.INFRASTRUCTURE,
  ai: AppView.INTELLIGENCE,
  intelligence: AppView.INTELLIGENCE,
  why: AppView.WHY_US,
  'why-us': AppView.WHY_US,
  pricing: AppView.PRICING,
  privacy: AppView.PRIVACY,
  'privacy-policy': AppView.PRIVACY,
  terms: AppView.TERMS,
  'terms-of-service': AppView.TERMS,
  tos: AppView.TERMS,
};

/** Legacy hash fragments that used to drive marketing views. */
const HASH_TO_VIEW: Record<string, AppView> = {
  LANDING: AppView.LANDING,
  INFRASTRUCTURE: AppView.INFRASTRUCTURE,
  INTELLIGENCE: AppView.INTELLIGENCE,
  WHY_US: AppView.WHY_US,
  PRICING: AppView.PRICING,
  PRIVACY: AppView.PRIVACY,
  'PRIVACY-POLICY': AppView.PRIVACY,
  TERMS: AppView.TERMS,
  'TERMS-OF-SERVICE': AppView.TERMS,
  TOS: AppView.TERMS,
};

export function isMarketingView(view: AppView): boolean {
  return view in MARKETING_PATH_BY_VIEW;
}

export function pathForMarketingView(view: AppView): string | null {
  return MARKETING_PATH_BY_VIEW[view] ?? null;
}

export function marketingViewFromPathname(pathname: string): AppView | null {
  const clean = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (clean in PATH_ALIASES) return PATH_ALIASES[clean];
  return null;
}

export function marketingViewFromHash(hash: string): AppView | null {
  const key = hash.replace(/^#/, '').toUpperCase();
  if (!key) return null;
  return HASH_TO_VIEW[key] ?? null;
}

function isRootPathname(pathname: string): boolean {
  const clean = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  return clean === '';
}

/** Resolve the initial app view from pathname + hash (cold-load deep links). */
export function resolveAppView(pathname: string, hash: string): AppView | null {
  const rawPath = pathname.replace(/^\/|\/$/g, '');
  const path = rawPath.toLowerCase();

  if (path.startsWith('share/')) return AppView.SHARED_REPORT;
  if (path.startsWith('verify/')) return AppView.VERIFY_ATTESTATION;
  if (path.startsWith('reports/')) return AppView.AGENT_REPORT;

  const swap = parseUrlSwapRoute(rawPath);
  if (swap) return swap.view;

  if (isRootPathname(pathname)) {
    const h = hash.replace(/^#/, '').toUpperCase();
    if (h) {
      if (h === 'SETTINGS' || h === 'INTEGRATIONS' || h === 'KEYS') return null;
      if (h.startsWith('SHARE/')) return AppView.SHARED_REPORT;
      if (h.startsWith('VERIFY/')) return AppView.VERIFY_ATTESTATION;
      if (h.startsWith('HARNESS')) return AppView.HARNESS;
      if (h.startsWith('ORACLE_AGENT')) return AppView.ORACLE_AGENT;
      if (h.startsWith('NOTEBOOK') || h.startsWith('STUDIO')) return AppView.NOTEBOOK;
      const fromMarketingHash = marketingViewFromHash(hash);
      if (fromMarketingHash) return fromMarketingHash;
      return (Object.values(AppView) as string[]).includes(h) ? (h as AppView) : null;
    }
  }

  const marketing = marketingViewFromPathname(pathname);
  if (marketing) return marketing;

  return null;
}

/**
 * Prefer a path URL for marketing views. Product shells keep hash fragments
 * so existing deep links (#settings, #notebook) keep working.
 * Leaving a marketing path or path deep-link clears the pathname to `/`.
 */
export function urlForView(
  view: AppView,
  opts?: { clearPathDeepLink?: boolean; leaveMarketingPath?: boolean },
): string {
  const marketingPath = pathForMarketingView(view);
  if (marketingPath) return marketingPath;
  const hash = `#${view.toLowerCase()}`;
  if (opts?.clearPathDeepLink || opts?.leaveMarketingPath) return `/${hash}`;
  return hash;
}
