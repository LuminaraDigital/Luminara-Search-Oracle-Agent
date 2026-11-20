import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markdownForPath } from '../services/marketing/agentMarkdown';
import { LLMS_TXT } from '../worker/crawlDocuments';
import { listMcpToolCatalogue } from '../worker/mcpServer';

const catalogPath = 'connectors/mcp/tool-catalog.json';

describe('MCP catalog generator', () => {
  it('matches the live tool list, and rewrites the file when MCP_CATALOG_WRITE=1', () => {
    const body = `${JSON.stringify(listMcpToolCatalogue(), null, 2)}\n`;
    if (process.env.MCP_CATALOG_WRITE === '1') {
      writeFileSync(catalogPath, body);
      const mcp = markdownForPath('/mcp.md');
      const home = markdownForPath('/index.md');
      if (mcp) writeFileSync('public/mcp.md', mcp);
      if (home) writeFileSync('public/index.md', home);
      writeFileSync('public/llm.txt', LLMS_TXT);
      writeFileSync('public/llms.txt', LLMS_TXT);
    }
    expect(readFileSync(catalogPath, 'utf8')).toBe(body);
  });
});
