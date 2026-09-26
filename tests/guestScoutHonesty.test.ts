import { describe, expect, it } from 'vitest';
import { buildGuestScoutSummary } from '../services/audit/guestScoutSummary';
import { hostedProviderKeyDecision } from '../services/apiClient';
import { hostedScoutPreRunCopy, resolveHostedScoutRail } from '../services/audit/hostedScoutRail';
import { evaluateLlmCrawlerReadiness } from '../services/audit/llmCrawlerReadiness';
import { playbookAuditorAgent } from '../services/agentCore/agents/playbookAuditorAgent';

describe('guest scout summary honesty', () => {
  it('does not invent percentages when SERP and page evidence are empty', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com/pricing',
      measurementStatus: 'not_measured',
      citationRatePercent: null,
      shareOfVoiceScore: null,
      healthScore: null,
      scrapedPageCount: 0,
      serpCount: 0,
      findings: [],
      errors: ['Tavily 401'],
      hostedRail: 'tma_hosted',
    });
    const blob = JSON.stringify(summary);
    expect(summary.evidenceEmpty).toBe(true);
    expect(summary.verdict.toLowerCase()).toContain('not measured');
    expect(summary.topFix.toLowerCase()).toContain('do not ship');
    expect(summary.badges.every((badge) => badge.status === 'not_measured')).toBe(true);
    expect(summary.badges.some((badge) => badge.value)).toBe(false);
    expect(blob).not.toMatch(/\d+%/);
    expect(blob).not.toContain('45');
    expect(blob).not.toContain('100% COMPLETE');
  });

  it('shows a measured citation only when a number was supplied', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'brand.example',
      measurementStatus: 'measured',
      citationRatePercent: 12,
      shareOfVoiceScore: 20,
      healthScore: 80,
      scrapedPageCount: 1,
      serpCount: 4,
      findings: [{ title: 'Add Organization schema' }],
      hostedRail: 'signed_in_hosted',
    });
    expect(summary.evidenceEmpty).toBe(false);
    expect(summary.badges.find((badge) => badge.label === 'Citation rate')).toEqual({
      label: 'Citation rate',
      status: 'measured',
      value: '12%',
    });
    expect(summary.topFix).toBe('Add Organization schema');
  });
});

describe('hosted scout rail', () => {
  it('gives Telegram initData a hosted rail and keeps anonymous web on BYOK', () => {
    expect(resolveHostedScoutRail({ inTelegram: true, hasInitData: true, signedIn: false })).toBe('tma_hosted');
    expect(resolveHostedScoutRail({ inTelegram: false, hasInitData: false, signedIn: true })).toBe('signed_in_hosted');
    expect(resolveHostedScoutRail({ inTelegram: false, hasInitData: false, signedIn: false })).toBe('byok_or_signin');
    expect(hostedScoutPreRunCopy('byok_or_signin').toLowerCase()).toContain('anonymous');
    expect(hostedScoutPreRunCopy('tma_hosted').toLowerCase()).toContain('no api key');
  });

  it('refuses free hosted keys without identity', () => {
    expect(hostedProviderKeyDecision({
      proxyReady: true,
      paidProvider: false,
      paidPlan: false,
      hasIdentity: false,
    })).toBe(false);
    expect(hostedProviderKeyDecision({
      proxyReady: true,
      paidProvider: false,
      paidPlan: false,
      hasIdentity: true,
    })).toBe(true);
    expect(hostedProviderKeyDecision({
      proxyReady: true,
      paidProvider: true,
      paidPlan: false,
      hasIdentity: true,
    })).toBe(false);
  });
});

describe('LLM crawler readiness', () => {
  it('passes when llms.txt exists and citation bots are not blocked', () => {
    const report = evaluateLlmCrawlerReadiness({
      llmsTxt: '# Product\n',
      llmsHttpStatus: 200,
      robotsTxt: 'User-agent: *\nAllow: /\n',
      robotsHttpStatus: 200,
    });
    expect(report.checks.map((check) => check.status)).toEqual(['pass', 'pass']);
    expect(JSON.stringify(report)).not.toMatch(/\d+\/100/);
  });

  it('fails a blocked GPTBot rule and a missing llms.txt without inventing a score', () => {
    const report = evaluateLlmCrawlerReadiness({
      llmsTxt: '',
      llmsHttpStatus: 404,
      robotsTxt: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n',
      robotsHttpStatus: 200,
    });
    expect(report.checks.find((check) => check.id === 'llms_txt')?.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'ai_bot_directives')?.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'ai_bot_directives')?.detail).toContain('GPTBot');
  });

  it('stays not_measured when the files were not fetched', async () => {
    const report = evaluateLlmCrawlerReadiness(null);
    expect(report.checks.every((check) => check.status === 'not_measured')).toBe(true);
    const audit = await playbookAuditorAgent.execute('AEO', [], [], null, () => {});
    expect(audit.healthScore).toBeNull();
    expect(audit.llmCrawler.checks.every((check) => check.status === 'not_measured')).toBe(true);
  });
});
