/**
 * Executive Translator Agent: Plain-English & ROI Specialist
 * 
 * CrewAI Role: Executive Communicator
 * Goal: Translate technical findings and schema gaps into an 8th-grade
 * reading level plain-English briefing for non-developers.
 *
 * The brief states counts this run collected and the steps it suggests. It does not
 * print a score out of 100, name a platform the run did not query, or say what the
 * steps will cause.
 */

import { readableStem } from '../../audit/brandName';
import { AgentActivityEvent, AuditFinding, CodeRemediationPatch } from '../types';
import { BusinessDNA } from '../../../types';
import { HEALTH_CHECKS, measuredCheckLine, resolveCheckCounts } from '../auditEvidenceGate';

/**
 * Counts of the live web search rows this run collected.
 * The brief quotes the two counts. It never turns them into a share of AI answers.
 */
export interface WebMentionCounts {
  mentioned: number;
  total: number;
}

/** How many of the site checks passed, failed, or were not measured. */
export interface SiteCheckCounts {
  passed: number;
  total: number;
  failed?: number;
  unmeasured?: number;
}

/**
 * The step the brief lists for each site check, shown only when that check failed.
 * A step says what the check found and what to do. It does not say what will follow.
 */
const STEP_FOR_FAILED_CHECK: Record<(typeof HEALTH_CHECKS)[number]['findingId'], string> = {
  'finding-zero-citations':
    '**Say plainly what you offer:** None of the web results this run collected mention your brand. Publish one page under your brand name that states what you offer and who it is for.',
  'finding-schema-org':
    '**Add an Organization tag:** No Organization markup was found on the pages this run read. Add the generated Organization tag to your website header. It states who you are and what you do in a form machines read.',
  'finding-deprecated-howto':
    '**Remove the HowTo markup:** Your pages carry HowTo schema, which the playbook marks as deprecated.',
  'finding-thin-content':
    '**Write fuller answers on thin pages:** At least one page this run read has fewer than 250 words. Add clear, 2-to-3 sentence answers to the questions your buyers ask before buying.',
};

/** Two whole numbers that can be "count of total". Anything else is treated as not measured. */
function validCount(count: number, total: number): boolean {
  return Number.isInteger(count) && Number.isInteger(total) && total > 0 && count >= 0 && count <= total;
}

export class ExecutiveTranslatorAgent {
  public readonly name = 'Executive Translator';
  public readonly role = 'executive_translator';

  public async execute(
    domain: string,
    healthChecks: SiteCheckCounts | null,
    webMentions: WebMentionCounts | null,
    findings: AuditFinding[],
    patches: CodeRemediationPatch[],
    dna: BusinessDNA | null | undefined,
    emit: (event: AgentActivityEvent) => void,
    displayName?: string | null,
  ): Promise<string> {
    emit({
      id: `exec-start-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'executive_translator',
      agentName: this.name,
      phase: 'synthesizing_brief',
      message: 'Translating technical findings into an 8th-grade plain English executive summary…',
      status: 'running',
    });

    const brandName = displayName || dna?.name || readableStem(domain);
    const critical = findings.filter((f) => f.severity === 'critical');
    const criticalCount = critical.length;
    // Counts that cannot be a count are treated as not measured.
    const checks = healthChecks != null && validCount(healthChecks.passed, healthChecks.total) ? healthChecks : null;
    const buckets = checks ? resolveCheckCounts(checks) : null;
    const healthKnown = buckets != null;
    const failed = buckets?.failed ?? 0;
    const unchecked = buckets?.unmeasured ?? 0;
    const mentions = webMentions != null && validCount(webMentions.mentioned, webMentions.total) ? webMentions : null;
    const citationKnown = mentions != null;
    const checksPhrase = buckets ? `**${measuredCheckLine(buckets)}**` : '';
    const mentionPhrase = mentions
      ? `**mentioned in ${mentions.mentioned} of ${mentions.total} web results**`
      : '';
    const scoreLine = healthKnown && citationKnown
      ? `Right now, ${checksPhrase} this run, and your brand is ${mentionPhrase} this run collected.`
      : healthKnown
        ? `Right now, ${checksPhrase} this run. Citation rate was not measured.`
        : citationKnown
          ? `Right now, your brand is ${mentionPhrase} this run collected. The site checks were not measured.`
          : 'Right now, the site checks and citation rate were not measured. Search or page providers did not return evidence for this run.';
    const failedTakeaway = `${failed} ${failed === 1 ? 'check failed' : 'checks failed'}.${unchecked > 0 ? ` ${unchecked} ${unchecked === 1 ? 'check was' : 'checks were'} not measured.` : ''}`;
    const takeaway = criticalCount > 0
      ? `⚠️ **The Big Takeaway:** This run found ${criticalCount} critical ${criticalCount === 1 ? 'gap' : 'gaps'}: ${critical.map((f) => f.title).join('; ')}.`
      : healthKnown && failed > 0
        ? `**The takeaway:** ${failedTakeaway}`
        : healthKnown && unchecked === 0
          ? `✅ **The Big Takeaway:** None of the checks this run made found a critical gap.`
          : healthKnown
            ? `**The takeaway:** ${unchecked} ${unchecked === 1 ? 'check was' : 'checks were'} not measured.`
            : '**The takeaway:** This run did not measure enough page or search evidence to judge the site.';

    // Only the checks that failed get a step. A check that passed has nothing to fix.
    const steps = HEALTH_CHECKS
      .filter((check) => findings.some((f) => f.id === check.findingId))
      .map((check) => {
        const finding = findings.find((item) => item.id === check.findingId);
        const evidence = finding?.howWeKnowItFailed?.trim();
        const step = STEP_FOR_FAILED_CHECK[check.findingId];
        return evidence ? `${step} ${evidence}` : step;
      });
    const listedFix = findings.some((finding) => !finding.id.endsWith('-unmeasured'));
    const stepLines = steps.length > 0
      ? [
          steps.length === 1 ? '#### 1 step for the check that failed:' : `#### ${steps.length} steps for the checks that failed:`,
          ...steps.map((step, index) => `${index + 1}. ${step}`),
          '',
          '*Bottom Line:* These are the steps the failed checks point to. This run did not measure what they will change.',
        ]
      : [
          !buckets
            ? 'The site checks were not measured, so there are no steps to list.'
            : buckets.passed === buckets.total && failed === 0 && unchecked === 0
              ? `All ${buckets.total} checks this run made passed, so there are no steps to list.`
              : listedFix
                ? ''
                : unchecked > 0 && failed === 0
                  ? 'The checks that were not measured have no steps to list.'
                  : 'There are no steps to list for this run.',
        ].filter((line) => line.length > 0);

    const sections = [
      `### What This Means For ${brandName}`,
      '',
      scoreLine,
      '',
      takeaway,
      '',
      ...stepLines,
    ];

    const brief = sections.join('\n');

    const measuredBrief = healthKnown || citationKnown;
    emit({
      id: `exec-done-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'executive_translator',
      agentName: this.name,
      phase: 'synthesis_complete',
      message: measuredBrief
        ? 'Executive brief compiled from the counts this run measured.'
        : 'Executive brief compiled. Counts were not measured.',
      status: 'completed',
      confidenceScore: measuredBrief ? 0.98 : undefined,
    });

    return brief;
  }
}

export const executiveTranslatorAgent = new ExecutiveTranslatorAgent();
