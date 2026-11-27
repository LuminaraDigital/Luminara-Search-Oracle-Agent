import { describe, expect, it } from 'vitest';
// The crawler ships as plain ESM with no build step; the guard uses only Node built-ins.
// @ts-expect-error untyped .mjs module
import {
  assertPublicTarget,
  assertPublicWebSocketTarget,
  installPublicRouteGuard,
  installWebSocketGuard,
  isPrivateIp,
  parsePublicHttpUrl,
  parsePublicWsUrl,
} from '../crawler/ssrf.mjs';
// @ts-expect-error untyped .mjs module
import { createSessionStore, isSessionOwner } from '../crawler/sessionStore.mjs';

describe('crawler SSRF guard', () => {
  it('flags reserved address ranges', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.0.10', '169.254.169.254', '100.100.1.1', '0.0.0.0', '::1', 'fe80::abcd', 'fd00::1', '::ffff:192.168.1.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('accepts public http(s) URLs only', () => {
    expect(parsePublicHttpUrl('https://example.com/page')?.hostname).toBe('example.com');
    expect(parsePublicHttpUrl('http://93.184.216.34/')?.hostname).toBe('93.184.216.34');
    for (const bad of [
      'file:///etc/passwd',
      'ftp://example.com/',
      'http://localhost:3001/health',
      'http://127.0.0.1/',
      'http://[::1]:8080/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/admin',
      'http://user:pass@example.com/',
      'http://intranet/',
      'http://printer.local/',
      'http://db.internal/',
      'not a url',
      '',
    ]) {
      expect(parsePublicHttpUrl(bad), bad).toBeNull();
    }
  });

  it('refuses hostnames that resolve to private addresses, and unresolved hosts', async () => {
    const resolver = (map: Record<string, string[]>) => async (host: string) => {
      if (!(host in map)) throw new Error('ENOTFOUND');
      return map[host].map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
    };
    const r = resolver({ 'example.com': ['93.184.216.34'], 'rebind.example.com': ['93.184.216.34', '127.0.0.1'], 'v6.example.com': ['fe80::1'] });
    expect((await assertPublicTarget('https://example.com/', r)).ok).toBe(true);
    expect((await assertPublicTarget('https://rebind.example.com/', r)).ok).toBe(false);
    expect((await assertPublicTarget('https://v6.example.com/', r)).ok).toBe(false);
    expect((await assertPublicTarget('https://missing.example.com/', r)).ok).toBe(false);
    expect((await assertPublicTarget('http://localhost/', r)).ok).toBe(false);
  });

  it('blocks expanded IPv6 ranges (loopback, ULA, link-local, multicast, IPv4-mapped, NAT64, unspecified) and non-80/443 ports', () => {
    for (const ip of [
      '::',
      '0:0:0:0:0:0:0:0',
      '::1',
      '0:0:0:0:0:0:0:1',
      '0000::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'fe80::1%eth0',
      'febf::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:192.168.1.1',
      '64:ff9b::127.0.0.1',
      '64:ff9b:1::1',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }

    expect(parsePublicHttpUrl('http://example.com:80/')?.hostname).toBe('example.com');
    expect(parsePublicHttpUrl('https://example.com:443/')?.hostname).toBe('example.com');
    expect(parsePublicHttpUrl('http://example.com:8080/')).toBeNull();
    expect(parsePublicHttpUrl('https://example.com:3001/')).toBeNull();
    expect(parsePublicHttpUrl('http://example.com:6379/')).toBeNull();
    expect(parsePublicHttpUrl('http://[0:0:0:0:0:0:0:1]/')).toBeNull();
    expect(parsePublicHttpUrl('http://[::ffff:127.0.0.1]/')).toBeNull();
  });

  it('enforces public WebSocket guard via page.routeWebSocket and keys route cache by port', async () => {
    expect(parsePublicWsUrl('wss://example.com/socket')?.hostname).toBe('example.com');
    expect(parsePublicWsUrl('ws://127.0.0.1/ws')).toBeNull();
    expect(parsePublicWsUrl('ws://[::1]/ws')).toBeNull();
    expect(parsePublicWsUrl('wss://example.com:8080/ws')).toBeNull();

    const resolver = async (host: string) =>
      host === 'example.com' ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }];
    expect((await assertPublicWebSocketTarget('wss://example.com/ws', resolver)).ok).toBe(true);
    expect((await assertPublicWebSocketTarget('wss://evil.example.com/ws', resolver)).ok).toBe(false);

    let wsHandler: ((ws: { url: () => string; close: (o: unknown) => void; connectToServer: () => void }) => Promise<void>) | null = null;
    const mockPage = {
      routeWebSocket: async (_pattern: unknown, handler: typeof wsHandler) => {
        wsHandler = handler;
      },
    };
    const installed = await installWebSocketGuard(mockPage, async (u: string) => (await assertPublicWebSocketTarget(u, resolver)).ok);
    expect(installed).toBe(true);

    let closed = false;
    let connected = false;
    await wsHandler!({
      url: () => 'ws://127.0.0.1:9222/devtools',
      close: () => { closed = true; },
      connectToServer: () => { connected = true; },
    });
    expect(closed).toBe(true);
    expect(connected).toBe(false);

    closed = false;
    connected = false;
    await wsHandler!({
      url: () => 'wss://example.com/live',
      close: () => { closed = true; },
      connectToServer: () => { connected = true; },
    });
    expect(closed).toBe(false);
    expect(connected).toBe(true);

    // Cache key must include port so allowing :443 never caches :8080 as allowed,
    // and credentialed URLs must be rejected even after caching the same host.
    let httpHandler: ((route: Record<string, unknown>) => Promise<unknown>) | null = null;
    const mockContext = {
      route: async (_pat: string, handler: typeof httpHandler) => { httpHandler = handler; },
    };
    await installPublicRouteGuard(mockContext, resolver);
    expect(await httpHandler!({ request: () => ({ url: () => 'https://example.com/' }), continue: () => 'ok', abort: () => 'blocked' })).toBe('ok');
    expect(await httpHandler!({ request: () => ({ url: () => 'https://example.com:8080/' }), continue: () => 'ok', abort: () => 'blocked' })).toBe('blocked');
    expect(await httpHandler!({ request: () => ({ url: () => 'https://user:pass@example.com/' }), continue: () => 'ok', abort: () => 'blocked' })).toBe('blocked');
  });

  it('validates 3xx redirects with maxRedirects:0, enforces hop cap, and prefers context.routeWebSocket (BLOCKER #3)', async () => {
    const resolver = async (host: string) =>
      host === 'example.com' || host === 'cdn.example.com'
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }];

    let httpHandler: ((route: Record<string, unknown>) => Promise<unknown>) | null = null;
    let contextWsInstalled = false;
    let pageWsInstalled = false;
    const mockContext = {
      route: async (_pat: string, handler: typeof httpHandler) => { httpHandler = handler; },
      routeWebSocket: async () => { contextWsInstalled = true; },
    };
    const guardPageWs = await installPublicRouteGuard(mockContext, resolver);
    expect(contextWsInstalled).toBe(true);
    await guardPageWs({ routeWebSocket: async () => { pageWsInstalled = true; } });
    expect(pageWsInstalled).toBe(false);

    // 3xx redirect to private/metadata target must be aborted.
    const abortPrivate = await httpHandler!({
      request: () => ({ url: () => 'https://example.com/go', method: () => 'GET' }),
      fetch: async () => ({ status: () => 302, headers: () => ({ location: 'http://169.254.169.254/latest/meta-data/' }) }),
      fulfill: () => 'fulfilled',
      abort: (reason: string) => `aborted:${reason}`,
      continue: () => 'continued',
    });
    expect(abortPrivate).toBe('aborted:blockedbyclient');

    // Valid public 3xx redirect is followed with maxRedirects:0 and fulfilled.
    const fetchCalls: Array<Record<string, unknown>> = [];
    const followPublic = await httpHandler!({
      request: () => ({ url: () => 'https://example.com/old', method: () => 'GET' }),
      fetch: async (opts: Record<string, unknown>) => {
        fetchCalls.push(opts);
        if (fetchCalls.length === 1) {
          return { status: () => 301, headers: () => ({ location: 'https://cdn.example.com/new' }) };
        }
        return { status: () => 200, headers: () => ({}) };
      },
      fulfill: () => 'fulfilled',
      abort: (reason: string) => `aborted:${reason}`,
      continue: () => 'continued',
    });
    expect(followPublic).toBe('fulfilled');
    expect(fetchCalls).toEqual([
      { maxRedirects: 0 },
      { url: 'https://cdn.example.com/new', maxRedirects: 0 },
    ]);

    // Redirect loops exceeding 5 hops must abort.
    const loopAbort = await httpHandler!({
      request: () => ({ url: () => 'https://example.com/loop', method: () => 'GET' }),
      fetch: async () => ({ status: () => 302, headers: () => ({ location: 'https://example.com/loop' }) }),
      fulfill: () => 'fulfilled',
      abort: (reason: string) => `aborted:${reason}`,
      continue: () => 'continued',
    });
    expect(loopAbort).toBe('aborted:blockedbyclient');
  });

  it('enforces tenant session ownership on getOwned and destroyOwned (H-03)', () => {
    const store = createSessionStore();
    const created = store.create({ accountKey: 'acct_A', browser: null, context: null, page: null });
    expect(created.ok).toBe(true);
    const id = created.session.id;

    expect(isSessionOwner(created.session, 'acct_A')).toBe(true);
    expect(isSessionOwner(created.session, 'acct_B')).toBe(false);
    expect(isSessionOwner(created.session, undefined)).toBe(false);

    expect(store.getOwned(id, 'acct_B')).toMatchObject({ ok: false, status: 403 });
    expect(store.getOwned(id, undefined)).toMatchObject({ ok: false, status: 403 });
    expect(store.getOwned(id, 'acct_A')).toMatchObject({ ok: true });

    // Cross-account destroy must return 403 and keep the session alive.
    expect(store.destroyOwned(id, 'acct_B')).toMatchObject({ ok: false, status: 403 });
    expect(store.size).toBe(1);
    expect(store.destroyOwned(id, 'acct_A')).toMatchObject({ ok: true });
    expect(store.size).toBe(0);
  });
});
