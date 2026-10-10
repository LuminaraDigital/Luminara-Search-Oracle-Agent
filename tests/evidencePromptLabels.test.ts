import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_LABEL_INSTRUCTION,
  EVIDENCE_PROMPT_LABEL,
  buildEmpiricalPromptSection,
  buildEnrichmentPromptSection,
  buildIntegrityPromptSection,
  buildPreliminaryTrustPromptSection,
} from '../services/audit/evidencePromptLabels';
import { aeoTrustPackService } from '../services/audit/aeoTrustPackService';
import type { EmpiricalCitationSummary } from '../services/audit/empiricalCitationService';
import type { EnrichedEntityIntelligence } from '../services/enrichment/publicApisEnrichmentService';

const summary: EmpiricalCitationSummary = {
  targetDomain: 'acme.example',
  brandName: 'Acme',
  totalQueriesTested: 2,
  queriesCitedCount: 1,
  citationRatePercent: 50,
  topCitedCompetitor: 'Globex',
  entityClarityScore: 70,
  lastAudited: 1,
  measurementStatus: 'measured',
  evidenceList: [
    {
      id: 'ev-1',
      query: 'what is acme',
      intent: 'informational',
      targetDomain: 'acme.example',
      brandCited: true,
      brandRank: 2,
      citedUrl: 'https://reviews.example/acme',
      snippet: 'Acme makes anvils...',
      competitorsCited: [],
      citationConfidence: 80,
      timestamp: 1,
    },
    {
      id: 'ev-2',
      query: 'acme vs competitors',
      intent: 'comparative',
      targetDomain: 'acme.example',
      brandCited: false,
      brandRank: null,
      citedUrl: null,
      snippet: 'Not cited in top 6 search results.',
      competitorsCited: ['Globex'],
      citationConfidence: 20,
      timestamp: 1,
    },
  ],
};

