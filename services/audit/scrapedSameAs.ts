/**
 * Organization JSON-LD sameAs may list only links that were on the scraped site.
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

function restrictNode(node: unknown, allowed: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) restrictNode(item, allowed);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if ('sameAs' in record) {
    const kept = urlList(record.sameAs).filter((url) => {
      const key = comparableUrl(url);
      return key !== null && allowed.has(key);
    });
    if (kept.length > 0) record.sameAs = kept;
    else delete record.sameAs;
  }
  for (const value of Object.values(record)) restrictNode(value, allowed);
}

/** Drop sameAs entries that are not links on the scraped site. Omit the key when none remain. */
export function restrictOrganizationSameAs(jsonText: string, scrapedLinks: readonly string[]): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return jsonText;
  }
  const allowed = new Set(
    scrapedLinks.map(comparableUrl).filter((key): key is string => key !== null),
  );
  restrictNode(parsed, allowed);
  return JSON.stringify(parsed, null, 2);
}

export function restrictReportJsonLdSameAs(markdown: string, scrapedLinks: readonly string[]): string {
  return markdown.replace(/```(json)?\s*([\s\S]*?)```/gi, (full, lang: string | undefined, body: string) => {
    const trimmed = body.trim();
    if (!/sameAs/.test(trimmed) || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return full;
    const next = restrictOrganizationSameAs(trimmed, scrapedLinks);
    if (next === trimmed) return full;
    return `\`\`\`${lang || 'json'}\n${next}\n\`\`\``;
  });
}
