import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuestScoutSummaryPanel } from '../components/audit/GuestScoutSummaryPanel';
import { validateAuditTargetUrl } from '../services/audit/auditTargetUrl';
import { buildGuestScoutSummary, liveDataUnavailableCopy } from '../services/audit/guestScoutSummary';
import { hostedProviderKeyDecision } from '../services/apiClient';
import { hostedAuthRecoveryHint, hostedScoutPreRunCopy, resolveHostedScoutRail } from '../services/audit/hostedScoutRail';
import { hostedAuthSkipError } from '../services/resilience/hostedAuthCircuit';
import { instantAuditPersistHint } from '../components/audit/InstantAuditView';
import { ReportDisplay } from '../components/audit/ReportDisplay';
import { evaluateLlmCrawlerReadiness } from '../services/audit/llmCrawlerReadiness';
import { playbookAuditorAgent } from '../services/agentCore/agents/playbookAuditorAgent';

describe('guest scout summary honesty', () => {
  it('does not invent percentages when SERP and page evidence are empty', () => {
    const leakedKey = ['sk', '-', 'abcdefghijklmnopqrstuvwxyz'].join('');
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com/pricing',
      measurementStatus: 'not_measured',
      citationRatePercent: null,
      shareOfVoiceScore: null,
      healthScore: null,
      scrapedPageCount: 0,
      serpCount: 0,
      findings: [],
      errors: [`Tavily 401 ${leakedKey}`],
      hostedRail: 'tma_hosted',
    });
    const blob = JSON.stringify(summary);
    expect(summary.failureCodes).toEqual(['page_fetch_empty', 'search_empty', 'provider_failed']);
    expect(blob).not.toContain(leakedKey);
    expect(blob).not.toContain('Tavily');
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
    expect(summary.failureCodes).toEqual([]);
    expect(summary.degraded).toBe(false);
  });

  it('treats provider_failed plus an empty SERP as degraded and hides percent badges', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'not_measured',
      citationRatePercent: 45,
      shareOfVoiceScore: 43,
      healthScore: 73,
      scrapedPageCount: 0,
      serpCount: 0,
      findings: [],
      errors: ['Firecrawl HTTP 401'],
      hostedRail: 'byok_or_signin',
    });
    expect(summary.evidenceEmpty).toBe(true);
    expect(summary.degraded).toBe(true);
    expect(summary.failureCodes).toEqual(['page_fetch_empty', 'search_empty', 'provider_failed']);
    expect(summary.banner).toMatch(/Live data unavailable/);
    expect(summary.banner).toMatch(/sign in/i);
    expect(summary.badges.every((badge) => badge.status === 'not_measured' && !badge.value)).toBe(true);
    const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary }));
    expect(html).toContain('Live data unavailable');
    expect(html).not.toMatch(/\d+%/);
    expect(html).not.toMatch(/Share-of-Voice: \d+/);
    expect(html).not.toMatch(/Health Score: \d+/);
    expect(html).not.toContain('45');
    expect(html).not.toContain('73');
  });

  it('never tells a signed-in rail to sign in when live data is unavailable', () => {
    for (const hostedRail of ['signed_in_hosted', 'tma_hosted'] as const) {
      const copy = liveDataUnavailableCopy(hostedRail);
      const summary = buildGuestScoutSummary({
        targetUrl: 'https://example.com',
        measurementStatus: 'not_measured',
        citationRatePercent: null,
        shareOfVoiceScore: null,
        healthScore: null,
        scrapedPageCount: 0,
        serpCount: 0,
        findings: [],
        errors: ['Firecrawl HTTP 401'],
        hostedRail,
      });
      expect(copy.toLowerCase()).not.toContain('sign in');
      expect(summary.banner).toBe(copy);
      expect(JSON.stringify(summary).toLowerCase()).not.toContain('sign in');
      expect(summary.banner).toMatch(/Settings → provider status/);
      const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary }));
      expect(html.toLowerCase()).not.toContain('sign in');
    }
  });

  it('keeps a sign-in step on the guest degraded banner', () => {
    expect(liveDataUnavailableCopy('byok_or_signin')).toMatch(/sign in/i);
    expect(hostedAuthRecoveryHint({ rail: 'byok_or_signin' })).toMatch(/sign in/i);
    expect(hostedAuthRecoveryHint({ signedIn: false })).toMatch(/sign in/i);
  });
});

describe('Instant Audit public target', () => {
  it('rejects localhost, IP literals, and special-use suffixes before a hosted run', () => {
    expect(validateAuditTargetUrl('')).toMatch(/website address/i);
    expect(validateAuditTargetUrl('https://stripe.com/pricing')).toBeNull();
    for (const host of ['localhost', 'http://127.0.0.1/', '10.0.0.1', '169.254.169.254', '192.168.1.9', '8.8.8.8', 'printer.local', 'db.internal', '[::1]']) {
      expect(validateAuditTargetUrl(host), host).toMatch(/public website/i);
    }
  });
});

