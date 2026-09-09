import { describe, expect, it, beforeEach } from 'vitest';
import { aeoCorpusService } from '../services/corpus/aeoCorpusService';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
};

if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}
(globalThis as any).localStorage = mockLocalStorage;

describe('AeoCorpusService', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('ingests an audit into compounding corpus and updates stats', () => {
    const markdown = `# Luminara Search: Strategic Intelligence Report
## I. Executive Briefing
Brand is performing well.

\`\`\`json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "CorpusTest"
}
\`\`\`
`;

    const entries = aeoCorpusService.ingestAudit('corpustest.com', markdown, 80);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].domain).toBe('corpustest.com');
    expect(entries[0].citationRate).toBe(80);
    expect(entries[0].schemaSnippet).toContain('CorpusTest');

    const stats = aeoCorpusService.getStats();
    expect(stats.totalRecords).toBeGreaterThanOrEqual(1);
    expect(stats.avgCitationRate).toBeGreaterThan(0);
  });

  it('exports Alpaca instruction fine-tuning dataset', () => {
    aeoCorpusService.ingestAudit('alpacatest.com', '# Report Title\nBrief content', 70);
    const alpaca = aeoCorpusService.exportAlpacaDataset();
    expect(alpaca.length).toBeGreaterThanOrEqual(1);

    const first = alpaca[0];
    expect(first.instruction).toContain('OracleMind');
    expect(first.input).toContain('alpacatest.com');
    expect(first.output).toContain('alpacatest.com');
  });

  it('exports ShareGPT multi-turn fine-tuning dataset', () => {
    aeoCorpusService.ingestAudit('sharegpt.com', '# ShareGPT Report\nAudit body', 85);
    const sharegpt = aeoCorpusService.exportShareGPTDataset();
    expect(sharegpt.length).toBeGreaterThanOrEqual(1);

    const first = sharegpt[0];
    expect(first.conversations.length).toBe(3);
    expect(first.conversations[0].from).toBe('system');
    expect(first.conversations[1].value).toContain('sharegpt.com');
    expect(first.conversations[2].from).toBe('gpt');
    expect(first.conversations[2].value).toContain('Entity Nodes: sharegpt');
  });

  it('persists trust metrics and includes them in Alpaca export', () => {
    const entries = aeoCorpusService.ingestAudit('trustbrand.com', '# Trust Report\nSaaS audit', 75, undefined, {
      ymylTier: 'none',
      securityTrust: 70,
      integrityScore: 80,
      schemaSafety: 100,
      citeWorthiness: 82,
      measurementConfidence: 'full',
    });
    expect(entries[0].citeWorthiness).toBe(82);
    expect(entries[0].trainEligible).toBe(true);

    const alpaca = aeoCorpusService.exportAlpacaDataset();
    const trustRow = alpaca.find((r) => r.input.includes('trustbrand.com'));
    expect(trustRow?.input).toContain('Cite-Worthiness: 82');
    expect(trustRow?.input).toContain('Security Trust: 70');
  });

  it('marks cors_limited records trainEligible=false and skips them in exports', () => {
    aeoCorpusService.ingestAudit('corslimited.com', '# CORS Report\nbody', 60, undefined, {
      securityTrust: 40,
      citeWorthiness: 45,
      measurementConfidence: 'cors_limited',
    });
    const records = aeoCorpusService.getCorpusRecords().filter((r) => r.domain === 'corslimited.com');
    expect(records[0].trainEligible).toBe(false);

    const alpaca = aeoCorpusService.exportAlpacaDataset();
    expect(alpaca.every((r) => !r.input.includes('corslimited.com'))).toBe(true);
  });
});
