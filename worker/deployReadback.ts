/**
 * Deploy read-back (Track SW, SW0a-17).
 *
 * A 200 from a CMS API says the request was accepted, not that the page changed. A browser
 * cannot read another site's HTML, so after a deploy call the client asks this route to fetch
 * the page and answer one question: is the schema in the page source?
 *
 *   POST /api/deploy/readback  { url, schemaJsonLd }  ->  { ok: true, found: boolean }
 *
 * Guards:
 *   - Sign-in required. A guest gets 401 AUTH_REQUIRED before anything is fetched.
 *   - 10 calls a minute per account and per IP (enforceDualRateLimit).
 *   - Public http(s) targets only. fetchPublicUrl refuses private, loopback and link-local
 *     addresses and re-checks DNS on every redirect hop.
 *   - Bounded time and bytes. The response carries the boolean, never the page.
 *
 * "In the page source" means a JSON-LD script block whose parsed JSON equals the schema that
 * was sent (or a top-level array holding it), so whitespace, key order and slash escaping
 * that a CMS adds on the way out do not hide a real deployment.
 */
import type { Env } from './env';
import { MAX_SMALL_BODY_BYTES, clientIp, fetchPublicUrl, readBody, safePublicUrl } from './security';
import { enforceDualRateLimit } from './securityHardening';
import { billingId, identify, json } from './workerUtils';

export const DEPLOY_READBACK_PER_MIN = 10;
const MAX_PAGE_BYTES = 2_000_000;
const MAX_JSON_LD_BLOCKS = 200;
const FETCH_TIMEOUT_MS = 8_000;

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

/** Bodies of the page's JSON-LD script blocks. One forward pass, no backtracking. */
function jsonLdBlocks(html: string): string[] {
  const openRe = /<script/gi;
  const closeRe = /<\/script/gi;
  const out: string[] = [];
  let at = 0;
  while (out.length < MAX_JSON_LD_BLOCKS) {
    const open = indexFrom(openRe, html, at);
    if (open < 0) break;
    const tagEnd = html.indexOf('>', open);
    if (tagEnd < 0) break;
    const close = indexFrom(closeRe, html, tagEnd);
    if (close < 0) break;
    if (html.slice(open, tagEnd).toLowerCase().includes('application/ld+json')) {
      out.push(html.slice(tagEnd + 1, close));
    }
    at = close + 1;
  }
  return out;
}

/** True when a JSON-LD block in the page holds exactly the wanted schema. */
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

const notRead = (error: string, code = 'PAGE_NOT_READ') => json({ ok: false, error, code }, 422);

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
    return json({ ok: false, error: 'url and schemaJsonLd are required.', code: 'BAD_REQUEST' }, 400);
  }

  let wanted: string;
  try {
    const parsed: unknown = JSON.parse(schemaJsonLd);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    wanted = canonical(parsed);
  } catch {
    return json({ ok: false, error: 'schemaJsonLd must be a JSON object or array.', code: 'INVALID_SCHEMA' }, 400);
  }

  if (!safePublicUrl(url)) {
    return json(
      {
        ok: false,
        error: 'url must be a public http(s) address (no localhost, private IPs, or credentials).',
        code: 'UNSAFE_URL',
      },
      400,
    );
  }

  const fetched = await fetchPublicUrl(url, {
    method: 'GET',
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'cache-control': 'no-cache',
      'user-agent': 'LuminaraDeployCheck/1.0 (+https://luminarasuite.com)',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!fetched.ok) return notRead(`The page could not be read: ${fetched.error}.`);
  if (!fetched.response.ok) {
    await fetched.response.body?.cancel().catch(() => undefined);
    return notRead(`The page answered HTTP ${fetched.response.status}.`);
  }

  let page: { text: string; truncated: boolean };
  try {
    page = await readCapped(fetched.response, MAX_PAGE_BYTES);
  } catch {
    return notRead('The page could not be read: the download did not finish.');
  }

  const found = pageHasSchema(page.text, wanted);
  // A miss on a page we only partly read is not evidence that the schema is absent.
  if (!found && page.truncated) return notRead('The page is too large to check.', 'PAGE_TOO_LARGE');
  return json({ ok: true, found });
}
