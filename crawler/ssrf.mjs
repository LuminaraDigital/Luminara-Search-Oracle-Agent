/**
 * SSRF guard for the crawler: only public http(s) targets may be fetched.
 * Pure helpers (no express, no browser) so the Vitest suite can cover them.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function parseIpv4(ip) {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every(p => p >= 0 && p <= 255) ? parts : null;
}

function isPrivateIpv4([a, b, c]) {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return a >= 224;
}

function expandIpv6(input) {
  let host = String(input || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const zoneIdx = host.indexOf('%');
  if (zoneIdx !== -1) host = host.slice(0, zoneIdx);
  const v4Tail = host.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Tail) {
    const v4 = parseIpv4(v4Tail[2]);
    if (!v4) return null;
    host = `${v4Tail[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...new Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  const nums = groups.map(g => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

function isPrivateIpv6(g) {
  // Unspecified (::), loopback (::1), and deprecated IPv4-compatible (::/96)
  if (g.slice(0, 6).every(x => x === 0)) return true;
  // IPv4-mapped (::ffff:0:0/96) and IPv4-translated (::ffff:0:0:0/96)
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return true;
  if (g.slice(0, 4).every(x => x === 0) && g[4] === 0xffff && g[5] === 0) return true;
  // ULA (fc00::/7)
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  // Link-local (fe80::/10) and deprecated site-local (fec0::/10)
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;
  // Multicast (ff00::/8)
  if ((g[0] & 0xff00) === 0xff00) return true;
  // NAT64 (64:ff9b::/96 and 64:ff9b:1::/48)
  if (g[0] === 0x0064 && g[1] === 0xff9b) return true;
  // 6to4 (2002::/16)
  if (g[0] === 0x2002) return true;
  // Teredo (2001::/32), benchmarking (2001:2::/48), documentation (2001:db8::/32), ORCHID (2001:10::/28)
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0x0002 || g[1] === 0x0db8 || (g[1] & 0xfff0) === 0x0010)) return true;
  // Discard-only (100::/64)
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
  return false;
}

/** Loopback, private, link-local, CGNAT, multicast, unspecified and cloud-metadata ranges. */
export function isPrivateIp(ip) {
  const raw = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = parseIpv4(raw);
  if (v4) return isPrivateIpv4(v4);
  if (raw.includes(':')) {
    const groups = expandIpv6(raw);
    return groups ? isPrivateIpv6(groups) : true;
  }
  return true;
}

const BLOCKED_TLD_RE = /\.(local|internal|intranet|home|lan|corp|arpa|onion|test|example|invalid|localhost)$/;
const ALLOWED_PORTS = new Set(['', '80', '443']);
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const WS_PROTOCOLS = new Set(['ws:', 'wss:']);

function parsePublicUrlWithProtocols(input, protocols) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { return null; }
  if (!protocols.has(u.protocol)) return null;
  if (u.username || u.password) return null;
  if (!ALLOWED_PORTS.has(u.port)) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  if (host === 'localhost' || BLOCKED_TLD_RE.test(host)) return null;
  const bare = host.replace(/^\[|\]$/g, '');
  if (bare.includes(':') || isIP(bare)) return isPrivateIp(bare) ? null : u;
  if (!host.includes('.')) return null; // single-label names are intranet hosts
  return u;
}

/**
 * Syntactic check: returns a parsed URL when it is http(s) on port 80/443/default, carries no
 * credentials, and its host is neither localhost-like nor an IP literal in a reserved range.
 */
export function parsePublicHttpUrl(input) {
  return parsePublicUrlWithProtocols(input, HTTP_PROTOCOLS);
}

/** Same public host/port check for WebSocket targets (ws/wss). */
export function parsePublicWsUrl(input) {
  return parsePublicUrlWithProtocols(input, WS_PROTOCOLS);
}

async function assertPublicUrlWithProtocols(input, protocols, label, resolver) {
  const u = parsePublicUrlWithProtocols(input, protocols);
  if (!u) return { ok: false, error: `Only public ${label} URLs on ports 80/443 can be reached` };
  const bare = u.hostname.replace(/^\[|\]$/g, '');
  if (bare.includes(':') || isIP(bare)) return { ok: true, url: u };
  let addrs;
  try {
    addrs = await resolver(bare);
  } catch {
    return { ok: false, error: 'Target host could not be resolved' };
  }
  const list = (Array.isArray(addrs) ? addrs : [addrs]).map(a => (typeof a === 'string' ? a : a && a.address)).filter(Boolean);
  if (list.length === 0) return { ok: false, error: 'Target host could not be resolved' };
  if (list.some(isPrivateIp)) return { ok: false, error: 'Target host resolves to a private or reserved address' };
  return { ok: true, url: u };
}

