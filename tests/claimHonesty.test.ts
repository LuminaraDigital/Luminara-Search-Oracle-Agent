import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalPage } from '../components/LegalPage';
import { MARKETING_SELL_POINTS } from '../components/marketing/MarketingSellPoints';
import { STORY_CHAPTERS } from '../components/marketing/earth/globeStory';
import { planBullets, pricingTiers } from '../components/paywall/planCopy';
import { ACL_RIGHTS_CLAUSE, LEGAL_ABN, legalAbnLine } from '../services/legal/consumerTerms';
import { LIVE_ANSWER_CHECKS } from '../services/marketing/engineCoverage';
import { MARKETING_FAQ } from '../services/marketing/marketingFaqContent';
import { MARKETING_SHELL_BY_PATH } from '../services/marketing/pageMeta';
import { AI_TXT, LLMS_TXT } from '../worker/crawlDocuments';
import { STRIPE_PLAN_CONFIG } from '../worker/stripePayment';
import { PLANS } from '../worker/telegramBot';
import { PRIVACY_HTML } from '../worker/privacyPolicy';
import { TERMS_HTML } from '../worker/termsPolicy';
import { MarketingFooter } from '../components/marketing/MarketingFooter';

const BANNED_PLAN_CLAIM = [/unlimited/i, /team seats/i, /\b24\/7\b/, /\bre-audits\b/];
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** ATO checksum: subtract 1 from the first digit, apply the weights, sum mod 89 is 0. */
function abnChecksumOk(abn: string): boolean {
  const digits = abn.replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const nums = digits.split('').map((char) => Number(char));
  nums[0] -= 1;
  const sum = nums.reduce((total, digit, index) => total + digit * ABN_WEIGHTS[index], 0);
  return sum % 89 === 0;
}

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/);
}

/** A paragraph that names those engines has to say who can measure them. */
function assertEngineParagraphs(text: string, label: string) {
  for (const paragraph of paragraphs(text)) {
    if (!/ChatGPT|Perplexity|AI Overviews/.test(paragraph)) continue;
    if (/is the discipline of|is the work of making a page/.test(paragraph)) continue;
    expect(paragraph, label).toMatch(/Agency|DataForSEO/);
    expect(paragraph, label).toMatch(/Not measured|not measured|not_measured/);
  }
}

