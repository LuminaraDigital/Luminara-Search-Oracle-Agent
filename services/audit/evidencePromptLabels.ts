/**
 * Honest evidence labels for the Instant Audit prompt.
 *
 * Uses the repo honesty vocabulary (measured / estimated / not_measured):
 * - MEASURED: fetched directly from a first-party API in this run.
 * - ESTIMATED: derived from a search-result sample and a substring match of the
 *   brand or domain, or from browser heuristics. Nothing re-fetched or confirmed it.
 * - NOT_MEASURED: not collected in this run.
 *
 * Pure string builders so the labels are unit-testable. No block here may claim
 * that heuristic data is verified.
 */
import type { MeasurementStatus } from '../tools/types';
import type { EmpiricalCitationSummary } from './empiricalCitationService';
import type { CitationIntegrityResult } from './citationIntegrityService';
import type { EnrichedEntityIntelligence } from '../enrichment/publicApisEnrichmentService';

export const EVIDENCE_PROMPT_LABEL: Record<MeasurementStatus, string> = {
  measured: 'MEASURED',
  estimated: 'ESTIMATED',
  not_measured: 'NOT_MEASURED',
};

const { measured: MEASURED, estimated: ESTIMATED, not_measured: NOT_MEASURED } = EVIDENCE_PROMPT_LABEL;

/** One instruction line telling the audit model how to treat each label. */
export const EVIDENCE_LABEL_INSTRUCTION =
  `Evidence labels: ${MEASURED} = fetched from a first-party source in this run, may be stated as fact. ` +
  `${ESTIMATED} = search-sample or heuristic signal, never present it as a verified fact and say "estimated" when citing it. ` +
  `${NOT_MEASURED} = not collected, never invent a value and write "not measured".`;

/** Search-derived citation probe: always ESTIMATED when present, NOT_MEASURED otherwise. */
export function buildEmpiricalPromptSection(summary: EmpiricalCitationSummary | undefined): string {
  if (
    !summary ||
    summary.evidenceList.length === 0 ||
    typeof summary.citationRatePercent !== 'number'
  ) {
    return `\n[${NOT_MEASURED}: SEARCH CITATION SAMPLE]\nNo search results were collected for citation rate, rank, or share of voice in this run.\n`;
  }
  const lines = summary.evidenceList.map((e) => {
    const outcome = e.brandCited
      ? `brand or domain string found in result #${e.brandRank}`
      : `not found in sampled results (Competitors: ${e.competitorsCited.join(', ') || 'None'})`;
    return `- ${ESTIMATED}: Query "${e.query}" (${e.intent}): ${outcome} -> Snippet: ${e.snippet}`;
  });
  return (
    `\n[${ESTIMATED}: SEARCH CITATION SAMPLE]\n` +
    `Method: substring match of the brand or domain against a small search-result sample. Not re-fetched, not confirmed.\n` +
    `Target Domain: ${summary.targetDomain}\n` +
    `${ESTIMATED} Citation Rate: ${summary.citationRatePercent}% (${summary.queriesCitedCount}/${summary.totalQueriesTested} sampled queries)\n` +
    `${ESTIMATED} Top Cited Competitor: ${summary.topCitedCompetitor || 'None identified'}\n` +
    `Evidence Summary:\n` +
    lines.join('\n') +
    '\n'
  );
}

/** Public API enrichment fetched in this run: MEASURED, except browser-limited security checks. */
export function buildEnrichmentPromptSection(entity: EnrichedEntityIntelligence | undefined): string {
  if (!entity) {
    return `\n[${NOT_MEASURED}: PUBLIC APIS & ENTITY INTELLIGENCE]\nWikidata, Internet Archive, and security posture were not collected in this run.\n`;
  }
  const parts: string[] = [`\n[${MEASURED}: PUBLIC APIS & ENTITY INTELLIGENCE]`];
  if (entity.wikidata) {
    parts.push(
      `Wikidata Entity (name match): ${entity.wikidata.id} (${entity.wikidata.label}) - ${entity.wikidata.description || 'no description'}`
    );
    parts.push(`Wikipedia URI: ${entity.wikidata.wikipediaUrl}`);
  }
  if (entity.wayback.hasArchive) {
    parts.push(
      `Internet Archive Domain Longevity: Indexed since ${entity.wayback.earliestDate} (${entity.wayback.archivedYearsAgo} years archived)`
    );
  }
  const sec = entity.security;
  const secLabel =
    sec.measurementConfidence === 'full' ? MEASURED : sec.measurementConfidence === 'failed' ? NOT_MEASURED : ESTIMATED;
  parts.push(
    `Security Posture (${secLabel}): HTTPS ${sec.httpsEnforced ? 'Enforced' : 'Missing'}, HSTS: ${sec.hstsEnabled ? 'Active' : 'Missing'}, CSP: ${sec.cspDetected ? 'Present' : 'Missing'}, security.txt: ${sec.securityTxtPresent ? 'Present' : 'Missing'}, TrustScore: ${sec.trustScore}/100, Measurement: ${sec.measurementConfidence}`
  );
  if (entity.sameAsUrls.length > 0) {
    parts.push(`sameAs Graph URIs: ${entity.sameAsUrls.join(', ')}`);
  }
  return parts.join('\n') + '\n';
}

/** Citation integrity is a browser heuristic: a blocked liveness request reads as dead. */
export function buildIntegrityPromptSection(integrity: CitationIntegrityResult | undefined): string {
  if (!integrity) return '';
  return (
    `\n[${ESTIMATED}: AEO CITATION INTEGRITY]\n` +
    `Method: browser liveness check and token overlap. A blocked request reads as dead.\n` +
    `IntegrityScore: ${integrity.integrityScore}/100\n` +
    `DeadCitations: ${integrity.deadCitationCount}\nSpoofRisk: ${integrity.spoofRisk}\n` +
    `sameAsConflict: ${integrity.sameAsConflict}\n`
  );
}
