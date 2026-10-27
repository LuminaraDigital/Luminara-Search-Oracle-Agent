/**
 * Head fields of a fetched homepage for the free check's search snippet.
 * Returns short parsed strings only, never the page HTML. Regex-based like the rest of the
 * Worker's readers; JSON-LD uses the deploy readback scanner, which skips templates and SVG.
 */
import { decodeEntities, stripTags } from '../utils/html';
import { jsonLdBlocks } from './deployReadback';
import { isStagingCrawlHost, servesOwnHost } from './crawlDocuments';
import { MARKETING_ORIGIN, MARKETING_SHELL_BY_PATH } from '../services/marketing/pageMeta';
import { HOME_HERO } from '../services/marketing/marketingHeroCopy';
import type { HomepageHead } from '../services/marketing/homepageSnippet';

const MAX_TEXT = 300;
const MAX_TYPES = 12;

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

function text(raw: string | null | undefined): string | null {
  const clean = decodeEntities(stripTags(raw ?? '')).replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, MAX_TEXT) : null;
}

/** Content of the first meta tag whose name or property is `key`. */
function meta(tags: string[], key: string): string | null {
  for (const tag of tags) {
    const name = (attr(tag, 'name') ?? attr(tag, 'property') ?? '').toLowerCase();
    if (name === key) return attr(tag, 'content');
  }
  return null;
}

function collectTypes(node: unknown, into: Set<string>): void {
  if (into.size >= MAX_TYPES || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectTypes(item, into));
    return;
  }
  const record = node as Record<string, unknown>;
  const type = record['@type'];
  for (const value of Array.isArray(type) ? type : [type]) {
    if (typeof value === 'string' && value.trim() && into.size < MAX_TYPES) into.add(value.trim().slice(0, 60));
  }
  if (record['@graph']) collectTypes(record['@graph'], into);
}

function jsonLdTypes(html: string): string[] {
  const types = new Set<string>();
  for (const block of jsonLdBlocks(html)) {
    try {
      collectTypes(JSON.parse(block), types);
    } catch {
      /* a broken block names no type */
    }
  }
  return [...types];
}

/**
 * Head of this Worker's own homepage, built from the same registry the Worker injects into the
 * page, for the free check run against luminarasuite.com from luminarasuite.com (fetch would 522).
 */
export function servedHomepageHead(serveHost: string, targetHost: string): HomepageHead | null {
  if (!servesOwnHost(serveHost, targetHost)) return null;
  const shell = MARKETING_SHELL_BY_PATH['/'];
  const graph = (shell.jsonLd['@graph'] as unknown[]) ?? [];
  const types = new Set<string>();
  collectTypes(graph, types);
  return {
    status: 200,
    finalUrl: `https://${targetHost.toLowerCase()}/`,
    title: shell.title,
    description: shell.description,
    canonical: `${MARKETING_ORIGIN}/`,
    h1: `${HOME_HERO.titleLead} ${HOME_HERO.titleEm}`,
    ogImage: true,
    jsonLdTypes: [...types],
    // Staging answers with X-Robots-Tag: noindex (applyHostRobots).
    noindex: isStagingCrawlHost(targetHost, undefined),
  };
}

export function readPageHead(html: string): Omit<HomepageHead, 'status' | 'finalUrl'> {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const canonicalTag = (html.match(/<link\b[^>]*>/gi) ?? []).find((tag) =>
    (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'),
  );
  const robots = `${meta(metas, 'robots') ?? ''} ${meta(metas, 'googlebot') ?? ''}`;
  return {
    title: text(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]),
    description: text(meta(metas, 'description')),
    canonical: text(canonicalTag ? attr(canonicalTag, 'href') : null),
    h1: text(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]),
    ogImage: Boolean(meta(metas, 'og:image')?.trim()),
    jsonLdTypes: jsonLdTypes(html),
    noindex: /\b(noindex|none)\b/i.test(robots),
  };
}
