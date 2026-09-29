import { describe, expect, it } from 'vitest';
import { buildCursorMcpServersJson, mcpHttpUrlFromApiBase } from '../services/mcp/cursorMcpSnippet';

describe('cursorMcpSnippet', () => {
  it('builds mcp URL from same-origin apiBase', () => {
    expect(mcpHttpUrlFromApiBase('https://luminarasuite.com')).toBe('https://luminarasuite.com/api/mcp');
    expect(mcpHttpUrlFromApiBase('https://luminarasuite.com/')).toBe('https://luminarasuite.com/api/mcp');
    expect(mcpHttpUrlFromApiBase('http://localhost:8787/api')).toBe('http://localhost:8787/api/mcp');
  });

  it('fills Cursor mcpServers JSON with Bearer key', () => {
    const json = buildCursorMcpServersJson('https://luminarasuite.com/api/mcp', 'lm_live_testkey');
    const parsed = JSON.parse(json) as {
      mcpServers: { luminara: { url: string; headers: { Authorization: string } } };
    };
    expect(parsed.mcpServers.luminara.url).toBe('https://luminarasuite.com/api/mcp');
    expect(parsed.mcpServers.luminara.headers.Authorization).toBe('Bearer lm_live_testkey');
  });
});
