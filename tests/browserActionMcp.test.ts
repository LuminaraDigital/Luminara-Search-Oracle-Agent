import { describe, expect, it } from 'vitest';
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
});