describe('claim honesty', () => {
  it('keeps ChatGPT, Perplexity and AI Overviews claims tied to Agency or DataForSEO', () => {
    const surfaces = [
      LIVE_ANSWER_CHECKS,
      ...STORY_CHAPTERS.map((chapter) => chapter.body),
      ...MARKETING_SELL_POINTS.map((point) => point.body),
      ...MARKETING_FAQ.map((item) => item.answer),
      ...Object.values(MARKETING_SHELL_BY_PATH).flatMap((page) => [page.description, page.crawlerBody]),
      LLMS_TXT,
      AI_TXT,
      readFileSync('index.html', 'utf8'),
      readFileSync('public/docs/what-is-aeo.html', 'utf8'),
      ...Object.values(PLANS).map((plan) => `${plan.title}\n${plan.description}`),
    ];
    surfaces.forEach((text, index) => assertEngineParagraphs(text, `surface ${index}`));
    const files = [
      'components/LandingPage.tsx',
      'components/PricingPage.tsx',
      'components/hub/EcosystemHubView.tsx',
      'components/auth/AuthRequiredScreen.tsx',
      'components/suite/DashboardView.tsx',
      'components/suite/VisionView.tsx',
      'components/InfrastructurePage.tsx',
      'components/MessageList.tsx',
      'components/SampleReportPage.tsx',
      'components/marketing/demo/demoFixtures.ts',
      'services/marketing/liveSampleSnapshot.ts',
    ];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!/ChatGPT|Perplexity|AI Overviews/.test(text)) continue;
      const usesClause = text.includes('LIVE_ANSWER_CHECKS');
      expect(usesClause || /Agency|DataForSEO/.test(text), file).toBe(true);
      expect(usesClause || /Not measured|not measured|not_measured/.test(text), file).toBe(true);
    }
    expect(readFileSync('index.html', 'utf8')).toContain(MARKETING_SHELL_BY_PATH['/'].description);
    expect(readFileSync('public/llms.txt', 'utf8')).toBe(LLMS_TXT);
    expect(readFileSync('public/ai.txt', 'utf8')).toBe(AI_TXT);
  });

  it('does not sell seats, unlimited audits, 24/7 sentinel, or re-audits', () => {
    const copy = [
      ...pricingTiers.map((tier) => tier.blurb),
      ...(['starter', 'growth', 'agency'] as const).flatMap((id) => planBullets(id).map((line) => line.text)),
      ...Object.values(PLANS).map((plan) => plan.description),
      ...Object.values(STRIPE_PLAN_CONFIG).map((plan) => plan.description),
      LLMS_TXT,
      readFileSync('components/PricingPage.tsx', 'utf8'),
    ].join('\n');
    for (const pattern of BANNED_PLAN_CLAIM) expect(copy).not.toMatch(pattern);
    expect(copy).toContain('re-audit reminders in Telegram');
    expect(copy).toContain('daily drift check');
    expect(copy).toContain('client workspaces');
    expect(copy).not.toContain('saved in this browser');
    expect(planBullets('growth').map((line) => line.text).join('\n')).not.toMatch(/seat/i);
    expect(planBullets('agency').map((line) => line.text).join('\n')).not.toMatch(/seat/i);
  });

  it('labels the 25 Star purchase as a 24-hour pass and leaves the price alone', () => {
    expect(PLANS.single_audit.stars).toBe(25);
    expect(PLANS.single_audit.days).toBe(1);
    expect(PLANS.multi_agent_crawl.stars).toBe(75);
    expect(PLANS.multi_agent_crawl.days).toBe(1);
    expect(PLANS.starter.stars).toBe(2500);
    expect(PLANS.growth.stars).toBe(7500);
    expect(PLANS.agency.stars).toBe(18000);
    for (const id of ['single_audit', 'multi_agent_crawl'] as const) {
      expect(PLANS[id].title).toBe('24-hour pass');
      expect(PLANS[id].description.length).toBeLessThanOrEqual(255);
      expect(PLANS[id].description).toContain('24-hour pass');
      expect(PLANS[id].description).toContain('Self-reported audit, not independently checked.');
    }
    expect(PLANS.single_audit.description).toMatch(/Not measured/);
  });

  it('keeps Australian Consumer Law rights and shows the operator ABN', () => {
    expect(LEGAL_ABN).toBe('90 693 125 281');
    expect(abnChecksumOk(LEGAL_ABN)).toBe(true);
    expect(abnChecksumOk('90693125282')).toBe(false);
    expect(legalAbnLine()).toBe('ABN 90 693 125 281');
    expect(legalAbnLine('  ')).toBe('');
    expect(legalAbnLine('12 345 678 901')).toBe('ABN 12 345 678 901');
    expect(TERMS_HTML).toContain(ACL_RIGHTS_CLAUSE);
    expect(TERMS_HTML).toContain('Subject to the Australian Consumer Law, the service is provided as is.');
    expect(TERMS_HTML).toContain('contact support@luminarasuite.com first');
    expect(TERMS_HTML).toContain("Telegram's process is how a Stars refund is paid");
    expect(TERMS_HTML).toContain('ABN 90 693 125 281');
    expect(PRIVACY_HTML).toContain('ABN 90 693 125 281');
    expect(TERMS_HTML).not.toContain("Refunds for Stars follow Telegram's policy");
    expect(TERMS_HTML).not.toContain('non-refundable once settled');
    expect(TERMS_HTML).not.toContain('Where TON checkout is offered');
    const terms = renderToStaticMarkup(createElement(LegalPage, { kind: 'terms', onBack: () => {} }));
    const privacy = renderToStaticMarkup(createElement(LegalPage, { kind: 'privacy', onBack: () => {} }));
    expect(terms).toContain(ACL_RIGHTS_CLAUSE);
    expect(terms).toContain('Subject to the Australian Consumer Law, the service is provided as is.');
    expect(terms).toContain('ABN 90 693 125 281');
    expect(privacy).toContain('ABN 90 693 125 281');
    expect(terms).not.toContain('Where TON checkout is offered');
    const footer = renderToStaticMarkup(createElement(MarketingFooter));
    expect(footer).toContain('Luminara Digital');
    expect(footer).toContain('LUMINARA DIGITAL PTY LTD (ABN 90 693 125 281)');
    expect(footer).toContain('trading as Luminara Digital');
    expect(footer).toContain('Victoria 3128, Australia');
    expect(footer).toContain('https://luminara.digital/services/');
    expect(footer).toContain('ABN 90 693 125 281');
    expect(footer).not.toContain('Melbourne');
    expect(footer).not.toMatch(/0402|0422|\+61/);
    expect(footer).not.toMatch(/GST/i);
    expect(TERMS_HTML).toContain('LUMINARA DIGITAL PTY LTD (ABN 90 693 125 281)');
    expect(TERMS_HTML).toContain('trading as Luminara Digital');
    expect(TERMS_HTML).toContain('Victoria 3128, Australia');
    expect(TERMS_HTML).toContain('info@luminara.digital');
    expect(TERMS_HTML).not.toMatch(/0402|0422|\+61|telephone/);
    expect(TERMS_HTML).not.toContain('Luminara Digital Agency');
    expect(PRIVACY_HTML).toContain('LUMINARA DIGITAL PTY LTD (ABN 90 693 125 281)');
    expect(PRIVACY_HTML).toContain('trading as Luminara Digital');
    expect(PRIVACY_HTML).toContain('Victoria 3128, Australia');
    expect(PRIVACY_HTML).toContain('info@luminara.digital');
    expect(PRIVACY_HTML).not.toMatch(/0402|0422|\+61|telephone/);
    expect(PRIVACY_HTML).not.toContain('Luminara Digital Agency');
    expect(terms).not.toMatch(/GST/i);
  });
});
