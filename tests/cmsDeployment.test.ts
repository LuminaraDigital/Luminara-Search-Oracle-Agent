import { describe, expect, it, beforeEach, vi } from 'vitest';
import { cmsDeploymentService, RemediationPayload, DeploymentConfig } from '../services/deployment/cmsDeploymentService';

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
      { platform: 'wordpress', authToken: 'user:pass', endpoint: 'https://ok.example' },
      payload
    );
    expect(res.success).toBe(false);
  });
});
