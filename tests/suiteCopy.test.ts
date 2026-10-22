import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGAL_ENTITY_LINE } from '../services/legal/consumerTerms';

/** User-facing copy this change touches. Fails if an em dash or en dash lands in it. */
const COPY_FILES = [
  'components/LandingPage.tsx',
  'components/WhyLuminaraPage.tsx',
  'components/PricingPage.tsx',
  'components/LegalPage.tsx',
  'components/marketing/MarketingFooter.tsx',
  'components/paywall/PaywallModal.tsx',
  'components/paywall/planCopy.ts',
  'components/audit/InstantAuditView.tsx',
  'components/onboarding/FirstRunTour.tsx',
  'services/onboarding/firstRunTour.ts',
  'services/marketing/marketingHeroCopy.ts',
  'services/marketing/pageMeta.ts',
  'services/legal/consumerTerms.ts',
  'services/audit/auditTargetUrl.ts',
  'worker/crawlDocuments.ts',
  'worker/termsPolicy.ts',
  'worker/privacyPolicy.ts',
  'services/legal/privacyCopy.ts',
  'worker/telegramBot.ts',
  'worker/welcomeEmail.ts',
  'public/llms.txt',
  'public/privacy.html',
  'public/docs/what-is-aeo.html',
  'index.html',
  'components/suite/BusinessDNAView.tsx',
  'components/suite/IdeaScoutView.tsx',
  'components/upgrade/UpgradeSurfaces.tsx',
] as const;

describe('suite copy', () => {
  it.each(COPY_FILES)('%s has no em dash or en dash', (file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('\u2014');
    expect(text).not.toContain('\u2013');
  });

  it('labels the home sample as an illustrative real estate example', () => {
    const landing = readFileSync('components/LandingPage.tsx', 'utf8');
    expect(landing).toContain('Illustrative example, not a real agency');
    expect(landing).toContain('An independent agency');
    expect(landing).toContain("best real estate agent in [suburb]");
    expect(landing).toContain('These rows show the report shape. They are not a measurement.');
    expect(landing).not.toMatch(/dental/i);
    expect(landing).not.toContain('\u2014');
  });

  it('uses real estate placeholders in the profile and idea forms', () => {
    const dna = readFileSync('components/suite/BusinessDNAView.tsx', 'utf8');
    const ideas = readFileSync('components/suite/IdeaScoutView.tsx', 'utf8');
    expect(dna).toContain("independent real estate agency in [suburb]");
    expect(ideas).toContain('who sells homes in [suburb]');
    expect(ideas).toContain('real estate agencies');
    expect(dna).not.toMatch(/dental/i);
    expect(ideas).not.toMatch(/dental|clinic/i);
  });

  it('uses one legal line and does not name the company Agency', () => {
    expect(LEGAL_ENTITY_LINE).toBe('Luminara Digital Pty Ltd (ABN 90 693 125 281)');
    const terms = readFileSync('worker/termsPolicy.ts', 'utf8');
    expect(terms).toContain('LEGAL_ENTITY_LINE');
    expect(terms).not.toContain('Luminara Digital Agency');
    expect(terms).not.toMatch(/GST/i);
  });
});
