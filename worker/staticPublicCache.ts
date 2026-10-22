/**
 * Gives the boot script, the CSS promoter, and the self-hosted fonts a content
 * hash so they can stay cached for a year. HTML is rewritten on the way out.
 */

export const HTML_DOCUMENT_CACHE = 'no-cache';
export const LONG_PUBLIC_CACHE = 'public, max-age=31536000, immutable';

const PUBLIC_FILES = [
  '/boot-splash.js',
  '/promote-css.js',
  '/fonts/outfit-latin.woff2',
  '/fonts/instrument-serif-latin.woff2',
  '/fonts/instrument-serif-italic-latin.woff2',
] as const;

type AssetFetcher = { fetch(request: Request): Promise<Response> };

let hashedNames: Record<string, string> | null = null;

export function resetHashedPublicUrls(): void {
  hashedNames = null;
}

function hashedPath(path: string, hex: string): string {
  const dot = path.lastIndexOf('.');
  return `${path.slice(0, dot)}.${hex}${path.slice(dot)}`;
}

async function sha10(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
}

export async function hashedPublicUrls(assets: AssetFetcher): Promise<Record<string, string>> {
  if (hashedNames) return hashedNames;
  const out: Record<string, string> = {};
  await Promise.all(PUBLIC_FILES.map(async (path) => {
    const res = await assets.fetch(new Request(`https://assets.local${path}`));
    if (!res.ok) return;
    out[path] = hashedPath(path, await sha10(await res.arrayBuffer()));
  }));
  hashedNames = out;
  return out;
}

export function rewriteHashedPublic(html: string, urls: Record<string, string>): string {
  let out = html;
  for (const [from, to] of Object.entries(urls)) {
    if (from !== to) out = out.split(from).join(to);
  }
  return out;
}

/** Hashed request path back to the file in the asset bucket, or null. */
export async function canonicalPublicFile(assets: AssetFetcher, pathname: string): Promise<string | null> {
  const urls = await hashedPublicUrls(assets);
  for (const [from, to] of Object.entries(urls)) {
    if (pathname === to) return from;
  }
  return null;
}

/** HTML documents revalidate. Hashed boot files are rewritten into the body. */
export async function decoratePublicHtml(res: Response, assets: AssetFetcher): Promise<Response> {
  const contentType = res.headers.get('content-type') || '';
  if (!/text\/html/i.test(contentType)) return res;
  const urls = await hashedPublicUrls(assets);
  const headers = new Headers(res.headers);
  const cache = headers.get('cache-control') || '';
  if (!/no-store/i.test(cache)) headers.set('Cache-Control', HTML_DOCUMENT_CACHE);
  if (res.body === null) {
    return new Response(null, { status: res.status, statusText: res.statusText, headers });
  }
  const html = rewriteHashedPublic(await res.text(), urls);
  headers.delete('content-length');
  return new Response(html, { status: res.status, statusText: res.statusText, headers });
}
