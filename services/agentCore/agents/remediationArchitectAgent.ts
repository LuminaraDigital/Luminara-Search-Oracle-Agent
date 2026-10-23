/**
 * Remediation Architect Agent: Code & Schema Generation Specialist
 * 
 * CrewAI Role: Remediation Architect
 * Goal: Formulate copy-paste ready, error-free Schema.org JSON-LD schemas
 * and CMS remediation diffs to resolve identified audit vulnerabilities.
 */

import { AgentActivityEvent, AuditFinding, CodeRemediationPatch } from '../types';
import { BusinessDNA } from '../../../types';
import { llmsTxtDraft } from '../../audit/fixPackCopy';
import { crawlerFixWanted } from '../../audit/teaserFailureCodes';
import { readableStem } from '../../audit/brandName';
import { guardPasteReadyCopy } from '../../audit/healthClaimGuard';

export class RemediationArchitectAgent {
  public readonly name = 'Remediation Architect';
  public readonly role = 'remediation_architect';

  public async execute(
    targetUrl: string,
    findings: AuditFinding[],
    dna: BusinessDNA | null | undefined,
    emit: (event: AgentActivityEvent) => void,
    displayName?: string | null,
    crawlerChecks?: readonly { id: string; status: string }[] | null,
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
    const knownName = displayName || dna?.name || '';
    const brandName = knownName || readableStem(cleanDomain);
    const patches: CodeRemediationPatch[] = [];

    // 1. Organization Schema Patch
    const orgFinding = findings.find((f) => f.id === 'finding-schema-org' || f.id === 'finding-schema-org-partial');
    if (orgFinding) {
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
        explanation: 'Draft Organization JSON-LD for the page header. Verify the name and URL before pasting.',
        criticSyntaxValid: true,
      });
    }

    if (crawlerFixWanted('llms', crawlerChecks)) {
      patches.push({
        id: 'patch-llms-txt',
        targetType: 'llms_txt',
        filename: 'llms.txt',
        proposedSnippet: llmsTxtDraft(cleanDomain, knownName || null),
        explanation: 'Draft llms.txt for the site root. The llms.txt check failed. Verify the text before pasting.',
        criticSyntaxValid: true,
      });
    }

    emit({
      id: `coder-done-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'remediation_architect',
      agentName: this.name,
      phase: 'code_generation_complete',
      message: patches.length
        ? `Drafted ${patches.length} remediation ${patches.length === 1 ? 'patch' : 'patches'}. Verify before pasting.`
        : 'No remediation patches. Measured checks did not call for an llms.txt or robots.txt change.',
      status: 'completed',
      evidenceSnippet: `Generated files: ${patches.map((p) => p.filename).join(', ')}`,
      confidenceScore: 0.95,
    });

    return patches.map((patch) => ({
      ...patch,
      proposedSnippet: guardPasteReadyCopy(patch.proposedSnippet).text,
    }));
  }
}

export const remediationArchitectAgent = new RemediationArchitectAgent();
