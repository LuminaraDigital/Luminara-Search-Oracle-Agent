import { AppView } from '../types';
import { parseUrlSwapRoute } from './urlSwapRouting';

/** Canonical public paths for crawlable marketing surfaces. */
export const MARKETING_PATH_BY_VIEW: Partial<Record<AppView, string>> = {
  [AppView.LANDING]: '/',
  [AppView.INFRASTRUCTURE]: '/how-it-works',
  [AppView.INTELLIGENCE]: '/ai',
  [AppView.WHY_US]: '/why',
  [AppView.PRICING]: '/pricing',
  [AppView.METHODOLOGY]: '/methodology',
  [AppView.SAMPLE_REPORT]: '/sample-report',
  [AppView.PRIVACY]: '/privacy',
  [AppView.TERMS]: '/terms',
  [AppView.FAQ]: '/faq',
  [AppView.CONTACT]: '/contact',
  [AppView.DELETE_ACCOUNT]: '/delete-account',
};

/** Path aliases accepted on entry (redirected to the canonical path via replaceState). */
const PATH_ALIASES: Record<string, AppView> = {
  '': AppView.LANDING,
  'how-it-works': AppView.INFRASTRUCTURE,
  how: AppView.INFRASTRUCTURE,
  infrastructure: AppView.INFRASTRUCTURE,
  modules: AppView.INFRASTRUCTURE,
  ai: AppView.INTELLIGENCE,
  intelligence: AppView.INTELLIGENCE,
  why: AppView.WHY_US,
  'why-us': AppView.WHY_US,
  pricing: AppView.PRICING,
  upgrade: AppView.PRICING,
  methodology: AppView.METHODOLOGY,
  'sample-report': AppView.SAMPLE_REPORT,
  dashboard: AppView.DASHBOARD,
  sample: AppView.SAMPLE_REPORT,
  privacy: AppView.PRIVACY,
  'privacy-policy': AppView.PRIVACY,
  'privacy.html': AppView.PRIVACY,
  faq: AppView.FAQ,
  help: AppView.FAQ,
  'faq.html': AppView.FAQ,
  contact: AppView.CONTACT,
  'contact.html': AppView.CONTACT,
  'delete-account': AppView.DELETE_ACCOUNT,
  terms: AppView.TERMS,
  'terms-of-service': AppView.TERMS,
  tos: AppView.TERMS,
  labs: AppView.ECOSYSTEM_HUB,
  lab: AppView.ECOSYSTEM_HUB,
  onboarding: AppView.BUSINESS_DNA,
  desktop: AppView.LANDING,
  'compare/profound': AppView.WHY_US,
  'compare/ahrefs': AppView.WHY_US,
  'compare/otterly': AppView.WHY_US,
  'compare/peec': AppView.WHY_US,
};

/** Legacy hash fragments that used to drive marketing views. */
const HASH_TO_VIEW: Record<string, AppView> = {
  LANDING: AppView.LANDING,
  INFRASTRUCTURE: AppView.INFRASTRUCTURE,
  INTELLIGENCE: AppView.INTELLIGENCE,
  WHY_US: AppView.WHY_US,
  PRICING: AppView.PRICING,
  METHODOLOGY: AppView.METHODOLOGY,
  SAMPLE_REPORT: AppView.SAMPLE_REPORT,
  PRIVACY: AppView.PRIVACY,
  'PRIVACY-POLICY': AppView.PRIVACY,
  TERMS: AppView.TERMS,
  'TERMS-OF-SERVICE': AppView.TERMS,
  TOS: AppView.TERMS,
  LABS: AppView.ECOSYSTEM_HUB,
  ONBOARDING: AppView.BUSINESS_DNA,
};

/**
 * Screens taken offline. LAUNCHPAD is still an AppView, so the generic hash
 * fallback would open a blank page. These hashes show Not Found instead.
 */
const OFFLINE_HASHES = new Set(['LAUNCHPAD']);

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

