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
  measuredCheckLine,
  healthScoreBlockReason,
  liveSearchRows,
  pageFetchBlocked,
  pageSupportsHealthScore,
  unmeasuredHealthMessage,
} from '../auditEvidenceGate';
import { hostedAuthBlocked } from '../../resilience/hostedAuthCircuit';
import { isOrganizationEntityType } from '../../audit/brandName';
import { countPhrase, findingSummary, joinList, tidySentence, withArticle } from '../../audit/reportSentence';

/** Names up to two pages in a finding title and counts the rest, so the reader knows where to look. */
export function pageList(urls: readonly string[]): string {
  const [first, second] = urls;
  const rest = urls.length - 2;
  if (urls.length <= 1) return first || 'a measured page';
  if (urls.length === 2) return `${first} and ${second}`;
  return `${first}, ${second} and ${rest} more ${rest === 1 ? 'page' : 'pages'}`;
}

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
      message: `Checking ${countPhrase(scrapedPages.length, 'page')} against the audit playbook.`,
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
      const queryList = queries.length ? joinList(queries.map((query) => `"${query}"`)) : 'the searches in this run';
      findings.push({
        id: 'finding-zero-citations',
        category: 'citations',
        severity: 'critical',
        title: 'Web results do not name your business',
        description: tidySentence(`None of the ${countPhrase(liveSerp.length, 'result')} for ${queryList} name your business.`),
        evidenceSource: 'Web results from this run',
        howWeKnowItFailed: tidySentence(`0 of ${liveSerp.length} results for ${queryList} named your business.`),
        leadingIndicator: 'Not measured. This run does not say what a new page will change.',
        criticVerified: false,
        criticConfidence: 0.85,
      });
    }

    // Schema and thin-content findings come from live scrapes only.
    // Jina markdown cannot prove a missing entity, so it never starts the 85-minus-penalty formula.
    if (livePages.length > 0) {
      const typesOn = (page: ScrapedPageEvidence): string[] =>
        [...new Set(page.schemasFound.map((schema) => schema.type.trim().toLowerCase()).filter(Boolean))];
      const measured = livePages.map((page) => ({ url: page.url, types: typesOn(page) }));
      const schemaTypes = new Set(measured.flatMap((page) => page.types));
      const hasOrgType = (types: readonly string[]) => types.some((type) => isOrganizationEntityType(type));
      const covered = measured.some((page) => hasOrgType(page.types));

      if (!covered) {
        const urlList = joinList(measured.map((page) => page.url).slice(0, 3));
        const seen = [...schemaTypes];
        const seenLabel = seen.length ? joinList(seen) : 'none';
        findings.push({
          id: 'finding-schema-org',
          category: 'schema',
          severity: 'critical',
          title: `Add a business identity tag on ${urlList}`,
          description: tidySentence(`Tags on the page: ${seenLabel}. A business identity tag was not among them.`),
          evidenceSource: 'Tags read from the pages in this run',
          howWeKnowItFailed: tidySentence(`Read ${countPhrase(measured.length, 'page')} at ${urlList}. Tags on the page: ${seenLabel}.`),
          leadingIndicator: 'Not measured. This run does not say how answer tools will use the tag.',
          criticVerified: false,
          criticConfidence: 0.9,
        });
      } else {
        const missing = measured.filter((page) => !hasOrgType(page.types));
        if (missing.length > 0) {
          const quoted = missing.slice(0, 3).map((page) => {
            const seen = page.types.length ? page.types.join(', ') : 'no tags';
            return `${page.url}: ${seen}`;
          }).join('; ');
          findings.push({
            id: 'finding-schema-org-partial',
            category: 'schema',
            severity: 'low',
            title: `A business identity tag is not on ${pageList(missing.map((page) => page.url))}`,
            description: `Other pages we read already include a business identity tag. These do not: ${quoted}.`,
            evidenceSource: 'Tags read from the pages in this run',
            howWeKnowItFailed: quoted,
            leadingIndicator: 'Not measured. This run does not say how answer tools will use the tag.',
            criticVerified: false,
            criticConfidence: 0.7,
          });
        }
      }

      if (schemaTypes.has('howto')) {
        const howtoUrls = joinList(livePages
          .filter((page) => page.schemasFound.some((schema) => schema.type.toLowerCase() === 'howto'))
          .map((page) => page.url)
          .slice(0, 3));
        const howtoWhere = howtoUrls || withArticle('page we read');
        findings.push({
          id: 'finding-deprecated-howto',
          category: 'schema',
          severity: 'medium',
          title: 'Remove the outdated how-to tag',
          description: tidySentence(`A how-to tag is on ${howtoWhere}. That tag is no longer used for rich results.`),
          evidenceSource: 'Tags read from the pages in this run',
          howWeKnowItFailed: tidySentence(`A how-to tag was on ${howtoWhere}.`),
          leadingIndicator: 'Not measured. This run does not say what removing the tag will change.',
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
          title: lowWordCountPages.length === 1 ? 'This page is too short' : 'These pages are too short',
          description: tidySentence(`${thin} ${lowWordCountPages.length === 1 ? 'has' : 'have'} fewer than 250 words.`),
          evidenceSource: 'Word count from the pages in this run',
          howWeKnowItFailed: thin,
          leadingIndicator: 'Not measured. This run does not say what a longer page will change.',
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
      message: `Finished the check. ${findingSummary(findings.map((finding) => finding.title))} ${measuredCheckLine(checklist)}.`,
      status: 'completed',
      confidenceScore: 0.92,
    });

    return { findings, healthScore, llmCrawler };
  }
}

export const playbookAuditorAgent = new PlaybookAuditorAgent();
