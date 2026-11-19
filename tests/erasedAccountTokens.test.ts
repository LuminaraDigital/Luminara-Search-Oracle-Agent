/** An agent token with no refresh family stops working once its account is on the erase ledger. */
import { describe, expect, it } from 'vitest';
import type { Env } from '../worker/env';
import { identifyMcpOAuthToken } from '../worker/mcpOAuth';

function envWithLedger(erased: { value: boolean }): Env {
  const store = new Map<string, string>([
    ['mcp_oauth_token:mcp_legacy', JSON.stringify({ accountId: 'acct-1', userId: 'fb:u1', plan: 'growth', scope: 'mcp:free' })],
  ]);
  return {
    LUMINARA_KV: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
    },
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            expect(sql).toContain('firestore_erase_ledger');
            expect(args[0]).toBe('acct-1');
            return erased.value ? { account_id: 'acct-1' } : null;
          },
        }),
      }),
    },
  } as unknown as Env;
}

describe('agent tokens after account erase', () => {
  it('accepts the token while the account exists and refuses it once erased', async () => {
    const erased = { value: false };
    const env = envWithLedger(erased);
    expect(await identifyMcpOAuthToken(env, 'mcp_legacy')).not.toBeNull();
    erased.value = true;
    expect(await identifyMcpOAuthToken(env, 'mcp_legacy')).toBeNull();
  });
});
