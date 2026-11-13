/**
 * Epistemic Citation Watch run note builder.
 *
 * Keeps measured counts separate from candidate explanations by formatting any
 * drift or not_measured hypotheses under `## Unverified / Working Hypotheses`
 * rather than letting unverified causal claims harden into factual summaries.
 */

import type { CitationWatchEngine, ClassifiedWatch } from './types';
import {
  UNVERIFIED_SECTION_HEADING,
  detectUnverifiedFactLeakage,
  parseUnverifiedSection,
} from '../trust/epistemicStance';

export interface CitationWatchNoteInput {
  domain: string;
  engine: CitationWatchEngine;
  classified: ClassifiedWatch;
  hypotheses?: Array<{ claim: string; basis: string }>;
}

export function buildCitationWatchEpistemicNote(input: CitationWatchNoteInput): string {
  const { domain, engine, classified } = input;
  const headerLines: string[] = [];

  if (classified.verdict === 'not_measured') {
    headerLines.push(
      `Verdict: not_measured for ${domain} on ${engine}. ${classified.reason}`,
      'Action: Configure a live engine observation probe or BYOK DataForSEO before drawing share conclusions.',
    );
  } else if (classified.verdict === 'insufficient') {
    headerLines.push(
      `Verdict: insufficient history for ${domain} on ${engine} (${classified.citedCount}/${classified.promptCount} prompts cited). ${classified.reason}`,
      'Action: Keep the prompt set fixed until the minimum baseline runs complete.',
    );
  } else if (classified.verdict === 'consistent') {
    headerLines.push(
      `Verdict: consistent citation share for ${domain} on ${engine} (${classified.citedCount}/${classified.promptCount} prompts cited). ${classified.reason}`,
      'Action: Maintain current page structure and monitor the next scheduled run.',
    );
  } else {
    headerLines.push(
      `Verdict: drift detected for ${domain} on ${engine} (${classified.citedCount}/${classified.promptCount} prompts cited). ${classified.reason}`,
      'Action: Inspect changed pages and cited competitor URLs on the affected prompts before editing copy.',
    );
  }

  const cleanHypotheses = (input.hypotheses || [])
    .map((h) => ({
      claim: String(h.claim || '').replace(/[\r\n]+/g, ' ').trim(),
      basis: String(h.basis || '').replace(/[\r\n]+/g, ' ').trim(),
    }))
    .filter((h) => h.claim.length > 0);

  headerLines.push('', UNVERIFIED_SECTION_HEADING);
  if (cleanHypotheses.length === 0) {
    headerLines.push('None.');
  } else {
    for (const h of cleanHypotheses) {
      headerLines.push(`- UNVERIFIED: ${h.claim} - ${h.basis || 'awaiting page-level verification'}`);
    }
  }

  return headerLines.join('\n');
}

export function validateCitationWatchEpistemicNote(note: string): {
  ok: boolean;
  reasons: string[];
} {
  const parsed = parseUnverifiedSection(note);
  const reasons: string[] = [];
  if (!parsed.hasSection) {
    reasons.push(`Missing required ${UNVERIFIED_SECTION_HEADING} section.`);
  }
  const leaks = detectUnverifiedFactLeakage(note);
  for (const leak of leaks) {
    reasons.push(`Unverified leakage (${leak.kind}): ${leak.excerpt}`);
  }
  return { ok: reasons.length === 0, reasons };
}
