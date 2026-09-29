/**
 * Cursor mcpServers JSON for Growth+ lm_live_* keys.
 * Pure helpers for Instant Audit mint CTA and Settings reveal.
 */

/** Resolve streamable HTTP MCP URL from apiBase() (origin or forced VITE_API_BASE). */
export function mcpHttpUrlFromApiBase(base: string): string {
  const trimmed = String(base || '').replace(/\/$/, '');
  if (!trimmed) return '';
  if (/\/api$/i.test(trimmed)) return `${trimmed}/mcp`;
  return `${trimmed}/api/mcp`;
}

/** Pretty-printed Cursor mcpServers block with Bearer key filled once. */
export function buildCursorMcpServersJson(mcpUrl: string, bearerKey: string): string {
  const url = String(mcpUrl || '').trim();
  const key = String(bearerKey || '').trim();
  return JSON.stringify(
    {
      mcpServers: {
        luminara: {
          url,
          headers: {
            Authorization: `Bearer ${key}`,
          },
        },
      },
    },
    null,
    2,
  );
}
