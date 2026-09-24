import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE_COPY,
  REVEAL_ONCE_WARNING,
  formatKeyRow,
  parseApiKeyList,
  redactKey,
} from '../components/settings/tabs/apiKeysTabUtils';

describe('ApiKeysTab pure logic', () => {
  it('redactKey renders prefix plus last 4, never the middle secret chars', () => {
    const rendered = redactKey('lm_live_abcd1234efgh5678');
    expect(rendered.startsWith('lm_live_abcd')).toBe(true);
    expect(rendered.endsWith('5678')).toBe(true);
    expect(rendered).toContain('...');
    expect(rendered).not.toContain('1234efgh');
    expect(rendered).not.toBe('lm_live_abcd1234efgh5678');
    expect(rendered.length).toBeLessThan('lm_live_abcd1234efgh5678'.length);
  });

  it('redactKey handles stored prefixes and empty input', () => {
    expect(redactKey('lm_live_abcd')).toBe('lm_live_abcd...');
    expect(redactKey('')).toBe('');
    expect(redactKey('  ')).toBe('');
  });

  it('formatKeyRow maps timestamps to display strings', () => {
    const row = formatKeyRow({
      id: 'apk_1',
      name: 'Cursor MCP',
      prefix: 'lm_live_abcd',
      createdAt: new Date('2026-01-05T00:00:00Z').getTime(),
      lastUsedAt: null,
    });
    expect(row.label).toBe('Cursor MCP');
    expect(row.created).toBe(new Date('2026-01-05T00:00:00Z').toLocaleDateString());
    expect(row.created.length).toBeGreaterThan(0);
    expect(row.lastUsed).toBe('Never used');
  });

  it('parseApiKeyList drops full-key material defensively and normalizes rows', () => {
    const rows = parseApiKeyList({
      keys: [
        { id: 'apk_1', name: 'A', prefix: 'lm_live_abcd', createdAt: 1, lastUsedAt: null, key: 'lm_live_secret_material' },
        { name: 'missing id' },
        null,
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('apk_1');
    expect(JSON.stringify(rows)).not.toContain('lm_live_secret_material');
    expect('key' in rows[0]).toBe(false);
  });

  it('reveal-once copy constants match the spec', () => {
    expect(REVEAL_ONCE_WARNING).toBe('Store this now. It will not be shown again.');
    expect(EMPTY_STATE_COPY).toBe(
      'No API keys yet. Create one to use Luminara from Cursor, Claude, or any MCP client.',
    );
  });

  it('reveal-once discipline: full key is only valid in created-modal state, not rows', () => {
    // Rows are what GET returns: metadata only. Assert the shape the tab renders
    // cannot hold the full key. The reveal modal takes a CreatedKey { key } that
    // is separate state and cleared on close (component behavior); here we assert
    // the two shapes stay structurally distinct.
    const row = parseApiKeyList({
      keys: [{ id: 'apk_9', name: 'n', prefix: 'lm_live_abcd', createdAt: 2 }],
    })[0];
    expect(row.lastUsedAt).toBeNull();
    expect(typeof row.id).toBe('string');
    expect(Object.keys(row).sort()).toEqual(['createdAt', 'id', 'lastUsedAt', 'name', 'prefix']);
  });
});
