/**
 * Executive Translator Agent: Plain-English & ROI Specialist
 * 
 * CrewAI Role: Executive Communicator
 * Goal: Translate complex technical findings and schema gaps into an 8th-grade
 * reading level plain-English briefing with clear business impact for non-developers.
 */

import { AgentActivityEvent, AuditFinding, CodeRemediationPatch } from '../types';
import { BusinessDNA } from '../../../types';

export class ExecutiveTranslatorAgent {
  public readonly name = 'Executive Translator';
  public readonly role = 'executive_translator';

  public async execute(
    domain: string,
    healthScore: number,
    citationRate: number,
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
    const criticalCount = findings.filter((f) => f.severity === 'critical').length;

    const sections = [
      `### What This Means For ${brandName}`,
      '',
      `Right now, your AI Search Health Score is **${healthScore}/100**, and your brand is cited in about **${citationRate}%** of relevant AI search answers.`,
      '',
      criticalCount > 0
        ? `⚠️ **The Big Takeaway:** Search engines and AI tools like ChatGPT and Perplexity are having trouble understanding your brand because ${criticalCount === 1 ? 'there is 1 key missing identity record' : `there are ${criticalCount} key identity records missing`} on your website.`
        : `✅ **The Big Takeaway:** Your site has solid baseline technical health, but can double its citations by adding structured comparison pages.`,
      '',
      '#### 3 Actions You Can Take Today (In Plain English):',
      '1. **Claim Your Brand Identity:** Add the generated Organization tag to your website header so AI search engines know who you are and what you do.',
      '2. **Answer Customer Questions Directly:** Add clear, 2-to-3 sentence answers to the top questions your buyers ask before buying.',
      '3. **Add an AI Navigation Guide (`llms.txt`):** Help AI bots find your most important products without getting lost in menu links.',
      '',
      `*Bottom Line:* Taking these steps will make it significantly easier for AI search engines to recommend ${brandName} instead of your competitors.`,
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
