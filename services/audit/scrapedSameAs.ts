/**
 * Organization JSON-LD keeps sameAs links from the scraped site, and other
 * fields only when the scraped text contains that value.
 */

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

function backedByEvidence(value: string, evidence: string, allowed: Set<string>): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const url = comparableUrl(trimmed);
  if (url && allowed.has(url)) return true;
  if (trimmed.length < 4) return false;
  return evidence.toLowerCase().includes(trimmed.toLowerCase());
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
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
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
  return {
    json: JSON.stringify(pruneJsonLd(parsed, evidence, allowed, dropped), null, 2),
    omitted: [...dropped].some((key) => OMITTED_FIELD.has(key)),
  };
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
    const note = omitted && !full.includes('REPLACE_ME') ? OMITTED_NOTE : '';
    return `${note}\`\`\`${lang || 'json'}\n${json}\n\`\`\``;
  });
}
