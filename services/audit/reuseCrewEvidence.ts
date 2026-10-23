/**
 * Reuse Instant Audit crew evidence inside generateAuditReport.
 * Usable scraped pages skip a second site pack. Usable SERP rows skip a second
 * search and feed the citation probe. Empty or sample-only input returns null
 * so the caller keeps the existing fetch path.
 */
import type { ScrapedPageEvidence, SerpEvidenceItem } from '../agentCore/types';
import { liveSearchRows, pageHasObservableBody } from '../agentCore/auditEvidenceGate';
import type { PrefetchedCitationGroup, QueryIntent } from './empiricalCitationService';
import { NAMESAKE_OMISSION_NOTE, withoutNamesakes, type AuditedEntity } from './entityMatch';

export interface AuditReportCrewEvidence {
  scrapedPages?: readonly ScrapedPageEvidence[] | null;
  serpEvidence?: readonly SerpEvidenceItem[] | null;
  rlmCorpus?: Record<string, string> | null;
}

export interface ReusedPageEvidence {
  formattedEvidence: string;
  combinedText: string;
  rlmCorpus: Record<string, string>;
}

export interface ReusedSerpEvidence {
  contextText: string;
  sources: Array<{ uri: string; title: string }>;
}

const PAGE_SNIPPET_CHARS = 4000;

export function usableCrewPages(
  pages: readonly ScrapedPageEvidence[] | null | undefined,
): ScrapedPageEvidence[] {
  if (!pages?.length) return [];
  return pages.filter((page) => pageHasObservableBody(page));
}

export function usableCrewSerpRows(
  rows: readonly SerpEvidenceItem[] | null | undefined,
): SerpEvidenceItem[] {
  if (!rows?.length) return [];
  return liveSearchRows(rows).filter((row) => {
    return Boolean((row.title || '').trim() || (row.url || '').trim() || (row.snippet || '').trim());
  });
}

export function intentForSerpQuery(query: string): QueryIntent {
  const q = query.toLowerCase();
  if (/\bvs\b|\bversus\b|compar/.test(q)) return 'comparative';
  if (/alternative|review|\bbest\b/.test(q)) return 'commercial';
  return 'informational';
}

export function formatCrewPagesForReport(
  rootUrl: string,
  pages: readonly ScrapedPageEvidence[] | null | undefined,
): ReusedPageEvidence | null {
  const usable = usableCrewPages(pages);
  if (usable.length === 0) return null;

  const blocks: string[] = [
    '[SITEWIDE EVIDENCE PACK]',
    `Root: ${rootUrl}`,
    'Mode: reused_crew',
    `Pages: ${usable.length} (discovery=crew_scout, candidates=${usable.length})`,
    '',
  ];
  const textParts: string[] = [];
  const rlmCorpus: Record<string, string> = {};

  for (let idx = 0; idx < usable.length; idx++) {
    const page = usable[idx];
    const source = page.source || 'crew';
    const headerLines: string[] = [`--- PAGE ${page.url} via ${source} ---`];
    if (page.title) headerLines.push(`Title: ${page.title}`);
    if (page.description) headerLines.push(`Description: ${page.description}`);
    if (page.h1s?.length) headerLines.push(`H1: ${page.h1s.join(' | ')}`);
    if (page.schemasFound?.length) {
      headerLines.push(`Schemas: ${page.schemasFound.map((schema) => schema.type).filter(Boolean).join(', ')}`);
    }
    headerLines.push(`Word count: ${page.wordCount}`);
    const pageLines = [...headerLines];
    const rlmLines = [...headerLines];
    const fullSnippet = (page.rawTextSnippet || '').trim();
    if (fullSnippet) {
      pageLines.push(fullSnippet.slice(0, PAGE_SNIPPET_CHARS));
      rlmLines.push(fullSnippet);
      textParts.push(fullSnippet.slice(0, PAGE_SNIPPET_CHARS));
    }
    const corpusKey = Object.prototype.hasOwnProperty.call(rlmCorpus, page.url)
      ? `${page.url}#${idx + 1}`
      : page.url;
    rlmCorpus[corpusKey] = rlmLines.join('\n');
    blocks.push(...pageLines, '');
  }

  return {
    formattedEvidence: blocks.join('\n').trim(),
    combinedText: textParts.join('\n\n'),
    rlmCorpus,
  };
}

export function formatCrewSerpForReport(
  rows: readonly SerpEvidenceItem[] | null | undefined,
  entity?: AuditedEntity | null,
): ReusedSerpEvidence | null {
  const live = usableCrewSerpRows(rows);
  if (live.length === 0) return null;
  const filtered = entity ? withoutNamesakes(live, entity) : { kept: live, omitted: 0 };
  const top = filtered.kept.slice(0, 8);
  const queries = [...new Set(top.map((row) => row.query).filter(Boolean))];
  const lines: string[] = [
    '[LIVE EVIDENCE GATHERED VIA CREW SERP RADAR]',
    'Search Intent Rationale: Reused SERP Radar rows from this audit. No second search was run.',
    `Active Queries Executed: ${queries.map((query) => `"${query}"`).join(', ')}`,
    '--------------------------------------------------',
    ...top.map((row, index) => `[Source ${index + 1}] ${row.title}\nURL: ${row.url}\nExcerpt: ${row.snippet}\n`),
    '--------------------------------------------------',
    filtered.omitted > 0 ? NAMESAKE_OMISSION_NOTE : '',
    'GROUNDING RULES:',
    '- Quote or cite these sources when directly answering questions of current fact.',
    '- If the search results contradict previous assumptions, prioritize the live evidence.',
    '- If the evidence does not contain the answer, say so honestly rather than inventing facts.',
    '--------------------------------------------------',
  ];

  const seen = new Set<string>();
  const sources: Array<{ uri: string; title: string }> = [];
  for (const row of top) {
    if (!row.url || seen.has(row.url)) continue;
    seen.add(row.url);
    sources.push({ uri: row.url, title: row.title || row.url });
  }

  return { contextText: lines.join('\n'), sources };
}

/** Groups live SERP rows by query for the citation probe. Sample rows are dropped. */
export function serpRowsToCitationGroups(
  rows: readonly SerpEvidenceItem[] | null | undefined,
): PrefetchedCitationGroup[] {
  const live = usableCrewSerpRows(rows);
  const byQuery = new Map<string, PrefetchedCitationGroup>();
  for (const row of live) {
    const query = (row.query || '').trim() || 'observed search';
    let group = byQuery.get(query);
    if (!group) {
      group = { query, intent: intentForSerpQuery(query), results: [] };
      byQuery.set(query, group);
    }
    group.results.push({
      url: row.url || '',
      title: row.title || '',
      content: row.snippet || '',
    });
  }
  return [...byQuery.values()];
}
