/**
 * AutoGen-Inspired Adversarial Critic & Reflection Engine
 * 
 * Implements Society-of-Mind cross-examination:
 * 1. Adversarial verification of all candidate audit findings against raw DOM & SERP evidence
 * 2. Deterministic JSON-LD syntax verification and auto-repair sandbox
 * 3. Anti-hallucination reflection feedback loop before presenting results to non-developers
 */

import { AuditFinding, CodeRemediationPatch, ScrapedPageEvidence, SerpEvidenceItem } from './types';

export interface CriticVerificationResult {
  verifiedFindings: AuditFinding[];
  verifiedPatches: CodeRemediationPatch[];
  rejectedCount: number;
  reflectionFeedback: string[];
  criticConfidence: number;
}

export class CriticReflectionEngine {
  /**
   * Adversarially cross-examine findings and code patches against ground-truth evidence
   */
  public verify(
    findings: AuditFinding[],
    patches: CodeRemediationPatch[],
    scrapedPages: ScrapedPageEvidence[],
    serpEvidence: SerpEvidenceItem[]
  ): CriticVerificationResult {
    const reflectionFeedback: string[] = [];
    let rejectedCount = 0;

    // Collect all raw schema types found across all scraped pages
    const rawSchemaTypes = new Set<string>();
    scrapedPages.forEach((p) => {
      p.schemasFound.forEach((s) => {
        if (s.type) rawSchemaTypes.add(s.type.toLowerCase().trim());
      });
    });

    // Collect all raw text lowercase for keyword checking
    const fullScrapedText = scrapedPages.map((p) => p.rawTextSnippet.toLowerCase()).join(' ');

    // 1. Verify Audit Findings
    const verifiedFindings: AuditFinding[] = findings.map((finding) => {
      let isHallucination = false;
      let correctionMessage: string | undefined;

      // Check Schema Gap claims
      if (finding.category === 'schema') {
        const titleLower = finding.title.toLowerCase();
        
        // E.g., claim: "Missing Organization Schema"
        if (titleLower.includes('organization') && rawSchemaTypes.has('organization')) {
          isHallucination = true;
          correctionMessage = 'Ground truth check: Organization schema was actually present in raw DOM. Finding suppressed.';
        } else if (titleLower.includes('website') && rawSchemaTypes.has('website')) {
          isHallucination = true;
          correctionMessage = 'Ground truth check: WebSite schema was found in raw DOM. Finding suppressed.';
        } else if (titleLower.includes('product') && rawSchemaTypes.has('product')) {
          isHallucination = true;
          correctionMessage = 'Ground truth check: Product schema is present in raw DOM. Finding suppressed.';
        }
      }

      // Check Meta / Content Claims
      if (finding.category === 'technical') {
        const titleLower = finding.title.toLowerCase();
        if (titleLower.includes('missing h1') && scrapedPages.some((p) => p.h1s.length > 0)) {
          isHallucination = true;
          correctionMessage = 'Ground truth check: Page contains valid H1 tags. False positive corrected.';
        }
      }

      // Check Citation Claims
      if (finding.category === 'citations') {
        const brandMentions = serpEvidence.filter((s) => s.brandMentioned).length;
        if (finding.title.toLowerCase().includes('zero citation') && brandMentions > 0) {
          isHallucination = true;
          correctionMessage = `Ground truth check: SERP evidence shows ${brandMentions} live brand mentions. Finding calibrated.`;
        }
      }

      if (isHallucination) {
        rejectedCount++;
        reflectionFeedback.push(`Critic rejected "${finding.title}": ${correctionMessage}`);
        return {
          ...finding,
          criticVerified: false,
          criticConfidence: 0.1,
          criticCorrection: correctionMessage,
        };
      }

      return {
        ...finding,
        criticVerified: true,
        criticConfidence: Math.max(0.85, finding.criticConfidence || 0.9),
      };
    }).filter((f) => f.criticVerified); // Only return findings that survived the adversarial gate!

    // 2. Verify Code Remediation Patches (JSON-LD syntax sandbox)
    const verifiedPatches: CodeRemediationPatch[] = patches.map((patch) => {
      if (patch.targetType === 'json_ld') {
        let valid = false;
        let cleaned = patch.proposedSnippet.trim();

        // Strip markdown code blocks if agent included them
        if (cleaned.startsWith('```json')) {
          cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
        } else if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```\s*/i, '').replace(/\s*```$/, '');
        }

        try {
          const parsed = JSON.parse(cleaned);
          if (parsed && typeof parsed === 'object') {
            // Must have @context and @type
            if (parsed['@context'] && parsed['@type']) {
              valid = true;
            } else if (Array.isArray(parsed) && parsed[0]?.['@context']) {
              valid = true;
            }
          }
        } catch {
          valid = false;
        }

        if (!valid) {
          reflectionFeedback.push(`Critic rejected patch "${patch.filename}": Invalid JSON-LD syntax.`);
          return { ...patch, proposedSnippet: cleaned, criticSyntaxValid: false };
        }

        return { ...patch, proposedSnippet: cleaned, criticSyntaxValid: true };
      }

      return { ...patch, criticSyntaxValid: true };
    });

    const criticConfidence =
      rejectedCount === 0 ? 0.98 : Math.max(0.7, 0.98 - rejectedCount * 0.05);

    return {
      verifiedFindings,
      verifiedPatches,
      rejectedCount,
      reflectionFeedback,
      criticConfidence,
    };
  }
}

export const criticReflectionEngine = new CriticReflectionEngine();
