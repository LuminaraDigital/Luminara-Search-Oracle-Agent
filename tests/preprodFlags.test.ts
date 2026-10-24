import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJsonc } from '../scripts/lib/jsonc.mjs';
import { enabledPreprodFlags, PREPROD_GATED_FLAGS } from '../worker/preprodFlags';

describe('preprod feature flags', () => {
  const wrangler = parseJsonc(readFileSync(resolve(__dirname, '..', 'wrangler.jsonc'), 'utf8')) as {
    vars: Record<string, unknown>;
    env: { production: { vars: Record<string, unknown> }; staging: { vars: Record<string, unknown> } };
  };

  it('names a gated flag when a production config turns it on', () => {
    expect(enabledPreprodFlags({ AUDIT_RECEIPTS_ENABLED: 'true' })).toEqual(['AUDIT_RECEIPTS_ENABLED']);
    expect(enabledPreprodFlags({ REQUEST_SIGNING_REQUIRED: 'on' })).toEqual(['REQUEST_SIGNING_REQUIRED']);
    expect(enabledPreprodFlags({})).toEqual([]);
  });

  it('fails if production config enables a gated flag', () => {
    const top = enabledPreprodFlags(wrangler.vars);
    const merged = enabledPreprodFlags({ ...wrangler.vars, ...wrangler.env.production.vars });
    expect(top, `top-level enables ${top.join(', ')}`).toEqual([]);
    expect(merged, `production enables ${merged.join(', ')}`).toEqual([]);
    for (const flag of PREPROD_GATED_FLAGS) {
      expect(wrangler.vars[flag], flag).toBe('false');
      expect(wrangler.env.production.vars[flag], flag).toBe('false');
    }
  });
});
