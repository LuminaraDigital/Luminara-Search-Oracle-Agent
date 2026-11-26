import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMcpToolCatalogue } from '../worker/mcpServer';
import { BROWSER_ACTION_CATALOGUE, executeBrowserActionTool } from '../services/browserAction';
import type { BrowserActionRuntime } from '../services/browserAction';

function stubRuntime(overrides: Partial<BrowserActionRuntime> = {}): BrowserActionRuntime {
  return {
    accountId: 'acct_test',
    canUsePaid: false,
    dataForSeoCredential: null,
    patchrightUrl: null,
    crawlerToken: null,
    getProject: async () => null,
    getResearchLog: async () => [],
    appendResearchLog: async () => {},
    dfsPost: async () => ({ ok: false, status: 0, body: null }),
    ...overrides,
  };
}

describe('browse MCP catalogue (B3)', () => {
  it('lists browse_observe (free) and browse_act (paid) in MCP catalogue', () => {
    const names = listMcpToolCatalogue().map((t) => t.name);
    expect(names).toContain('browse_observe');
    expect(names).toContain('browse_act');
    expect(names).toContain('browse_goal');
    expect(names).toContain('browse_close');

    const observe = BROWSER_ACTION_CATALOGUE.find((t) => t.name === 'browse_observe');
    const act = BROWSER_ACTION_CATALOGUE.find((t) => t.name === 'browse_act');
    expect(observe?.creditClass).toBe('free');
    expect(act?.creditClass).toBe('paid');
  });

  it('browse_act fails closed without paid entitlement', async () => {
    const result = await executeBrowserActionTool(
      'browse_act',
      { sessionId: 's1', fingerprint: 'fp', actionId: 'e1' },
      stubRuntime({ canUsePaid: false, patchrightUrl: 'http://127.0.0.1:3001' }),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.code).toBe('PAID_TOOL_FORBIDDEN');
  });

  it('browse_observe returns BROWSER_UNAVAILABLE when crawler URL unset', async () => {
    const result = await executeBrowserActionTool(
      'browse_observe',
      { url: 'https://example.com' },
      stubRuntime({ patchrightUrl: null }),
    );
    expect(result.structuredContent?.code).toBe('BROWSER_UNAVAILABLE');
    expect(result.structuredContent?.measurementStatus).toBe('not_measured');
    expect(result.text.toLowerCase()).toContain('not_measured');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends x-luminara-account-id header on create, observe, act, and close calls', async () => {
    const seenHeaders: Array<{ url: string; method: string; accountHeader: string | null }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method || 'GET';
        const headers = new Headers(init?.headers);
        seenHeaders.push({ url, method, accountHeader: headers.get('x-luminara-account-id') });
        if (url.endsWith('/health')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            success: true,
            sessionId: 'sess_1',
            observe: { url: 'https://example.com', title: 'Ex', text: 'Hi', actions: [], fingerprint: 'fp1' },
          }),
          { status: 200 },
        );
      }),
    );

    const rt = stubRuntime({
      accountId: 'acct_owner_99',
      canUsePaid: true,
      patchrightUrl: 'http://127.0.0.1:3001',
      crawlerToken: 'tok_1',
    });

    await executeBrowserActionTool('browse_observe', { url: 'https://example.com' }, rt);
    await executeBrowserActionTool('browse_observe', { sessionId: 'sess_1' }, rt);
    await executeBrowserActionTool('browse_act', { sessionId: 'sess_1', fingerprint: 'fp1', actionId: 'e1' }, rt);
    await executeBrowserActionTool('browse_close', { sessionId: 'sess_1' }, rt);

    const sessionCalls = seenHeaders.filter((c) => !c.url.endsWith('/health'));
    expect(sessionCalls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'POST /session',
      'POST /session/sess_1/observe',
      'POST /session/sess_1/act',
      'DELETE /session/sess_1',
    ]);
    for (const call of sessionCalls) {
      expect(call.accountHeader).toBe('acct_owner_99');
    }
  });
});
