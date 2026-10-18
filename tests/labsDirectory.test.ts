import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EcosystemHubView, trustDirectoryOpen } from '../components/hub/EcosystemHubView';

const off = { receiptsEnabled: false, domainVerifyEnabled: false, receiptSigningConfigured: false };
const on = { receiptsEnabled: true, domainVerifyEnabled: true, receiptSigningConfigured: false };

describe('labs directory honesty', () => {
  it('labels Trust Center not available when a trust flag is off, and has no Lumens, Jetton, or LORA card', () => {
    expect(trustDirectoryOpen(null)).toBe(false);
    expect(trustDirectoryOpen(off)).toBe(false);
    expect(trustDirectoryOpen({ receiptsEnabled: true, domainVerifyEnabled: false })).toBe(false);
    expect(trustDirectoryOpen(on)).toBe(true);

    const html = renderToStaticMarkup(
      createElement(EcosystemHubView, { onSelectView: () => {}, trustFlags: off }),
    );
    expect(html).toContain('Not available yet');
    expect(html).toContain('disabled=""');
    expect(html).not.toMatch(/Lumens|Jetton|LORA/);
  });

  it('leaves the Trust Center launchable when both flags are on', () => {
    const html = renderToStaticMarkup(
      createElement(EcosystemHubView, { onSelectView: () => {}, trustFlags: on }),
    );
    expect(html).toContain('Launch Surface');
    expect(html).toContain('Cryptographic');
    expect(html).not.toContain('Not available yet');
  });
});
