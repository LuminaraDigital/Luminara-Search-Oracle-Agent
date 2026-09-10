/**
 * Security helpers for the Worker: response headers, request body limits, a best-effort
 * per-IP rate limiter, and SSRF guards for URLs the Worker fetches on a caller's behalf.
 * Everything here is pure (or takes injectable clocks/fetchers) so it can be unit-tested.
 */

// ---- Response headers ------------------------------------------------------------------------

/**
 * CSP for the SPA shell. The app loads the Telegram Web App bridge from telegram.org and fonts
 * from Google Fonts; index.html carries an inline <style>, and React components set inline styles.
 * 'wasm-unsafe-eval' is required for Forme PDF (WebAssembly) without opening full 'unsafe-eval'.
 * connect-src stays open because users can point the app at their own Ollama / crawler /
 * LanguageTool / Umami URLs, and the browser calls vendor APIs directly with user-held keys.
 */
export const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://telegram.org https://www.gstatic.com https://apis.google.com https://*.firebaseio.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src * data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' https: https://*.firebaseapp.com https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://*.t.me",
].join('; ');

const COMMON_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

/** Adds security headers to a response. HTML documents additionally get the CSP. */
export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(COMMON_HEADERS)) out.headers.set(k, v);
  const ct = out.headers.get('content-type') || '';
  if (/text\/html/i.test(ct)) {
    out.headers.set('Content-Security-Policy', HTML_CSP);
  }
  return out;
}

/** Headers copied from an upstream vendor response must never carry the vendor's CORS or cookies. */
export function stripUpstreamHeaders(headers: Headers): void {
  for (const h of [
    'content-encoding',
    'content-length',
    'set-cookie',
    'access-control-allow-origin',
    'access-control-allow-credentials',
    'access-control-allow-headers',
    'access-control-allow-methods',
    'access-control-expose-headers',
    'transfer-encoding',
  ]) headers.delete(h);
}

// ---- Request bodies --------------------------------------------------------------------------

export const MAX_BODY_BYTES = 1_000_000; // provider proxies (chat completions with long context)
export const MAX_SMALL_BODY_BYTES = 64_000; // auth / invoice / webhook / sentinel

/** Caps for hosted-key LLM calls (cost abuse control). BYOK is not clamped. */
export const HOSTED_MAX_TOKENS = 8192;
export const HOSTED_MAX_COMPLETION_CHOICES = 1;
export const HOSTED_MAX_MESSAGES = 64;

export type BodyResult<T> = { ok: true; value: T; text: string } | { ok: false; status: number; error: string };

/**
 * Clamps OpenAI-compatible chat completion bodies on hosted keys so a single request cannot
 * burn unbounded tokens (n, max_tokens / max_completion_tokens).
 */
export function clampHostedChatCompletionsBody(body: unknown): { ok: true; body: unknown } | { ok: false; error: string } {
  if (body === undefined || body === null) return { ok: true, body: { max_tokens: HOSTED_MAX_TOKENS } };
  if (typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Request body must be a JSON object' };
  const b = { ...(body as Record<string, unknown>) };
  if (Array.isArray(b.messages) && b.messages.length > HOSTED_MAX_MESSAGES) {
    return { ok: false, error: `Too many messages (max ${HOSTED_MAX_MESSAGES} on hosted keys)` };
  }
  const clampToken = (key: 'max_tokens' | 'max_completion_tokens') => {
    const v = b[key];
    if (v === undefined || v === null) return;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1) {
      b[key] = HOSTED_MAX_TOKENS;
      return;
    }
    b[key] = Math.min(Math.floor(n), HOSTED_MAX_TOKENS);
  };
  clampToken('max_tokens');
  clampToken('max_completion_tokens');
  if (b.max_tokens === undefined && b.max_completion_tokens === undefined) {
    b.max_tokens = HOSTED_MAX_TOKENS;
  }
  if (b.n !== undefined) {
    const n = Number(b.n);
    b.n = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), HOSTED_MAX_COMPLETION_CHOICES) : HOSTED_MAX_COMPLETION_CHOICES;
  }
  return { ok: true, body: b };
}

