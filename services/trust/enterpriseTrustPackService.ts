/**
 * Luminara Enterprise Trust Pack: controls checklist, dataset provenance,
 * prompt-volume estimates, and E-E-A-T signal status.
 *
 * IMPORTANT: This is a readiness / evidence map, NOT a SOC 2 certification claim.
 * Clean-room structure inspired by common trust-program checklists and CORE-EEAT ideas.
 */

import type { TrustPackSummary } from '../audit/aeoTrustPackService';
import type { EmpiricalCitationSummary } from '../audit/empiricalCitationService';
import type { EnrichedEntityIntelligence } from '../enrichment/publicApisEnrichmentService';
import type { TrafficImpact } from '../analytics/trafficInsightsService';
import type { SourceCitationGraph } from '../visibility/sourceCitationGraphService';

export type TrustStatus = 'pass' | 'partial' | 'fail' | 'unknown';
export type TrustCriterion =
  | 'security'
  | 'availability'
  | 'confidentiality'
  | 'processing_integrity'
  | 'privacy';

export interface TrustControlItem {
  id: string;
  criterion: TrustCriterion;
  title: string;
  status: TrustStatus;
  evidenceRefs: string[];
  owner: string;
  period: 'point_in_time' | 'observation';
  detail: string;
}

export interface DatasetProvenanceItem {
  id: string;
  name: string;
  topic: string;
  license?: string;
  sourceUrl: string;
  health: 'ok' | 'fixme' | 'unknown';
  free: boolean;
  retrievedAt: string;
  usedIn: string;
}

export interface PromptVolumeEstimate {
  id: string;
  surface: string;
  periodStart: string;
  periodEnd: string;
  prompts?: number;
  sessions?: number;
  method: 'observed' | 'estimated';
  confidence: number;
  notes: string;
}

export interface EeatSignalItem {
  id: string;
  system: 'experience' | 'expertise' | 'authority' | 'trust';
  itemCode: string;
  status: TrustStatus;
  evidenceRefs: string[];
  veto?: boolean;
  detail: string;
}

export interface EnterpriseTrustPack {
  meta: {
    version: string;
    asOf: string;
    product: 'Luminara Suite';
    disclaimer: 'controls_checklist_not_certification';
  };
  controls: TrustControlItem[];
  datasetProvenance: DatasetProvenanceItem[];
  promptVolumeEstimates: PromptVolumeEstimate[];
  eeatSignals: EeatSignalItem[];
  sourceGraphSummary?: {
    nodes: number;
    edges: number;
    brandCites: number;
  };
  readinessScore: number;
  formula: string;
}

const FORMULA =
  'readinessScore = mean(control passes*100 + partial*50) capped by failed veto E-E-A-T trust signals';

