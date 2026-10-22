import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BusinessDNAView, savedProfile } from '../components/suite/BusinessDNAView';

describe('business profile with no saved DNA', () => {
  it('shows suburb, state, agency type and portal fields, and saving them creates the profile', () => {
    const html = renderToStaticMarkup(createElement(BusinessDNAView, {
      currentDNA: null,
      onDNAGenerated: () => {},
    }));
    expect(html).toContain('No profile yet');
    expect(html).toContain('id="dna-suburb"');
    expect(html).toContain('id="dna-state"');
    expect(html).toContain('id="dna-agency-type"');
    expect(html).toContain('id="dna-rea"');
    expect(html).toContain('id="dna-domain"');
    expect(html).toContain('Save Changes');
    expect(html).not.toContain('Profile active');
    const saved = savedProfile({
      name: '',
      mission: '',
      usp: '',
      targetAudience: '',
      competitors: [],
      perceivedGaps: [],
      rawContext: '',
      suburb: 'Hawthorn',
      state: 'VIC',
      agencyType: 'agency',
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.dna).toMatchObject({ suburb: 'Hawthorn', state: 'VIC', agencyType: 'agency' });
  });
});

describe('finished audit chrome', () => {
  it('keeps the quota banner and the checklist off the finished report', () => {
    const src = readFileSync('components/audit/InstantAuditView.tsx', 'utf8');
    expect(src).toContain('{!report && quota && !quota.isUnlimited');
    expect(src).toContain('{!report && <SuiteCitabilityChecklist />}');
  });
});
