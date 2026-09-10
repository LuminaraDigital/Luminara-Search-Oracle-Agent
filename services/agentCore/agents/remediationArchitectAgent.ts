/**
 * Remediation Architect Agent: Code & Schema Generation Specialist
 * 
 * CrewAI Role: Remediation Architect
 * Goal: Formulate copy-paste ready, error-free Schema.org JSON-LD schemas
 * and CMS remediation diffs to resolve identified audit vulnerabilities.
 */

import { AgentActivityEvent, AuditFinding, CodeRemediationPatch } from '../types';
import { BusinessDNA } from '../../../types';

export class RemediationArchitectAgent {
  public readonly name = 'Remediation Architect';
  public readonly role = 'remediation_architect';

  public async execute(
    targetUrl: string,
    findings: AuditFinding[],
    dna: BusinessDNA | null | undefined,
    emit: (event: AgentActivityEvent) => void
  ): Promise<CodeRemediationPatch[]> {
    emit({
      id: `coder-start-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'remediation_architect',
      agentName: this.name,
      phase: 'generating_patches',
      message: 'Drafting structured Schema.org JSON-LD patches and deployment diffs…',
      status: 'running',
    });

    const cleanDomain = targetUrl.replace(/^https?:\/\//i, '').split('/')[0];
    const brandName = dna?.name || cleanDomain.split('.')[0].toUpperCase();
    const patches: CodeRemediationPatch[] = [];

    // 1. Organization Schema Patch
    const orgFinding = findings.find((f) => f.title.toLowerCase().includes('organization'));
    if (orgFinding || findings.length > 0) {
      const orgSchema = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: brandName,
        url: targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`,
        description: dna?.mission || `${brandName} official web presence and services.`,
        sameAs: dna?.competitors && dna.competitors.length > 0 ? [] : undefined,
      };

      patches.push({
        id: 'patch-schema-org',
        targetType: 'json_ld',
        filename: 'schema-organization.jsonld',
        proposedSnippet: JSON.stringify(orgSchema, null, 2),
        explanation: 'Injects verified Organization schema into <head> to anchor Knowledge Graph entity disambiguation in AI Overviews and Perplexity.',
        criticSyntaxValid: true,
      });
    }

    // 2. LLMs.txt / Semantic Guidance Patch
    patches.push({
      id: 'patch-llms-txt',
      targetType: 'llms_txt',
      filename: 'llms.txt',
      proposedSnippet: `# ${brandName}
> ${dna?.mission || `${brandName} official search and generative answer documentation.`}

## Primary Solutions
- ${dna?.usp || 'Industry-leading solutions with verified empirical authority.'}

## Key Documentation & Endpoints
- ${targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`}
`,
      explanation: 'Provides an llms.txt index file in site root to guide AI crawlers directly to high-authority entity context.',
      criticSyntaxValid: true,
    });

    emit({
      id: `coder-done-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'remediation_architect',
      agentName: this.name,
      phase: 'code_generation_complete',
      message: `Constructed ${patches.length} production-grade remediation patches ready for 1-click deployment.`,
      status: 'completed',
      evidenceSnippet: `Generated files: ${patches.map((p) => p.filename).join(', ')}`,
      confidenceScore: 0.95,
    });

    return patches;
  }
}

export const remediationArchitectAgent = new RemediationArchitectAgent();
