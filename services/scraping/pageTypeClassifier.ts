/**
 * Page-type classifier for sitewide SEO/AEO/GEO evidence packs.
 * Pure URL + title heuristics (no network). Used to budget crawl slots
 * across home, about, product, FAQ, location, blog, legal, and other.
 */

export type PageType =
  | 'home'
  | 'about'
  | 'product'
  | 'pricing'
  | 'faq'
  | 'blog'
  | 'location'
  | 'contact'
  | 'legal'
  | 'other';

export interface ClassifiedUrl {
  url: string;
  pageType: PageType;
  /** Higher = scrape sooner within the evidence budget. */
  priority: number;
  title?: string;
  description?: string;
}

/** Soft caps per type so one blog index does not crowd out product/FAQ evidence. */
export const DEFAULT_PAGE_TYPE_BUDGET: Record<PageType, number> = {
  home: 1,
  about: 1,
  product: 2,
  pricing: 1,
  faq: 1,
  blog: 2,
  location: 2,
  contact: 1,
  legal: 1,
  other: 2,
};

const TYPE_PRIORITY: Record<PageType, number> = {
  home: 100,
  about: 90,
  product: 85,
  pricing: 80,
  faq: 78,
  location: 75,
  contact: 70,
  blog: 55,
  legal: 40,
  other: 30,
};

function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    // Drop tracking noise; keep meaningful query keys for local pages.
    const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
    for (const k of drop) u.searchParams.delete(k);
    return u.toString().replace(/\/$/, '') || u.origin;
  } catch {
    return null;
  }
}

function sameHost(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./i, '').toLowerCase();
    const hb = new URL(b).hostname.replace(/^www\./i, '').toLowerCase();
    return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
  } catch {
    return false;
  }
}

export function classifyPageType(url: string, title = '', description = ''): PageType {
  let path = '';
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  const blob = `${path} ${title} ${description}`.toLowerCase();

  if (path === '/' || path === '' || /^\/(index|home)(\.(html?|php))?$/.test(path)) {
    return 'home';
  }
  if (/\b(about|our-story|our-team|company|who-we-are|mission)\b/.test(blob)) return 'about';
  if (/\b(pricing|plans|packages|subscribe)\b/.test(blob)) return 'pricing';
  if (/\b(faq|faqs|help-center|knowledge-base|support\/)\b/.test(blob)) return 'faq';
  if (/\b(contact|get-in-touch|book-a-demo|schedule)\b/.test(blob)) return 'contact';
  if (/\b(locations?|stores?|branches?|near-me|find-us|directions)\b/.test(blob)) return 'location';
  if (/\b(privacy|terms|cookie|legal|gdpr|disclaimer)\b/.test(blob)) return 'legal';
  if (/\b(blog|news|articles?|insights?|resources?|posts?)\b/.test(blob)) return 'blog';
  if (/\b(product|products|services?|solutions?|features?|platform|shop|store|pricing)\b/.test(blob)) {
    return 'product';
  }
  return 'other';
}

/**
 * Rank and dedupe candidate URLs for a sitewide evidence pack.
 */
export function prioritizeUrls(
  rootUrl: string,
  candidates: Array<{ url: string; title?: string; description?: string }>,
  options: { maxPages?: number; budgets?: Partial<Record<PageType, number>> } = {},
): ClassifiedUrl[] {
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 8, 25));
  const budgets = { ...DEFAULT_PAGE_TYPE_BUDGET, ...options.budgets };
  const used: Partial<Record<PageType, number>> = {};

  const rootNorm = normalizeUrl(rootUrl) || rootUrl;
  const seen = new Set<string>();
  const classified: ClassifiedUrl[] = [];

  const seed = [{ url: rootNorm, title: 'Home', description: '' }, ...candidates];
  for (const c of seed) {
    const norm = normalizeUrl(c.url, rootNorm);
    if (!norm || seen.has(norm)) continue;
    if (!sameHost(norm, rootNorm)) continue;
    seen.add(norm);
    const pageType = classifyPageType(norm, c.title || '', c.description || '');
    classified.push({
      url: norm,
      pageType,
      priority: TYPE_PRIORITY[pageType],
      title: c.title,
      description: c.description,
    });
  }

  classified.sort((a, b) => b.priority - a.priority || a.url.localeCompare(b.url));

  const selected: ClassifiedUrl[] = [];
  for (const item of classified) {
    const count = used[item.pageType] || 0;
    if (count >= (budgets[item.pageType] ?? 1)) continue;
    used[item.pageType] = count + 1;
    selected.push(item);
    if (selected.length >= maxPages) break;
  }

  // Always ensure homepage is first when present.
  selected.sort((a, b) => {
    if (a.pageType === 'home' && b.pageType !== 'home') return -1;
    if (b.pageType === 'home' && a.pageType !== 'home') return 1;
    return b.priority - a.priority;
  });

  return selected;
}

/** Pull same-host hrefs from HTML for zero-key multi-page discovery. */
export function extractInternalLinks(html: string, rootUrl: string, limit = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const hrefRe = /href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const norm = normalizeUrl(m[1], rootUrl);
    if (!norm || seen.has(norm)) continue;
    if (!sameHost(norm, rootUrl)) continue;
    if (/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3|css|js)(\?|$)/i.test(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= limit) break;
  }
  return out;
}
