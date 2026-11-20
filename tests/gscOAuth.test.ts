import { describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import {
  beginGscConnect,
  decryptGscToken,
  finishGscConnect,
  GSC_SCOPE,
  gscOauthEnabled,
  gscScopesAllowed,
  handleGscRoute,
} from '../worker/gscOAuth';

function memoryKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function envFor(extra: Partial<Env> = {}): Env {
  return {
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://www.luminarasuite.com/',
    GSC_OAUTH_ENABLED: 'false',
    GOOGLE_OAUTH_CLIENT_ID: 'client-id.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    GSC_TOKEN_KEY: 'test-token-key',
    LUMINARA_KV: memoryKv(),
    ...extra,
  } as unknown as Env;
}

describe('Search Console OAuth scaffolding', () => {
  it('stays off unless the flag is on, and the off route does not call Google', async () => {
    expect(gscOauthEnabled({})).toBe(false);
    expect(gscOauthEnabled({ GSC_OAUTH_ENABLED: 'false' })).toBe(false);
    expect(gscOauthEnabled({ GSC_OAUTH_ENABLED: 'true' })).toBe(true);
    const fetcher = vi.fn();
    const off = await handleGscRoute(
      new Request('https://www.luminarasuite.com/api/gsc/connect', { method: 'POST' }),
      envFor(),
      '/gsc/connect',
      { tokenFetcher: fetcher },
    );
    expect(off?.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('names the missing secret and requests only the read-only scope', async () => {
    const env = envFor({ GSC_OAUTH_ENABLED: 'true', GSC_TOKEN_KEY: '' });
    const res = await beginGscConnect(env, 'acct-a');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'Search Console connect needs the Worker secret GSC_TOKEN_KEY.' });

    const ready = envFor({ GSC_OAUTH_ENABLED: 'true' });
    const started = await beginGscConnect(ready, 'acct-a');
    const body = (await started.json()) as { url: string };
    const url = new URL(body.url);
    expect(url.searchParams.get('scope')).toBe(GSC_SCOPE);
    expect(url.searchParams.get('include_granted_scopes')).toBe('false');
    expect(url.searchParams.get('scope')).not.toBe('https://www.googleapis.com/auth/webmasters');
    expect(url.searchParams.get('redirect_uri')).toBe('https://www.luminarasuite.com/api/gsc/callback');
  });

  it('stores an encrypted token for that account and refuses a write scope', async () => {
    expect(gscScopesAllowed('https://www.googleapis.com/auth/webmasters')).toBe(false);
    expect(gscScopesAllowed(`${GSC_SCOPE} https://www.googleapis.com/auth/webmasters`)).toBe(false);
    const env = envFor({ GSC_OAUTH_ENABLED: 'true' });
    const started = await beginGscConnect(env, 'acct-a');
    const start = (await started.json()) as { url: string };
    const state = new URL(start.url).searchParams.get('state') || '';
    const refused = await finishGscConnect(
      new Request(`https://www.luminarasuite.com/api/gsc/callback?code=ok-code-value&state=${state}`),
      env,
      'acct-a',
      async () => new Response(JSON.stringify({
        refresh_token: 'should-not-store',
        scope: 'https://www.googleapis.com/auth/webmasters',
      }), { status: 200 }),
    );
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Nothing was stored');
    const empty = await env.DB!.prepare(`SELECT account_id FROM gsc_oauth_tokens`).all<{ account_id: string }>();
    expect(empty.results).toEqual([]);

    const startedAgain = await beginGscConnect(env, 'acct-a');
    const again = (await startedAgain.json()) as { url: string };
    const nextState = new URL(again.url).searchParams.get('state') || '';
    const done = await finishGscConnect(
      new Request(`https://www.luminarasuite.com/api/gsc/callback?code=4/0Aok-code&state=${nextState}`),
      env,
      'acct-a',
      async () => new Response(JSON.stringify({ refresh_token: 'refresh-secret-value', scope: GSC_SCOPE }), { status: 200 }),
    );
    expect(done.status).toBe(200);
    const row = await env.DB!.prepare(
      `SELECT account_id, refresh_token_enc, scopes FROM gsc_oauth_tokens WHERE account_id = ?`,
    ).bind('acct-a').first<{ refresh_token_enc: string; scopes: string }>();
    expect(row?.scopes).toBe(GSC_SCOPE);
    expect(row?.refresh_token_enc).not.toContain('refresh-secret-value');
    expect(await decryptGscToken('test-token-key', row!.refresh_token_enc)).toBe('refresh-secret-value');
    const other = await env.DB!.prepare(
      `SELECT account_id FROM gsc_oauth_tokens WHERE account_id = ?`,
    ).bind('acct-b').first();
    expect(other).toBeNull();
  });
});
