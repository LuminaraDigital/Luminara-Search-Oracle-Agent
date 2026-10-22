/**
 * Playbook Auditor Agent: Compliance & Scoring Specialist
 * 
 * CrewAI Role: Playbook Auditor
 * Goal: Evaluate on-page and search evidence against rigorous AEO/SEO playbooks
 * (Schema.org deprecations, Core Web Vitals, E-E-A-T, and content quality),
 * calculating a deterministic health score.
 */

import { AgentActivityEvent, AuditFinding, ScrapedPageEvidence, SerpEvidenceItem } from '../types';
import { ReportFocus, BusinessDNA } from '../../../types';
import {
  BLOCKED_CHECK,
  evaluateLlmCrawlerReadiness,
  unevaluatedLlmCrawlerReport,
  type LlmCrawlerReport,
  type LlmCrawlerSnapshot,
} from '../../audit/llmCrawlerReadiness';
import {
  healthChecklist,
  healthScoreFromFindings,
  healthScoreBlockReason,
  liveSearchRows,
  pageFetchBlocked,
  pageSupportsHealthScore,
  unmeasuredHealthMessage,
} from '../auditEvidenceGate';
import { hostedAuthBlocked } from '../../resilience/hostedAuthCircuit';

export class PlaybookAuditorAgent {
  public readonly name = 'Playbook Auditor';
  public readonly role = 'playbook_auditor';

