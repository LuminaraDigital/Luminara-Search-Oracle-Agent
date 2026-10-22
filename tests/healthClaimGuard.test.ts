import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SYSTEM_INSTRUCTIONS } from '../constants';
import { ReportDisplay } from '../components/audit/ReportDisplay';
import { remediationArchitectAgent } from '../services/agentCore/agents/remediationArchitectAgent';
import {
  HEALTH_CLAIM_RULE,
  HEALTH_CLAIM_WARNING,
  HEALTH_SITE_NOTE,
  REMOVED_HEALTH_CLAIM,
  guardPasteReadyCopy,
  siteLooksHealthRelated,
} from '../services/audit/healthClaimGuard';
import { generateAuditReportUnlessDegraded } from '../services/audit/instantAuditHelpers';
import { buildGuestScoutSummary } from '../services/audit/guestScoutSummary';
import type { ScrapedPageEvidence } from '../services/agentCore/types';
import { geminiService } from '../services/geminiService';
import { TELEGRAM_ORACLE_SYSTEM_PROMPT } from '../worker/telegramBot';
import { buildOracleSystemPrompt } from '../worker/oracleInteractionGuard';

const BEFORE =
  'Sea moss gel boosts immunity, is clinically proven to detox, and can cure fatigue. It treats eczema.';

