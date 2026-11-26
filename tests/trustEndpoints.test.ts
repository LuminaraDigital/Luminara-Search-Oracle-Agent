import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import { HTML_CSP, HTML_CSP_REPORT_ONLY, HSTS_VALUE, withSecurityHeaders } from '../worker/security';
import { SECURITY_CONTACT, deepHealth, securityTxt, summarizeCspReports } from '../worker/trustEndpoints';
import { createSqliteD1 } from './helpers/sqliteD1';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function kv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => void store.set(key, value),
    delete: async (key: string) => void store.delete(key),
  } as unknown as KVNamespace;
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) } as unknown as Fetcher,
    LUMINARA_KV: kv(),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://www.luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://www.luminarasuite.com',
    ...overrides,
  } as Env;
}

const get = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers || {});
  headers.set('cf-connecting-ip', '10.7.7.1');
  return new Request(`https://www.luminarasuite.com${path}`, { ...init, headers });
};

describe('report-only CSP', () => {
  it('keeps the enforced CSP and adds the tighter policy as report-only on HTML', () => {
    const res = withSecurityHeaders(new Response('<p>x</p>', { headers: { 'content-type': 'text/html' } }));
    expect(res.headers.get('Content-Security-Policy')).toBe(HTML_CSP);
    expect(res.headers.get('Content-Security-Policy-Report-Only')).toBe(HTML_CSP_REPORT_ONLY);
  });

  it('names connect and frame hosts instead of any https origin and drops localhost', () => {
    const connect = HTML_CSP_REPORT_ONLY.split('; ').find((d) => d.startsWith('connect-src')) || '';
    const frame = HTML_CSP_REPORT_ONLY.split('; ').find((d) => d.startsWith('frame-src')) || '';
    expect(connect.split(' ')).not.toContain('https:');
    expect(connect.split(' ')).not.toContain('wss:');
    expect(connect).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(frame.split(' ')).not.toContain('https:');
    expect(HTML_CSP_REPORT_ONLY).toContain('report-uri /api/csp-report');
    expect(HTML_CSP_REPORT_ONLY).toContain("object-src 'none'");
  });

  it('does not add a CSP to JSON responses', () => {
    const res = withSecurityHeaders(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    expect(res.headers.get('Content-Security-Policy-Report-Only')).toBeNull();
    expect(res.headers.get('Strict-Transport-Security')).toBe(HSTS_VALUE);
  });

  it('HSTS is one year, all subdomains, preload-eligible', () => {
    expect(HSTS_VALUE).toBe('max-age=31536000; includeSubDomains; preload');
  });
});

describe('CSP report sink', () => {
  it('keeps only directive, blocked origin and document path', () => {
    const legacy = summarizeCspReports({
      'csp-report': {
        'effective-directive': 'connect-src',
        'blocked-uri': 'https://evil.example/steal?token=abc',
        'document-uri': 'https://www.luminarasuite.com/app?email=a@b.c',
      },
    });
    expect(legacy).toEqual([{ directive: 'connect-src', blocked: 'https://evil.example', documentPath: '/app' }]);
    const modern = summarizeCspReports([
      { type: 'csp-violation', body: { effectiveDirective: 'frame-src', blockedURL: 'inline', documentURL: 'https://www.luminarasuite.com/' } },
    ]);
    expect(modern).toEqual([{ directive: 'frame-src', blocked: 'inline', documentPath: '/' }]);
    expect(JSON.stringify(legacy)).not.toContain('token');
  });

  it('accepts a POST with 204 and refuses oversized bodies', async () => {
    const ok = await worker.fetch(
      get('/api/csp-report', {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report' },
        body: JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'https://x.example/a.png' } }),
      }),
      env(),
      ctx,
    );
    expect(ok.status).toBe(204);
    const big = await worker.fetch(
      get('/api/csp-report', { method: 'POST', headers: { 'content-type': 'application/csp-report' }, body: 'x'.repeat(20_000) }),
      env(),
      ctx,
    );
    expect(big.status).toBe(413);
  });
});

describe('security.txt', () => {
  it('names the serving host as Canonical, the contact, the policy, and an Expires under a year away', () => {
    const now = Date.UTC(2026, 10, 26);
    const txt = securityTxt('www.luminarasuite.com', now);
    expect(txt).toContain(`Contact: ${SECURITY_CONTACT}`);
    expect(txt).toContain('Canonical: https://www.luminarasuite.com/.well-known/security.txt');
    expect(txt).toContain('Policy: https://github.com/LuminaraDigital/Luminara-Search-Oracle-Agent/blob/main/SECURITY.md');
    const expires = Date.parse(/Expires: (\S+)/.exec(txt)![1]);
    expect(expires).toBeGreaterThan(now);
    expect(expires - now).toBeLessThan(365 * 24 * 3600 * 1000);
  });

  it('is served by the Worker as text/plain', async () => {
    const res = await worker.fetch(get('/.well-known/security.txt'), env({ ENVIRONMENT: 'production' } as Partial<Env>), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('Canonical: https://www.luminarasuite.com/.well-known/security.txt');
  });
});

describe('deep health', () => {
  it('reports D1 and KV reachability without config values', async () => {
    const res = await worker.fetch(get('/api/health/deep'), env(), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; checks: Record<string, string> };
    expect(body.ok).toBe(true);
    expect(body.checks).toEqual({ d1: 'ok', kv: 'ok', auditQueue: 'unbound' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 503 when D1 fails', async () => {
    const broken = { prepare: () => ({ first: async () => { throw new Error('d1 down'); } }) } as unknown as D1Database;
    const res = await deepHealth(env({ DB: broken }));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { checks: { d1: string } };
    expect(body.checks.d1).toBe('fail');
    expect(JSON.stringify(body)).not.toContain('d1 down');
  });
});
