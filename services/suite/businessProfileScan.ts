/**
 * A business profile scan may only describe the site the user named.
 * A bare word is rejected before any search, and a fetched page is kept only
 * when its final host is that site.
 */
import type { BusinessDNA } from '../../types';
import { brandFromEvidence } from '../audit/brandName';
import { auditedHost, sameSite } from '../audit/entityMatch';
import { responseBlocked } from '../audit/llmCrawlerReadiness';
import { fetchProbeCrawl } from '../marketing/probeCrawlClient';
import { unifiedScraperService, type ScrapedPageEvidence } from '../scraping/unifiedScraper';

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const NEED_DOMAIN_MESSAGE =
  'Enter your website address, like luminara.digital. A name or a partial word can match a different business.';

export const UNCONFIRMED_MESSAGE =
  'Could not confirm this is your business. Nothing was applied.';

export const REVIEW_NOTE = 'Review this profile, then save it. It is not applied yet.';

export type ScanTarget =
  | { ok: true; url: string; host: string }
  | { ok: false; message: string };

export function parseBusinessScanTarget(raw: string): ScanTarget {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return { ok: false, message: NEED_DOMAIN_MESSAGE };
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, message: NEED_DOMAIN_MESSAGE };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, message: NEED_DOMAIN_MESSAGE };
  if (url.username || url.password || url.port) return { ok: false, message: NEED_DOMAIN_MESSAGE };
  const host = auditedHost(url.hostname);
  if (!HOST_RE.test(host)) return { ok: false, message: NEED_DOMAIN_MESSAGE };
  url.hash = '';
  return { ok: true, url: url.toString(), host };
}

/** The response is this site, and the body is not a bot wall. */
export function fetchedPageMatchesHost(input: {
  host: string;
  finalUrl: string;
  statusCode?: number;
  body: string;
}): boolean {
  if (responseBlocked(input.statusCode, input.body)) return false;
  let finalHost = '';
  try {
    finalHost = auditedHost(new URL(input.finalUrl).hostname);
  } catch {
    finalHost = auditedHost(input.finalUrl);
  }
  if (!finalHost) return false;
  return sameSite(finalHost, input.host);
}

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
}

/**
 * The name is this site's stem, this site's host, or words that are actually on the page.
 * A shorter namesake such as Lumi does not pass for luminara.digital.
 */
export function nameAgreesWithPage(host: string, name: string, pageText: string): boolean {
  const normalizedHost = auditedHost(host);
  const stem = normalizedHost.split('.')[0] || '';
  const nameWords = words(name);
  if (nameWords.length === 0 || stem.length < 4) return false;
  if (auditedHost(name) === normalizedHost) return true;
  if (nameWords.length === 1 && nameWords[0] === stem) return true;
  const pageWords = new Set(words(pageText));
  const pageHasSite = pageWords.has(stem) || pageText.toLowerCase().includes(normalizedHost);
  if (!pageHasSite) return false;
  return nameWords.every((word) => word === stem || pageWords.has(word));
}

export function measuredBrand(input: { siteName?: string; title?: string; organizationName?: string }): string {
  return brandFromEvidence(input) || '';
}

/** Model name, then the name on the page, then the host. Empty when none of them is this site. */
export function confirmedName(host: string, modelName: string, measured: string, pageText: string): string {
  if (nameAgreesWithPage(host, modelName, pageText)) return modelName;
  if (nameAgreesWithPage(host, measured, pageText)) return measured;
  if (nameAgreesWithPage(host, host, pageText)) return host;
  return '';
}

/** Names the page itself states. Anything else is left off the profile. */
export function mentionedOnPage(items: readonly string[], pageText: string): string[] {
  const lower = pageText.toLowerCase();
  const kept: string[] = [];
  for (const item of items) {
    const name = item.trim();
    if (name.length < 3 || !lower.includes(name.toLowerCase())) continue;
    if (kept.some((have) => have.toLowerCase() === name.toLowerCase())) continue;
    kept.push(name);
    if (kept.length >= 8) break;
  }
  return kept;
}

const EMPTY_PROFILE: BusinessDNA = {
  name: '',
  mission: '',
  usp: '',
  targetAudience: '',
  competitors: [],
  perceivedGaps: [],
  rawContext: '',
};

