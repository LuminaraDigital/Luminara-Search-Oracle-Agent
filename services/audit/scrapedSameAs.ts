/**
 * Organization JSON-LD keeps sameAs links from the scraped site, and other
 * fields only when the scraped text contains that value.
 * SearchAction is never kept. A logo must be a logo or icon, not a poster or og:image.
 */
import { organizationJsonLd } from './fixPackCopy';

const HREF_RE = /\bhref\s*=\s*["']([^"'>\s]+)["']/gi;
const MARKDOWN_LINK_RE = /\[[^\]]*]\(\s*(https?:\/\/[^)\s]+)/gi;

export function comparableUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return null;
  }
}

export function extractScrapedLinks(source: string): string[] {
  const found: string[] = [];
  const push = (raw: string) => {
    const clean = raw.trim().replace(/[),.;]+$/, '');
    if (comparableUrl(clean)) found.push(clean);
  };
  for (const match of source.matchAll(HREF_RE)) push(match[1] || '');
  for (const match of source.matchAll(MARKDOWN_LINK_RE)) push(match[1] || '');
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const link of found) {
    const key = comparableUrl(link);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(link);
  }
  return unique.slice(0, 80);
}

export function collectScrapedLinks(
  pages: readonly { outboundLinks?: readonly string[]; rawTextSnippet?: string }[] | null | undefined,
  extra = '',
): string[] {
  const direct = (pages ?? []).flatMap((page) =>
    page.outboundLinks?.length ? [...page.outboundLinks] : extractScrapedLinks(page.rawTextSnippet || ''),
  );
  return extractScrapedLinks(
    [...direct, ...extractScrapedLinks(extra)].map((link) => `<a href="${link}">`).join(''),
  );
}

function urlList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

const STRUCTURAL_KEY = new Set(['@context', '@type', '@id']);
const OMITTED_FIELD = new Set([
  'telephone', 'logo', 'address', 'email', 'image', 'contactPoint',
  'streetAddress', 'postalCode', 'addressLocality', 'addressRegion', 'addressCountry',
]);

const NON_LOGO_MEDIA = /poster|hero|og[-_]?image|opengraph|banner|cover|thumbnail|share[-_]?image|social[-_]?image|\.mp4|\.webm/i;
const LOGO_SIGNAL = /logo|favicon|apple-touch-icon|(?:^|\/)icon(?:[-.]|$)/i;

function pathOf(raw: string): string {
  try {
    const url = new URL(raw, 'https://logo.invalid');
    return `${url.pathname}${url.search}`;
  } catch {
    return raw;
  }
}

/** A logo URL names a logo or icon. Posters, heroes, and og:image files do not qualify. */
function logoPathOk(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const path = pathOf(trimmed);
  if (NON_LOGO_MEDIA.test(path) || NON_LOGO_MEDIA.test(trimmed)) return false;
  return LOGO_SIGNAL.test(path);
}

function logoUrlAllowed(raw: string, evidence: string): boolean {
  const trimmed = raw.trim();
  return logoPathOk(trimmed) && evidence.toLowerCase().includes(trimmed.toLowerCase());
}

function mediaUrl(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const url = Object.entries(value).find(([key]) => key === 'url')?.[1];
  return typeof url === 'string' ? url : null;
}

function backedByEvidence(value: string, evidence: string, allowed: Set<string>): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const url = comparableUrl(trimmed);
  if (url && allowed.has(url)) return true;
  if (trimmed.length < 4) return false;
  return evidence.toLowerCase().includes(trimmed.toLowerCase());
}

function isSearchActionNode(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => String(item).toLowerCase() === 'searchaction');
}

function hasSearchAction(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasSearchAction);
  if (!node || typeof node !== 'object') return false;
  if (isSearchActionNode(node as Record<string, unknown>)) return true;
  if ('potentialAction' in node) return true;
  return Object.values(node).some(hasSearchAction);
}

function typesOf(node: unknown): string[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  const type = (node as Record<string, unknown>)['@type'];
  if (typeof type === 'string') return [type];
  if (!Array.isArray(type)) return [];
  return type.filter((item): item is string => typeof item === 'string');
}

