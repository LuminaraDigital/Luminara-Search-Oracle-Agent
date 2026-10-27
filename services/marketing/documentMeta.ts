import { AppView } from '../../types';
import {
  DASHBOARD_TAB_TITLE,
  DEFAULT_OG_IMAGE,
  ENQUIRY_DESK_TAB_TITLE,
  MARKETING_ORIGIN,
  MARKETING_SHELL_BY_PATH,
  instantAuditTabTitle,
  marketingShellKey,
  perDomainShell,
  checkShell,
  type MarketingShellMeta,
} from './pageMeta';
import { HONEST_VISIBILITY_PROMISE } from './engineCoverage';
import { MARKETING_PATH_BY_VIEW } from '../../utils/marketingRoutes';
import { parseUrlSwapRoute } from '../../utils/urlSwapRouting';

const JSON_LD_ID = 'luminara-marketing-jsonld';

const VIEW_TO_SHELL: Partial<Record<AppView, string>> = {
  [AppView.LANDING]: '/',
  [AppView.INFRASTRUCTURE]: '/how-it-works',
  [AppView.INTELLIGENCE]: '/ai',
  [AppView.WHY_US]: '/why',
  [AppView.PRICING]: '/pricing',
  [AppView.METHODOLOGY]: '/methodology',
  [AppView.SAMPLE_REPORT]: '/sample-report',
};

function ensureMeta(attr: 'name' | 'property', key: string, content: string) {
  const selector = attr === 'name' ? `meta[name="${key}"]` : `meta[property="${key}"]`;
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function ensureCanonical(href: string) {
  let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = href;
}

function ensureRobots(content: string | null) {
  const existing = document.head.querySelector('meta[name="robots"]');
  if (!content) {
    existing?.remove();
    return;
  }
  const el = existing instanceof HTMLMetaElement ? existing : document.createElement('meta');
  if (!(existing instanceof HTMLMetaElement)) {
    el.setAttribute('name', 'robots');
    document.head.appendChild(el);
  }
  el.content = content;
}

export function canonicalHrefForPage(page: MarketingShellMeta): string {
  return page.path === '/' ? `${MARKETING_ORIGIN}/` : `${MARKETING_ORIGIN}${page.path}`;
}

function ensureJsonLd(data: Record<string, unknown>) {
  const legacyScript = document.getElementById('luminara-static-jsonld');
  if (legacyScript) {
    legacyScript.remove();
  }
  let script = document.getElementById(JSON_LD_ID) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = JSON_LD_ID;
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(data);
}

function applyShell(page: MarketingShellMeta) {
  const url = canonicalHrefForPage(page);
  document.title = page.title;
  ensureMeta('name', 'description', page.description);
  ensureMeta('property', 'og:title', page.title);
  ensureMeta('property', 'og:description', page.description);
  ensureMeta('property', 'og:url', url);
  ensureMeta('property', 'og:type', 'website');
  ensureMeta('property', 'og:image', DEFAULT_OG_IMAGE);
  ensureCanonical(url);
  ensureRobots(page.robots ?? null);
  ensureJsonLd(page.jsonLd);
}

const DEFAULT_APP_META = {
  title: 'Luminara Suite',
  description: HONEST_VISIBILITY_PROMISE,
};

function shellFor(pathname: string, view: AppView): MarketingShellMeta | undefined {
  const path = pathname || '/';
  // A shared check renders the landing view but keeps its own noindex meta.
  const sharedCheck = checkShell(path);
  if (sharedCheck) return sharedCheck;
  // `/` plus a hash is a product view. A real path such as /compare/profound wins over the shared view.
  const key = path === '/' ? null : marketingShellKey(path);
  const shellPath = key ?? VIEW_TO_SHELL[view];
  const shell = shellPath ? MARKETING_SHELL_BY_PATH[shellPath] : undefined;
  if (shell) return shell;
  return perDomainShell(path) ?? undefined;
}

/** Canonical the client will set. Per-domain audits point at themselves. Other app shells stay on the homepage. */
export function resolveCanonicalHref(pathname: string, view: AppView): string {
  const page = shellFor(pathname, view);
  if (page) return canonicalHrefForPage(page);
  return `${MARKETING_ORIGIN}${MARKETING_PATH_BY_VIEW[AppView.LANDING] || '/'}`;
}

/** noindex for per-domain audits. Null means the page may be indexed. */
export function resolveRobotsDirective(pathname: string, view: AppView): string | null {
  return shellFor(pathname, view)?.robots ?? null;
}

/** Browser tab title for a path and view. Marketing shells, dashboard, and Instant Audit included. */
export function resolveDocumentTitle(pathname: string, view: AppView): string {
  const page = shellFor(pathname, view);
  if (page) return page.title;
  if (view === AppView.DASHBOARD) return DASHBOARD_TAB_TITLE;
  if (view === AppView.ENQUIRY_DESK) return ENQUIRY_DESK_TAB_TITLE;
  if (view === AppView.INSTANT_AUDIT) return instantAuditTabTitle(parseUrlSwapRoute(pathname)?.targetUrl);
  return DEFAULT_APP_META.title;
}

/** Update document head for marketing views. Product shells get a short app title. */
export function applyDocumentMetaForView(view: AppView): void {
  if (typeof document === 'undefined') return;

  const path = typeof location !== 'undefined' ? location.pathname : '/';
  const page = shellFor(path, view);
  if (page) {
    applyShell(page);
    return;
  }

  document.title = resolveDocumentTitle(path, view);
  ensureMeta('name', 'description', DEFAULT_APP_META.description);
  ensureMeta('property', 'og:title', DEFAULT_APP_META.title);
  ensureMeta('property', 'og:description', DEFAULT_APP_META.description);
  ensureCanonical(resolveCanonicalHref(path, view));
  ensureRobots(resolveRobotsDirective(path, view));
}
