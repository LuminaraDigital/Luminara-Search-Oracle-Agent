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
import { healthChecklist, siteChecksRan } from '../agentCore/auditEvidenceGate';
import { entitlementsFor } from '../plans/planEntitlements';
import { getAnswerDepth } from './answerDepth';
import type { HostedScoutRail } from './hostedScoutRail';
import { guardPasteReadyCopy, siteLooksHealthRelated } from './healthClaimGuard';
import { guardUnmeasuredClaims, type MeasuredClaimFacts } from './unmeasuredClaimGuard';
import { fallbackAnswerLine } from '../llm/fallbackAnswer';
import { brandFromEvidence, readableStem, rememberScrapedBrand } from './brandName';
import { recordAudit } from './auditHistoryService';
import { evaluateRealEstateChecks, formatRealEstateChecks } from './realEstateChecks';
import { includeRealEstateChecks, wantsAgencyMentions } from './jevVerifier';

export function instantAuditPrimaryLabel(crewRunning: boolean, _isFullAudit: boolean): string {
  if (crewRunning) return 'Running the audit…';
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
      return 'Instant Audit finished. Use the summary above. This run did not measure the site, so no full report was generated. Sign in to save a project. Full branded share links stay on Growth and Agency.';
    }
    return 'Instant Audit finished. Use the summary above. Sign in to save a project. Full branded share links stay on Growth and Agency.';
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
  siteType?: string | null;
  brandSupported?: boolean | null;
  /** Name Jev picked, or a supported scraped name. A title-cased domain is not stored. */
  displayName?: string | null;
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
  const scrapedBrand = brandFromEvidence({
    siteName: firstPage?.siteName,
    organizationName: firstPage?.organizationName,
    title: firstPage?.title || firstPage?.h1s?.[0],
  });
  const keptName = input.displayName || (input.brandSupported === false ? null : scrapedBrand);
  rememberScrapedBrand(input.formattedUrl, keptName);
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
  const body = modelLine && !guarded.includes(modelLine) ? `${guarded}\n\n${modelLine}` : guarded;
  const estate = includeRealEstateChecks(input.siteType, pages.length)
    ? formatRealEstateChecks(evaluateRealEstateChecks(pages)).trimEnd()
    : '';
  const mention = await agencyMentionLine(input.siteType, scrapedBrand || '', input.formattedUrl);
  const parts = [body];
  if (estate && !body.includes('## Real estate checks')) parts.push(estate);
  if (mention) parts.push(mention);
  const text = parts.join('\n\n');
  try {
    recordAudit({
      id: report.auditHistoryId,
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

async function agencyMentionLine(siteType: string | null | undefined, brand: string, domain: string): Promise<string> {
  if (!wantsAgencyMentions(siteType)) return '';
  const name = brand.replace(/"/g, '').trim() || domain;
  try {
    const { exaService } = await import('../search/exaService');
    const found = await exaService.search(`"${name}" ${domain} reviews`, {
      numResults: 3,
      contents: true,
      summary: false,
      timeoutMs: 8000,
    });
    if (!found.results.length) return '';
    const rows = found.results.slice(0, 3).map((row) => `${row.title} (${row.url})`).join('; ');
    return `Web mentions: ${rows}.`;
  } catch {
    return '';
  }
}

export function summaryFromCrew(crew: AuditStateGraphContext, hostedRail: HostedScoutRail): GuestScoutSummary {
  if (crew.displayName) rememberScrapedBrand(crew.targetUrl, crew.displayName);
  const brand = crew.displayName || readableStem(crew.targetUrl);
  return buildGuestScoutSummary({
    brand,
    targetUrl: crew.targetUrl,
    measurementStatus: crew.measurementStatus,
    measurementReason: crew.measurementReason,
    citationRatePercent: crew.citationRatePercent,
    shareOfVoiceScore: crew.shareOfVoiceScore,
    healthScore: crew.healthScore,
    healthChecks: siteChecksRan(crew.healthScore, crew.findings)
      ? healthChecklist(crew.findings, { citationRateKnown: typeof crew.citationRatePercent === 'number' })
      : null,
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
