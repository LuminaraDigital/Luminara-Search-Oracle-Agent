/**
 * Head fields of a fetched homepage for the free check: title, meta description, JSON-LD types,
 * noindex. Returns short parsed strings only, never the page HTML. JSON-LD uses the deploy
 * readback scanner, which skips templates and SVG.
 *
 * The page is hostile input up to 256 KB, parsed on the Worker's CPU, so every scan is linear:
 * comments are cut with indexOf, tag openers stop at the next `<` (`[^<>]*`), closers are found
 * with indexOf, and no text or tag longer than MAX_SPAN is matched, since output is MAX_TEXT long.
 */
import { brandFromEvidence, cleanScrapedName } from '../services/audit/brandName';
import { cleanPlace } from '../services/audit/freeAiAnswer';
import { decodeEntities } from '../utils/html';
import { jsonLdBlocks } from './deployReadback';
import type { HomepageHead } from '../services/marketing/homepageSnippet';

const MAX_TEXT = 300;
const MAX_TYPES = 12;
const MAX_SPAN = 1_000;
const MAX_TAGS = 200;
/** robots values that look like "name: value" but are directives, not a user agent prefix. */
const ROBOTS_DIRECTIVES_WITH_COLON = /^(max-snippet|max-image-preview|max-video-preview|unavailable_after)\s*:/;

function attr(tag: string, name: string): string | null {
  // Preceded by whitespace, so `name` does not match `data-name`.
  // A quote left open by the MAX_SPAN cut runs to the end of the cut tag.
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)(?:"|$)|'([^']*)(?:'|$)|([^\\s"'>]+))`, 'i').exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

/** Visible text of a fragment: tags become spaces, entities are decoded once. */
function text(raw: string | null | undefined): string | null {
  const clean = decodeEntities((raw ?? '').slice(0, MAX_SPAN).replace(/<[^<>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, MAX_TEXT) : null;
}

/** The HTML with comments removed, so a commented-out tag is never read. */
function withoutComments(html: string): string {
  const parts: string[] = [];
  let at = 0;
  for (;;) {
    const open = html.indexOf('<!--', at);
    if (open < 0) break;
    parts.push(html.slice(at, open));
    // From open + 2, so the empty comments <!--> and <!---> close where HTML closes them.
    const close = html.indexOf('-->', open + 2);
    if (close < 0) return parts.join('');
    at = close + 3;
  }
  parts.push(html.slice(at));
  return parts.join('');
}

/** Inner text of the first <title>. A missing closer reads at most MAX_SPAN characters. */
function elementText(html: string, lower: string, tag: 'title'): string | null {
  const open = new RegExp(`<${tag}\\b[^<>]*>`, 'i').exec(html);
  if (!open) return null;
  const from = open.index + open[0].length;
  const close = lower.indexOf(`</${tag}`, from);
  return text(html.slice(from, close < 0 ? from + MAX_SPAN : Math.min(close, from + MAX_SPAN)));
}

function metaTags(html: string): string[] {
  // A tag longer than MAX_SPAN is cut, not dropped: a very long description still reads as too long.
  return (html.match(/<meta\b[^<>]*>/gi) ?? []).slice(0, MAX_TAGS).map((tag) => tag.slice(0, MAX_SPAN));
}

/** Content of the first meta tag whose name or property is `key`. */
function meta(tags: string[], key: string): string | null {
  for (const tag of tags) {
    const name = (attr(tag, 'name') ?? attr(tag, 'property') ?? '').toLowerCase();
    if (name === key) return attr(tag, 'content');
  }
  return null;
}

/**
 * True when a robots meta value or X-Robots-Tag header says noindex (or none) for every crawler or
 * for Googlebot. Directives are whole comma-separated tokens: `max-image-preview:none` is not
 * noindex, and `otherbot: noindex` applies to another crawler.
 */
export function robotsSaysNoindex(value: string | null | undefined): boolean {
  let agent: string | null = null;
  for (const raw of String(value ?? '').toLowerCase().split(',')) {
    let token = raw.trim();
    const prefixed = /^([a-z0-9_-]+)\s*:\s*(.*)$/.exec(token);
    if (prefixed && !ROBOTS_DIRECTIVES_WITH_COLON.test(token)) {
      agent = prefixed[1];
      token = prefixed[2].trim();
    }
    const appliesToGoogle = agent === null || agent === 'googlebot';
    if (appliesToGoogle && (token === 'noindex' || token === 'none')) return true;
  }
  return false;
}

/** Nested entities (a publisher, an address) are read this deep, enough for real pages and bounded for hostile ones. */
const MAX_DEPTH = 6;
/** Objects visited per block, so a wide hostile document stays cheap. */
const MAX_NODES = 2_000;

/**
 * Types breadth first: the page's own entities (top level and @graph) come before nested helpers
 * such as PostalAddress, so the first few names are the ones worth showing.
 */
function collectTypes(root: unknown, into: Set<string>): void {
  let level: unknown[] = [root];
  let visited = 0;
  for (let depth = 0; depth <= MAX_DEPTH && level.length && into.size < MAX_TYPES; depth++) {
    const next: unknown[] = [];
    for (const node of level) {
      if (++visited > MAX_NODES || into.size >= MAX_TYPES) return;
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) {
        next.push(...node.slice(0, MAX_NODES));
        continue;
      }
      const record = node as Record<string, unknown>;
      const type = record['@type'];
      for (const value of Array.isArray(type) ? type : [type]) {
        if (typeof value === 'string' && value.trim() && into.size < MAX_TYPES) into.add(value.trim().slice(0, 60));
      }
      // @graph members are the page's own entities, so they stay on the same level as the root.
      const graph = record['@graph'];
      if (Array.isArray(graph)) level.push(...graph.slice(0, MAX_NODES));
      for (const [key, value] of Object.entries(record)) {
        if (key !== '@type' && key !== '@graph' && value && typeof value === 'object') next.push(value);
      }
    }
    level = next;
  }
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

export function readPageHead(html: string): Omit<HomepageHead, 'finalUrl'> {
  const page = withoutComments(html);
  const lower = page.toLowerCase();
  // Title and meta come from the head only, so an inline SVG <title> in the body never stands in.
  // </head> is optional in HTML, so the start of <body> also ends it.
  const closeHead = lower.indexOf('</head');
  const openBody = lower.indexOf('<body');
  const headEnd = closeHead >= 0 ? closeHead : openBody >= 0 ? openBody : page.length;
  const head = page.slice(0, headEnd);
  const metas = metaTags(head);
  return {
    title: elementText(head, lower.slice(0, headEnd), 'title'),
    description: text(meta(metas, 'description')),
    jsonLdTypes: jsonLdTypes(page),
    noindex: robotsSaysNoindex(meta(metas, 'robots')) || robotsSaysNoindex(meta(metas, 'googlebot')),
  };
}

const BUSINESS_TYPES = new Set(['RealEstateAgent', 'LocalBusiness', 'ProfessionalService']);
const LD_NODES = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function leafType(value: string): string {
  const slash = value.lastIndexOf('/');
  const base = slash >= 0 ? value.slice(slash + 1) : value;
  const colon = base.lastIndexOf(':');
  return (colon >= 0 ? base.slice(colon + 1) : base).trim();
}

function typeList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === 'string' && item.trim()) out.push(leafType(item));
  }
  return out;
}

