/**
 * Pure display logic for the Settings "MCP API keys" tab.
 * Kept component-free so the reveal-once and redaction rules are unit-testable.
 */

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
};

/**
 * Display form for a key row: stored 12-char prefix plus a terminal ellipsis.
 * The raw key only exists in the POST /api-keys response; callers MUST NOT pass
 * it here. This is the second layer: even if a full key leaks in, only the
 * leading prefix and trailing 4 chars are rendered, never the middle.
 */
export function redactKey(prefixOrKey: string): string {
  const raw = String(prefixOrKey || '').trim();
  if (!raw) return '';
  const prefix = raw.startsWith('lm_live_') ? raw.slice(0, 12) : raw.slice(0, 12);
  const last4 = raw.length > 16 ? raw.slice(-4) : '';
  return last4 ? `${prefix}...${last4}` : `${prefix}...`;
}

export function formatKeyRow(row: ApiKeyRow): { label: string; created: string; lastUsed: string } {
  return {
    label: row.name || 'MCP key',
    created: row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '',
    lastUsed: row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleDateString() : 'Never used',
  };
}

export const REVEAL_ONCE_WARNING = 'Store this now. It will not be shown again.';

export const EMPTY_STATE_COPY =
  'No API keys yet. Create one to use Luminara from Cursor, Claude, or any MCP client.';

/**
 * Narrow unknown JSON to rows. Non-rows and rows with full-key material are
 * defensively dropped: list payloads must never carry a `key` field.
 */
export function parseApiKeyList(payload: unknown): ApiKeyRow[] {
  const keys = (payload as { keys?: unknown })?.keys;
  if (!Array.isArray(keys)) return [];
  return keys
    .filter(
      (k): k is Record<string, unknown> =>
        !!k && typeof k === 'object' && typeof (k as { id?: unknown }).id === 'string',
    )
    .map((k) => {
      const { key: _drop, ...rest } = k;
      void _drop;
      return {
        id: String(rest.id),
        name: typeof rest.name === 'string' ? rest.name : 'MCP key',
        prefix: typeof rest.prefix === 'string' ? rest.prefix : 'lm_live_...',
        createdAt: typeof rest.createdAt === 'number' ? rest.createdAt : 0,
        lastUsedAt: typeof rest.lastUsedAt === 'number' ? rest.lastUsedAt : null,
      } satisfies ApiKeyRow;
    });
}