describe('hosted scout rail', () => {
  it('gives Telegram initData a hosted rail and keeps anonymous web on BYOK', () => {
    expect(resolveHostedScoutRail({ inTelegram: true, hasInitData: true, signedIn: false })).toBe('tma_hosted');
    expect(resolveHostedScoutRail({ inTelegram: false, hasInitData: false, signedIn: true })).toBe('signed_in_hosted');
    expect(resolveHostedScoutRail({ inTelegram: false, hasInitData: false, signedIn: false })).toBe('byok_or_signin');
    expect(hostedScoutPreRunCopy('byok_or_signin').toLowerCase()).toContain('anonymous');
    expect(hostedScoutPreRunCopy('byok_or_signin')).toMatch(/sign in/i);
    expect(hostedScoutPreRunCopy('tma_hosted').toLowerCase()).toContain('no api key');
    expect(hostedScoutPreRunCopy('signed_in_hosted').toLowerCase()).not.toContain('sign in');
    expect(hostedScoutPreRunCopy('signed_in_hosted', { hostedGateOpen: false })).toMatch(/off for this session/i);
    expect(hostedScoutPreRunCopy('signed_in_hosted', { hostedGateOpen: false }).toLowerCase()).not.toContain('sign in');
    expect(hostedScoutPreRunCopy('signed_in_hosted', { hostedGateOpen: true })).toMatch(/daily free allowance/);
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

describe('signed-in degraded copy', () => {
  it('does not tell a signed-in user to sign in when strategy was not saved', () => {
    expect(instantAuditPersistHint(true, 'unsaved').toLowerCase()).not.toContain('sign in');
    expect(instantAuditPersistHint(true, 'unmeasured').toLowerCase()).not.toContain('sign in');
    expect(instantAuditPersistHint(false, 'unsaved')).toMatch(/Sign in to save a project/);
    expect(instantAuditPersistHint(false, 'unmeasured')).toMatch(/Sign in to save a project/);
  });

  it('drops the sign-in suffix from hosted auth skips when the session exists', () => {
    expect(hostedAuthSkipError(true).toLowerCase()).not.toContain('sign in');
    expect(hostedAuthSkipError(true)).toMatch(/provider status/);
    expect(hostedAuthSkipError(false)).toMatch(/or sign in/);
    expect(hostedAuthRecoveryHint({ rail: 'signed_in_hosted' }).toLowerCase()).not.toContain('sign in');
    expect(hostedAuthRecoveryHint({ rail: 'tma_hosted' }).toLowerCase()).not.toContain('sign in');
  });

  it('hides the sign-in banner on a signed-in report that was not measured', () => {
    const html = renderToStaticMarkup(createElement(ReportDisplay, {
      markdownText: 'Scout notes without a live score.',
      hideAgencyActions: true,
      suppressLiveMetrics: true,
      hostedRail: 'signed_in_hosted',
    }));
    expect(html).toContain('Live search or page fetch did not run');
    expect(html.toLowerCase()).not.toContain('sign in');
  });
});

describe('LLM crawler readiness', () => {
  it('passes when llms.txt exists and citation bots are not blocked', () => {
    const report = evaluateLlmCrawlerReadiness({
      llmsTxt: '# Product\n\n> A short product summary for agents that quote this site.\n',
      llmsHttpStatus: 200,
      robotsTxt: 'User-agent: *\nAllow: /\n',
      robotsHttpStatus: 200,
      aiTxt: '# Agent notes\n',
      aiHttpStatus: 200,
    });
    expect(report.checks.map((check) => check.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
    expect(JSON.stringify(report)).not.toMatch(/\d+\/100/);
    expect(JSON.stringify(report)).not.toMatch(/\d+%/);
  });

  it('fails a blocked GPTBot rule and a missing llms.txt without inventing a score', () => {
    const report = evaluateLlmCrawlerReadiness({
      llmsTxt: '',
      llmsHttpStatus: 404,
      robotsTxt: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n',
      robotsHttpStatus: 200,
    });
    expect(report.checks.find((check) => check.id === 'llms_txt')?.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'llms_structure')?.status).toBe('not_measured');
    expect(report.checks.find((check) => check.id === 'ai_bot_directives')?.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'cite_paths')?.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'ai_bot_directives')?.detail).toContain('GPTBot');
    expect(JSON.stringify(report)).not.toMatch(/\d+%/);
  });

  it('stays not_measured when the files were not fetched', async () => {
    const report = evaluateLlmCrawlerReadiness(null);
    expect(report.checks.every((check) => check.status === 'not_measured')).toBe(true);
    const audit = await playbookAuditorAgent.execute('AEO', [], [], null, () => {});
    expect(audit.healthScore).toBeNull();
    expect(audit.llmCrawler.checks.every((check) => check.status === 'not_measured')).toBe(true);
  });
});
