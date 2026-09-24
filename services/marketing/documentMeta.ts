import { AppView } from '../../types';
import {
  DEFAULT_OG_IMAGE,
  MARKETING_ORIGIN,
  MARKETING_SHELL_BY_PATH,
  type MarketingShellMeta,
} from './pageMeta';
import { MARKETING_PATH_BY_VIEW } from '../../utils/marketingRoutes';

const JSON_LD_ID = 'luminara-marketing-jsonld';

const VIEW_TO_SHELL: Partial<Record<AppView, string>> = {
  [AppView.LANDING]: '/',
  [AppView.INFRASTRUCTURE]: '/how-it-works',
  [AppView.INTELLIGENCE]: '/ai',
  [AppView.WHY_US]: '/why',
  [AppView.PRICING]: '/pricing',
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

function ensureJsonLd(data: Record<string, unknown>) {
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
  const url = page.path === '/' ? `${MARKETING_ORIGIN}/` : `${MARKETING_ORIGIN}${page.path}`;
  document.title = page.title;
  ensureMeta('name', 'description', page.description);
  ensureMeta('property', 'og:title', page.title);
  ensureMeta('property', 'og:description', page.description);
  ensureMeta('property', 'og:url', url);
  ensureMeta('property', 'og:type', 'website');
  ensureMeta('property', 'og:image', DEFAULT_OG_IMAGE);
  ensureCanonical(url);
  ensureJsonLd(page.jsonLd);
}

const DEFAULT_APP_META = {
  title: 'Luminara Suite',
  description:
    'Luminara Suite audits how your brand shows up in Google, AI Overviews, ChatGPT and Perplexity.',
};

/** Update document head for marketing views. Product shells get a short app title. */
export function applyDocumentMetaForView(view: AppView): void {
  if (typeof document === 'undefined') return;

  const shellPath = VIEW_TO_SHELL[view];
  const page = shellPath ? MARKETING_SHELL_BY_PATH[shellPath] : undefined;
  if (page) {
    applyShell(page);
    return;
  }

  document.title = DEFAULT_APP_META.title;
  ensureMeta('name', 'description', DEFAULT_APP_META.description);
  ensureMeta('property', 'og:title', DEFAULT_APP_META.title);
  ensureMeta('property', 'og:description', DEFAULT_APP_META.description);
  const canonicalPath = MARKETING_PATH_BY_VIEW[AppView.LANDING] || '/';
  ensureCanonical(`${MARKETING_ORIGIN}${canonicalPath}`);
}
