/**
 * Scout Agent: Deep Crawl & On-Page Evidence Specialist
 * 
 * CrewAI Role: Scout
 * Goal: Autonomously extract DOM structures, JSON-LD schemas, heading hierarchies,
 * and page-load metrics from the target domain without human intervention.
 */

import { siteEvidencePackService } from '../../scraping/siteEvidencePack';
import { unifiedScraperService, type ScrapedPageEvidence as ProviderPage } from '../../scraping/unifiedScraper';
import { clientHasHostedIdentity, formatFirecrawlSkipDetail, hostedProviderDecisionReason } from '../../apiClient';
import { hostedAuthBlocked } from '../../resilience/hostedAuthCircuit';
import { hostedAuthRecoveryHint } from '../../audit/hostedScoutRail';
import { AgentActivityEvent, ScrapedPageEvidence } from '../types';

function withFallbackNote(message: string, note: string): string {
  const extra = note.trim();
  return extra ? `${message} ${extra}` : message;
}

function toCrewPage(p: ProviderPage, fallbackUrl: string): ScrapedPageEvidence {
  const markdown = p.markdown || '';
  return {
    url: p.url,
    title: p.title || fallbackUrl,
    description: p.description,
    h1s: (p.distilled?.headings || []).filter((h) => h.level === 1).map((h) => h.text),
    schemasFound: (p.distilled?.schemas || []).map((s) => ({
      type: s.type || 'UnknownSchema',
      rawJson: JSON.stringify(s.raw || s),
      isValid: true,
    })),
    wordCount: markdown.trim() ? markdown.trim().split(/\s+/).filter(Boolean).length : 0,
    loadTimeMs: p.latencyMs,
    rawTextSnippet: markdown ? markdown.slice(0, 1500) : '',
    source: p.providerUsed,
  };
}

function isUsablePage(page: ScrapedPageEvidence): boolean {
  return page.wordCount > 0 || page.schemasFound.length > 0 || page.rawTextSnippet.trim().length > 0;
}

export class ScoutAgent {
  public readonly name = 'Scout Agent';
  public readonly role = 'scout';

  public async execute(
    url: string,
    emit: (event: AgentActivityEvent) => void
  ): Promise<ScrapedPageEvidence[]> {
    emit({
      id: `scout-start-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'scout',
      agentName: this.name,
      phase: 'crawling',
      message: `Navigating to ${url} to map internal link structure and DOM assets…`,
      status: 'running',
    });

    const pages: ScrapedPageEvidence[] = [];
    let fallbackNote = '';

    try {
      const pack = await siteEvidencePackService.buildPack(url, { mode: 'smart', maxPages: 4 });
      fallbackNote = pack.pages.find((p) => p.fallbackNote)?.fallbackNote
        || pack.warnings.find((w) => w.startsWith('Page fetch:'))
        || '';
      if (pack.success && pack.pages.length > 0) {
        for (const p of pack.pages) {
          const page = toCrewPage(p, url);
          if (isUsablePage(page)) pages.push(page);
        }
      }
    } catch {
      /* fallback to single scrape */
    }

    if (pages.length === 0) {
      try {
        const single = await unifiedScraperService.scrapeAndDistill(url);
        if (!fallbackNote && single.fallbackNote) fallbackNote = single.fallbackNote;
        const page = toCrewPage(single, url);
        if (isUsablePage(page)) pages.push(page);
      } catch {
        /* total scrape failure: do not invent a page */
      }
    }

    if (pages.length === 0) {
      const skipDetail = fallbackNote || formatFirecrawlSkipDetail(hostedProviderDecisionReason('firecrawl'));
      emit({
        id: `scout-unmeasured-${Date.now()}`,
        timestamp: Date.now(),
        agentRole: 'scout',
        agentName: this.name,
        phase: 'crawling_complete',
        message: hostedAuthBlocked()
          ? `Page fetch failed. On-page evidence not measured. ${hostedAuthRecoveryHint({ signedIn: clientHasHostedIdentity() })}`
          : withFallbackNote('Page fetch failed. On-page evidence not measured.', skipDetail),
        status: 'completed',
        evidenceSnippet: 'Scraper returned no page text, headings, or schema.',
      });
      return [];
    }

    const schemaCount = pages.reduce((acc, p) => acc + p.schemasFound.length, 0);

    emit({
      id: `scout-done-${Date.now()}`,
      timestamp: Date.now(),
      agentRole: 'scout',
      agentName: this.name,
      phase: 'crawling_complete',
      message: withFallbackNote(
        `Scouted ${pages.length} page(s). Discovered ${schemaCount} structured schema entity block(s).`,
        fallbackNote,
      ),
      status: 'completed',
      evidenceSnippet: `Discovered pages: ${pages.map((p) => p.url).join(', ')}`,
      confidenceScore: 0.95,
    });

    return pages;
  }
}

export const scoutAgent = new ScoutAgent();
