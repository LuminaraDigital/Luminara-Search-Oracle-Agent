/**
 * Deploy read-back (Track SW, SW0a-17).
 *
 * A 200 from a CMS API says the request was accepted, not that the page changed. A browser
 * cannot read another site's HTML, so the client asks this route to fetch the page, before and
 * after a deploy call, and answer one question: is the schema in the page source?
 *
 *   POST /api/deploy/readback  { url, schemaJsonLd }  ->  { ok: true, found: boolean }
 *
 * Guards:
 *   - Sign-in required. A guest gets 401 AUTH_REQUIRED before anything is fetched.
 *   - 10 calls a minute per account and per IP (enforceDualRateLimit).
 *   - Public http(s) targets only. fetchPublicUrl refuses private, loopback and link-local
 *     addresses and re-checks DNS on every redirect hop.
 *   - Standard web ports only, on the first hop and on every redirect, and one reason for every
 *     page that could not be read, so the route cannot be used to probe ports or statuses.
 *   - Bounded time and bytes. The response carries the boolean, never the page.
 *
 * "In the page source" means a JSON-LD script element an HTML parser would find in a page served
 * as HTML, whose parsed JSON equals the schema that was sent (or a top-level array holding it).
 * Whitespace, key order and slash escaping do not hide a real deployment. A copy inside a
 * comment, a textarea, a template, a noscript, a style or another kind of script is text, not
 * an element, and does not count. The comparison is of the whole schema: a plugin that merges it
 * into a larger `@graph`, or adds an `@id`, reads as not found.
 */
import type { Env } from './env';
import { MAX_SMALL_BODY_BYTES, clientIp, fetchPublicUrl, readBody, safePublicUrl } from './security';
import { enforceDualRateLimit } from './securityHardening';
import { billingId, identify, json } from './workerUtils';

export const DEPLOY_READBACK_PER_MIN = 10;
const MAX_PAGE_BYTES = 2_000_000;
const MAX_JSON_LD_BLOCKS = 200;
const FETCH_TIMEOUT_MS = 8_000;
const JSON_LD_TYPE = 'application/ld+json';

/** Key-order-independent serialisation, so two JSON values compare by content. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function indexFrom(re: RegExp, text: string, from: number): number {
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? m.index : -1;
}

const isSpace = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
const isLetter = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

type Tag = { name: string; closing: boolean; selfClosing: boolean; end: number; type: string | null };

/**
 * Reads the tag that starts at `lt`, stepping over quoted attribute values so a '>' or a
 * '<script' inside one is not taken for markup. `end` is the index of the tag's own '>', or -1
 * when the tag never closes. `type` is the value of its first `type` attribute. `selfClosing`
 * is true for a tag written `<name ... />`.
 */
function readTag(html: string, lt: number): Tag | null {
  let i = lt + 1;
  const closing = html[i] === '/';
  if (closing) i++;
  if (i >= html.length || !isLetter(html[i])) return null;
  const nameStart = i;
  while (i < html.length && !isSpace(html[i]) && html[i] !== '/' && html[i] !== '>') i++;
  const name = html.slice(nameStart, i).toLowerCase();
  let type: string | null = null;
  let selfClosing = false;
  while (i < html.length) {
    const c = html[i];
    if (c === '>') return { name, closing, selfClosing, end: i, type };
    if (c === '/' || isSpace(c)) {
      selfClosing = c === '/' && html[i + 1] === '>';
      i++;
      continue;
    }
    const attrStart = i;
    i++;
    while (i < html.length && !isSpace(html[i]) && html[i] !== '/' && html[i] !== '>' && html[i] !== '=') i++;
    const attr = html.slice(attrStart, i).toLowerCase();
    while (i < html.length && isSpace(html[i])) i++;
    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < html.length && isSpace(html[i])) i++;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close < 0) return { name, closing, selfClosing, end: -1, type };
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const valueStart = i;
        while (i < html.length && !isSpace(html[i]) && html[i] !== '>') i++;
        value = html.slice(valueStart, i);
      }
    }
    if (attr === 'type' && type === null) type = value;
  }
  return { name, closing, selfClosing, end: -1, type };
}

/** Elements whose content is text to an HTML parser: markup written inside them is not on the page. */
const TEXT_ONLY_CLOSE = new Map<string, RegExp>([
  ['style', /<\/style[\s/>]/gi],
  ['textarea', /<\/textarea[\s/>]/gi],
  ['title', /<\/title[\s/>]/gi],
  ['noscript', /<\/noscript[\s/>]/gi],
  ['xmp', /<\/xmp[\s/>]/gi],
  ['iframe', /<\/iframe[\s/>]/gi],
  ['noembed', /<\/noembed[\s/>]/gi],
  ['noframes', /<\/noframes[\s/>]/gi],
]);
const COMMENT_END = /--!?>/g;
const SCRIPT_TOKEN = /<!--|-->|<\/?script[\s/>]/gi;

