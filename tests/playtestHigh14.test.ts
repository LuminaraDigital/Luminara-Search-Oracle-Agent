import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentMissionControl, missionControlCardBadge, missionControlHeadline } from '../components/audit/AgentMissionControl';
import LandingPage from '../components/LandingPage';
import { GuestScoutSummaryPanel } from '../components/audit/GuestScoutSummaryPanel';
import { CHECKOUT_TERM_LINE, PAYWALL_HEADLINE, PAYWALL_SUBLINE, planBullets } from '../components/paywall/planCopy';
import { unmeasuredHealthMessage } from '../services/agentCore/auditEvidenceGate';
import { scoutAgent } from '../services/agentCore/agents/scoutAgent';
import { CREW_PROFILES } from '../services/agentCore/crewOrchestrator';
import type { AgentRole } from '../services/agentCore/types';
import { buildGuestScoutSummary } from '../services/audit/guestScoutSummary';
import {
  GUEST_FULL_AUDIT_CTA,
  GUEST_HERO_NOTE,
  GUEST_REPORT_NOTE,
  requestGuestFullAuditSignIn,
} from '../services/audit/hostedScoutRail';
import { siteEvidencePackService } from '../services/scraping/siteEvidencePack';
import { unifiedScraperService } from '../services/scraping/unifiedScraper';

const state = vi.hoisted(() => ({
  inTelegram: false,
  wallet: null as { account: { address: string } } | null,
  health: { ok: true, providers: {}, telegram: false, requireAuth: true, ton: false, jettonCheckout: false, stripeCheckout: false, plans: {} } as Record<string, unknown>,
}));

vi.mock('@tonconnect/ui-react', () => ({
  TonConnectButton: () => createElement('span', null, 'TON-CONNECT-BUTTON'),
  useTonWallet: () => state.wallet,
  useTonConnectUI: () => [{}, () => {}],
}));

vi.mock('../services/telegram/tma', async (importActual) => ({
  ...(await importActual<typeof import('../services/telegram/tma')>()),
  isInTelegram: () => state.inTelegram,
}));

vi.mock('../services/apiClient', async (importActual) => ({
  ...(await importActual<typeof import('../services/apiClient')>()),
  getServerHealthSync: () => state.health,
}));

import { PaywallModal } from '../components/paywall/PaywallModal';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('honest guest audit copy', () => {
  it('tells guests the homepage check is crawl files, and a full audit needs sign-in or keys', () => {
    expect(GUEST_HERO_NOTE).toMatch(/robots\.txt/);
    expect(GUEST_HERO_NOTE).toMatch(/sign-in or your own keys/i);
    expect(GUEST_HERO_NOTE).not.toMatch(/no signup/i);
    expect(GUEST_REPORT_NOTE).toMatch(/sign-in or your own keys/i);
    expect(GUEST_FULL_AUDIT_CTA).toBe('Sign in to run a full audit');

    const html = renderToStaticMarkup(createElement(LandingPage, {
      onNavigateAudit: () => {},
      onNavigatePricing: () => {},
      onNavigateMethodology: () => {},
      onNavigateSampleReport: () => {},
      isAuthenticated: false,
      onSignUpClick: () => {},
    }));
    expect(html).toContain(GUEST_HERO_NOTE);
    expect(html).toContain(GUEST_REPORT_NOTE);
    expect(html).not.toContain('No card, no signup');
    expect(html).not.toContain('Free live crawl check');
  });

  it('opens the sign-in wall from the guest audit button', () => {
    const seen: CustomEvent[] = [];
    vi.stubGlobal('window', {
      dispatchEvent: (event: Event) => {
        seen.push(event as CustomEvent);
        return true;
      },
    });
    requestGuestFullAuditSignIn();
    expect(seen[0]?.type).toBe('luminara-open-login');
    expect(seen[0]?.detail).toEqual({ mode: 'signin' });
  });
});

