import { describe, expect, it, vi } from 'vitest';
import {
  enforceDualRateLimit,
  enforceEdgeBindingLimit,
  projectAdminUser,
  rateLimitHeaders,
  rateLimitedResponse,
  resolveOAuthSigningSecret,
  sanitizeWorkspaceWrite,
} from '../worker/securityHardening';
import type { Env } from '../worker/env';

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

describe('securityHardening', () => {
  it('rejects privilege and unknown workspace fields', () => {
    expect(sanitizeWorkspaceWrite({ plan: 'agency' }).ok).toBe(false);
    expect(sanitizeWorkspaceWrite({ role: 'admin' }).ok).toBe(false);
    expect(sanitizeWorkspaceWrite({ accountId: 'x' }).ok).toBe(false);
    expect(sanitizeWorkspaceWrite({ unexpected: 1 }).ok).toBe(false);
  });

  it('allow-lists storage, keys, encryptedKeys', () => {
    const ok = sanitizeWorkspaceWrite({
      storage: { luminara_business_dna: '{}' },
      keys: { groq: 'sk-test' },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.payload.storage?.luminara_business_dna).toBe('{}');
      expect(ok.payload.keys?.groq).toBe('sk-test');
    }
  });

  it('projects admin users without email or telegram ids', () => {
    const row = projectAdminUser({
      id: 'fb:abc',
      source: 'firebase',
      account_id: 'acct-1',
      email: 'secret@example.com',
      telegram_id: '99',
      firebase_uid: 'abc',
      created_at: 1,
      last_seen_at: 2,
    });
    expect(row).toEqual({
      id: 'fb:abc',
      source: 'firebase',
      accountId: 'acct-1',
      createdAt: 1,
      lastSeenAt: 2,
      hasEmail: true,
      hasTelegram: true,
      hasFirebase: true,
    });
    expect(JSON.stringify(row)).not.toContain('secret@example.com');
    expect(JSON.stringify(row)).not.toContain('99');
  });

  it('fails closed on OAuth secret in production', () => {
    const prod = resolveOAuthSigningSecret({ ENVIRONMENT: 'production' } as Env);
    expect(prod.ok).toBe(false);

    const withSecret = resolveOAuthSigningSecret({
      ENVIRONMENT: 'production',
      MCP_OAUTH_SECRET: 'prod-secret',
    } as Env);
    expect(withSecret.ok).toBe(true);
    if (withSecret.ok) expect(withSecret.secret).toBe('prod-secret');

    const local = resolveOAuthSigningSecret({
      ENVIRONMENT: 'development',
      BOT_TOKEN: 'bot-fallback',
    } as Env);
    expect(local.ok).toBe(true);
    if (local.ok) expect(local.secret).toBe('bot-fallback');
  });

  it('emits X-RateLimit headers on dual limit allow and 429', async () => {
    const store = new Map<string, string>();
    const env = { LUMINARA_KV: mockKv(store), REQUIRE_TG_AUTH: 'true' } as Env;

    const first = await enforceDualRateLimit(env, {
      action: 'test_action',
      accountId: 'acct-a',
      ip: '1.2.3.4',
      limitPerKey: 2,
      windowSec: 60,
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.headers['X-RateLimit-Limit']).toBe('2');
      expect(first.headers['X-RateLimit-Remaining']).toBe('1');
      expect(first.headers['X-RateLimit-Reset']).toMatch(/^\d+$/);
    }

    await enforceDualRateLimit(env, {
      action: 'test_action',
      accountId: 'acct-a',
      ip: '1.2.3.4',
      limitPerKey: 2,
      windowSec: 60,
    });

    const blocked = await enforceDualRateLimit(env, {
      action: 'test_action',
      accountId: 'acct-a',
      ip: '1.2.3.4',
      limitPerKey: 2,
      windowSec: 60,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.response.status).toBe(429);
      expect(blocked.response.headers.get('Retry-After')).toBeTruthy();
      expect(blocked.response.headers.get('X-RateLimit-Limit')).toBe('2');
      expect(blocked.response.headers.get('X-RateLimit-Remaining')).toBe('0');
    }
  });

  it('edge binding returns EDGE_RATE_LIMITED when limit() fails', async () => {
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const result = await enforceEdgeBindingLimit(limiter, 'api:9.9.9.9', {
      action: 'api_edge',
      limit: 120,
      windowSec: 60,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(429);
      const body = (await result.response.json()) as { code?: string };
      expect(body.code).toBe('EDGE_RATE_LIMITED');
    }
  });

  it('rateLimitHeaders include reset epoch', () => {
    const h = rateLimitHeaders({ limit: 10, remaining: 3, windowSec: 60 });
    expect(h['X-RateLimit-Limit']).toBe('10');
    expect(h['X-RateLimit-Remaining']).toBe('3');
    expect(Number(h['X-RateLimit-Reset'])).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(rateLimitedResponse({ limit: 10, windowSec: 60 }).status).toBe(429);
  });
});
