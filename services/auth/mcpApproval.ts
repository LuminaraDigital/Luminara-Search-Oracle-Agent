const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The agent approval request id from `?mcp_approval=`. Only a canonical UUID counts; nothing else in the URL is used. */
export function mcpApprovalId(search: string): string | null {
  const id = new URLSearchParams(search).get('mcp_approval');
  return id && UUID.test(id) ? id : null;
}
