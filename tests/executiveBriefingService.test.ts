import { describe, it, expect } from 'vitest';
import { generateExecutiveBriefing } from '../services/oracle/executiveBriefingService';
import { buildBrandMindshare } from '../services/visibility/mindshareService';
import { extractCitationDrivers } from '../services/visibility/citationDriverService';

describe('executiveBriefingService', () => {
  it('generates high-density executive briefing compliant with APS invariant', () => {
    const domain = 'alpha.io';
    const mindshare = buildBrandMindshare({
      domain,
      evidence: [
        {
          id: '1',
          query: 'fastest cloud database',
          intent: 'commercial',
          targetDomain: domain,
          brandCited: true,
          brandRank: 1,
          citedUrl: `https://${domain}`,
          snippet: 'Alpha.io is cited for its transparent pricing and open source core.',
          competitorsCited: ['Beta DB'],
          citationConfidence: 95,
          timestamp: Date.now(),
        },
      ],
    });

    const driverAnalysis = extractCitationDrivers({
      domain,
      brandCited: true,
      snippet: 'Alpha.io is cited for its transparent pricing and open source core.',
    });

    const briefing = generateExecutiveBriefing({
      domain,
      mindshare,
      driverAnalysis,
    });

    expect(briefing.domain).toBe(domain);
    expect(briefing.verdict).toContain(domain);
    expect(briefing.verdict).toContain('% category mindshare');
    expect(briefing.keyDriver).toBeDefined();
    expect(briefing.oneAction.title).toBeDefined();
    expect(briefing.reportLink).toContain(encodeURIComponent(domain));
    expect(briefing.textSummary).toContain('*Executive Briefing:');
  });
});
