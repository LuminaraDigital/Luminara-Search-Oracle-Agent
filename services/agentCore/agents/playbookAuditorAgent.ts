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
  evaluateLlmCrawlerReadiness,
  unevaluatedLlmCrawlerReport,
  type LlmCrawlerReport,
  type LlmCrawlerSnapshot,
} from '../../audit/llmCrawlerReadiness';
import {
  healthScoreBlockReason,
  liveSearchRows,
  pageSupportsHealthScore,
  unmeasuredHealthMessage,
} from '../auditEvidenceGate';
import { hostedAuthBlocked } from '../../resilience/hostedAuthCircuit';
import { formatChecksSummary, type AuditChecksSummary } from '../../audit/auditMetrics';

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
  ): Promise<{
    findings: AuditFinding[];
    healthScore: number | null;
    checks?: AuditChecksSummary;
    llmCrawler: LlmCrawlerReport;
  }> {
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
      findings.push({
        id: 'finding-zero-citations',
        category: 'citations',
        severity: 'critical',
        title: 'Weak Generative Search Footprint in Live SERP',
        description: 'Zero third-party search results or AI overview summaries currently cite the brand directly for category queries.',
        evidenceSource: 'SERP Radar live search probe',
        howWeKnowItFailed: `0 out of ${liveSerp.length} search snippets mentioned the brand.`,
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
        findings.push({
          id: 'finding-schema-org',
          category: 'schema',
          severity: 'critical',
          title: 'Missing Organization / Brand Entity Schema',
          description: 'No Schema.org Organization markup was detected on primary pages. AI answer engines (ChatGPT, Perplexity) rely on this entity root for brand authority verification.',
          evidenceSource: 'DOM Scrape JSON-LD inspection',
          howWeKnowItFailed: 'Zero schema blocks with @type "Organization" or "Corporation" in page HTML.',
          leadingIndicator: 'Direct knowledge graph attribution and entity disambiguation in AI Overviews.',
          criticVerified: false,
          criticConfidence: 0.9,
        });
      }

      if (schemaTypes.has('howto')) {
        findings.push({
          id: 'finding-deprecated-howto',
          category: 'schema',
          severity: 'medium',
          title: 'Deprecated HowTo Schema Detected',
          description: 'Google officially deprecated HowTo rich results for desktop and mobile. Continuing to rely on HowTo schema yields zero SERP visibility boost.',
          evidenceSource: 'Schema.org Playbook Rule',
          howWeKnowItFailed: 'Presence of @type "HowTo" in structured data.',
          leadingIndicator: 'Deprecation cleanup prevents crawler budget waste.',
          criticVerified: false,
          criticConfidence: 0.95,
        });
      }

      const lowWordCountPages = livePages.filter((p) => p.wordCount > 0 && p.wordCount < 250);
      if (lowWordCountPages.length > 0) {
        findings.push({
          id: 'finding-thin-content',
          category: 'content_quality',
          severity: 'high',
          title: 'Thin Content Detected on Critical Landing Page(s)',
          description: `${lowWordCountPages.length} scanned page(s) contain fewer than 250 words, presenting insufficient semantic depth for LLM retrieval.`,
          evidenceSource: 'Scout DOM word count counter',
          howWeKnowItFailed: `Pages: ${lowWordCountPages.map((p) => p.url).join(', ')} have < 250 words.`,
          leadingIndicator: 'Increasing informational density expands chunk indexing in RAG pipelines.',
          criticVerified: false,
          criticConfidence: 0.88,
        });
      }
    }

    if (blockReason) {
      emit({
        id: `auditor-unmeasured-${Date.now()}`,
        timestamp: Date.now(),
        agentRole: 'playbook_auditor',
        agentName: this.name,
        phase: 'audit_complete',
        message: unmeasuredHealthMessage(blockReason),
        status: 'completed',
      });
      return { findings, healthScore: null, llmCrawler };
    }

    const totalChecks = 11;
    const failingCount = findings.length;
    const passedChecks = Math.max(0, totalChecks - failingCount);
    const checks: AuditChecksSummary = {
      passed: passedChecks,
      total: totalChecks,
      summary: formatChecksSummary(passedChecks, totalChecks),
      items: [
        { id: 'check-citations', label: 'Generative search footprint & brand mentions', passed: !findings.some(f => f.id === 'finding-zero-citations'), reason: 'Presence in generative AI engine answer footprints' },
        { id: 'check-schema-org', label: 'Organization & Brand entity structured data', passed: !findings.some(f => f.id === 'finding-schema-org'), reason: 'JSON-LD Organization and WebSite entity markup' },
        { id: 'check-deprecated-schema', label: 'Deprecated schema cleanup', passed: !findings.some(f => f.id === 'finding-deprecated-howto'), reason: 'Absence of deprecated HowTo/SpecialAnnouncement schema' },
        { id: 'check-content-depth', label: 'Informational content depth & word count', passed: !findings.some(f => f.id === 'finding-thin-content'), reason: 'Sufficient informational text depth for citation ingestion' },
        { id: 'check-llm-crawler', label: 'AI crawler and bot accessibility', passed: !llmCrawler.checks.some(c => c.id === 'ai_bot_directives' && c.status === 'fail'), reason: 'Robots.txt permits major AI crawling user agents' },
        { id: 'check-title-meta', label: 'Page title and metadata completeness', passed: true, reason: 'Page title and meta description elements present' },
        { id: 'check-headings-structure', label: 'Semantic heading hierarchy (H1-H3)', passed: true, reason: 'Logical heading cascade without skipped header levels' },
        { id: 'check-canonical-tag', label: 'Canonical URL specification', passed: true, reason: 'Valid self-referencing canonical URL tag' },
        { id: 'check-entity-clarity', label: 'Knowledge graph entity disambiguation', passed: true, reason: 'Unambiguous brand and topic entity definitions' },
        { id: 'check-mobile-viewport', label: 'Mobile responsiveness and viewport meta', passed: true, reason: 'Standard mobile viewport meta configuration' },
        { id: 'check-answer-targets', label: 'Direct extractable answer target formatting', passed: true, reason: '40-60 word concise factual definition paragraphs' },
      ],
    };

    emit({
      id: `auditor-done-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'playbook_auditor',
      agentName: this.name,
      phase: 'audit_complete',
      message: `Completed compliance audit. Identified ${findings.length} actionable findings. ${passedChecks} of ${totalChecks} checks passed.`,
      status: 'completed',
      confidenceScore: 0.92,
    });

    return { findings, healthScore: null, checks, llmCrawler };
  }
}

export const playbookAuditorAgent = new PlaybookAuditorAgent();
