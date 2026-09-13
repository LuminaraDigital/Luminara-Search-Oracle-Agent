import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  cmsDeploymentService,
  validateCmsEndpoint,
  RemediationPayload,
  DeploymentConfig,
} from '../services/deployment/cmsDeploymentService';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
};

if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}
(globalThis as any).localStorage = mockLocalStorage;

describe('CmsDeploymentService', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('generates standard unified diff format', () => {
    const original = '{"@type": "WebPage"}';
    const updated = '{\n  "@type": "Organization",\n  "name": "Luminara"\n}';

    const diff = cmsDeploymentService.generateUnifiedDiff(original, updated, 'schema.json');
    expect(diff).toContain('--- a/schema.json (Existing State)');
    expect(diff).toContain('+++ b/schema.json (Luminara AEO Remediated)');
    expect(diff).toContain('- {"@type": "WebPage"}');
    expect(diff).toContain('+   "@type": "Organization",');
  });

  it('persists and retrieves CMS deployment credentials in localStorage', () => {
    const wpConfig: Partial<DeploymentConfig> = {
      platform: 'wordpress',
      endpoint: 'https://mysite.com',
      authToken: 'test-app-password-token',
    };

    cmsDeploymentService.saveConfig('wordpress', wpConfig);
    const retrieved = cmsDeploymentService.getSavedConfig('wordpress');
    expect(retrieved.endpoint).toBe('https://mysite.com');
    expect(retrieved.authToken).toBe('test-app-password-token');
  });

  it('generates client-side zero-code CDN script tag with base64 encoding', () => {
    const payload: RemediationPayload = {
      domain: 'samplebrand.com',
      title: 'Sample Remediation',
      schemaJsonLd: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Corporation",
        "name": "Sample Brand"
      })
    };

    const script = cmsDeploymentService.generateClientScriptTag(payload);
    expect(script).toContain('<!-- Luminara AEO Autonomous Injector (Zero-Code) -->');
    expect(script).toContain('application/ld+json');
    expect(script).toContain('decodeURIComponent(atob(');
    expect(script).toContain('CSP:');
  });

  it('blocks WordPress deploy when schema JSON is invalid', async () => {
    const payload: RemediationPayload = {
      domain: 'bad.example',
      title: 'Broken',
      schemaJsonLd: '{not-json',
    };
    const res = await cmsDeploymentService.deployToWordPress(
      { platform: 'wordpress', authToken: 'user:pass' },
      payload
    );
    expect(res.success).toBe(false);
    expect(res.deploymentId.startsWith('gate-')).toBe(true);
    expect(res.validationErrors?.some((i) => i.severity === 'critical')).toBe(true);
  });

  it('reports failure when WordPress fetch returns null (no fake success)', async () => {
    const { vi } = await import('vitest');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(null as any);
    const payload: RemediationPayload = {
      domain: 'ok.example',
      title: 'Ok',
      schemaJsonLd: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Ok',
      }),
    };
    const res = await cmsDeploymentService.deployToWordPress(
      { platform: 'wordpress', authToken: 'user:pass', endpoint: 'https://ok-site.com' },
      payload
    );
    expect(res.success).toBe(false);
  });
});

const validPayload = (name = 'Acme'): RemediationPayload => ({
  domain: 'attacker-audited.com',
  title: 'Remediation',
  schemaJsonLd: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name }),
});

describe('CMS endpoint steering protection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not derive the WordPress endpoint from the audited domain', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await cmsDeploymentService.deployToWordPress(
      { platform: 'wordpress', authToken: 'user:pass' },
      validPayload()
    );
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/site URL rejected/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects http endpoints without sending credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(validateCmsEndpoint('http://my-site.com').ok).toBe(false);
    const res = await cmsDeploymentService.deployToWordPress(
      { platform: 'wordpress', authToken: 'user:pass', endpoint: 'http://my-site.com' },
      validPayload()
    );
    expect(res.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    'https://localhost',
    'https://wp.localhost',
    'https://printer.local',
    'https://db.internal',
    'https://intranet',
    'https://127.0.0.1',
    'https://2130706433',
    'https://0.0.0.0',
    'https://10.0.0.5',
    'https://172.16.0.1',
    'https://172.31.255.255',
    'https://192.168.1.1',
    'https://169.254.169.254',
    'https://100.64.0.1',
    'https://[::1]',
    'https://[::]',
    'https://[fc00::1]',
    'https://[fd12:3456::1]',
    'https://[fe80::1]',
    'https://[::ffff:127.0.0.1]',
    'https://[::ffff:10.0.0.1]',
    'https://user:pass@my-site.com',
    'https://user@my-site.com',
    'ftp://my-site.com',
    'my-site.com',
    '',
  ])('rejects %s', (url) => {
    expect(validateCmsEndpoint(url).ok).toBe(false);
  });

  it.each([
    ['https://my-site.com', 'https://my-site.com'],
    ['https://blog.my-site.com/wp/', 'https://blog.my-site.com/wp'],
    ['https://my-site.com:8443', 'https://my-site.com:8443'],
    ['https://172.32.0.1', 'https://172.32.0.1'],
    ['https://[2606:4700::1111]', 'https://[2606:4700::1111]'],
  ])('accepts public https endpoint %s', (input, normalized) => {
    expect(validateCmsEndpoint(input)).toEqual({ ok: true, url: normalized });
  });

  it('sends the canonical, HTML-escaped schema only to the explicit endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const res = await cmsDeploymentService.deployToWordPress(
      { platform: 'wordpress', authToken: 'user:pass', endpoint: 'https://my-site.com/' },
      validPayload('Scripts & <Co>')
    );
    expect(res.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://my-site.com/wp-json/wp/v2/settings');
    const sent = JSON.parse(String((init as RequestInit).body)).luminara_aeo_schema as string;
    expect(sent).not.toMatch(/[<>&]/);
    expect(JSON.parse(sent).name).toBe('Scripts & <Co>');
  });

  it('Webflow custom code cannot contain a script breakout', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const blocked = await cmsDeploymentService.deployToWebflow(
      { platform: 'webflow', authToken: 't', siteId: 's' },
      validPayload('</script><script>alert(1)</script>')
    );
    expect(blocked.success).toBe(false);
    expect(blocked.deploymentId.startsWith('gate-')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
