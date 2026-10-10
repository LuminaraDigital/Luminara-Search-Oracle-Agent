import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GuestScoutSummaryPanel } from '../components/audit/GuestScoutSummaryPanel';
import { validateAuditTargetUrl } from '../services/audit/auditTargetUrl';
import { buildGuestScoutSummary, liveDataUnavailableCopy, plainScoutVerdict, shouldGenerateAuditReport } from '../services/audit/guestScoutSummary';
import { executiveTranslatorAgent } from '../services/agentCore/agents/executiveTranslatorAgent';
import type { AuditFinding } from '../services/agentCore/types';
import { renderMarkdown } from '../utils/markdown';
import * as markdownUtils from '../utils/markdown';
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
      citationRatePercent: 25,
      shareOfVoiceScore: 1,
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
      value: 'mentioned in 1 of 4 web results',
    });
    expect(summary.topFix).toBe('Add Organization schema');
    expect(summary.failureCodes).toEqual([]);
    expect(summary.degraded).toBe(false);
  });

  // SW0a-7 review, item 4: the card names what was queried and nothing else.
  it('names only the search source the rows came from, and no AI product the run did not query', () => {
    const measured = {
      targetUrl: 'brand.example',
      measurementStatus: 'measured' as const,
      citationRatePercent: 56,
      shareOfVoiceScore: 5,
      healthScore: 73,
      healthChecks: { passed: 3, total: 4 },
      scrapedPageCount: 1,
      serpCount: 9,
      searchEngines: ['tavily', 'tavily', 'tavily'],
      findings: [{ title: 'Add Organization schema' }],
      hostedRail: 'signed_in_hosted' as const,
    };
    const summary = buildGuestScoutSummary(measured);
    expect(summary.degraded).toBe(false);
    expect('aiPlatforms' in summary).toBe(false);
    expect(summary.evidenceUsed).toBe('Pages with text or schema: 1. Found 9 web results through Tavily web search.');

    const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary }));
    expect(html).toContain('Found 9 web results through Tavily web search.');
    // The summary names no platform at all.
    for (const text of ['ChatGPT', 'Perplexity', 'Google', 'AI Overviews', 'Verified', 'Recommended']) {
      expect(JSON.stringify(summary), text).not.toContain(text);
    }
    // The card's own block that claimed to have observed four platforms is gone.
    // (The fix templates lower on the card still name the engines a fix is aimed at.)
    for (const text of [
      'AI Engine Recommendation Status', 'Direct observation', 'citation density', 'Brand is recommended',
      'Zero citations detected', 'organic category', 'Not Cited', 'Not Measured',
    ]) {
      expect(html, text).not.toContain(text);
    }
    expect(html).not.toMatch(/>\s*(Cited|Recommended)\s*</);

    // The sidecar is named when the rows came from it, and nothing is named when the source is unknown.
    expect(buildGuestScoutSummary({ ...measured, searchEngines: ['local_serp'] }).evidenceUsed)
      .toBe('Pages with text or schema: 1. Found 9 web results through the local search sidecar.');
    expect(buildGuestScoutSummary({ ...measured, searchEngines: undefined }).evidenceUsed)
      .toBe('Pages with text or schema: 1. Found 9 web results.');
    expect(buildGuestScoutSummary({ ...measured, serpCount: 1, shareOfVoiceScore: 1 }).evidenceUsed)
      .toBe('Pages with text or schema: 1. Found 1 web result through Tavily web search.');
  });

  // Review 2, 7: citation rate is the same two counts as share of voice.
  it('prints the citation rate as the two counts, never as a percentage', () => {
    const base = {
      targetUrl: 'brand.example',
      measurementStatus: 'measured' as const,
      healthScore: 73,
      healthChecks: { passed: 3, total: 4 },
      scrapedPageCount: 1,
      serpCount: 9,
      searchEngines: ['tavily'],
      findings: [],
      hostedRail: 'signed_in_hosted' as const,
    };
    const badge = (citationRatePercent: number | null, shareOfVoiceScore: number | null) =>
      buildGuestScoutSummary({ ...base, citationRatePercent, shareOfVoiceScore }).badges.find((item) => item.label === 'Citation rate');

    expect(badge(56, 5)).toEqual({ label: 'Citation rate', status: 'measured', value: 'mentioned in 5 of 9 web results' });
    expect(badge(0, 0)).toEqual({ label: 'Citation rate', status: 'measured', value: 'mentioned in 0 of 9 web results' });
    // A percentage with no count behind it is not printed.
    expect(badge(56, null)).toEqual({ label: 'Citation rate', status: 'not_measured' });
    expect(badge(56, 61)).toEqual({ label: 'Citation rate', status: 'not_measured' });
    expect(badge(null, 5)).toEqual({ label: 'Citation rate', status: 'not_measured' });

    const summary = buildGuestScoutSummary({ ...base, citationRatePercent: 56, shareOfVoiceScore: 5 });
    const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary }));
    expect(html).toContain('Citation rate: mentioned in 5 of 9 web results');
    expect(html).not.toContain('56');
    expect(JSON.stringify(summary.badges)).not.toMatch(/\d\s*%/);
  });

  it('shows no "Cited" pill when no search result mentions the brand', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'brand.example',
      measurementStatus: 'measured',
      citationRatePercent: 0,
      shareOfVoiceScore: 0,
      healthScore: 70,
      healthChecks: { passed: 3, total: 4 },
      scrapedPageCount: 1,
      serpCount: 9,
      searchEngines: ['tavily'],
      findings: [],
      hostedRail: 'signed_in_hosted',
    });
    const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary }));
    expect(html).toContain('Share of voice: mentioned in 0 of 9 web results');
    expect(html).not.toMatch(/>\s*Cited\s*</);
    expect(html).not.toMatch(/>\s*Recommended\s*</);
    expect(html).not.toMatch(/Verified \d+ organic/);
    expect(summary.evidenceUsed).toContain('Found 9 web results');
  });

  it('shows page health as checks passed, never as a number out of 100', () => {
    const base = {
      targetUrl: 'brand.example',
      measurementStatus: 'measured' as const,
      citationRatePercent: 56,
      shareOfVoiceScore: 5,
      scrapedPageCount: 1,
      serpCount: 9,
      findings: [],
      hostedRail: 'signed_in_hosted' as const,
    };
    const badge = (healthScore: number | null, healthChecks?: { passed: number; total: number } | null) =>
      buildGuestScoutSummary({ ...base, healthScore, healthChecks }).badges.find((item) => item.label === 'Page health');

    expect(badge(73, { passed: 3, total: 4 })).toEqual({ label: 'Page health', status: 'measured', value: '3 of 4 checks passed' });
    // The checklist number on its own is never printed.
    expect(badge(73)).toEqual({ label: 'Page health', status: 'not_measured' });
    expect(badge(null, { passed: 3, total: 4 })).toEqual({ label: 'Page health', status: 'not_measured' });
    expect(badge(73, { passed: 9, total: 4 })).toEqual({ label: 'Page health', status: 'not_measured' });

    const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, {
      summary: buildGuestScoutSummary({ ...base, healthScore: 73, healthChecks: { passed: 3, total: 4 } }),
    }));
    expect(html).toContain('Page health: 3 of 4 checks passed');
    expect(html).not.toMatch(/\d+\s*\/\s*100/);
    expect(html).not.toContain('73');
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

  it('keeps the full measured brief for the card and a plain verdict for share', async () => {
    const finding = (id: string, severity: AuditFinding['severity'], title: string): AuditFinding => ({
      id,
      category: 'schema',
      severity,
      title,
      description: 'd',
      evidenceSource: 'homepage',
      howWeKnowItFailed: 'h',
      leadingIndicator: 'entity',
      criticVerified: true,
      criticConfidence: 0.9,
    });
    // Three of the four checks failed, so the brief lists three steps and is long.
    const brief = await executiveTranslatorAgent.execute(
      'https://seamossvibes.com.au',
      { passed: 1, total: 4 },
      { mentioned: 5, total: 9 },
      [
        finding('finding-schema-org', 'critical', 'Missing Organization'),
        finding('finding-deprecated-howto', 'medium', 'Deprecated HowTo Schema Detected'),
        finding('finding-thin-content', 'high', 'Thin Content Detected'),
      ],
      [],
      null,
      () => {},
    );
    const actionThree = '3. **Write fuller answers on thin pages:** At least one page this run read has fewer than 250 words. Add clear, 2-to-3 sentence answers to the questions your buyers ask before buying.';
    expect(brief).toContain(actionThree);
    expect(brief.length).toBeGreaterThan(600);
    expect(brief.indexOf('questions your buyers ask before buying.')).toBeGreaterThan(600);

    const summary = buildGuestScoutSummary({
      targetUrl: 'https://seamossvibes.com.au',
      measurementStatus: 'measured',
      citationRatePercent: 56,
      shareOfVoiceScore: 5,
      healthScore: 75,
      scrapedPageCount: 4,
      serpCount: 9,
      findings: [{ title: 'Missing Organization / Brand Entity Schema' }],
      plainEnglishBrief: brief,
      hostedRail: 'signed_in_hosted',
    });

    expect(summary.degraded).toBe(false);
    expect(summary.verdictMarkdown).toBe(brief.trim());
    expect(summary.verdictMarkdown.length).toBeGreaterThan(600);
    expect(summary.verdictMarkdown).toContain(actionThree);
    expect(summary.verdictMarkdown.endsWith('This run did not measure what they will change.')).toBe(true);
    expect(summary.verdict).not.toMatch(/#{2,}/);
    expect(summary.verdict).not.toContain('**');
    expect(summary.verdict).not.toContain('__');
    expect(summary.verdict).toContain('questions your buyers ask before buying.');
    expect(summary.verdict).toContain('Write fuller answers on thin pages:');
    expect(summary.verdict).toContain('Bottom Line:');
    expect(summary.verdict).not.toMatch(/(^|\s)\*[A-Za-z]/);
    expect(plainScoutVerdict(summary.verdict)).toBe(summary.verdict);

    const collapsed = brief.replace(/\s+/g, ' ').trim().slice(0, 600);
    expect(collapsed).not.toContain('questions your buyers ask before buying.');
    expect(plainScoutVerdict(collapsed)).not.toMatch(/#{2,}/);
    expect(plainScoutVerdict(collapsed)).not.toContain('**');

    const spy = vi.spyOn(markdownUtils, 'renderMarkdown');
    const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary }));
    expect(spy).toHaveBeenCalledWith(summary.verdictMarkdown);
    expect(html).toContain('markdown-content');
    expect(html).toContain('scout-brief');
    expect(html).not.toContain('###');
    expect(html).not.toContain('**');
    expect(html).not.toContain('<script');
    spy.mockRestore();
  });

  it('does not put a translator brief on a degraded card', () => {
    const brief = [
      '### What This Means',
      '',
      'Right now the score is **75/100** and citations are **56%**.',
      '',
      '1. **Claim Your Brand Identity:** Add the tag.',
      '2. **Answer Customer Questions Directly:** Write the answers.',
      '3. **Add an AI Navigation Guide:** This third action must stay off the card.',
    ].join('\n');
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'measured',
      citationRatePercent: 56,
      shareOfVoiceScore: 10,
      healthScore: 75,
      scrapedPageCount: 1,
      serpCount: 0,
      findings: [],
      errors: ['provider_auth_failed'],
      plainEnglishBrief: brief,
      hostedRail: 'signed_in_hosted',
    });
    expect(summary.degraded).toBe(true);
    expect(summary.verdictMarkdown).toBe(summary.verdict);
    expect(summary.verdictMarkdown).not.toContain('###');
    expect(summary.verdictMarkdown).not.toContain('**');
    expect(summary.verdictMarkdown).not.toContain('75/100');
    expect(summary.verdictMarkdown).not.toContain('56%');
    expect(summary.verdictMarkdown).not.toContain('third action');
    expect(summary.badges.every((badge) => badge.status === 'not_measured' && !badge.value)).toBe(true);
    expect(summary.verdict).toMatch(/not measured/i);
    expect(summary.banner).toMatch(/provider status/i);
    const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary }));
    expect(html).toContain('provider status');
    expect(html).not.toContain('75/100');
    expect(html).not.toContain('56%');
    expect(html).not.toContain('**');
    expect(html).not.toContain('What This Means');
    expect(html).not.toContain('third action');
  });

  it('does not return raw markup from renderMarkdown without a DOM sanitizer', () => {
    const dirty = '### Ok\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n**bold**';
    const html = renderMarkdown(dirty);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('**');
    expect(html).not.toContain('###');
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

describe('audit report LLM gate', () => {
  it('skips the report for a guest degraded run', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'not_measured',
      citationRatePercent: null,
      shareOfVoiceScore: null,
      healthScore: null,
      scrapedPageCount: 0,
      serpCount: 0,
      findings: [],
      errors: ['provider_auth_failed'],
      hostedRail: 'byok_or_signin',
    });
    expect(summary.degraded).toBe(true);
    expect(shouldGenerateAuditReport(true, summary, 'not_measured')).toBe(false);
  });

  it('generates the report for a guest run that was measured', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'measured',
      citationRatePercent: 12,
      shareOfVoiceScore: 20,
      healthScore: 80,
      scrapedPageCount: 1,
      serpCount: 4,
      findings: [{ title: 'Add Organization schema' }],
      hostedRail: 'byok_or_signin',
    });
    expect(summary.degraded).toBe(false);
    expect(shouldGenerateAuditReport(true, summary, 'measured')).toBe(true);
  });

  it('generates the report for a signed-in run that was measured', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'measured',
      citationRatePercent: 25,
      shareOfVoiceScore: 1,
      healthScore: 80,
      scrapedPageCount: 1,
      serpCount: 4,
      findings: [{ title: 'Add Organization schema' }],
      hostedRail: 'signed_in_hosted',
    });
    expect(summary.badges.find((badge) => badge.label === 'Citation rate')?.value).toBe('mentioned in 1 of 4 web results');
    expect(shouldGenerateAuditReport(false, summary, 'measured')).toBe(true);
  });

  it('skips the report for a signed-in run that was not measured', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com/pricing',
      measurementStatus: 'not_measured',
      citationRatePercent: null,
      shareOfVoiceScore: null,
      healthScore: null,
      scrapedPageCount: 0,
      serpCount: 0,
      findings: [],
      errors: ['Firecrawl HTTP 401'],
      hostedRail: 'signed_in_hosted',
    });
    expect(summary.degraded).toBe(true);
    expect(summary.evidenceEmpty).toBe(true);
    expect(summary.badges.every((badge) => badge.status === 'not_measured' && !badge.value)).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(/\d+%/);
    expect(shouldGenerateAuditReport(false, summary, 'not_measured')).toBe(false);
  });

  it('skips the report when a signed-in run is degraded by an empty search', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'not_measured',
      citationRatePercent: 45,
      shareOfVoiceScore: 43,
      healthScore: 73,
      scrapedPageCount: 1,
      serpCount: 0,
      findings: [],
      errors: ['provider_auth_failed'],
      hostedRail: 'signed_in_hosted',
    });
    expect(summary.degraded).toBe(true);
    expect(summary.badges.every((badge) => badge.status === 'not_measured' && !badge.value)).toBe(true);
    expect(shouldGenerateAuditReport(false, summary, 'not_measured')).toBe(false);
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