function isoDay(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function statusFromBool(ok: boolean | undefined, partialWhenMissing = true): TrustStatus {
  if (ok === true) return 'pass';
  if (ok === false) return 'fail';
  return partialWhenMissing ? 'partial' : 'unknown';
}

export function buildEnterpriseTrustPack(input: {
  domain: string;
  trustPack?: TrustPackSummary | null;
  empirical?: EmpiricalCitationSummary | null;
  enriched?: EnrichedEntityIntelligence | null;
  traffic?: TrafficImpact | null;
  sourceGraph?: SourceCitationGraph | null;
  hasFirebase?: boolean;
  requireTgAuth?: boolean;
}): EnterpriseTrustPack {
  const asOf = new Date().toISOString();
  const day = isoDay();
  const sec = input.enriched?.security;
  const httpsOk = sec?.httpsEnforced === true || sec?.redirectsToHttps === true;
  const hstsOk = !!sec?.hstsEnabled;
  const integrityOk = (input.trustPack?.citationIntegrity ?? 0) >= 70;
  const citeOk = (input.trustPack?.citeWorthiness ?? 0) >= 60;

  const controls: TrustControlItem[] = [
    {
      id: 'ctrl-byok-isolation',
      criterion: 'confidentiality',
      title: 'Bring-your-own-keys stay in the browser',
      status: 'pass',
      evidenceRefs: ['SECURITY.md', 'services/configService.ts'],
      owner: 'Luminara Platform',
      period: 'point_in_time',
      detail: 'User provider keys are stored in localStorage and sent to vendors or relayed without Worker persistence.',
    },
    {
      id: 'ctrl-provider-allowlist',
      criterion: 'processing_integrity',
      title: 'Worker provider path allow-lists',
      status: 'pass',
      evidenceRefs: ['worker/index.ts', 'tests/workerAllowlist.test.ts'],
      owner: 'Luminara Platform',
      period: 'observation',
      detail: 'Proxied vendor paths are allow-listed; SSRF guards cover sidecar and scrape targets.',
    },
    {
      id: 'ctrl-output-sanitize',
      criterion: 'security',
      title: 'Model and scrape output sanitised before render',
      status: 'pass',
      evidenceRefs: ['utils/markdown.ts', 'SECURITY.md'],
      owner: 'Luminara Platform',
      period: 'observation',
      detail: 'DOMPurify gates markdown rendering of audit and chat output.',
    },
    {
      id: 'ctrl-tg-hmac',
      criterion: 'security',
      title: 'Telegram Mini App initData HMAC validation',
      status: 'pass',
      evidenceRefs: ['worker/telegramAuth.ts', 'tests/telegramAuth.test.ts'],
      owner: 'Luminara Platform',
      period: 'observation',
      detail: 'Hosted-key use requires validated Telegram initData or Firebase ID token when configured.',
    },
    {
      id: 'ctrl-target-https',
      criterion: 'security',
      title: 'Audited site HTTPS posture',
      status: statusFromBool(httpsOk),
      evidenceRefs: ['services/enrichment/publicApisEnrichmentService.ts'],
      owner: 'Customer site',
      period: 'point_in_time',
      detail: httpsOk
        ? 'HTTPS (or redirect) measured on the audited origin.'
        : 'HTTPS not confirmed for the audited origin in this run.',
    },
    {
      id: 'ctrl-hsts',
      criterion: 'availability',
      title: 'HSTS on audited origin',
      status: statusFromBool(hstsOk),
      evidenceRefs: ['enriched.security.hstsEnabled'],
      owner: 'Customer site',
      period: 'point_in_time',
      detail: hstsOk ? 'HSTS header observed.' : 'HSTS not observed (partial readiness for enterprise buyers).',
    },
    {
      id: 'ctrl-citation-integrity',
      criterion: 'processing_integrity',
      title: 'Citation integrity gate on empirical sources',
      status: integrityOk ? 'pass' : input.empirical ? 'partial' : 'unknown',
      evidenceRefs: ['services/audit/citationIntegrityService.ts'],
      owner: 'Luminara Audit',
      period: 'point_in_time',
      detail: `Integrity score ${input.trustPack?.citationIntegrity ?? 'n/a'}/100 for this audit.`,
    },
    {
      id: 'ctrl-secrets-ci',
      criterion: 'confidentiality',
      title: 'Secrets scanning in CI and git hooks',
      status: 'pass',
      evidenceRefs: ['.github/workflows/ci.yml', 'scripts/check-secrets.mjs'],
      owner: 'Luminara Platform',
      period: 'observation',
      detail: 'CI fails on credential-shaped strings in tree and dist bundle.',
    },
    {
      id: 'ctrl-auth-gating',
      criterion: 'privacy',
      title: 'Hosted keys gated by identity',
      status: input.requireTgAuth === false ? 'partial' : 'pass',
      evidenceRefs: ['wrangler.jsonc REQUIRE_TG_AUTH', 'worker/index.ts'],
      owner: 'Luminara Platform',
      period: 'observation',
      detail: input.hasFirebase
        ? 'Firebase and/or Telegram identity available for hosted-key metering.'
        : 'Telegram auth path present; Firebase project id may still need production wiring.',
    },
  ];

  const datasetProvenance: DatasetProvenanceItem[] = [
    {
      id: 'ds-tavily',
      name: 'Tavily Search',
      topic: 'live-serp',
      license: 'vendor-ToS',
      sourceUrl: 'https://tavily.com',
      health: 'ok',
      free: false,
      retrievedAt: asOf,
      usedIn: 'Instant Audit empirical probes + Oracle grounding',
    },
    {
      id: 'ds-firecrawl',
      name: 'Firecrawl / unified scrape',
      topic: 'on-page',
      license: 'vendor-ToS',
      sourceUrl: 'https://firecrawl.dev',
      health: 'ok',
      free: false,
      retrievedAt: asOf,
      usedIn: 'Instant Audit sitewide evidence pack (scrape / map / crawl)',
    },
    {
      id: 'ds-wikidata',
      name: 'Wikidata entity enrichment',
      topic: 'entity-authority',
      license: 'CC0',
      sourceUrl: 'https://www.wikidata.org',
      health: 'ok',
      free: true,
      retrievedAt: asOf,
      usedIn: 'Entity Authority card / sameAs',
    },
    {
      id: 'ds-wayback',
      name: 'Internet Archive CDX / Wayback',
      topic: 'historical-presence',
      license: 'vendor-ToS',
      sourceUrl: 'https://web.archive.org',
      health: 'ok',
      free: true,
      retrievedAt: asOf,
      usedIn: 'Entity Authority historical snapshots',
    },
    {
      id: 'ds-playbooks',
      name: 'Luminara SEO playbooks (compiled)',
      topic: 'methodology',
      license: 'MIT upstream + AGPL app',
      sourceUrl: 'https://github.com/AgriciDaniel/claude-seo',
      health: 'ok',
      free: true,
      retrievedAt: day,
      usedIn: 'Audit prompt methodology injection',
    },
    {
      id: 'ds-umami',
      name: 'Umami results tracking (optional sidecar)',
      topic: 'traffic',
      license: 'MIT',
      sourceUrl: 'https://umami.is',
      health: input.traffic?.status === 'ready' ? 'ok' : 'unknown',
      free: true,
      retrievedAt: asOf,
      usedIn: 'Results tracking / AI referral tiles',
    },
  ];

  const promptsObserved = input.empirical?.totalQueriesTested ?? 0;
  const promptVolumeEstimates: PromptVolumeEstimate[] = [
    {
      id: 'pv-audit-panel',
      surface: 'Luminara Instant Audit prompt panel',
      periodStart: day,
      periodEnd: day,
      prompts: promptsObserved,
      method: 'observed',
      confidence: promptsObserved > 0 ? 95 : 40,
      notes: 'Frozen panel size for this audit run (not market-wide prompt volume).',
    },
    {
      id: 'pv-category-estimate',
      surface: 'Category demand (estimated)',
      periodStart: day,
      periodEnd: day,
      prompts: Math.max(promptsObserved * 40, 120),
      method: 'estimated',
      confidence: 35,
      notes:
        'Order-of-magnitude category estimate = max(observed_panel * 40, 120). Not Profound-style conversation telemetry. Labelled estimated.',
    },
  ];

  if (input.traffic && input.traffic.status === 'ready') {
    const sessions = input.traffic.visits?.current ?? input.traffic.visitors?.current;
    if (typeof sessions === 'number') {
      promptVolumeEstimates.push({
        id: 'pv-site-sessions',
        surface: 'Site visits (Umami)',
        periodStart: day,
        periodEnd: day,
        sessions,
        method: 'observed',
        confidence: 80,
        notes: 'Observed site visits from results-tracking sidecar when configured.',
      });
    }
  }

  const hasWikidata = !!input.enriched?.wikidata?.id;
  const eeatSignals: EeatSignalItem[] = [
    {
      id: 'eeat-exp-empirical',
      system: 'experience',
      itemCode: 'EXP-LIVE-PROBE',
      status: promptsObserved > 0 ? 'pass' : 'fail',
      evidenceRefs: ['empiricalCitationService'],
      detail: 'Live SERP probes executed for the brand panel.',
    },
    {
      id: 'eeat-expertise-entity',
      system: 'expertise',
      itemCode: 'EXPERT-ENTITY',
      status: hasWikidata ? 'pass' : 'partial',
      evidenceRefs: ['publicApisEnrichmentService'],
      detail: hasWikidata
        ? `Wikidata entity linked (${input.enriched?.wikidata?.id}).`
        : 'No Wikidata entity match in this run.',
    },
    {
      id: 'eeat-authority-sameas',
      system: 'authority',
      itemCode: 'AUTH-SAMEAS',
      status: (input.enriched?.sameAsUrls?.length ?? 0) > 0 ? 'pass' : 'partial',
      evidenceRefs: ['enriched.sameAsUrls'],
      detail: `${input.enriched?.sameAsUrls?.length ?? 0} sameAs URIs attached.`,
    },
    {
      id: 'eeat-trust-cite',
      system: 'trust',
      itemCode: 'TRUST-CITE-WORTH',
      status: citeOk ? 'pass' : 'partial',
      evidenceRefs: ['aeoTrustPackService'],
      veto: (input.trustPack?.citeWorthiness ?? 100) < 40,
      detail: `Cite-worthiness ${input.trustPack?.citeWorthiness ?? 'n/a'}/100.`,
    },
    {
      id: 'eeat-trust-https',
      system: 'trust',
      itemCode: 'TRUST-HTTPS',
      status: httpsOk ? 'pass' : 'fail',
      evidenceRefs: ['enriched.security'],
      veto: !httpsOk,
      detail: 'HTTPS is a hard trust veto for enterprise buyers when missing.',
    },
  ];

  const controlScores: number[] = controls.map((c) =>
    c.status === 'pass' ? 100 : c.status === 'partial' ? 50 : c.status === 'unknown' ? 40 : 0
  );
  let readinessScore = Math.round(controlScores.reduce((a, b) => a + b, 0) / Math.max(1, controlScores.length));
  if (eeatSignals.some((s) => s.veto && s.status === 'fail')) {
    readinessScore = Math.min(readinessScore, 55);
  }

  return {
    meta: {
      version: '1.0.0',
      asOf,
      product: 'Luminara Suite',
      disclaimer: 'controls_checklist_not_certification',
    },
    controls,
    datasetProvenance,
    promptVolumeEstimates,
    eeatSignals,
    sourceGraphSummary: input.sourceGraph
      ? {
          nodes: input.sourceGraph.nodes.length,
          edges: input.sourceGraph.edges.length,
          brandCites: input.sourceGraph.stats.brandCites,
        }
      : undefined,
    readinessScore,
    formula: FORMULA,
  };
}

export const enterpriseTrustPackService = {
  build: buildEnterpriseTrustPack,
};
