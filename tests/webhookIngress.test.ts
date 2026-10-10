import { describe, it, expect } from 'vitest';
import {
  handleWebhookIngressRoute,
  extractWebhookSecret,
  normalizeTargetUrl,
} from '../worker/webhookIngressService';
import type { Env } from '../worker/env';

describe('Webhook Ingress Service', () => {
  const mockEnv: Env = {
    ASSETS: {} as any,
    WEBAPP_URL: 'https://app.luminara.ai',
    INGRESS_WEBHOOK_SECRET: 'test-secret-12345',
  };

  it('normalizes target URLs correctly', () => {
    expect(normalizeTargetUrl('example.com')).toBe('https://example.com/');
    expect(normalizeTargetUrl('https://demo.app/blog')).toBe('https://demo.app/blog');
    expect(normalizeTargetUrl('   http://my-site.org   ')).toBe('http://my-site.org/');
    expect(normalizeTargetUrl('')).toBeNull();
    expect(normalizeTargetUrl('not a url')).toBeNull();
    expect(normalizeTargetUrl('ftp://invalid.com')).toBeNull();
  });

  it('extracts secrets from path, Bearer authorization, or custom header', () => {
    // 1. Path
    const req1 = new Request('https://api.luminara.ai/api/webhooks/ingress/my-path-secret', { method: 'POST' });
    expect(extractWebhookSecret(req1, '/api/webhooks/ingress/my-path-secret')).toBe('my-path-secret');

    // 2. Bearer header
    const req2 = new Request('https://api.luminara.ai/webhooks/ingress', {
      method: 'POST',
      headers: { Authorization: 'Bearer my-bearer-token' },
    });
    expect(extractWebhookSecret(req2, '/webhooks/ingress')).toBe('my-bearer-token');

    // 3. Custom header
    const req3 = new Request('https://api.luminara.ai/webhooks/ingress', {
      method: 'POST',
      headers: { 'x-webhook-secret': 'my-custom-secret' },
    });
    expect(extractWebhookSecret(req3, '/webhooks/ingress')).toBe('my-custom-secret');

    // 4. Missing
    const req4 = new Request('https://api.luminara.ai/webhooks/ingress', { method: 'POST' });
    expect(extractWebhookSecret(req4, '/webhooks/ingress')).toBeNull();
  });

  it('rejects non-POST methods with 405', async () => {
    const req = new Request('https://api.luminara.ai/api/webhooks/ingress', { method: 'GET' });
    const res = await handleWebhookIngressRoute(req, mockEnv, '/api/webhooks/ingress');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(405);
  });

  it('fails closed with 503 if no webhook secret is configured', async () => {
    const unconfiguredEnv = { ...mockEnv, INGRESS_WEBHOOK_SECRET: undefined, AUTH_WEBHOOK_SECRET: undefined };
    const req = new Request('https://api.luminara.ai/api/webhooks/ingress', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-secret-12345' },
    });
    const res = await handleWebhookIngressRoute(req, unconfiguredEnv, '/api/webhooks/ingress');
    expect(res?.status).toBe(503);
    const body = await res?.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
  });

  it('rejects unauthorized requests with 401', async () => {
    const req = new Request('https://api.luminara.ai/api/webhooks/ingress', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret' },
      body: JSON.stringify({ targetUrl: 'example.com' }),
    });
    const res = await handleWebhookIngressRoute(req, mockEnv, '/api/webhooks/ingress');
    expect(res?.status).toBe(401);
  });

  it('rejects invalid JSON body with 400', async () => {
    const req = new Request('https://api.luminara.ai/api/webhooks/ingress', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-secret-12345',
        'content-type': 'application/json',
      },
      body: 'not a json',
    });
    const res = await handleWebhookIngressRoute(req, mockEnv, '/api/webhooks/ingress');
    expect(res?.status).toBe(400);
  });

  it('rejects missing or invalid targetUrl with 400', async () => {
    const req = new Request('https://api.luminara.ai/api/webhooks/ingress', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-secret-12345',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ targetUrl: '' }),
    });
    const res = await handleWebhookIngressRoute(req, mockEnv, '/api/webhooks/ingress');
    expect(res?.status).toBe(400);
  });

  it('dispatches valid webhook payload successfully with 200 receipt', async () => {
    const req = new Request('https://api.luminara.ai/api/webhooks/ingress', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-secret-12345',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetUrl: 'acme.org',
        event: 'site_deployed',
        branch: 'main',
        commit: '9f83a21',
      }),
    });
    const res = await handleWebhookIngressRoute(req, mockEnv, '/api/webhooks/ingress');
    expect(res?.status).toBe(200);

    const body = await res?.json() as {
      ok: boolean;
      auditId: string;
      targetUrl: string;
      event: string;
      status: string;
    };
    expect(body.ok).toBe(true);
    expect(body.auditId).toMatch(/^ing-\d+-[a-f0-9]{8}$/);
    expect(body.targetUrl).toBe('https://acme.org/');
    expect(body.event).toBe('site_deployed');
    expect(body.status).toBe('dispatched');
  });

  it('accepts secret via path parameter', async () => {
    const req = new Request('https://api.luminara.ai/webhooks/ingress/test-secret-12345', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUrl: 'brand.co' }),
    });
    const res = await handleWebhookIngressRoute(req, mockEnv, '/webhooks/ingress/test-secret-12345');
    expect(res?.status).toBe(200);
    const body = await res?.json() as { ok: boolean; targetUrl: string };
    expect(body.ok).toBe(true);
    expect(body.targetUrl).toBe('https://brand.co/');
  });
});
