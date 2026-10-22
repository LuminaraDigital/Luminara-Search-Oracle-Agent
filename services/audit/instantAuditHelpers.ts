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
import { getAnswerDepth } from './answerDepth';
import type { HostedScoutRail } from './hostedScoutRail';
import { guardPasteReadyCopy, siteLooksHealthRelated } from './healthClaimGuard';
import { guardUnmeasuredClaims, type MeasuredClaimFacts } from './unmeasuredClaimGuard';
import { fallbackAnswerLine } from '../llm/fallbackAnswer';
import { brandFromEvidence, rememberScrapedBrand } from './brandName';
import { recordAudit } from './auditHistoryService';

export function instantAuditPrimaryLabel(crewRunning: boolean, _isFullAudit: boolean): string {
  if (crewRunning) return 'Scanning...';
  return 'Run Instant Audit';
}

export type InstantAuditPersistOutcome = 'unmeasured' | 'unsaved';

export const FAILED_CHECK_NOTE =
  "This check couldn't finish, it didn't count against your free checks.";

/** Save-status line under Instant Audit. Signed-in sessions are never told to sign in. */
export function instantAuditPersistHint(
  signedIn: boolean,
  outcome: InstantAuditPersistOutcome,
  metered = false,
): string {
  if (signedIn && outcome === 'unmeasured' && metered) {
    return `${FAILED_CHECK_NOTE} Retry, or check Settings → provider status.`;
  }
  if (!signedIn) {
    if (outcome === 'unmeasured') {
      return 'Instant Audit finished. Use the summary above. This run did not measure the site, so no full report was generated. Sign in to save a project. Full branded share links stay on Growth and Pro / Agency.';
    }
    return 'Instant Audit finished. Use the summary above. Sign in to save a project. Full branded share links stay on Growth and Pro / Agency.';
  }
  if (outcome === 'unmeasured') {
    return 'Instant Audit finished. Use the summary above. This run did not measure the site, so no full report was generated. Strategy was not saved. Retry, or check Settings → provider status.';
  }
  return 'Audit complete. Strategy was not saved to a project. Retry, or check Settings for share links and MCP on your plan.';
}

/** Undefined until provider health is known. False when signed-in hosted Firecrawl and Tavily are both closed. */
export function signedInHostedGateOpen(rail: HostedScoutRail): boolean | undefined {
  if (rail !== 'signed_in_hosted') return undefined;
  if (!getServerHealthSync().ok) return undefined;
  return canUseHostedProviderKey('firecrawl') || canUseHostedProviderKey('tavily');
}

export type GuardedAuditReport = Awaited<ReturnType<typeof geminiService.generateAuditReport>> & {
  healthSite: boolean;
};

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
}): Promise<GuardedAuditReport | null> {
  if (!shouldGenerateAuditReport(input.isGuest, input.summary, input.measurementStatus)) {
    return null;
  }
  await ensureHostedProviderReady();
  const report = await geminiService.generateAuditReport(
    input.formattedUrl,
    input.targetFocus,
    input.dna,
    input.lenses,
    {
      scrapedPages: input.scrapedPages,
      serpEvidence: input.serpEvidence,
    },
  );
  const pages = input.scrapedPages ?? [];
  const firstPage = pages[0];
  rememberScrapedBrand(input.formattedUrl, brandFromEvidence({
    siteName: firstPage?.siteName,
    organizationName: firstPage?.organizationName,
    title: firstPage?.title || firstPage?.h1s?.[0],
  }));
  const serp = input.serpEvidence ?? [];
  const facts: MeasuredClaimFacts = {
    ...input.summary.measured,
    wordCounts: pages.map((page) => page.wordCount),
    schemaTypes: pages.flatMap((page) => page.schemasFound.map((schema) => schema.type)),
    tavilyResultCount: input.serpEvidence
      ? serp.filter((row) => row.engine === 'tavily').length
      : input.summary.measured?.tavilyResultCount,
    evidenceText: [
      ...pages.flatMap((page) => [page.title, page.description, page.rawTextSnippet, ...page.h1s]),
      ...serp.flatMap((row) => [row.title, row.snippet, row.query, row.aiOverviewText]),
    ].filter((part): part is string => Boolean(part && part.trim())).join('\n'),
  };
  const guarded = guardUnmeasuredClaims(guardPasteReadyCopy(report.text).text, facts);
  const modelLine = fallbackAnswerLine(
    report.answeredBy ? { model: report.answeredBy, provider: report.answeredByProvider } : undefined,
  );
  const text = modelLine && !guarded.includes(modelLine) ? `${guarded}\n\n${modelLine}` : guarded;
  try {
    recordAudit({
      domain: input.formattedUrl,
      focus: input.targetFocus,
      reportText: text,
      healthScore: facts.healthScore ?? null,
      citationRatePercent: facts.citationRatePercent ?? null,
    });
  } catch {
    /* local history is optional */
  }
  return {
    ...report,
    text,
    unifiedDiff: report.unifiedDiff ? guardPasteReadyCopy(report.unifiedDiff).text : report.unifiedDiff,
    remediationPayload: report.remediationPayload
      ? { ...report.remediationPayload, schemaJsonLd: guardPasteReadyCopy(report.remediationPayload.schemaJsonLd).text }
      : report.remediationPayload,
    healthSite: siteLooksHealthRelated({
      domain: input.formattedUrl,
      title: [input.dna?.name, ...pages.map((page) => page.title)].filter(Boolean).join(' '),
      content: [input.dna?.mission, input.dna?.usp, ...pages.map((page) => page.rawTextSnippet)].filter(Boolean).join('\n'),
    }),
  };
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
    focus: crew.focus,
    depth: getAnswerDepth(),
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