function placeLabel(value: unknown): string {
  if (typeof value === 'string') return cleanPlace(value);
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) {
      const found = placeLabel(item);
      if (found) return found;
    }
    return '';
  }
  if (isRecord(value) && typeof value.name === 'string') return cleanPlace(value.name);
  return '';
}

function plainName(value: string): string {
  return value.replace(/[<>]/g, '').trim();
}

/**
 * Agency name and suburb the homepage itself states. Title, og:site_name, and JSON-LD only.
 * A missing field stays empty. Nothing here is guessed from the domain.
 */
export function readBusinessSignals(html: string, title: string | null): { agencyName: string; suburb: string } {
  const page = withoutComments(html);
  const lower = page.toLowerCase();
  const closeHead = lower.indexOf('</head');
  const openBody = lower.indexOf('<body');
  const headEnd = closeHead >= 0 ? closeHead : openBody >= 0 ? openBody : page.length;
  const metas = metaTags(page.slice(0, headEnd));
  const siteName = text(meta(metas, 'og:site_name'));
  const geo = cleanPlace(text(meta(metas, 'geo.placename')));
  let businessName = '';
  let organizationName = '';
  let locality = '';
  let areaServed = '';
  for (const block of jsonLdBlocks(page)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const stack: unknown[] = [parsed];
    let seen = 0;
    while (stack.length > 0 && seen < LD_NODES && (!businessName || !locality)) {
      const node = stack.shift();
      seen += 1;
      if (Array.isArray(node)) {
        stack.push(...node.slice(0, 20));
        continue;
      }
      if (!isRecord(node)) continue;
      const types = typeList(node['@type']);
      const name = typeof node.name === 'string' ? plainName(cleanScrapedName(node.name)) : '';
      if (name && types.some((type) => BUSINESS_TYPES.has(type)) && !businessName) businessName = name;
      if (name && types.includes('Organization') && !organizationName) organizationName = name;
      const address = node.address;
      if (!locality && isRecord(address) && typeof address.addressLocality === 'string') {
        locality = cleanPlace(address.addressLocality);
      }
      if (!areaServed) areaServed = placeLabel(node.areaServed);
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') stack.push(value);
      }
    }
    if (businessName && locality) break;
  }
  const agencyName = plainName(brandFromEvidence({
    siteName,
    organizationName: businessName || organizationName,
    title,
  }) || '');
  return { agencyName, suburb: locality || areaServed || geo };
}
