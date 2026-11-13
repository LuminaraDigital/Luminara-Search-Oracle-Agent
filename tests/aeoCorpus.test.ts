import { describe, expect, it, beforeEach } from 'vitest';
import { aeoCorpusService } from '../services/corpus/aeoCorpusService';
import type { AeoPatternRecord } from '../services/corpus/aeoCorpusService';

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

function saveReal(domain: string, overrides: Partial<AeoPatternRecord> = {}): void {
  aeoCorpusService.saveRecord({
    id: `real-${domain}`,
    timestamp: 1,
    domain,
    vertical: 'SaaS & Technology',
    query: `${domain} overview`,
    intent: 'informational',
    winningSchemaType: 'Organization',
    entityNodes: [domain.split('.')[0]],
    citationRate: 70,
    schemaSnippet: '{"@type":"Organization"}',
    plainEnglishBrief: `Brief for ${domain}`,
    provenance: 'real',
    ...overrides,
  });
}

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

  it('keeps the measured citation rate on every row', () => {
    expect(aeoCorpusService.ingestAudit('zero.com', '# Report', 0).map((r) => r.citationRate)).toEqual([0, 0, 0]);
    expect(aeoCorpusService.ingestAudit('high.com', '# Report', 75).map((r) => r.citationRate)).toEqual([75, 75, 75]);
  });

  it('labels audit rows as synthetic and keeps them out of every export', () => {
    const entries = aeoCorpusService.ingestAudit('template.com', '# Report\nSaaS audit', 70);
    expect(entries.every((r) => r.provenance === 'synthetic_template')).toBe(true);
    expect(aeoCorpusService.exportAlpacaDataset()).toEqual([]);
    expect(aeoCorpusService.exportShareGptDataset()).toEqual([]);
    expect(aeoCorpusService.exportOpenAiToolTrajectories()).toEqual([]);
  });

  it('keeps rows saved before provenance existed out of every export', () => {
    saveReal('legacy.com', { provenance: undefined });
    expect(aeoCorpusService.exportAlpacaDataset()).toEqual([]);
  });

  it('exports Alpaca instruction fine-tuning dataset', () => {
    saveReal('alpacatest.com');
    const alpaca = aeoCorpusService.exportAlpacaDataset();
    expect(alpaca.length).toBeGreaterThanOrEqual(1);

    const first = alpaca[0];
    expect(first.instruction).toContain('OracleMind');
    expect(first.input).toContain('alpacatest.com');
    expect(first.output).toContain('Brief for alpacatest.com');
  });

  it('exports ShareGPT multi-turn fine-tuning dataset', () => {
    saveReal('sharegpt.com');
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
    });
    expect(entries[0].citeWorthiness).toBe(82);

    saveReal('trustbrand.com', { citeWorthiness: 82, securityTrust: 70 });
    const alpaca = aeoCorpusService.exportAlpacaDataset();
    const trustRow = alpaca.find((r) => r.input.includes('trustbrand.com'));
    expect(trustRow?.input).toContain('Cite-Worthiness: 82');
    expect(trustRow?.input).toContain('Security Trust: 70');
  });

  it('exports OpenAI-style tool trajectories without claiming a measurement', () => {
    saveReal('tooltraj.com');
    const rows = aeoCorpusService.exportOpenAiToolTrajectories();
    expect(rows.length).toBeGreaterThanOrEqual(1);

    const first = rows.find((r) => r.meta.domain === 'tooltraj.com');
    expect(first).toBeDefined();
    expect(first!.messages[0].role).toBe('system');
    expect(first!.messages[2].tool_calls?.[0].function.name).toBe('get_project_context');
    expect(first!.messages[4].tool_calls?.[0].function.name).toBe('get_visibility_snapshot');
    expect(first!.messages[3].content).toContain('"research_log_within_30_days":"unknown"');
    expect(first!.messages[5].content).toContain('"status":"estimated"');
    expect(first!.messages[first!.messages.length - 1].content).toContain('Verdict');
  });
});