/** Hosted Firecrawl /crawl cost guard: cap pages and depth on shared keys. */
export const HOSTED_FIRECRAWL_MAX_LIMIT = 12;
export const HOSTED_FIRECRAWL_MAX_DEPTH = 2;

export function clampHostedFirecrawlCrawlBody(body: unknown): { ok: true; body: unknown } | { ok: false; error: string } {
  if (body === undefined || body === null) {
    return { ok: true, body: { limit: 6, maxDepth: HOSTED_FIRECRAWL_MAX_DEPTH } };
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const b = { ...(body as Record<string, unknown>) };
  const limitRaw = Number(b.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), HOSTED_FIRECRAWL_MAX_LIMIT)
    : 6;
  b.limit = limit;

  const depthRaw = Number(b.maxDepth ?? b.maxDiscoveryDepth);
  const depth = Number.isFinite(depthRaw) && depthRaw > 0
    ? Math.min(Math.floor(depthRaw), HOSTED_FIRECRAWL_MAX_DEPTH)
    : HOSTED_FIRECRAWL_MAX_DEPTH;
  b.maxDepth = depth;
  if (b.maxDiscoveryDepth !== undefined) b.maxDiscoveryDepth = depth;

  // Never follow external sites on hosted crawls.
  b.allowExternalLinks = false;
  return { ok: true, body: b };
}

/**
 * Clamps Gemini generateContent bodies on hosted keys (generationConfig.maxOutputTokens).
 */
export function clampHostedGeminiBody(body: unknown): { ok: true; body: unknown } | { ok: false; error: string } {
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: true, body: body ?? {} };
  }
  const b = { ...(body as Record<string, unknown>) };
  const gen =
    b.generationConfig && typeof b.generationConfig === 'object' && !Array.isArray(b.generationConfig)
      ? { ...(b.generationConfig as Record<string, unknown>) }
      : {};
  const raw = gen.maxOutputTokens;
  if (raw === undefined || raw === null) {
    gen.maxOutputTokens = HOSTED_MAX_TOKENS;
  } else {
    const n = Number(raw);
    gen.maxOutputTokens = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), HOSTED_MAX_TOKENS) : HOSTED_MAX_TOKENS;
  }
  b.generationConfig = gen;
  return { ok: true, body: b };
}

/** Gemini model actions allowed through the Worker proxy. */
export function isGeminiModelActionAllowed(subPath: string): boolean {
  return /^\/v1beta\/models\/[A-Za-z0-9._%-]+:(generateContent|streamGenerateContent|countTokens)$/.test(subPath);
}

/**
 * Reads a request body with a hard size cap. Rejects oversized bodies (413) and, when
 * `json` is true, malformed JSON (400). Empty bodies parse as `{}`.
 */
export async function readBody(request: Request, maxBytes: number, json = true): Promise<BodyResult<unknown>> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) return { ok: false, status: 413, error: 'Request body too large' };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: 'Could not read request body' };
  }
  if (text.length > maxBytes) return { ok: false, status: 413, error: 'Request body too large' };
  if (!json) return { ok: true, value: text, text };
  if (!text.trim()) return { ok: true, value: {}, text };
  try {
    return { ok: true, value: JSON.parse(text), text };
  } catch {
    return { ok: false, status: 400, error: 'Request body is not valid JSON' };
  }
}

// ---- Rate limiting ---------------------------------------------------------------------------

/**
 * Fixed-window counter kept in isolate memory. It is best-effort (each Worker isolate has its
 * own map, and it resets on eviction) but it is free, needs no binding, and blunts bursts from a
 * single client. For a global limit, bind Cloudflare's Rate Limiting API (see wrangler.jsonc).
 */
