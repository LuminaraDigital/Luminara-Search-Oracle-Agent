/**
 * Executive Briefing Service (Track KP-5).
 * Generates concise 1-minute executive briefings combining Mindshare, Drivers, Catalysts, and WDL action.
 * Complies with Luminara APS invariant: verdict + one action + report link.
 */

import type { BrandMindshareSummary } from '../visibility/mindshareService';
import type { CitationDriverAnalysis } from '../visibility/citationDriverService';
import type { AuthoritySource } from '../visibility/authorityScoutService';
import type { AEOCatalyst } from '../visibility/catalystService';

export interface ExecutiveBriefing {
  domain: string;
  generatedAt: number;
  verdict: string;
  keyDriver: string;
  oneAction: {
    title: string;
    actionId: string;
    description: string;
    expectedImpact: string;
  };
  metrics: {
    mindsharePercent: number;
    velocityPercentWoW: number;
    brandCitations: number;
  };
  topUntappedHub?: {
    domain: string;
    recommendation: string;
  };
  upcomingCatalyst?: {
    title: string;
    date: string;
  };
  reportLink: string;
  textSummary: string; // Plain-text format for chat or Telegram message
}

export function generateExecutiveBriefing(opts: {
  domain: string;
  mindshare: BrandMindshareSummary;
  driverAnalysis: CitationDriverAnalysis;
  topUntappedHub?: AuthoritySource;
  upcomingCatalyst?: AEOCatalyst;
  actionOverride?: { title: string; actionId: string; description: string };
}): ExecutiveBriefing {
  const ms = opts.mindshare;
  const da = opts.driverAnalysis;
  const velocityStr = ms.velocityPercentWoW >= 0 ? `+${ms.velocityPercentWoW}%` : `${ms.velocityPercentWoW}%`;

  let verdict = '';
  if (ms.overallMindsharePercent >= 50) {
    verdict = `${opts.domain} commands a dominant ${ms.overallMindsharePercent}% category mindshare (${velocityStr} WoW) across Answer Engines.`;
  } else if (ms.overallMindsharePercent >= 20) {
    verdict = `${opts.domain} holds ${ms.overallMindsharePercent}% category mindshare (${velocityStr} WoW), actively contesting AI search citations with competitors.`;
  } else {
    verdict = `${opts.domain} currently holds ${ms.overallMindsharePercent}% mindshare across Answer Engines, with competitors capturing the majority of category citations.`;
  }

  const keyDriver = da.primaryDriver.label + ': ' + da.primaryDriver.evidenceSnippet;

  const defaultActionTitle = da.primaryDriver.actionHint;
  const defaultActionId = da.primaryDriver.recommendedActionId || 'deploy-schema';

  const oneAction = {
    title: opts.actionOverride?.title || defaultActionTitle,
    actionId: opts.actionOverride?.actionId || defaultActionId,
    description: opts.actionOverride?.description || da.primaryDriver.actionHint,
    expectedImpact: 'Directly targets citation gaps identified in Answer Engine responses.',
  };

  const reportLink = `/audit?domain=${encodeURIComponent(opts.domain)}`;

  const textSummary = [
    `*Executive Briefing: ${opts.domain}*`,
    `Verdict: ${verdict}`,
    `Driver: ${da.primaryDriver.label}`,
    `Action: ${oneAction.title}`,
    opts.topUntappedHub ? `Citation Hub: ${opts.topUntappedHub.domain} (${opts.topUntappedHub.actionRecommendation})` : null,
    `Full Report: ${reportLink}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    domain: opts.domain,
    generatedAt: Date.now(),
    verdict,
    keyDriver,
    oneAction,
    metrics: {
      mindsharePercent: ms.overallMindsharePercent,
      velocityPercentWoW: ms.velocityPercentWoW,
      brandCitations: ms.brandCitations,
    },
    topUntappedHub: opts.topUntappedHub
      ? {
          domain: opts.topUntappedHub.domain,
          recommendation: opts.topUntappedHub.actionRecommendation,
        }
      : undefined,
    upcomingCatalyst: opts.upcomingCatalyst
      ? {
          title: opts.upcomingCatalyst.title,
          date: opts.upcomingCatalyst.date,
        }
      : undefined,
    reportLink,
    textSummary,
  };
}
