/** An erased account's agent tokens stop working; a token made after the erase still works. */
import { describe, expect, it } from 'vitest';
import type { Env } from '../worker/env';
import { identifyMcpOAuthToken } from '../worker/mcpOAuth';
import { markAccountErased } from '../worker/opaqueSession';

function kvEnv(): Env {
  const store = new Map<string, string>();
  return {
    LUMINARA_KV: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
    },
  } as unknown as Env;
}

async function seedToken(env: Env, token: string, createdAt: number): Promise<void> {
  await env.LUMINARA_KV!.put(
    `mcp_oauth_token:${token}`,
    JSON.stringify({ accountId: 'acct-1', userId: 'fb:u1', plan: 'growth', scope: 'mcp:free', createdAt }),
  );
}

describe('agent tokens after account erase', () => {
  it('rejects a token issued before the erase and accepts one issued after', async () => {
    const env = kvEnv();
    await seedToken(env, 'mcp_old', Date.now() - 60_000);
    expect(await identifyMcpOAuthToken(env, 'mcp_old')).not.toBeNull();

    await markAccountErased(env, 'acct-1');
    expect(await identifyMcpOAuthToken(env, 'mcp_old')).toBeNull();

    await seedToken(env, 'mcp_new', Date.now() + 60_000);
    expect(await identifyMcpOAuthToken(env, 'mcp_new')).not.toBeNull();
  });
});
