import { describe, expect, it } from 'vitest';
import { mcpApprovalId } from '../services/auth/mcpApproval';

const ID = '3f2b8c1e-9d4a-4e6b-8a1c-0d5e7f9a2b34';

describe('mcpApprovalId', () => {
  it('returns a valid UUID among other params', () => {
    expect(mcpApprovalId(`?utm=x&mcp_approval=${ID}&b=1`)).toBe(ID);
    expect(mcpApprovalId(`?mcp_approval=${ID.toUpperCase()}`)).toBe(ID.toUpperCase());
  });

  it('returns null when missing or empty', () => {
    expect(mcpApprovalId('')).toBeNull();
    expect(mcpApprovalId('?other=1')).toBeNull();
    expect(mcpApprovalId('?mcp_approval=')).toBeNull();
  });

  it('returns null for anything that is not a bare UUID', () => {
    expect(mcpApprovalId('?mcp_approval=abc')).toBeNull();
    expect(mcpApprovalId(`?mcp_approval=/api/${ID}`)).toBeNull();
    expect(mcpApprovalId(`?mcp_approval=${ID}/x`)).toBeNull();
    expect(mcpApprovalId(`?mcp_approval=${encodeURIComponent(`https://evil.test/${ID}`)}`)).toBeNull();
    expect(mcpApprovalId(`?mcp_approval=${ID}%0A`)).toBeNull();
  });
});