describe('health-claim guardrail', () => {
  it('puts the same rule on audit, Telegram, and Oracle prompts', () => {
    for (const prompt of [SYSTEM_INSTRUCTIONS, TELEGRAM_ORACLE_SYSTEM_PROMPT, buildOracleSystemPrompt()]) {
      expect(prompt).toContain(HEALTH_CLAIM_RULE);
      expect(prompt).toContain('Never give medical advice');
      expect(prompt).toContain('TGA Therapeutic Goods Advertising Code');
      expect(prompt).toContain('Australian Consumer Law');
    }
  });

  it('strips high-risk phrases from paste-ready copy and leaves ordinary SEO advice', () => {
    const guarded = guardPasteReadyCopy(BEFORE);
    expect(guarded.changed).toBe(true);
    expect(guarded.text).not.toMatch(/boosts immunity|clinically proven|detox|cure|treats eczema/i);
    expect(guarded.text).toContain(REMOVED_HEALTH_CLAIM);
    expect(guarded.text).toContain(HEALTH_CLAIM_WARNING);
    expect(guarded.text.startsWith(`Sea moss gel ${REMOVED_HEALTH_CLAIM}`)).toBe(true);

    const seo = guardPasteReadyCopy('Rewrite the title to prevent thin content. Treat the homepage as the main page. The technical health, site health, and health score stay as written.');
    expect(seo.changed).toBe(false);
    expect(seo.text).toContain('technical health');
    expect(seo.text).toContain('site health');
    expect(seo.text).toContain('health score');
    expect(seo.text).toContain('prevent thin content');
    expect(seo.text).not.toContain(HEALTH_CLAIM_WARNING);

    const twice = guardPasteReadyCopy(guarded.text);
    expect(twice.changed).toBe(false);
    expect(twice.text).toBe(guarded.text);
  });

  it('flags health sites from the domain, title, or fetched copy', () => {
    expect(siteLooksHealthRelated({ domain: 'clinic.example.com', title: 'Hours', content: 'Book a visit' })).toBe(true);
    expect(siteLooksHealthRelated({ domain: 'seamossvibes.com.au', title: 'Sea Moss Vibes', content: 'Jar of gel' })).toBe(true);
    expect(siteLooksHealthRelated({ domain: 'acme.example', title: 'Acme Pharmacy', content: 'Opening hours' })).toBe(true);
    expect(siteLooksHealthRelated({ domain: 'acme.example', title: 'Acme Plumbing', content: 'We fix pipes and taps.' })).toBe(false);
    expect(HEALTH_SITE_NOTE).toBe(
      'Health and wellness copy in Australia must follow the TGA Advertising Code. Luminara gives marketing suggestions only, not medical or legal advice.',
    );
  });

  it('shows the TGA note on a health report and hides it on a plumbing report', () => {
    const health = renderToStaticMarkup(createElement(ReportDisplay, {
      markdownText: '# Audit\n\nOne move this week.',
      targetDomain: 'acme-plumbing.example',
      healthSite: true,
    }));
    expect(health).toContain(HEALTH_SITE_NOTE);
    const clinic = renderToStaticMarkup(createElement(ReportDisplay, {
      markdownText: '# Audit',
      targetDomain: 'clinic.example.com',
    }));
    expect(clinic).toContain(HEALTH_SITE_NOTE);
    const plumbing = renderToStaticMarkup(createElement(ReportDisplay, {
      markdownText: '# Audit\n\nFix the title tag.',
      targetDomain: 'acme-plumbing.example',
      dnaName: 'Acme Plumbing',
    }));
    expect(plumbing).not.toContain('TGA Advertising Code');
  });

  it('guards the audit report and the schema snippet without another model call', async () => {
    const spy = vi.spyOn(geminiService, 'generateAuditReport').mockResolvedValue({
      text: BEFORE,
      sources: [],
      remediationPayload: {
        domain: 'seamossvibes.com.au',
        pageUrl: 'https://seamossvibes.com.au',
        title: 'Sea Moss',
        schemaJsonLd: '{"description":"This gel boosts immunity"}',
      },
      unifiedDiff: 'clinically proven',
    } as Awaited<ReturnType<typeof geminiService.generateAuditReport>>);
    const page: ScrapedPageEvidence = {
      url: 'https://seamossvibes.com.au',
      title: 'Sea Moss Vibes',
      h1s: ['Sea moss gel'],
      schemasFound: [],
      wordCount: 40,
      rawTextSnippet: 'Organic sea moss supplement.',
      source: 'firecrawl',
    };
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://seamossvibes.com.au',
      measurementStatus: 'measured',
      citationRatePercent: 12,
      shareOfVoiceScore: 20,
      healthScore: 80,
      scrapedPageCount: 1,
      serpCount: 1,
      findings: [{ title: 'Add Organization schema' }],
      hostedRail: 'signed_in_hosted',
    });
    const report = await generateAuditReportUnlessDegraded({
      isGuest: false,
      summary,
      measurementStatus: 'measured',
      formattedUrl: 'https://seamossvibes.com.au',
      targetFocus: 'AEO',
      dna: null,
      lenses: [],
      scrapedPages: [page],
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(report?.healthSite).toBe(true);
    expect(report?.text).not.toMatch(/boosts immunity|clinically proven|\bcure\b/i);
    expect(report?.text).toContain(HEALTH_CLAIM_WARNING);
    expect(report?.remediationPayload?.schemaJsonLd).not.toMatch(/boosts immunity/i);
    expect(report?.unifiedDiff).not.toMatch(/clinically proven/i);
    spy.mockRestore();
  });

  it('names the Workers AI model on a fallback audit report', async () => {
    const spy = vi.spyOn(geminiService, 'generateAuditReport').mockResolvedValue({
      text: '# Luminara\n\nOne move this week.',
      sources: [],
      answeredBy: '@cf/meta/llama-3.1-8b-instruct-fast',
    } as Awaited<ReturnType<typeof geminiService.generateAuditReport>>);
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'measured',
      citationRatePercent: 12,
      shareOfVoiceScore: 20,
      healthScore: 80,
      scrapedPageCount: 1,
      serpCount: 1,
      findings: [],
      hostedRail: 'signed_in_hosted',
    });
    const report = await generateAuditReportUnlessDegraded({
      isGuest: false,
      summary,
      measurementStatus: 'measured',
      formattedUrl: 'https://example.com',
      targetFocus: 'AEO',
      dna: null,
      lenses: [],
    });
    expect(report?.answeredBy).toBe('@cf/meta/llama-3.1-8b-instruct-fast');
    expect(report?.text).toContain('Answered by a fallback model: @cf/meta/llama-3.1-8b-instruct-fast');
    spy.mockRestore();
  });

  it('names NVIDIA on a fallback audit report', async () => {
    const spy = vi.spyOn(geminiService, 'generateAuditReport').mockResolvedValue({
      text: '# Luminara\n\nOne move this week.',
      sources: [],
      answeredBy: 'meta/llama-3.2-11b-vision-instruct',
      answeredByProvider: 'nvidia',
    } as Awaited<ReturnType<typeof geminiService.generateAuditReport>>);
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'measured',
      citationRatePercent: 12,
      shareOfVoiceScore: 20,
      healthScore: 80,
      scrapedPageCount: 1,
      serpCount: 1,
      findings: [],
      hostedRail: 'signed_in_hosted',
    });
    const report = await generateAuditReportUnlessDegraded({
      isGuest: false,
      summary,
      measurementStatus: 'measured',
      formattedUrl: 'https://example.com',
      targetFocus: 'AEO',
      dna: null,
      lenses: [],
    });
    expect(report?.text).toContain('Answered by a fallback model: NVIDIA (meta/llama-3.2-11b-vision-instruct)');
    spy.mockRestore();
  });

  it('strips a health claim from a paste-ready llms.txt patch', async () => {
    const patches = await remediationArchitectAgent.execute(
      'https://clinic.example',
      [{
        id: 'finding-schema-org',
        category: 'schema',
        severity: 'high',
        title: 'Missing Organization markup',
        description: 'Parsed HTML has no Organization schema.',
        evidenceSource: 'DOM',
        howWeKnowItFailed: 'Schema types found: none.',
        leadingIndicator: 'Entity disambiguation.',
        criticVerified: false,
        criticConfidence: 0.9,
      }],
      {
        name: 'Clinic',
        mission: 'Our gel boosts immunity.',
        usp: 'Same-day visits',
        targetAudience: 'Local patients',
        competitors: [],
        perceivedGaps: [],
        rawContext: '',
      },
      () => {},
    );
    const pasted = patches.map((patch) => patch.proposedSnippet).join('\n');
    expect(pasted).not.toMatch(/boosts immunity/i);
    expect(pasted).toContain(HEALTH_CLAIM_WARNING);
  });
});
