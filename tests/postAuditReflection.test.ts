import { describe, it, expect, beforeEach } from 'vitest';
import { postAuditReflectionService } from '../services/audit/postAuditReflectionService';
import { brandMemoryVaultService } from '../services/memory/brandMemoryVaultService';
import { mem0MemoryEngine } from '../services/agentCore/mem0MemoryEngine';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
};

(globalThis as any).localStorage = mockLocalStorage;

describe('MUSE Post-Audit Autonomous Reflection Engine', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    mem0MemoryEngine.clear();
  });

  it('autonomously detects Shopify platform traits and extracts procedural lessons', () => {
    const exp = postAuditReflectionService.reflectOnAudit({
      domain: 'gymshark.com',
      focus: 'AEO',
      auditId: 'audit-1',
      healthScore: 78,
      scrapedEvidence: {
        rawTextSnippet: '<html><script src="https://cdn.shopify.com/s/files/1/bundle.js"></script></html>',
        wordCount: 800,
        schemasFound: ['Product', 'Organization'],
      },
      citationRatePercent: 80,
    });

    expect(exp.domain).toBe('gymshark.com');
    expect(exp.proceduralLessons.length).toBeGreaterThan(0);
    expect(exp.proceduralLessons.some((p) => p.pattern.includes('Shopify'))).toBe(true);
  });

  it('detects thin initial DOM content and flags critical severity', () => {
    const exp = postAuditReflectionService.reflectOnAudit({
      domain: 'spasite.com',
      focus: 'SEO',
      auditId: 'audit-2',
      scrapedEvidence: {
        rawTextSnippet: 'Welcome to our single page app.',
        wordCount: 45,
        schemasFound: [],
      },
    });

    const thinContent = exp.proceduralLessons.find((p) => p.pattern.includes('Thin Initial DOM Content'));
    expect(thinContent).toBeDefined();
    expect(thinContent?.severity).toBe('critical');

    const noSchema = exp.proceduralLessons.find((p) => p.pattern.includes('Zero Schema.org'));
    expect(noSchema).toBeDefined();
  });

  it('generates strategic methodology lessons for low AI citation rates and competitors', () => {
    const exp = postAuditReflectionService.reflectOnAudit({
      domain: 'acmecorp.com',
      focus: 'AEO',
      auditId: 'audit-3',
      citationRatePercent: 30,
      topCompetitor: 'RivalTech',
    });

    expect(exp.strategicLessons.length).toBe(2);
    // Low citation lesson
    expect(exp.strategicLessons.some((s) => s.actionableRule.includes('40-60 word'))).toBe(true);
    // Competitor displacement lesson
    expect(exp.strategicLessons.some((s) => s.actionableRule.includes('RivalTech'))).toBe(true);
  });

  it('ingests experience into BrandMemoryVault and formats prompt guidance', () => {
    const exp = postAuditReflectionService.reflectOnAudit({
      domain: 'notion.so',
      focus: 'AEO',
      auditId: 'audit-4',
      citationRatePercent: 85,
      scrapedEvidence: {
        rawTextSnippet: '<div id="__next"><div>Notion workspace</div></div>',
        wordCount: 1200,
        schemasFound: ['Organization'],
      },
    });

    const vaultEvent = brandMemoryVaultService.ingestAuditExperience(exp);
    expect(vaultEvent.type).toBe('experience_heuristic');
    expect(vaultEvent.domain).toBe('notion.so');

    const promptText = postAuditReflectionService.formatExperienceForPrompt('notion.so');
    expect(promptText).toContain('MUSE HISTORIC AUDIT EXPERIENCE');
    expect(promptText).toContain('Next.js / React Hydration');
  });
});
