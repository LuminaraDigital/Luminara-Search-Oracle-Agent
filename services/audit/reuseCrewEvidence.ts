/**
 * Reuse Instant Audit crew evidence inside generateAuditReport.
 * Usable scraped pages skip a second site pack. Usable SERP rows skip a second
 * search and feed the citation probe. Empty or sample-only input returns null
 * so the caller keeps the existing fetch path.
 */
import type { ScrapedPageEvidence, SerpEvidenceItem } from '../agentCore/types';
import { liveSearchRows, pageHasObservableBody } from '../agentCore/auditEvidenceGate';
import type { PrefetchedCitationGroup, QueryIntent } from './empiricalCitationService';

export interface AuditReportCrewEvidence {
  scrapedPages?: readonly ScrapedPageEvidence[] | null;
  serpEvidence?: readonly SerpEvidenceItem[] | null;
}

export interface ReusedPageEvidence {
  formattedEvidence: string;
  combinedText: string;
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

  for (const page of usable) {
    const source = page.source || 'crew';
    blocks.push(`--- PAGE ${page.url} via ${source} ---`);
    if (page.title) blocks.push(`Title: ${page.title}`);
    if (page.description) blocks.push(`Description: ${page.description}`);
    if (page.h1s?.length) blocks.push(`H1: ${page.h1s.join(' | ')}`);
    if (page.schemasFound?.length) {
      blocks.push(`Schemas: ${page.schemasFound.map((schema) => schema.type).filter(Boolean).join(', ')}`);
    }
    blocks.push(`Word count: ${page.wordCount}`);
    const snippet = (page.rawTextSnippet || '').trim().slice(0, PAGE_SNIPPET_CHARS);
    if (snippet) {
      blocks.push(snippet);
      textParts.push(snippet);
    }
    blocks.push('');
  }

  return {
    formattedEvidence: blocks.join('\n').trim(),
    combinedText: textParts.join('\n\n'),
  };
}

export function formatCrewSerpForReport(
  rows: readonly SerpEvidenceItem[] | null | undefined,
): ReusedSerpEvidence | null {
  const live = usableCrewSerpRows(rows);
  if (live.length === 0) return null;

  const top = live.slice(0, 8);
  const queries = [...new Set(top.map((row) => row.query).filter(Boolean))];
  const lines: string[] = [
    '[LIVE EVIDENCE GATHERED VIA CREW SERP RADAR]',
    'Search Intent Rationale: Reused SERP Radar rows from this audit. No second search was run.',
    `Active Queries Executed: ${queries.map((query) => `"${query}"`).join(', ')}`,
    '--------------------------------------------------',
    ...top.map((row, index) => `[Source ${index + 1}] ${row.title}\nURL: ${row.url}\nExcerpt: ${row.snippet}\n`),
    '--------------------------------------------------',
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
