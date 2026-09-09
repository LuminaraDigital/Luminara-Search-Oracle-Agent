import { describe, expect, it } from 'vitest';
import { gscAnalyticsService } from '../services/mcp/gscAnalyticsService';

describe('GscAnalyticsService', () => {
  it('parses GSC CSV export and detects zero-click cannibalization', () => {
    const csvContent = `Top queries,Clicks,Impressions,CTR,Position
"best crm for dentists",12,4500,0.27%,1.4
"dental crm pricing",150,1200,12.5%,3.2
"what is cloud dental software",5,6200,0.08%,1.2
`;

    const result = gscAnalyticsService.parseGscCsv(csvContent, 'acme.com');
    expect(result.rows.length).toBe(3);
    expect(result.cannibalizedKeywordsCount).toBe(2);

    const cannibalizedNames = result.rows.filter(r => r.cannibalizationRisk === 'High').map(c => c.query);
    expect(cannibalizedNames).toContain('best crm for dentists');
    expect(cannibalizedNames).toContain('what is cloud dental software');
  });

  it('generates an actionable AEO remediation brief', () => {
    const csvContent = `Query,Clicks,Impressions,CTR,Position
"best ai search oracle",2,8000,0.02%,1.1
`;
    const result = gscAnalyticsService.parseGscCsv(csvContent);
    const brief = gscAnalyticsService.generateRemediationBrief(result, 'luminarasuite.com');

    expect(brief).toContain('Luminara GSC Zero-Click Cannibalization Remediation Brief');
    expect(brief).toContain('luminarasuite.com');
    expect(brief).toContain('best ai search oracle');
    expect(brief).toContain('Actionable AEO Playbook');
  });
});