/**
 * Index of the `</script` that ends a script whose content starts at `from`. Follows the HTML
 * rule that inside `<!-- ... -->` a nested `<script>` ... `</script>` pair does not end it.
 */
function scriptCloseIndex(html: string, from: number): number {
  let inComment = false;
  let nested = false;
  SCRIPT_TOKEN.lastIndex = from;
  for (let m = SCRIPT_TOKEN.exec(html); m; m = SCRIPT_TOKEN.exec(html)) {
    const token = m[0].toLowerCase();
    if (token === '<!--') {
      inComment = true;
      SCRIPT_TOKEN.lastIndex = m.index + 2; // so that "<!-->" is seen to close at once
    } else if (token === '-->') {
      inComment = false;
      nested = false;
    } else if (token[1] === '/') {
      if (!nested) return m.index;
      nested = false;
    } else if (inComment) {
      nested = true;
    }
  }
  return -1;
}

/** Inline SVG and MathML: inside them `<title/>` and the like close themselves, as in XML. */
const FOREIGN_ROOTS = new Set(['svg', 'math']);
/** Elements inside SVG or MathML whose children are read by the HTML rules again. */
const HTML_INSIDE_FOREIGN = new Set(['foreignobject', 'desc', 'annotation-xml', 'mi', 'mo', 'mn', 'ms', 'mtext']);

/** JSON-LD may carry parameters, as in `application/ld+json; charset=utf-8`: compare the part before ';'. */
const isJsonLdType = (type: string | null) => (type ?? '').split(';')[0].trim().toLowerCase() === JSON_LD_TYPE;

/**
 * Bodies of the JSON-LD script elements an HTML parser would find. One forward pass: every
 * character is stepped over once. Anything left open at the end of the page swallows the rest.
 * A script inside a template, inline SVG or MathML is not counted.
 */
function jsonLdBlocks(html: string): string[] {
  const out: string[] = [];
  let templateDepth = 0;
  let foreignDepth = 0;
  let htmlInsideForeign = 0;
  let pos = 0;
  while (out.length < MAX_JSON_LD_BLOCKS) {
    const lt = html.indexOf('<', pos);
    if (lt < 0) break;
    const next = html[lt + 1];

    if (html.startsWith('<!--', lt)) {
      const end = indexFrom(COMMENT_END, html, lt + 2);
      if (end < 0) break;
      pos = html.indexOf('>', end) + 1;
      continue;
    }
    if (foreignDepth > 0 && html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt);
      if (end < 0) break;
      pos = end + 3;
      continue;
    }
    // A declaration ("<!doctype"), a "<?", and a "</" that no tag name follows are all read by
    // an HTML parser as a comment that runs to the first '>'. Markup inside it is not markup.
    const afterSlash = html[lt + 2];
    const strayEndTag = next === '/' && afterSlash !== undefined && afterSlash !== '>' && !isLetter(afterSlash);
    if (next === '!' || next === '?' || strayEndTag) {
      const end = html.indexOf('>', lt);
      if (end < 0) break;
      pos = end + 1;
      continue;
    }

    const tag = readTag(html, lt);
    if (!tag) {
      pos = lt + 1;
      continue;
    }
    if (tag.end < 0) break;
    pos = tag.end + 1;

    if (tag.name === 'template') {
      templateDepth = Math.max(0, templateDepth + (tag.closing ? -1 : 1));
      continue;
    }
    if (FOREIGN_ROOTS.has(tag.name)) {
      if (tag.closing) foreignDepth = Math.max(0, foreignDepth - 1);
      else if (!tag.selfClosing) foreignDepth++;
      if (foreignDepth === 0) htmlInsideForeign = 0;
      continue;
    }
    if (foreignDepth > 0 && HTML_INSIDE_FOREIGN.has(tag.name)) {
      if (tag.closing) htmlInsideForeign = Math.max(0, htmlInsideForeign - 1);
      else if (!tag.selfClosing) htmlInsideForeign++;
      continue;
    }
    if (tag.closing) continue;
    if (tag.name === 'plaintext' && foreignDepth === 0) break;

    const isScript = tag.name === 'script';
    const textOnlyClose = TEXT_ONLY_CLOSE.get(tag.name);
    if (!isScript && !textOnlyClose) continue;
    // Directly inside SVG or MathML a self-closed element is empty: there is no content to skip.
    if (tag.selfClosing && foreignDepth > 0 && htmlInsideForeign === 0) continue;

    const close = isScript ? scriptCloseIndex(html, pos) : indexFrom(textOnlyClose as RegExp, html, pos);
    if (close < 0) break;
    if (isScript && templateDepth === 0 && foreignDepth === 0 && isJsonLdType(tag.type)) {
      out.push(html.slice(pos, close));
    }
    const closeEnd = html.indexOf('>', close);
    if (closeEnd < 0) break;
    pos = closeEnd + 1;
  }
  return out;
}

