import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import { PRIVACY_HTML } from '../worker/privacyPolicy';
import { TERMS_HTML } from '../worker/termsPolicy';
import { PRIVACY_SECTIONS } from '../services/legal/privacyCopy';
import { SECURITY_HTML, SUBPROCESSORS, SUBPROCESSORS_HTML, trustPageResponse } from '../worker/trustPages';

function kv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
  } as unknown as KVNamespace;
}

const env = {
  ASSETS: { fetch: async () => new Response('<!doctype html><html><body>app</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }) } as unknown as Fetcher,
  LUMINARA_KV: kv(),
  WEBAPP_URL: 'https://luminarasuite.com/',
  ALLOWED_ORIGINS: 'https://luminarasuite.com',
} as Env;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
let ip = 0;
const req = (path: string) => new Request(`https://luminarasuite.com${path}`, { headers: { 'cf-connecting-ip': `10.77.0.${(ip++ % 250) + 1}` } });

const PUBLIC_TEXT = [SECURITY_HTML, SUBPROCESSORS_HTML, PRIVACY_HTML, TERMS_HTML];

describe('trust pages', () => {
  it('serves /security and /legal/subprocessors as HTML with security headers', async () => {
    for (const [path, marker] of [
      ['/security', 'Report a vulnerability'],
      ['/security/', 'Report a vulnerability'],
      ['/legal/subprocessors', 'Data it receives'],
      ['/subprocessors', 'Data it receives'],
    ] as const) {
      const res = await worker.fetch(req(path), env, ctx);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('content-security-policy')).toBeTruthy();
      expect(await res.text()).toContain(marker);
    }
  });

  it('leaves other paths alone', () => {
    expect(trustPageResponse('/securityx')).toBeNull();
    expect(trustPageResponse('/legal')).toBeNull();
  });

  it('lists every subprocessor that the privacy policy names', () => {
    const policy = PRIVACY_HTML;
    for (const name of ['Cloudflare', 'Firebase', 'Stripe', 'Telegram', 'Resend', 'Sentry', 'Groq', 'NVIDIA', 'Gemini', 'OpenRouter', 'Typesafe', 'Tavily', 'Exa', 'Firecrawl', 'DataForSEO', 'PageSpeed', 'Toncenter']) {
      expect(policy, name).toContain(name);
      expect(SUBPROCESSORS.some((s) => s.name.includes(name)), name).toBe(true);
    }
  });

  it('names Resend and Sentry in the privacy policy, including the overseas disclosure', () => {
    const overseas = PRIVACY_SECTIONS.flatMap((s) => s.paragraphs || []).find((p) => p.startsWith('Overseas disclosure'));
    expect(overseas).toContain('Resend');
    expect(overseas).toContain('Sentry');
  });

  it('renders the retention table in the static privacy page', () => {
    expect(PRIVACY_HTML).toContain('<table class="policy-table">');
    expect(PRIVACY_HTML).toContain('<th scope="row">Database backups</th>');
  });

  it('describes sync as automatic and keys as never uploaded unencrypted', () => {
    expect(PRIVACY_HTML).toContain('There is no switch to turn this off.');
    expect(PRIVACY_HTML).toContain('If encryption fails, the keys stay on that device and are not uploaded.');
    expect(PRIVACY_HTML).not.toContain('turn on workspace sync');
    expect(TERMS_HTML).not.toContain('If you enable workspace sync');
  });

  it('keeps phone numbers, tax lines, certifications, and dashes out of public pages', () => {
    for (const html of PUBLIC_TEXT) {
      expect(html).not.toMatch(/\+61|\b04\d{2}\s?\d{3}\s?\d{3}\b/);
      expect(html).not.toMatch(/\u2014|\u2013/);
    }
    for (const html of [SECURITY_HTML, SUBPROCESSORS_HTML]) {
      expect(html).not.toMatch(/GST|SOC ?2 (certified|compliant)|ISO 27001 (certified|compliant)/i);
      expect(html).toContain('LUMINARA DIGITAL PTY LTD (ABN 90 693 125 281)');
      expect(html).toContain('Founded 2025');
    }
  });

  it('uses a footer colour that passes WCAG AA on the terms page', () => {
    expect(TERMS_HTML).not.toContain('color: #64748b');
    expect(TERMS_HTML).toContain('footer { margin-top: 2.5rem; font-size: 0.75rem; color: #94a3b8; }');
  });
});
