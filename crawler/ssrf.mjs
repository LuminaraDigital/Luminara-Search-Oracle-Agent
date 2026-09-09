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

/** Loopback, private, link-local, CGNAT, multicast, unspecified and cloud-metadata ranges. */
export function isPrivateIp(ip) {
  const raw = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = parseIpv4(raw);
  if (v4) {
    const [a, b, c] = v4;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && c === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (raw.includes(':')) {
    if (raw === '::' || raw === '::1') return true;
    if (raw.startsWith('::ffff:')) {
      const tail = raw.slice(7);
      return parseIpv4(tail) ? isPrivateIp(tail) : true;
    }
    if (/^fe[89ab]/.test(raw)) return true;
    if (/^f[cd]/.test(raw)) return true;
    if (/^ff/.test(raw)) return true;
    if (/^64:ff9b:/.test(raw)) return true;
    if (/^2002:/.test(raw)) return true;
    return false;
  }
  return true;
}

const BLOCKED_TLD_RE = /\.(local|internal|intranet|home|lan|corp|arpa|onion|test|example|invalid|localhost)$/;

/**
 * Syntactic check: returns a parsed URL when it is http(s), carries no credentials, and its host
 * is neither localhost-like nor an IP literal in a reserved range. Returns null otherwise.
 */
export function parsePublicHttpUrl(input) {
  let u;
  try { u = new URL(String(input || '').trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  if (host === 'localhost' || BLOCKED_TLD_RE.test(host)) return null;
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return isPrivateIp(bare) ? null : u;
  if (!host.includes('.')) return null; // single-label names are intranet hosts
  return u;
}

/**
 * Resolves the host and refuses targets whose addresses fall in a reserved range.
 * `resolver` is injectable for tests; the default is the system resolver.
 */
export async function assertPublicTarget(input, resolver = host => lookup(host, { all: true })) {
  const u = parsePublicHttpUrl(input);
  if (!u) return { ok: false, error: 'Only public http(s) URLs can be crawled' };
  const bare = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return { ok: true, url: u };
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