export type PageFacts = {
  finalUrl: string;
  text: string;
  title: string;
  description: string;
  siteName: string;
};

export type ModelProfile = {
  name: string;
  mission: string;
  usp: string;
  targetAudience: string;
  competitors: string[];
  perceivedGaps: string[];
  rawContext: string;
};

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function modelProfile(parsed: Record<string, unknown>): ModelProfile {
  return {
    name: textField(parsed.name),
    mission: textField(parsed.mission),
    usp: textField(parsed.usp),
    targetAudience: textField(parsed.targetAudience),
    competitors: Array.isArray(parsed.competitors) ? parsed.competitors.filter((item): item is string => typeof item === 'string') : [],
    perceivedGaps: Array.isArray(parsed.perceivedGaps) ? parsed.perceivedGaps.filter((item): item is string => typeof item === 'string') : [],
    rawContext: textField(parsed.rawContext),
  };
}

export function groundedContext(host: string, page: PageFacts, modelContext: string): string {
  const stem = host.split('.')[0] || '';
  if (modelContext && stem.length >= 4 && modelContext.toLowerCase().includes(stem)) return modelContext;
  const stated = [page.title, page.description].filter(Boolean).join('. ');
  return stated
    ? `Read ${host}. ${stated} Add mission, USP, audience and competitors if they are missing.`
    : `Read ${host}. Mission, USP, audience and competitors were not extracted from the page. Add them.`;
}

function factsFromScrape(host: string, scrape: ScrapedPageEvidence): PageFacts | null {
  if (!scrape.success) return null;
  const finalUrl = scrape.finalUrl || scrape.url;
  const text = [scrape.title, scrape.description, scrape.distilled?.title, scrape.distilled?.description, scrape.distilled?.distilledText, scrape.markdown, scrape.formattedEvidence]
    .filter((part) => typeof part === 'string' && part.trim())
    .join('\n');
  if (text.trim().length < 40) return null;
  if (!fetchedPageMatchesHost({ host, finalUrl, statusCode: scrape.statusCode, body: text })) return null;
  return {
    finalUrl,
    text,
    title: scrape.distilled?.title || scrape.title || '',
    description: scrape.distilled?.description || scrape.description || '',
    siteName: scrape.distilled?.openGraph?.site_name || '',
  };
}

/** Scraper fallbacks first. If the browser cannot read the site, the Worker homepage read is next. */
export async function readConfirmedPage(url: string, host: string): Promise<PageFacts | null> {
  try {
    // shortcut: 40s covers the scraper's Jina, direct, and Exa budgets. Raise it if those budgets grow.
    const scrape = await Promise.race([
      unifiedScraperService.scrapeAndDistill(url, { maxChars: 5000 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 40_000)),
    ]);
    if (scrape) {
      const facts = factsFromScrape(host, scrape);
      if (facts) return facts;
    }
  } catch (e) {
    console.warn('[DNA] Page fetch failed', e);
  }
  try {
    const probe = await fetchProbeCrawl(url);
    if (!probe.ok || !probe.page?.finalUrl) return null;
    const text = [probe.page.title, probe.page.description, probe.page.finalUrl].filter(Boolean).join('\n');
    if (!fetchedPageMatchesHost({ host, finalUrl: probe.page.finalUrl, body: text })) return null;
    if (text.trim().length < 12) return null;
    return {
      finalUrl: probe.page.finalUrl,
      text,
      title: probe.page.title || '',
      description: probe.page.description || '',
      siteName: '',
    };
  } catch (e) {
    console.warn('[DNA] Worker homepage read failed', e);
    return null;
  }
}

/** Scan fields replace the narrative. Industry, suburb, and portal links stay. */
export function reviewedProfile(current: BusinessDNA | null, scanned: BusinessDNA): BusinessDNA {
  const base = current ?? EMPTY_PROFILE;
  return {
    ...base,
    name: scanned.name,
    mission: scanned.mission,
    usp: scanned.usp,
    targetAudience: scanned.targetAudience,
    competitors: scanned.competitors,
    perceivedGaps: scanned.perceivedGaps,
    rawContext: scanned.rawContext,
  };
}