/** Matches `verify/r/<id>` (path or hash body). Must be checked before the generic `verify/` attestation route. */
const VERIFY_RECEIPT_RE = /^verify\/r\/([^/?#]+)$/i;
const VERIFY_AUDIT_RE = /^verify\/audit(?:\/([^/?#]+))?$/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

/** Receipt id from a /verify/audit/<id> path or hash, or '' when the page has no id. */
export function auditReceiptIdFromLocation(pathname: string, hash: string): string {
  const fromPath = pathname.replace(/^\/+|\/+$/g, '').match(VERIFY_AUDIT_RE);
  if (fromPath?.[1]) return safeDecode(fromPath[1]);
  const fromHash = hash.replace(/^#\/?/, '').replace(/\/+$/, '').match(VERIFY_AUDIT_RE);
  return fromHash?.[1] ? safeDecode(fromHash[1]) : '';
}

/** Receipt id from a /verify/r/<id> path or #verify/r/<id> hash, or '' when absent. */
export function receiptIdFromLocation(pathname: string, hash: string): string {
  const fromPath = pathname.replace(/^\/+|\/+$/g, '').match(VERIFY_RECEIPT_RE);
  if (fromPath?.[1]) return safeDecode(fromPath[1]);
  const fromHash = hash.replace(/^#\/?/, '').replace(/\/+$/, '').match(VERIFY_RECEIPT_RE);
  return fromHash?.[1] ? safeDecode(fromHash[1]) : '';
}

/** Resolve the initial app view from pathname + hash (cold-load deep links). */
export function resolveAppView(pathname: string, hash: string): AppView | null {
  const rawPath = pathname.replace(/^\/|\/$/g, '');
  const path = rawPath.toLowerCase();

  if (path.startsWith('share/')) return AppView.SHARED_REPORT;
  if (path === 'verify/audit' || path.startsWith('verify/audit/')) return AppView.VERIFY_AUDIT_RECEIPT;
  if (path.startsWith('verify/r/')) return AppView.VERIFY_RECEIPT;
  if (path.startsWith('verify/')) return AppView.VERIFY_ATTESTATION;
  if (path.startsWith('reports/')) return AppView.AGENT_REPORT;
  if (path.startsWith('compare/')) return AppView.WHY_US;

  const swap = parseUrlSwapRoute(rawPath);
  if (swap) return swap.view;

  if (isRootPathname(pathname)) {
    const h = hash.replace(/^#/, '').toUpperCase();
    if (h) {
      if (h === 'SETTINGS' || h === 'INTEGRATIONS' || h === 'KEYS') return null;
      if (h.startsWith('SHARE/')) return AppView.SHARED_REPORT;
      if (h === 'VERIFY/AUDIT' || h.startsWith('VERIFY/AUDIT/')) return AppView.VERIFY_AUDIT_RECEIPT;
      if (h.startsWith('VERIFY/R/')) return AppView.VERIFY_RECEIPT;
      if (h.startsWith('VERIFY/')) return AppView.VERIFY_ATTESTATION;
      if (h.startsWith('HARNESS')) return AppView.HARNESS;
      if (h.startsWith('ORACLE_AGENT')) return AppView.ORACLE_AGENT;
      if (h.startsWith('NOTEBOOK') || h.startsWith('STUDIO')) return AppView.NOTEBOOK;
      if (OFFLINE_HASHES.has(h)) return AppView.NOT_FOUND;
      if (h === 'INSTANT_AUDIT' || h.startsWith('INSTANT_AUDIT/')) return AppView.INSTANT_AUDIT;
      const fromMarketingHash = marketingViewFromHash(hash);
      if (fromMarketingHash) return fromMarketingHash;
      return (Object.values(AppView) as string[]).includes(h) ? (h as AppView) : null;
    }
  }

  const marketing = marketingViewFromPathname(pathname);
  if (marketing) return marketing;

  if (!isRootPathname(pathname)) return AppView.NOT_FOUND;

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