  public async execute(
    focus: ReportFocus,
    scrapedPages: ScrapedPageEvidence[],
    serpEvidence: SerpEvidenceItem[],
    dna: BusinessDNA | null | undefined,
    emit: (event: AgentActivityEvent) => void,
    crawlerSnapshot?: LlmCrawlerSnapshot | null,
  ): Promise<{ findings: AuditFinding[]; healthScore: number | null; llmCrawler: LlmCrawlerReport }> {
    emit({
      id: `auditor-start-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'playbook_auditor',
      agentName: this.name,
      phase: 'evaluating_playbooks',
      message: `Auditing ${scrapedPages.length} page(s) against official AEO/SEO scoring playbooks…`,
      status: 'running',
    });

    const findings: AuditFinding[] = [];
    const llmCrawler = crawlerSnapshot
      ? evaluateLlmCrawlerReadiness(crawlerSnapshot)
      : unevaluatedLlmCrawlerReport();
    const livePages = scrapedPages.filter(pageSupportsHealthScore);
    const liveSerp = liveSearchRows(serpEvidence);

    // Hosted 401/403 still blocks every numeric score. Jina-only text, empty search,
    // and SAMPLE rows do too: they are not enough to mint a /100 health score.
    const blockReason = healthScoreBlockReason({
      pages: scrapedPages,
      serp: serpEvidence,
      authBlocked: hostedAuthBlocked(),
    });
    if (blockReason === 'auth') {
      emit({
        id: `auditor-unmeasured-${Date.now()}`,
        timestamp: Date.now(),
        agentRole: 'playbook_auditor',
        agentName: this.name,
        phase: 'audit_complete',
        message: unmeasuredHealthMessage('auth'),
        status: 'completed',
      });
      return { findings: [], healthScore: null, llmCrawler };
    }

    const brandMentions = liveSerp.filter((s) => s.brandMentioned).length;
    if (liveSerp.length > 0 && brandMentions === 0) {
      const queries = [...new Set(liveSerp.map((row) => row.query).filter(Boolean))].slice(0, 3);
      const queryList = queries.length ? queries.map((query) => `"${query}"`).join(', ') : 'the queries this run sent';
      findings.push({
        id: 'finding-zero-citations',
        category: 'citations',
        severity: 'critical',
        title: 'Weak Generative Search Footprint in Live SERP',
        description: `None of the ${liveSerp.length} results for ${queryList} name the brand.`,
        evidenceSource: 'SERP Radar live search probe',
        howWeKnowItFailed: `0 of ${liveSerp.length} snippets for ${queryList} named the brand.`,
        leadingIndicator: 'Publishing entity-grounded comparison pages increases AI Overview citation rate.',
        criticVerified: false,
        criticConfidence: 0.85,
      });
    }

    // Schema and thin-content findings come from live scrapes only.
    // Jina markdown cannot prove a missing entity, so it never starts the 85-minus-penalty formula.
    if (livePages.length > 0) {
      const allSchemas = livePages.flatMap((p) => p.schemasFound);
      const schemaTypes = new Set(allSchemas.map((s) => s.type.toLowerCase()));

      if (!schemaTypes.has('organization') && !schemaTypes.has('corporation') && !schemaTypes.has('localbusiness')) {
        const urls = livePages.map((page) => page.url).slice(0, 3).join(', ');
        const seen = [...schemaTypes];
        const seenLabel = seen.length ? seen.join(', ') : 'none';
        findings.push({
          id: 'finding-schema-org',
          category: 'schema',
          severity: 'critical',
          title: `Missing Organization markup on ${urls}`,
          description: `Parsed HTML at ${urls} has schema types: ${seenLabel}. Organization, Corporation, and LocalBusiness are not among them.`,
          evidenceSource: 'DOM Scrape JSON-LD inspection',
          howWeKnowItFailed: `Parsed ${livePages.length} page(s) at ${urls}. Schema types found: ${seenLabel}.`,
          leadingIndicator: 'Direct knowledge graph attribution and entity disambiguation in AI Overviews.',
          criticVerified: false,
          criticConfidence: 0.9,
        });
      }

      if (schemaTypes.has('howto')) {
        const howtoUrls = livePages
          .filter((page) => page.schemasFound.some((schema) => schema.type.toLowerCase() === 'howto'))
          .map((page) => page.url)
          .slice(0, 3)
          .join(', ');
        findings.push({
          id: 'finding-deprecated-howto',
          category: 'schema',
          severity: 'medium',
          title: 'Deprecated HowTo Schema Detected',
          description: `HowTo schema is on ${howtoUrls || 'a parsed page'}. Google has deprecated HowTo rich results.`,
          evidenceSource: 'Schema.org Playbook Rule',
          howWeKnowItFailed: `HowTo schema was parsed on ${howtoUrls || 'the fetched page'}.`,
          leadingIndicator: 'Deprecation cleanup prevents crawler budget waste.',
          criticVerified: false,
          criticConfidence: 0.95,
        });
      }

      const lowWordCountPages = livePages.filter((p) => p.wordCount > 0 && p.wordCount < 250);
      if (lowWordCountPages.length > 0) {
        const thin = lowWordCountPages.map((page) => `${page.url} (${page.wordCount} words)`).join('; ');
        findings.push({
          id: 'finding-thin-content',
          category: 'content_quality',
          severity: 'high',
          title: 'Thin Content Detected on Critical Landing Page(s)',
          description: `${thin} ${lowWordCountPages.length === 1 ? 'has' : 'have'} fewer than 250 words.`,
          evidenceSource: 'Scout DOM word count counter',
          howWeKnowItFailed: thin,
          leadingIndicator: 'Increasing informational density expands chunk indexing in RAG pipelines.',
          criticVerified: false,
          criticConfidence: 0.88,
        });
      }
    }

    if (blockReason) {
      const pageBlocked = livePages.length === 0 && scrapedPages.some(pageFetchBlocked);
      emit({
        id: `auditor-unmeasured-${Date.now()}`,
        timestamp: Date.now(),
        agentRole: 'playbook_auditor',
        agentName: this.name,
        phase: 'audit_complete',
        message: pageBlocked ? BLOCKED_CHECK : unmeasuredHealthMessage(blockReason),
        status: 'completed',
      });
      return { findings, healthScore: null, llmCrawler };
    }

    // A checklist number: it starts at 85 and loses a fixed amount for each failed check.
    // It is kept for the code that reads it. What a founder is told is the count of checks.
    const healthScore = healthScoreFromFindings(findings);
    const checklist = healthChecklist(findings, { citationRateKnown: liveSerp.length > 0 });

    emit({
      id: `auditor-done-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'playbook_auditor',
      agentName: this.name,
      phase: 'audit_complete',
      message: `Completed compliance audit. Identified ${findings.length} actionable findings. ${checklist.passed} of ${checklist.total} checks passed, ${checklist.failed} failed.`,
      status: 'completed',
      confidenceScore: 0.92,
    });

    return { findings, healthScore, llmCrawler };
  }
}

export const playbookAuditorAgent = new PlaybookAuditorAgent();
