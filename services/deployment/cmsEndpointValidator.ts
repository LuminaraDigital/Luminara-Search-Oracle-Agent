/**
 * Validates a user-entered CMS endpoint before any credential is sent to it.
 * Pure and browser-safe; mirrors the rules in worker/security.ts without importing Worker code.
 */

export type CmsEndpointValidation = { ok: true; url: string } | { ok: false; error: string };

const BLOCKED_HOST_SUFFIXES = [
  '.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp',
  '.arpa', '.test', '.example', '.invalid', '.onion',
];

function parseIpv4(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

function isPrivateIpv4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return a >= 224;
}

function expandIpv6(input: string): number[] | null {
  let host = input;
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
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

function embeddedV4(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function isPrivateIpv6(g: number[]): boolean {
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1, deprecated IPv4-compatible
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateIpv4(embeddedV4(g[6], g[7]));
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true;
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 can map to private v4
  if (g[0] === 0x2002) return isPrivateIpv4(embeddedV4(g[1], g[2]));
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
  return false;
}

export function validateCmsEndpoint(input: string): CmsEndpointValidation {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'Enter your site URL, for example https://your-site.com.' };

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: 'Enter a full URL, for example https://your-site.com.' };
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'The site URL must start with https://.' };
  if (u.username || u.password) return { ok: false, error: 'Remove the username or password from the URL.' };

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const privateHost = { ok: false as const, error: 'That address is private or local. Use your public site URL.' };

  if (host.startsWith('[')) {
    const groups = expandIpv6(host.slice(1, -1));
    if (!groups || isPrivateIpv6(groups)) return privateHost;
  } else if (/^[\d.]+$/.test(host)) {
    const v4 = parseIpv4(host);
    if (!v4 || isPrivateIpv4(v4)) return privateHost;
  } else {
    if (!host.includes('.') || host === 'localhost') return privateHost;
    if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return privateHost;
  }

  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, '')}` };
}
