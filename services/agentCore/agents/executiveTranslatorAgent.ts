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

import { AgentActivityEvent, AuditFinding, CodeRemediationPatch } from '../types';
import { BusinessDNA } from '../../../types';

/**
 * Counts of the live web search rows this run collected.
 * The brief quotes the two counts. It never turns them into a share of AI answers.
 */
export interface WebMentionCounts {
  mentioned: number;
  total: number;
}

/** How many of the site checks this run made passed. */
export interface SiteCheckCounts {
  passed: number;
  total: number;
}

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
    emit: (event: AgentActivityEvent) => void
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

    const cleanDomain = domain.replace(/^https?:\/\//i, '').split('/')[0];
    const brandName = dna?.name || cleanDomain;
    const critical = findings.filter((f) => f.severity === 'critical');
    const criticalCount = critical.length;
    // Counts that cannot be a count are treated as not measured.
    const checks = healthChecks != null && validCount(healthChecks.passed, healthChecks.total) ? healthChecks : null;
    const healthKnown = checks != null;
    const mentions = webMentions != null && validCount(webMentions.mentioned, webMentions.total) ? webMentions : null;
    const citationKnown = mentions != null;
    const checksPhrase = checks ? `**passed ${checks.passed} of ${checks.total} checks**` : '';
    const mentionPhrase = mentions
      ? `**mentioned in ${mentions.mentioned} of ${mentions.total} web results**`
      : '';
    const scoreLine = healthKnown && citationKnown
      ? `Right now, your site ${checksPhrase} this run made, and your brand is ${mentionPhrase} this run collected.`
      : healthKnown
        ? `Right now, your site ${checksPhrase} this run made. Citation rate was not measured.`
        : citationKnown
          ? `Right now, your brand is ${mentionPhrase} this run collected. The site checks were not measured.`
          : 'Right now, the site checks and citation rate were not measured. Search or page providers did not return evidence for this run.';
    const takeaway = criticalCount > 0
      ? `⚠️ **The Big Takeaway:** This run found ${criticalCount} critical ${criticalCount === 1 ? 'gap' : 'gaps'}: ${critical.map((f) => f.title).join('; ')}.`
      : healthKnown
        ? `✅ **The Big Takeaway:** None of the checks this run made found a critical gap.`
        : '**The takeaway:** This run did not measure enough page or search evidence to judge the site.';

    const sections = [
      `### What This Means For ${brandName}`,
      '',
      scoreLine,
      '',
      takeaway,
      '',
      '#### 3 Actions You Can Take Today (In Plain English):',
      '1. **Claim Your Brand Identity:** Add the generated Organization tag to your website header so AI search engines know who you are and what you do.',
      '2. **Answer Customer Questions Directly:** Add clear, 2-to-3 sentence answers to the top questions your buyers ask before buying.',
      '3. **Add an AI Navigation Guide (`llms.txt`):** Help AI bots find your most important products without getting lost in menu links.',
      '',
      "*Bottom Line:* The three steps are: add the Organization tag, write short answers to your buyers' top questions, and publish an llms.txt file. This run did not measure what they will change.",
    ];

    const brief = sections.join('\n');

    emit({
      id: `exec-done-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'executive_translator',
      agentName: this.name,
      phase: 'synthesis_complete',
      message: 'Executive brief compiled. Ready for non-technical stakeholders.',
      status: 'completed',
      confidenceScore: 0.98,
    });

    return brief;
  }
}

export const executiveTranslatorAgent = new ExecutiveTranslatorAgent();