/**
 * Resolves the host and refuses targets whose addresses fall in a reserved range.
 * `resolver` is injectable for tests; the default is the system resolver.
 */
export async function assertPublicTarget(input, resolver = host => lookup(host, { all: true })) {
  return assertPublicUrlWithProtocols(input, HTTP_PROTOCOLS, 'http(s)', resolver);
}

export async function assertPublicWebSocketTarget(input, resolver = host => lookup(host, { all: true })) {
  return assertPublicUrlWithProtocols(input, WS_PROTOCOLS, 'ws(s)', resolver);
}

const MAX_REDIRECT_HOPS = 5;

/**
 * Hooks Playwright `context.routeWebSocket` or `page.routeWebSocket` (when available) so
 * pages and popups cannot open WebSockets to private/loopback addresses or non-80/443 ports.
 */
export async function installWebSocketGuard(target, checkUrl = async url => (await assertPublicWebSocketTarget(url)).ok) {
  if (!target || typeof target.routeWebSocket !== 'function') return false;
  await target.routeWebSocket(/.*/, async ws => {
    const allowed = await checkUrl(ws.url()).catch(() => false);
    if (!allowed) {
      ws.close({ code: 1008, reason: 'Blocked by SSRF policy' });
      return;
    }
    ws.connectToServer();
  });
  return true;
}

/**
 * Installs HTTP (with 3xx redirect re-validation) and WebSocket public-target SSRF guards
 * on a Playwright BrowserContext. Cache keys include protocol + host + port and reject
 * credentialed URLs before cache lookup.
 */
export async function installPublicRouteGuard(context, resolver) {
  const originCache = new Map();
  async function checkCached(reqUrl, validator) {
    let key;
    try {
      const u = new URL(reqUrl);
      if (u.username || u.password) return false;
      key = `${u.protocol}//${u.host.toLowerCase()}`;
    } catch {
      return false;
    }
    const cached = originCache.get(key);
    if (cached && Date.now() - cached.time < 3000) return cached.verdict;
    const verdict = (await validator(reqUrl, resolver)).ok;
    originCache.set(key, { verdict, time: Date.now() });
    return verdict;
  }
  const isRoutableHttp = reqUrl => (/^(data|blob|about):/i.test(reqUrl) ? true : checkCached(reqUrl, assertPublicTarget));
  const isRoutableWs = wsUrl => checkCached(wsUrl, assertPublicWebSocketTarget);

  await context.route('**/*', async route => {
    const initialUrl = route.request().url();
    if (/^(data|blob|about):/i.test(initialUrl)) return route.continue();
    if (!(await isRoutableHttp(initialUrl))) return route.abort('blockedbyclient');
    if (typeof route.fetch !== 'function') return route.continue();

    let currentUrl = initialUrl;
    let method = typeof route.request().method === 'function' ? String(route.request().method() || 'GET').toUpperCase() : 'GET';
    let switchedToGet = false;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      let response;
      try {
        const fetchOpts =
          hop === 0
            ? { maxRedirects: 0 }
            : switchedToGet
              ? { url: currentUrl, method: 'GET', postData: '', maxRedirects: 0 }
              : { url: currentUrl, maxRedirects: 0 };
        response = await route.fetch(fetchOpts);
      } catch {
        return route.abort('blockedbyclient');
      }
      const status = typeof response.status === 'function' ? response.status() : 200;
      const headers = typeof response.headers === 'function' ? response.headers() : {};
      const location = headers?.location ?? headers?.Location ?? '';
      if (status < 300 || status >= 400 || !location) {
        return route.fulfill({ response });
      }
      if (hop === MAX_REDIRECT_HOPS) {
        return route.abort('blockedbyclient');
      }
      let nextUrl;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        return route.abort('blockedbyclient');
      }
      if (!(await assertPublicTarget(nextUrl, resolver)).ok) {
        return route.abort('blockedbyclient');
      }
      if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
        method = 'GET';
        switchedToGet = true;
      }
      currentUrl = nextUrl;
    }
    return route.abort('blockedbyclient');
  });

  const contextWsGuarded = await installWebSocketGuard(context, isRoutableWs);
  if (!contextWsGuarded && typeof context.on === 'function') {
    context.on('page', p => { void installWebSocketGuard(p, isRoutableWs).catch(() => {}); });
  }
  return page => (contextWsGuarded ? Promise.resolve(true) : installWebSocketGuard(page, isRoutableWs));
}