function pruneJsonLd(
  node: unknown,
  evidence: string,
  allowed: Set<string>,
  dropped: Set<string>,
): unknown {
  if (Array.isArray(node)) {
    return node
      .map((item) => pruneJsonLd(item, evidence, allowed, dropped))
      .filter((item) => item !== undefined && !(typeof item === 'object' && item && !Array.isArray(item) && Object.keys(item).length === 0));
  }
  if (!node || typeof node !== 'object') return node;
  const record = node as Record<string, unknown>;
  if (isSearchActionNode(record)) return undefined;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'potentialAction') {
      dropped.add(key);
      continue;
    }
    if (key === 'logo' || key === 'image') {
      const url = mediaUrl(value);
      if (url && logoUrlAllowed(url, evidence)) next[key] = url;
      else dropped.add(key);
      continue;
    }
    if (key === 'sameAs') {
      const kept = urlList(value).filter((url) => {
        const comparable = comparableUrl(url);
        return comparable !== null && allowed.has(comparable);
      });
      if (kept.length > 0) next.sameAs = kept;
      continue;
    }
    if (STRUCTURAL_KEY.has(key)) {
      next[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      if (backedByEvidence(value, evidence, allowed)) next[key] = value;
      else if (OMITTED_FIELD.has(key)) dropped.add(key);
      continue;
    }
    if (typeof value === 'number' && evidence.includes(String(value))) {
      next[key] = value;
      continue;
    }
    if (value && typeof value === 'object') {
      const child = pruneJsonLd(value, evidence, allowed, dropped);
      const childRecord = !Array.isArray(child) && child && typeof child === 'object'
        ? child as Record<string, unknown>
        : null;
      const onlyStructural = Boolean(
        childRecord && Object.keys(childRecord).every((childKey) => STRUCTURAL_KEY.has(childKey)),
      );
      const empty = Array.isArray(child)
        ? child.length === 0
        : !childRecord || Object.keys(childRecord).length === 0 || onlyStructural;
      if (!empty) next[key] = child;
      else if (OMITTED_FIELD.has(key)) dropped.add(key);
    }
  }
  return next;
}

const OMITTED_NOTE = '<!-- Omitted phone, logo, or address. REPLACE_ME from the scraped page. -->\n';

function restrictParsed(
  parsed: unknown,
  scrapedLinks: readonly string[],
  evidence: string,
): { json: string; omitted: boolean } {
  const allowed = new Set(
    scrapedLinks.map(comparableUrl).filter((key): key is string => key !== null),
  );
  const dropped = new Set<string>();
  const pruned = pruneJsonLd(parsed, evidence, allowed, dropped);
  return {
    json: pruned === undefined ? '{}' : JSON.stringify(pruned, null, 2),
    omitted: [...dropped].some((key) => OMITTED_FIELD.has(key)),
  };
}

/**
 * Copy-paste default. Keeps one evidence-backed Organization object.
 * Anything with SearchAction, a non-logo image, or a different type becomes the deterministic Organization draft.
 */
export function copyPasteOrganizationSchema(candidate: string, host: string, siteName?: string | null): string {
  const fallback = organizationJsonLd(host, siteName);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return fallback;
  }
  if (hasSearchAction(parsed)) return fallback;
  const types = typesOf(parsed);
  if (types.length !== 1 || types[0] !== 'Organization') return fallback;
  const record = parsed as Record<string, unknown>;
  for (const key of ['logo', 'image']) {
    if (record[key] === undefined) continue;
    if (typeof record[key] !== 'string' || !logoPathOk(record[key])) return fallback;
  }
  return JSON.stringify(parsed, null, 2);
}

/** Drop sameAs entries that are not links on the scraped site. Omit the key when none remain. */
export function restrictOrganizationSameAs(jsonText: string, scrapedLinks: readonly string[], evidence = ''): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return jsonText;
  }
  return restrictParsed(parsed, scrapedLinks, evidence).json;
}

export function restrictReportJsonLdSameAs(
  markdown: string,
  scrapedLinks: readonly string[],
  evidence = '',
  copyPaste?: { host: string; siteName?: string | null },
): string {
  return markdown.replace(/```(json)?\s*([\s\S]*?)```/gi, (full, lang: string | undefined, body: string) => {
    const trimmed = body.trim();
    if (!/"@type"|"@context"|sameAs/.test(trimmed)) return full;
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return full;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return full;
    }
    const { json, omitted } = restrictParsed(parsed, scrapedLinks, evidence);
    const safe = copyPaste?.host ? copyPasteOrganizationSchema(json, copyPaste.host, copyPaste.siteName) : json;
    const note = omitted && !full.includes('REPLACE_ME') ? OMITTED_NOTE : '';
    return `${note}\`\`\`${lang || 'json'}\n${safe}\n\`\`\``;
  });
}
