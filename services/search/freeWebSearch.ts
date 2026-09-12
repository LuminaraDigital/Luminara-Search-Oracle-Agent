/**
 * Free, no-API-key web search via DuckDuckGo's HTML "lite" endpoint.
 * Adapted from OmniRoute (open-sse/services/freeWebSearch.ts, MIT License).
 *
 * Used as a last-resort fallback search provider when no commercial search API
 * key (Tavily, Exa, Serper, Brave) is configured or when upstream credits are exhausted.
 *
 * Implements bounded regex parsing (MAX_HTML_BYTES) to prevent ReDoS, recursive entity
 * unescaping, and multi-character tag stripping.
 */

export interface FreeSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export const DUCKDUCKGO_LITE_URL = "https://lite.duckduckgo.com/lite/";
export const DDG_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const ANCHOR_RE = /<a\b([^>]*?class=['"][^'"]*result-link[^'"]*['"][^>]*)>([\s\S]{0,512}?)<\/a>/gi;
const HREF_RE = /href=['"]([^'"]+)['"]/i;
const SNIPPET_RE =
  /<td\b[^>]*?class=['"][^'"]*result-snippet[^'"]*['"][^>]*>([\s\S]{0,2048}?)<\/td>/gi;
export const MAX_HTML_BYTES = 256 * 1024;

import { decodeEntities, stripTags } from '../../utils/html';
export { decodeEntities, stripTags };

export function resolveResultUrl(href: string): string {
  let candidate = href;
  const redirect = href.match(/[?&]uddg=([^&]+)/);
  if (redirect) {
    try {
      candidate = decodeURIComponent(redirect[1]);
    } catch {
      candidate = href;
    }
  } else if (href.startsWith("//")) {
    candidate = `https:${href}`;
  }
  return /^https?:\/\//i.test(candidate) ? candidate : "";
}

/**
 * Pure parser for DuckDuckGo lite HTML into structured results.
 */
export function parseDuckDuckGoLite(rawHtml: string): FreeSearchResult[] {
  if (!rawHtml) return [];
  const html = rawHtml.length > MAX_HTML_BYTES ? rawHtml.slice(0, MAX_HTML_BYTES) : rawHtml;

  const snippets = [...html.matchAll(SNIPPET_RE)].map((m) => stripTags(m[1]));
  const results: FreeSearchResult[] = [];
  let index = 0;

  for (const match of html.matchAll(ANCHOR_RE)) {
    const attrs = match[1];
    const inner = match[2];
    const hrefMatch = attrs.match(HREF_RE);
    const title = stripTags(inner);
    if (hrefMatch && title) {
      const url = resolveResultUrl(hrefMatch[1]);
      if (url) {
        results.push({
          url,
          title,
          snippet: snippets[index] ?? "",
        });
      }
    }
    index += 1;
  }

  return results;
}

/**
 * Executes a DuckDuckGo lite search query.
 */
export async function freeWebSearch(
  query: string,
  maxResults = 5,
  timeoutMs = 10_000
): Promise<FreeSearchResult[]> {
  if (!query || !query.trim()) return [];

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(DUCKDUCKGO_LITE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": DDG_USER_AGENT,
        Accept: "text/html",
      },
      body: new URLSearchParams({ q: query }).toString(),
      signal: controller?.signal,
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo lite search returned HTTP ${response.status}`);
    }

    const html = await response.text();
    return parseDuckDuckGoLite(html).slice(0, Math.max(1, maxResults));
  } finally {
    if (timer) clearTimeout(timer);
  }
}
