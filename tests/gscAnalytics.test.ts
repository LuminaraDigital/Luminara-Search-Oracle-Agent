import { describe, expect, it } from 'vitest';
import { gscAnalyticsService } from '../services/mcp/gscAnalyticsService';

describe('GscAnalyticsService', () => {
  it('parses GSC CSV export and detects low-CTR risk without inventing AI Overview', () => {
    const csvContent = `Top queries,Clicks,Impressions,CTR,Position
"best crm for dentists",12,4500,0.27%,1.4
"dental crm pricing",150,1200,12.5%,3.2
"what is cloud dental software",5,6200,0.08%,1.2
`;

    const result = gscAnalyticsService.parseGscCsv(csvContent, 'acme.com');
    expect(result).not.toBeNull();
    expect(result!.rows.length).toBe(3);
    expect(result!.cannibalizedKeywordsCount).toBe(2);

    const atRisk = result!.rows.filter(r => r.lowCtrRisk || r.cannibalizationRisk === 'High');
    expect(atRisk.map(c => c.query)).toContain('best crm for dentists');
    expect(atRisk.map(c => c.query)).toContain('what is cloud dental software');
    expect(result!.rows.every(r => r.aiOverviewPresent === false)).toBe(true);
    expect(result!.rows.filter(r => r.lowCtrRisk).length).toBe(2);
  });

  it('does not simulate on empty CSV in product path', () => {
    const result = gscAnalyticsService.parseGscCsv('not a csv', 'acme.com', { allowSimulate: false });
    expect(result).toBeNull();
  });

  it('generates an actionable AEO remediation brief', () => {
    const csvContent = `Query,Clicks,Impressions,CTR,Position
"best ai search oracle",2,8000,0.02%,1.1
`;
    const result = gscAnalyticsService.parseGscCsv(csvContent);
    expect(result).not.toBeNull();
    const brief = gscAnalyticsService.generateRemediationBrief(result!, 'luminarasuite.com');

    expect(brief).toContain('Luminara GSC Zero-Click Cannibalization Remediation Brief');
    expect(brief).toContain('luminarasuite.com');
    expect(brief).toContain('best ai search oracle');
    expect(brief).toContain('Actionable AEO Playbook');
    expect(brief).toContain('not_measured from GSC CTR alone');
    expect(brief).not.toMatch(/AI Overviews are absorbing/);
  });
});