describe('Mission Control status', () => {
  it('maps done, not measured, and skipped from the step result', () => {
    expect(missionControlHeadline(false, null)).toBe('Running the audit steps. Each card shows what that step returned.');
    expect(missionControlHeadline(false, null)).not.toMatch(/collaborat/i);
    expect(unmeasuredHealthMessage('none')).toBe('Compliance checks not measured: no page or search evidence.');
    expect(unmeasuredHealthMessage('none')).not.toMatch(/finished/i);
    expect(missionControlCardBadge('completed', unmeasuredHealthMessage('no_page'))).toBe('not_measured');
    expect(missionControlCardBadge('completed', 'Scouted 2 page(s). Discovered 1 structured schema entity block(s).')).toBe('done');
    expect(missionControlCardBadge('completed', 'Remediation skipped. Live evidence was not measured, so no patches were generated.')).toBe('skipped');

    const events = (Object.keys(CREW_PROFILES) as AgentRole[]).map((role) => ({
      id: role,
      timestamp: 1,
      agentRole: role,
      agentName: CREW_PROFILES[role].name,
      phase: 'done',
      message: role === 'scout'
        ? 'Page text was read, but this crawl was not measured. On-page evidence not measured.'
        : role === 'playbook_auditor'
          ? unmeasuredHealthMessage('search')
          : role === 'remediation_architect'
            ? 'Remediation skipped. Live evidence was not measured, so no patches were generated.'
            : 'Step finished.',
      status: 'completed' as const,
    }));
    const html = renderToStaticMarkup(createElement(AgentMissionControl, {
      events,
      isComplete: true,
      measurementStatus: 'not_measured',
    }));
    expect(html).toContain('Not measured');
    expect(html).toContain('Skipped');
    expect(html).toContain('Compliance checks not measured');
    expect(html).not.toContain('Compliance audit finished');
    expect(html).not.toMatch(/collaborat/i);
    expect(html).toContain('✓ Done');
  });

  it('does not count an unmeasured page beside an empty search as measured evidence', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'not_measured',
      citationRatePercent: null,
      shareOfVoiceScore: null,
      healthScore: null,
      scrapedPageCount: 1,
      serpCount: 0,
      findings: [],
      hostedRail: 'byok_or_signin',
    });
    expect(summary.evidenceUsed).toBe('No web results were collected. This run did not measure the site.');
    expect(summary.evidenceUsed).not.toContain('Pages with text or schema');
    expect(summary.banner).toBe('Live data unavailable. Sample / not measured.');
    const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, {
      summary,
      onSignIn: () => {},
    }));
    const bannerAt = html.indexOf('Live data unavailable');
    const signInAt = html.indexOf(GUEST_FULL_AUDIT_CTA);
    const keysAt = html.indexOf('Or add your own keys in Settings.');
    expect(bannerAt).toBeGreaterThan(-1);
    expect(signInAt).toBeGreaterThan(bannerAt);
    expect(keysAt).toBeGreaterThan(signInAt);
    const view = readFileSync(resolve(__dirname, '..', 'components/audit/InstantAuditView.tsx'), 'utf8');
    const hoisted = view.indexOf('{guestResultFirst && scoutPanel}');
    const form = view.indexOf('audit-target-url');
    expect(hoisted).toBeGreaterThan(-1);
    expect(hoisted).toBeLessThan(form);
  });

  it('marks a Jina-only crawl as not measured instead of done', async () => {
    vi.spyOn(siteEvidencePackService, 'buildPack').mockRejectedValue(new Error('no pack'));
    vi.spyOn(unifiedScraperService, 'scrapeAndDistill').mockResolvedValue({
      success: true,
      providerUsed: 'jina',
      url: 'https://example.com',
      statusCode: 200,
      title: 'Example',
      description: '',
      markdown: 'Example page text for a reader fallback. '.repeat(20),
      distilled: {
        title: 'Example',
        description: '',
        openGraph: {},
        schemas: [],
        schemaTypes: [],
        headings: [],
        distilledText: 'Example page text.',
        formattedEvidence: '',
        stats: { rawChars: 80, distilledChars: 20, compressionRatio: 0.25 },
      },
      formattedEvidence: '',
      latencyMs: 20,
    });
    const messages: string[] = [];
    const pages = await scoutAgent.execute('https://example.com', (event) => {
      messages.push(event.message);
    });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.source).toBe('jina');
    const done = messages.filter((message) => message.includes('page') || message.includes('crawl') || message.includes('Scouted'));
    expect(done.join(' ')).toMatch(/not measured/i);
    expect(done.join(' ')).not.toContain('Scouted 1');
    expect(missionControlCardBadge('completed', done.join(' '))).toBe('not_measured');
  });
});

describe('checkout honesty', () => {
  it('uses a capped headline and marks Starter exclusions as not included', () => {
    expect(PAYWALL_HEADLINE).toBe('Pick the plan that fits your sites');
    expect(PAYWALL_SUBLINE).toBe(CHECKOUT_TERM_LINE);
    expect(PAYWALL_SUBLINE.toLowerCase()).not.toContain('monthly limits');
    expect(planBullets('starter').map((line) => line.text)).toContain('Monthly re-audit reminders in Telegram');
    expect(planBullets('growth').map((line) => line.text)).toContain('Weekly re-audit reminders in Telegram');
    expect(planBullets('agency').map((line) => line.text)).toContain('Daily re-audit reminders in Telegram');
    for (const id of ['starter', 'growth', 'agency'] as const) {
      for (const line of planBullets(id)) expect(line.text).not.toMatch(/^[a-z]/);
    }
    expect(PAYWALL_HEADLINE.toLowerCase()).not.toContain('unlimited');
    expect(planBullets('starter').filter((line) => !line.included).map((line) => line.text)).toEqual([
      'No IDE access (web app only)',
      'No public share links',
    ]);
    expect(planBullets('growth').find((line) => line.text.startsWith('IDE access'))?.included).toBe(true);
    const html = renderToStaticMarkup(createElement(PaywallModal, { isOpen: true, onClose: () => {} }));
    expect(html).toContain(PAYWALL_HEADLINE);
    expect(html).toContain(PAYWALL_SUBLINE);
    expect(html).not.toContain('See the caps on each plan');
    expect(html.toLowerCase()).not.toContain('unlimited');
    expect(html).toContain('Not included: </span>No IDE access (web app only)');
    expect(html).toContain('Not included: </span>No public share links');
    expect(html).not.toContain('✓</span>No IDE access');
    expect(html).not.toContain('✓</span>No public share links');
    expect(html).toContain('✓');
  });
});
