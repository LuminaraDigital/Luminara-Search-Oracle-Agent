/**
 * Luminara Audit Preflight Simulator
 *
 * Provides instant (<300ms) execution simulation before launching audits or multi-agent crawls.
 * Predicts run time, compute units, dual-chain pricing, AI crawler allowance, and evidence yield.
 */

import { probeLlmCrawlerReadiness } from './llmCrawlerProbe';
import type { LlmCrawlerReport } from './llmCrawlerReadiness';

export type AuditSimulationType = 'seo' | 'aeo' | 'geo' | 'multi_agent_crawl';

export interface PreflightSimulationPricing {
  ton: string;
  nanoTon: string;
  usdt: string;
  lora: string;
  xdc: string;
}

export interface PreflightSimulationResult {
  targetDomain: string;
  auditType: AuditSimulationType;
  estimatedDurationSec: number;
  estimatedComputeUnits: number;
  pricing: PreflightSimulationPricing;
  aiCrawlerStatus: {
    gptBotAllowed: boolean;
    perplexityAllowed: boolean;
    claudeBotAllowed: boolean;
    googleExtendedAllowed: boolean;
  };
  hasLlmsTxt: boolean;
  predictedEvidenceYield: 'high' | 'medium' | 'low';
  riskFlags: string[];
  recommendation: 'proceed' | 'caution' | 'block';
  timestamp: number;
}

export const DUAL_CHAIN_AUDIT_PRICING: Record<AuditSimulationType, PreflightSimulationPricing> = {
  seo: {
    ton: '0.05 TON',
    nanoTon: '50000000',
    usdt: '1 USDT',
    lora: '1 $LORA',
    xdc: '50 XDC',
  },
  aeo: {
    ton: '0.05 TON',
    nanoTon: '50000000',
    usdt: '1 USDT',
    lora: '1 $LORA',
    xdc: '50 XDC',
  },
  geo: {
    ton: '0.05 TON',
    nanoTon: '50000000',
    usdt: '1 USDT',
    lora: '1 $LORA',
    xdc: '50 XDC',
  },
  multi_agent_crawl: {
    ton: '0.15 TON',
    nanoTon: '150000000',
    usdt: '3 USDT',
    lora: '3 $LORA',
    xdc: '150 XDC',
  },
};

export function cleanTargetDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const withoutProto = trimmed.replace(/^https?:\/\//i, '');
  const host = withoutProto.split('/')[0].split('?')[0].split('#')[0];
  return host.replace(/^www\./i, '');
}

export function evaluateCrawlerFlagsFromReport(report: LlmCrawlerReport): {
  gptBotAllowed: boolean;
  perplexityAllowed: boolean;
  claudeBotAllowed: boolean;
  googleExtendedAllowed: boolean;
  hasLlmsTxt: boolean;
  riskFlags: string[];
} {
  const riskFlags: string[] = [];
  const llmsCheck = report.checks.find((c) => c.id === 'llms_txt');
  const hasLlmsTxt = llmsCheck?.status === 'pass';

  if (!hasLlmsTxt) {
    riskFlags.push('Missing llms.txt standard file');
  }

  const botCheck = report.checks.find((c) => c.id === 'ai_bot_directives');
  const isBotFailed = botCheck?.status === 'fail';

  let gptBotAllowed = true;
  let perplexityAllowed = true;
  let claudeBotAllowed = true;
  let googleExtendedAllowed = true;

  if (isBotFailed) {
    riskFlags.push('One or more AI search crawlers are restricted in robots.txt');
    const detail = (botCheck?.detail || '').toLowerCase();
    if (detail.includes('gptbot') || detail.includes('oai-searchbot')) gptBotAllowed = false;
    if (detail.includes('perplexitybot')) perplexityAllowed = false;
    if (detail.includes('claudebot')) claudeBotAllowed = false;
    if (detail.includes('google-extended')) googleExtendedAllowed = false;
  }

  return {
    gptBotAllowed,
    perplexityAllowed,
    claudeBotAllowed,
    googleExtendedAllowed,
    hasLlmsTxt,
    riskFlags,
  };
}

/**
 * Runs a preflight simulation of an audit execution against a domain.
 */
export async function simulateAudit(
  rawInput: string,
  auditType: AuditSimulationType = 'aeo',
  fetcher?: (url: string) => Promise<LlmCrawlerReport>,
): Promise<PreflightSimulationResult> {
  const domain = cleanTargetDomain(rawInput);
  const now = Date.now();
  const pricing = DUAL_CHAIN_AUDIT_PRICING[auditType] || DUAL_CHAIN_AUDIT_PRICING.aeo;
  const isMultiAgent = auditType === 'multi_agent_crawl';

  if (!domain) {
    return {
      targetDomain: '',
      auditType,
      estimatedDurationSec: 0,
      estimatedComputeUnits: 0,
      pricing,
      aiCrawlerStatus: {
        gptBotAllowed: false,
        perplexityAllowed: false,
        claudeBotAllowed: false,
        googleExtendedAllowed: false,
      },
      hasLlmsTxt: false,
      predictedEvidenceYield: 'low',
      riskFlags: ['Invalid or empty domain'],
      recommendation: 'block',
      timestamp: now,
    };
  }

  let crawlerReport: LlmCrawlerReport;
  try {
    if (fetcher) {
      crawlerReport = await fetcher(domain);
    } else {
      crawlerReport = await probeLlmCrawlerReadiness(`https://${domain}`);
    }
  } catch {
    crawlerReport = { checks: [] };
  }

  const {
    gptBotAllowed,
    perplexityAllowed,
    claudeBotAllowed,
    googleExtendedAllowed,
    hasLlmsTxt,
    riskFlags,
  } = evaluateCrawlerFlagsFromReport(crawlerReport);

  let predictedEvidenceYield: 'high' | 'medium' | 'low' = 'high';
  if (!gptBotAllowed && !perplexityAllowed) {
    predictedEvidenceYield = 'low';
    riskFlags.push('Critical AI crawlers blocked. AI citation visibility may be suppressed.');
  } else if (!hasLlmsTxt || !googleExtendedAllowed) {
    predictedEvidenceYield = 'medium';
  }

  let recommendation: 'proceed' | 'caution' | 'block' = 'proceed';
  if (predictedEvidenceYield === 'low') {
    recommendation = 'caution';
  }

  const estimatedDurationSec = isMultiAgent ? 24 : 12;
  const estimatedComputeUnits = isMultiAgent ? 3 : 1;

  return {
    targetDomain: domain,
    auditType,
    estimatedDurationSec,
    estimatedComputeUnits,
    pricing,
    aiCrawlerStatus: {
      gptBotAllowed,
      perplexityAllowed,
      claudeBotAllowed,
      googleExtendedAllowed,
    },
    hasLlmsTxt,
    predictedEvidenceYield,
    riskFlags,
    recommendation,
    timestamp: now,
  };
}