export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = () => Date.now(), private readonly maxKeys = 10_000) {}

  /** Returns true when the call is allowed. */
  check(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; retryAfterSec: number } {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      if (this.buckets.size >= this.maxKeys) this.prune(t);
      b = { count: 0, resetAt: t + windowMs };
      this.buckets.set(key, b);
    }
    b.count += 1;
    const allowed = b.count <= limit;
    return { allowed, remaining: Math.max(0, limit - b.count), retryAfterSec: Math.max(1, Math.ceil((b.resetAt - t) / 1000)) };
  }

  private prune(t: number): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}

/** Client address as seen by Cloudflare; falls back to a shared bucket when absent (local dev). */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
}

// ---- SSRF guards -----------------------------------------------------------------------------

function parseIpv4(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every(p => p >= 0 && p <= 255) ? parts : null;
}

/** True for loopback, private, link-local, CGNAT, multicast, unspecified and cloud-metadata ranges. */
export function isPrivateIp(ip: string): boolean {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = parseIpv4(raw);
  if (v4) {
    const [a, b] = v4;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && v4[2] === 0) return true; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }
  if (raw.includes(':')) {
    // IPv6. Normalise a few forms without pulling in a full parser.
    if (raw === '::' || raw === '::1') return true;
    if (raw.startsWith('::ffff:')) {
      const tail = raw.slice(7);
      return parseIpv4(tail) ? isPrivateIp(tail) : true;
    }
    if (/^fe[89ab]/.test(raw)) return true; // link-local fe80::/10
    if (/^f[cd]/.test(raw)) return true; // unique local fc00::/7
    if (/^ff/.test(raw)) return true; // multicast
    if (/^64:ff9b:/.test(raw)) return true; // NAT64 (could map to private v4)
    if (/^2002:/.test(raw)) return true; // 6to4 (embeds v4)
    return false;
  }
  return true; // not an IP literal at all: caller should only pass IPs here
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;

/**
 * Validates a hostname a user asked us to probe: DNS-shaped, with a public TLD, not an IP
 * literal, not localhost / .local / .internal / .arpa. Returns the lower-cased hostname or null.
 */
export function safePublicHostname(input: string): string | null {
  let host = String(input || '').trim().toLowerCase();
  if (!host) return null;
  host = host.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^[^@]*@/, '').replace(/:\d+$/, '');
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host || host.length > 253) return null;
  if (parseIpv4(host) || host.includes(':') || host.includes('[')) return null;
  if (!HOSTNAME_RE.test(host)) return null;
  if (host === 'localhost' || host.endsWith('.localhost')) return null;
  if (/\.(local|internal|intranet|home|lan|corp|arpa|onion|test|example|invalid)$/.test(host)) return null;
  return host;
}

/** Validates a full URL for outbound fetching: http(s) only, safe hostname, no credentials. */
export function safePublicUrl(input: string): URL | null {
  let u: URL;
  try { u = new URL(String(input || '').trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!safePublicHostname(u.hostname)) return null;
  return u;
}

export type DohFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Resolves a hostname through DNS-over-HTTPS and returns false when any answer points at a
 * private or reserved address. Resolution failures are treated as unsafe. Cloudflare's own
 * resolver is used so no extra binding is needed.
 */
export async function resolvesToPublicAddress(host: string, fetcher: DohFetch = fetch): Promise<boolean> {
  const lookup = async (type: 'A' | 'AAAA'): Promise<string[] | null> => {
    try {
      const res = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { accept: 'application/dns-json' },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { Status?: number; Answer?: Array<{ type: number; data: string }> };
      if (data.Status !== 0) return [];
      const want = type === 'A' ? 1 : 28;
      return (data.Answer || []).filter(a => a.type === want).map(a => a.data);
    } catch {
      return null;
    }
  };
  const [a, aaaa] = await Promise.all([lookup('A'), lookup('AAAA')]);
  if (a === null && aaaa === null) return false; // resolver unreachable: fail closed
  const addrs = [...(a || []), ...(aaaa || [])];
  if (addrs.length === 0) return false; // NXDOMAIN or no address records
  return addrs.every(ip => !isPrivateIp(ip));
}