/** True when a JSON-LD script element in the page holds exactly the wanted schema. */
function pageHasSchema(html: string, wantedCanonical: string): boolean {
  for (const block of jsonLdBlocks(html)) {
    try {
      const parsed: unknown = JSON.parse(block);
      if (canonical(parsed) === wantedCanonical) return true;
      if (Array.isArray(parsed) && parsed.some((item) => canonical(item) === wantedCanonical)) return true;
    } catch {
      // Not JSON, or nested too deep to compare: it is not the schema we sent.
    }
  }
  return false;
}

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > maxBytes) {
      text += decoder.decode(value.subarray(0, value.byteLength - (total - maxBytes)), { stream: true });
      await reader.cancel().catch(() => undefined);
      return { text, truncated: true };
    }
    text += decoder.decode(value, { stream: true });
  }
  return { text: text + decoder.decode(), truncated: false };
}

/**
 * One answer for every page that could not be read: unreachable, refused, redirected somewhere
 * it may not go, an error status, too large. Telling them apart would let a caller probe hosts.
 */
const notRead = () => json({ ok: false, error: 'The page could not be read.', code: 'PAGE_NOT_READ' }, 422);

/** Fetches only on the standard web ports. fetchPublicUrl calls this for the first hop and every redirect. */
async function fetchOnDefaultPort(input: string, init?: RequestInit): Promise<Response> {
  if (new URL(input).port) throw new Error('non-default port');
  return fetch(input, init);
}

export async function handleDeployReadbackRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const who = await identify(request, env);
  if (who.error || !who.user) {
    return json({ ok: false, error: who.error || 'Sign in to read a deployed page back.', code: 'AUTH_REQUIRED' }, 401);
  }

  const dual = await enforceDualRateLimit(env, {
    action: 'deploy_readback',
    accountId: billingId(who.user),
    ip: clientIp(request),
    limitPerKey: DEPLOY_READBACK_PER_MIN,
    windowSec: 60,
  });
  if (!dual.ok) return dual.response;

  const read = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!read.ok) return json({ ok: false, error: read.error, code: 'BAD_REQUEST' }, read.status);
  const body = (read.value || {}) as Record<string, unknown>;
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const schemaJsonLd = typeof body.schemaJsonLd === 'string' ? body.schemaJsonLd : '';
  if (!url || !schemaJsonLd.trim()) {
    return json({ ok: false, error: 'The page address and the schema are both needed.', code: 'BAD_REQUEST' }, 400);
  }

  let wanted: string;
  try {
    const parsed: unknown = JSON.parse(schemaJsonLd);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    wanted = canonical(parsed);
  } catch {
    return json({ ok: false, error: 'The schema is not a JSON object or list.', code: 'INVALID_SCHEMA' }, 400);
  }

  const target = safePublicUrl(url);
  if (!target) {
    return json(
      {
        ok: false,
        error: "That address is private or local, or is not a web address. Use the site's public address.",
        code: 'UNSAFE_URL',
      },
      400,
    );
  }
  if (target.port) {
    return json(
      { ok: false, error: "Use the site's normal address, without a port number.", code: 'UNSAFE_URL' },
      400,
    );
  }

  const fetched = await fetchPublicUrl(
    url,
    {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'cache-control': 'no-cache',
        'user-agent': 'LuminaraDeployCheck/1.0 (+https://luminarasuite.com)',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
    { fetcher: fetchOnDefaultPort, dohFetcher: (dohUrl, dohInit) => fetch(dohUrl, dohInit) },
  );
  if (!fetched.ok) return notRead();
  // Only an HTML page can carry a script element. The same markup served as text/plain, or with
  // no content type, is text that no browser or crawler would read as a page.
  const isHtml = /html/i.test(fetched.response.headers.get('content-type') || '');
  if (!fetched.response.ok || !isHtml) {
    await fetched.response.body?.cancel().catch(() => undefined);
    return notRead();
  }

  let page: { text: string; truncated: boolean };
  try {
    page = await readCapped(fetched.response, MAX_PAGE_BYTES);
  } catch {
    return notRead();
  }

  const found = pageHasSchema(page.text, wanted);
  // A miss on a page we only partly read is not evidence that the schema is absent.
  if (!found && page.truncated) return notRead();
  return json({ ok: true, found });
}
