/**
 * Pure helpers extracted from InstantAuditView to maintain <1000 line ceiling.
 */
import {
  canUseHostedProviderKey,
  ensureHostedProviderReady,
  getCurrentQuotaSync,
  getServerHealthSync,
  hasActivePaidPlanSync,
} from '../apiClient';
import { geminiService } from '../geminiService';
import type { BusinessDNA, ReportFocus } from '../../types';
import type { AuditLens } from '../skills/seoPlaybooks';
import type { AuditStateGraphContext } from '../agentCore/types';
import {
  buildGuestScoutSummary,
  shouldGenerateAuditReport,
  type GuestScoutSummary,
} from './guestScoutSummary';
import { healthChecklist } from '../agentCore/auditEvidenceGate';
import { entitlementsFor } from '../plans/planEntitlements';
import type { HostedScoutRail } from './hostedScoutRail';

export function instantAuditPrimaryLabel(crewRunning: boolean, isFullAudit: boolean): string {
  if (crewRunning) return 'Scanning...';
  return isFullAudit ? 'Run full audit' : 'Run quick scout';
}

export type InstantAuditPersistOutcome = 'unmeasured' | 'unsaved';

/** Save-status line under Instant Audit. Signed-in sessions are never told to sign in. */
export function instantAuditPersistHint(signedIn: boolean, outcome: InstantAuditPersistOutcome): string {
  if (!signedIn) {
    if (outcome === 'unmeasured') {
      return 'Scout finished. Use the summary above. This run did not measure the site, so no full report was generated. Sign in to save a project. Full branded share links stay on Growth and Agency.';
    }
    return 'Scout finished. Use the summary above. Sign in to save a project. Full branded share links stay on Growth and Agency.';
  }
  if (outcome === 'unmeasured') {
    return 'Scout finished. Use the summary above. This run did not measure the site, so no full report was generated. Strategy was not saved. Retry, or check Settings → provider status.';
  }
  return 'Audit complete. Strategy was not saved to a project. Retry, or check Settings for share links and MCP on your plan.';
}

/** Undefined until provider health is known. False when signed-in hosted Firecrawl and Tavily are both closed. */
export function signedInHostedGateOpen(rail: HostedScoutRail): boolean | undefined {
  if (rail !== 'signed_in_hosted') return undefined;
  if (!getServerHealthSync().ok) return undefined;
  return canUseHostedProviderKey('firecrawl') || canUseHostedProviderKey('tavily');
}

export async function generateAuditReportUnlessDegraded(input: {
  isGuest: boolean;
  summary: GuestScoutSummary;
  measurementStatus: 'measured' | 'not_measured';
  formattedUrl: string;
  targetFocus: ReportFocus;
  dna: BusinessDNA | null;
  lenses: AuditLens[];
  scrapedPages?: AuditStateGraphContext['scrapedPages'];
  serpEvidence?: AuditStateGraphContext['serpEvidence'];
}): Promise<Awaited<ReturnType<typeof geminiService.generateAuditReport>> | null> {
  if (!shouldGenerateAuditReport(input.isGuest, input.summary, input.measurementStatus)) {
    return null;
  }
  await ensureHostedProviderReady();
  return geminiService.generateAuditReport(
    input.formattedUrl,
    input.targetFocus,
    input.dna,
    input.lenses,
    {
      scrapedPages: input.scrapedPages,
      serpEvidence: input.serpEvidence,
    },
  );
}

export function summaryFromCrew(crew: AuditStateGraphContext, hostedRail: HostedScoutRail): GuestScoutSummary {
  return buildGuestScoutSummary({
    targetUrl: crew.targetUrl,
    measurementStatus: crew.measurementStatus,
    measurementReason: crew.measurementReason,
    citationRatePercent: crew.citationRatePercent,
    shareOfVoiceScore: crew.shareOfVoiceScore,
    healthScore: crew.healthScore,
    healthChecks: typeof crew.healthScore === 'number' ? healthChecklist(crew.findings) : null,
    scrapedPageCount: crew.scrapedPages.length,
    serpCount: crew.serpEvidence.length,
    searchEngines: [...new Set(crew.serpEvidence.map((row) => row.engine))],
    findings: crew.findings.map((finding) => ({ title: finding.title })),
    errors: crew.errors,
    plainEnglishBrief: crew.plainEnglishBrief,
    llmCrawler: crew.llmCrawlerReadiness,
    hostedRail,
  });
}

export function canMintMcpKeys(): boolean {
  const quota = getCurrentQuotaSync();
  if (!quota) return false;
  const plan = quota.plan || 'free';
  if (plan !== 'free' && plan !== 'active') {
    return entitlementsFor(plan).mcpAccess;
  }
  if (hasActivePaidPlanSync()) {
    return entitlementsFor('growth').mcpAccess;
  }
  return false;
}
