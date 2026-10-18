import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TrustCenterView, publicVerificationCopy } from '../components/trust/TrustCenterView';
import { badgeCaption, badgePreviewLabel } from '../components/trust/UniversalBrandPassportView';

describe('Trust page honesty', () => {
  it('does not call a disabled badge live', () => {
    expect(badgeCaption(false)).not.toMatch(/Live/);
    expect(badgeCaption(false).toLowerCase()).toContain('not enabled');
    expect(badgePreviewLabel(false)).toBe('Preview:');
    expect(badgeCaption(true)).toContain('Live embeddable');
    expect(badgePreviewLabel(true)).toBe('Live Preview:');
  });

  it('does not paint a passport from an empty domain', () => {
    const html = renderToStaticMarkup(createElement(TrustCenterView));
    expect(html).not.toContain('yourdomain.com');
    expect(html).not.toContain('Organization JSON-LD');
    expect(html).not.toContain('Not named yet');
    expect(html).toContain('Public verification is not enabled yet');
    expect(html).not.toContain('Anyone can independently verify');
  });

  it('points a live receipt at /verify/r and never at bare /verify', () => {
    const live = publicVerificationCopy(true);
    expect(live).toContain('/verify/r/');
    expect(live).not.toMatch(/\/verify(?!\/r\/)/);
    expect(live).not.toMatch(/MCP/);
    expect(publicVerificationCopy(false)).toContain('not enabled');
  });
});