function entity(confidence: 'full' | 'cors_limited' | 'failed'): EnrichedEntityIntelligence {
  return {
    domain: 'acme.example',
    brandName: 'Acme',
    wikidata: { id: 'Q1', label: 'Acme', url: 'https://www.wikidata.org/wiki/Q1', wikipediaUrl: 'https://en.wikipedia.org/wiki/Acme' },
    wayback: { hasArchive: true, earliestDate: '2001-04-12', archivedYearsAgo: 25, status: 'historic_authority' },
    security: {
      httpsEnforced: true,
      redirectsToHttps: true,
      hstsEnabled: true,
      cspDetected: false,
      referrerPolicy: false,
      xFrameOptions: false,
      securityTxtPresent: false,
      trustScore: 60,
      measurementConfidence: confidence,
    },
    sameAsUrls: ['https://www.wikidata.org/wiki/Q1'],
    timestamp: 1,
  };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

describe('audit prompt evidence labels', () => {
  it('maps the honesty vocabulary onto prompt labels', () => {
    expect(EVIDENCE_PROMPT_LABEL).toEqual({
      measured: 'MEASURED',
      estimated: 'ESTIMATED',
      not_measured: 'NOT_MEASURED',
    });
  });

  it('labels search-derived citation evidence ESTIMATED, never verified', () => {
    const text = buildEmpiricalPromptSection(summary);
    expect(text).toContain('[ESTIMATED: SEARCH CITATION SAMPLE]');
    expect(text).toContain('ESTIMATED Citation Rate: 50% (1/2 sampled queries)');
    expect(text).toContain('ESTIMATED Top Cited Competitor: Globex');
    expect(text).toContain('- ESTIMATED: Query "what is acme" (informational): brand or domain string found in result #2');
    expect(text).toContain('- ESTIMATED: Query "acme vs competitors" (comparative): not found in sampled results (Competitors: Globex)');
    expect(text).not.toMatch(/verified/i);
    expect(text).not.toContain('MEASURED:');
    expect(text.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(2);
  });

  it('labels first-party enrichment MEASURED', () => {
    const text = buildEnrichmentPromptSection(entity('full'));
    expect(text).toContain('[MEASURED: PUBLIC APIS & ENTITY INTELLIGENCE]');
    expect(text).toContain('Wikidata Entity (name match): Q1 (Acme) - no description');
    expect(text).toContain('Security Posture (MEASURED):');
    expect(text).not.toMatch(/verified/i);
  });

  it('downgrades a browser-limited or failed security check inside the enrichment block', () => {
    expect(buildEnrichmentPromptSection(entity('cors_limited'))).toContain('Security Posture (ESTIMATED):');
    expect(buildEnrichmentPromptSection(entity('failed'))).toContain('Security Posture (NOT_MEASURED):');
  });

  it('labels everything NOT_MEASURED when nothing was collected', () => {
    const empty: EmpiricalCitationSummary = {
      ...summary,
      totalQueriesTested: 0,
      queriesCitedCount: 0,
      citationRatePercent: null,
      topCitedCompetitor: null,
      entityClarityScore: null,
      evidenceList: [],
      measurementStatus: 'not_measured',
    };
    for (const text of [buildEmpiricalPromptSection(undefined), buildEmpiricalPromptSection(empty)]) {
      expect(text).toContain('[NOT_MEASURED: SEARCH CITATION SAMPLE]');
      expect(text).not.toContain('ESTIMATED');
      expect(text).not.toMatch(/\d+%/);
    }
    const enrichment = buildEnrichmentPromptSection(undefined);
    expect(enrichment).toContain('[NOT_MEASURED: PUBLIC APIS & ENTITY INTELLIGENCE]');
    expect(enrichment).not.toContain('[MEASURED');
    expect(buildIntegrityPromptSection(undefined)).toBe('');
  });

  it('labels citation integrity heuristics ESTIMATED', () => {
    const text = buildIntegrityPromptSection({
      integrityScore: 55,
      deadCitationCount: 1,
      spoofRisk: 'low',
      sameAsConflict: false,
      details: [],
      measuredAt: 1,
    });
    expect(text).toContain('[ESTIMATED: AEO CITATION INTEGRITY]');
    expect(text).toContain('A blocked request reads as dead.');
  });

  it('tells the model how to treat each label in one line', () => {
    expect(EVIDENCE_LABEL_INSTRUCTION).not.toContain('\n');
    expect(EVIDENCE_LABEL_INSTRUCTION).toContain('MEASURED');
    expect(EVIDENCE_LABEL_INSTRUCTION).toContain('ESTIMATED');
    expect(EVIDENCE_LABEL_INSTRUCTION).toContain('NOT_MEASURED');
    expect(EVIDENCE_LABEL_INSTRUCTION).toContain('say "estimated"');
    expect(EVIDENCE_LABEL_INSTRUCTION).toContain('never invent');
  });

  it('wires the helpers and the instruction into the audit prompt', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'services', 'geminiService.ts'), 'utf8');
    expect(src).toContain('buildEmpiricalPromptSection(empiricalSummary)');
    expect(src).toContain('buildEnrichmentPromptSection(enrichedEntity)');
    expect(src).toContain('buildIntegrityPromptSection(citationIntegrity)');
    expect(src).toContain('${EVIDENCE_LABEL_INSTRUCTION}');
  });

  // SW0a-7: the preliminary trust block carries no cite-worthiness value.
  it('labels the preliminary trust pack ESTIMATED and prints no cite-worthiness value or formula', () => {
    // A failed security check caps the composite at 50. The raw value (30 + 30 + 20 = 80) is above it,
    // so the pack holds the finding that quotes the raw composite.
    const pack = aeoTrustPackService.build({
      security: { ...entity('failed').security, trustScore: 100 },
      empirical: { ...summary, entityClarityScore: 100 },
      integrity: { integrityScore: 100, deadCitationCount: 0, spoofRisk: 'low', sameAsConflict: false, details: [], measuredAt: 1 },
      reportText: 'Acme makes anvils',
      brandName: 'Acme',
      domain: 'acme.example',
    });
    expect(pack.findings.some((finding) => /Raw weighted score \d+/.test(finding.detail))).toBe(true);

    const text = buildPreliminaryTrustPromptSection(pack);
    expect(text).toContain('[ESTIMATED: AEO TRUST PACK, PRELIMINARY]');
    expect(text).toContain('Cite-worthiness: not measured at this stage.');
    expect(text).not.toMatch(/cite-?worthiness\s*[:=]\s*\d/i);
    expect(text).not.toContain('Raw weighted score');
    expect(text).not.toContain(String(pack.citeWorthiness));
    expect(text).not.toContain('Formula');
    expect(text).not.toContain('0.30*');
    expect(text).not.toMatch(/verified/i);
    // The security check failed, so its sub-signal is not printed as a number.
    expect(text).toContain('securityTrust: not measured');
    expect(text).toContain('citationIntegrity: 100/100');
    expect(text).toContain('entityClarity: 100/100');
  });

  it('prints not measured, never a zero, for trust signals nothing collected', () => {
    const text = buildPreliminaryTrustPromptSection(aeoTrustPackService.build({ domain: 'acme.example' }));
    expect(text).toContain('securityTrust: not measured, citationIntegrity: not measured, entityClarity: not measured');
    expect(text).not.toMatch(/\d+\/100/);
    expect(text).toContain('Findings:\n- none');
  });

  it('has no VERIFIED evidence header anywhere in services/', () => {
    const offenders = walk(path.join(process.cwd(), 'services')).filter((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return text.includes('VERIFIED EMPIRICAL') || text.includes('[VERIFIED');
    });
    expect(offenders).toEqual([]);
  });
});
