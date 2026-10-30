import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('docs honesty', () => {
  it('gives MCP a nav and states the free MCP cap', () => {
    const html = readFileSync(resolve(__dirname, '../public/docs/mcp.html'), 'utf8');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/how-it-works"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('Free allows 100 calls a day');
    expect(html).not.toContain('Free tools:');
  });

  it('says Measured can come from keys on this device', () => {
    const page = readFileSync(resolve(__dirname, '../components/MethodologyPage.tsx'), 'utf8');
    expect(page).toContain('Your own keys on this device work without signing in.');
    expect(page).not.toContain('a run you signed in for');
  });
});
