import { describe, it, expect } from 'vitest';
import {
  simulateAudit,
  cleanTargetDomain,
  evaluateCrawlerFlagsFromReport,
  DUAL_CHAIN_AUDIT_PRICING,
} from '../services/audit/auditSimulator';
import type { LlmCrawlerReport } from '../services/audit/llmCrawlerReadiness';

describe('Luminara Audit Preflight Simulator', () => {
  it('cleans target domains correctly', () => {
    expect(cleanTargetDomain('https://example.com/blog?query=1')).toBe('example.com');
    expect(cleanTargetDomain('http://www.luminarasuite.com/')).toBe('luminarasuite.com');
    expect(cleanTargetDomain('sub.domain.co.uk')).toBe('sub.domain.co.uk');
  });

  it('evaluates crawler flags and identifies missing llms.txt or restricted bots', () => {
    const mockReport: LlmCrawlerReport = {
      checks: [
        { id: 'llms_txt', label: 'llms.txt', status: 'fail', detail: '404 Not Found' },
        { id: 'ai_bot_directives', label: 'Directives', status: 'fail', detail: 'Disallow: GPTBot, PerplexityBot' },
      ],
    };

    const res = evaluateCrawlerFlagsFromReport(mockReport);
    expect(res.hasLlmsTxt).toBe(false);
    expect(res.gptBotAllowed).toBe(false);
    expect(res.perplexityAllowed).toBe(false);
    expect(res.claudeBotAllowed).toBe(true);
    expect(res.riskFlags.length).toBeGreaterThan(0);
  });

  it('runs a preflight simulation predicting yield, cost, and duration', async () => {
    const mockFetcher = async (_domain: string): Promise<LlmCrawlerReport> => ({
      checks: [
        { id: 'llms_txt', label: 'llms.txt', status: 'pass', detail: '200 OK' },
        { id: 'ai_bot_directives', label: 'Directives', status: 'pass', detail: 'All allowed' },
      ],
    });

    const simulation = await simulateAudit('https://luminarasuite.com', 'aeo', mockFetcher);
    expect(simulation.targetDomain).toBe('luminarasuite.com');
    expect(simulation.auditType).toBe('aeo');
    expect(simulation.estimatedDurationSec).toBe(12);
    expect(simulation.estimatedComputeUnits).toBe(1);
    expect(simulation.hasLlmsTxt).toBe(true);
    expect(simulation.predictedEvidenceYield).toBe('high');
    expect(simulation.recommendation).toBe('proceed');
    expect(simulation.pricing).toEqual(DUAL_CHAIN_AUDIT_PRICING.aeo);
    expect(simulation.pricing.ton).toBe('0.05 TON');
    expect(simulation.pricing.xdc).toBe('50 XDC');
  });

  it('adjusts duration and compute units for multi-agent deep crawls', async () => {
    const mockFetcher = async () => ({ checks: [] });
    const simulation = await simulateAudit('example.com', 'multi_agent_crawl', mockFetcher);
    expect(simulation.estimatedDurationSec).toBe(24);
    expect(simulation.estimatedComputeUnits).toBe(3);
    expect(simulation.pricing.ton).toBe('0.15 TON');
    expect(simulation.pricing.xdc).toBe('150 XDC');
  });

  it('handles empty domain inputs gracefully', async () => {
    const simulation = await simulateAudit('', 'seo');
    expect(simulation.targetDomain).toBe('');
    expect(simulation.recommendation).toBe('block');
    expect(simulation.predictedEvidenceYield).toBe('low');
  });
});
