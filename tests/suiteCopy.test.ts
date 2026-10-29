import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGAL_ENTITY_LINE } from '../services/legal/consumerTerms';

/** User-facing copy this change touches. Fails if an em dash or en dash lands in it. */
const COPY_FILES = [
  'components/LandingPage.tsx',
  'components/InfrastructurePage.tsx',
  'components/IntelligencePage.tsx',
  'components/WhyLuminaraPage.tsx',
  'components/PricingPage.tsx',
  'components/LegalPage.tsx',
  'components/marketing/MarketingFooter.tsx',
  'components/paywall/PaywallModal.tsx',
  'components/paywall/planCopy.ts',
  'components/audit/InstantAuditView.tsx',
  'components/audit/FreeAiAnswerCard.tsx',
  'components/settings/NotificationsPanel.tsx',
  'components/audit/PastReports.tsx',
  'services/help/helpPages.ts',
  'components/help/HelpPage.tsx',
  'services/legal/privacyCrawler.ts',
  'services/audit/freeAiAnswer.ts',
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
  'services/legal/deleteAccountCopy.ts',
  'services/legal/playClient.ts',
  'components/DeleteAccountPage.tsx',
  'components/legal/PlaySafeDocument.tsx',
  'worker/androidLegalHtml.ts',
  'worker/plainLegalDocument.ts',
  'worker/telegramBot.ts',
  'worker/welcomeEmail.ts',
  'worker/weeklyDigest.ts',
  'worker/weeklyDigestContent.ts',
  'specs/0031-weekly-email-digest.md',
  'public/llms.txt',
  'public/ai.txt',
  'public/privacy.html',
  'public/docs/what-is-aeo.html',
  'index.html',
  'components/suite/BusinessDNAView.tsx',
  'components/suite/IdeaScoutView.tsx',
  'components/upgrade/UpgradeSurfaces.tsx',
  'components/share/WinSharePanel.tsx',
  'components/settings/AccountPanel.tsx',
  'services/account/accountSummary.ts',
  'services/share/winShare.ts',
  'worker/winShare.ts',
  'components/suite/EnquiryDeskView.tsx',
  'components/audit/CmsMcpRemediationPanel.tsx',
  'services/enquiries/playbookQualificationService.ts',
  'services/deployment/remediationTierRouter.ts',
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
    expect(LEGAL_ENTITY_LINE).toBe('LUMINARA DIGITAL PTY LTD (ABN 90 693 125 281)');
    const terms = readFileSync('worker/termsPolicy.ts', 'utf8');
    expect(terms).toContain('OPERATOR_LINE');
    expect(terms).not.toContain('Luminara Digital Agency');
    expect(terms).not.toMatch(/GST/i);
  });

  it('includes the 4-stage pipeline, deliverable preview, and access matrix on how-it-works', () => {
    const howItWorks = readFileSync('components/InfrastructurePage.tsx', 'utf8');
    expect(howItWorks).toContain('The 4-stage loop');
    expect(howItWorks).toContain('Deliverable 01');
    expect(howItWorks).toContain('Deliverable 02');
    expect(howItWorks).toContain('Illustrative example, not a live measurement');
    expect(howItWorks).toContain('Start as a guest');
    expect(howItWorks).toContain('Create free account');
  });

  it('includes the 3-way buyer matrix, agency role cards, and honest fit guide on why', () => {
    const whyPage = readFileSync('components/WhyLuminaraPage.tsx', 'utf8');
    expect(whyPage).toContain('The 3-way buyer decision');
    expect(whyPage).toContain('Retainer SEO Agency');
    expect(whyPage).toContain('Read-Only AI Trackers');
    expect(whyPage).toContain('Role 01');
    expect(whyPage).toContain('Role 02');
    expect(whyPage).toContain('Role 03');
    expect(whyPage).toContain('When Luminara fits');
    expect(whyPage).toContain('When another tool or team is better');
  });

  it('includes the 4-step grounding pipeline, separate SEO/AEO/GEO cards, switchyard bento, and access matrix on ai', () => {
    const aiPage = readFileSync('components/IntelligencePage.tsx', 'utf8');
    expect(aiPage).toContain('Evidence before advice');
    expect(aiPage).toContain('Discipline 01');
    expect(aiPage).toContain('Discipline 02');
    expect(aiPage).toContain('Discipline 03');
    expect(aiPage).toContain('Architecture 01');
    expect(aiPage).toContain('Architecture 02');
    expect(aiPage).toContain('Hosted allowance vs. your own keys');
  });

  it('includes the agency fit cards, 4-tier capability matrix, and pass FAQ on pricing', () => {
    const pricingPage = readFileSync('components/PricingPage.tsx', 'utf8');
    expect(pricingPage).toContain('Which pass fits your agency');
    expect(pricingPage).toContain('Profile 01');
    expect(pricingPage).toContain('Profile 02');
    expect(pricingPage).toContain('Profile 03');
    expect(pricingPage).toContain('Side-by-side comparison');
    expect(pricingPage).toContain('Pass terms, keys');
  });
});
