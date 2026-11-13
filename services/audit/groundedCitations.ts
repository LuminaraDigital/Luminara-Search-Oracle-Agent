/**
 * Grounded citations ledger, verbatim quote verifier, and provenance coverage gate.
 *
 * Clean-room TypeScript implementation inspired by NousResearch/hermes-agent
 * (`skills/research/grounded-citations/SKILL.md`, commit ca2269588fd028adb41f3cc45875b04f3c0b88b4, MIT)
 * and aligned with Luminara's `ClaimStatus` (`services/evidenceBound/types.ts`).
 */

import type { ClaimStatus } from '../evidenceBound/types';

export interface GroundedSourceEntry {
  id: number;
  url: string;
  normalizedUrl: string;
  title: string;
  fetchedText: string;
  quotes: string[];
}

export interface SentenceProvenance {
  sentence: string;
  citedIds: number[];
  markedUnverified: boolean;
  status: ClaimStatus;
}

export interface GroundedVerificationResult {
  ok: boolean;
  unknownIds: number[];
  missingEvidenceIds: number[];
  overCitedSentences: string[];
  mismatchedSources: string[];
  uncitedSourceIds: number[];
  proseSentenceCount: number;
  coveredSentenceCount: number;
  coverage: number;
  sentences: SentenceProvenance[];
}

/** Canonicalize HTTP(S) URLs so registering the same page twice returns the same `[n]` id. */
export function normalizeSourceUrl(rawUrl: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) throw new Error('Source URL is required.');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Source URL must use http or https.');
  }
  parsed.hash = '';
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }
  return parsed.toString();
}

/**
 * Strip markdown link/emphasis syntax and collapse whitespace + case so a verbatim
 * quote matches extracted page text without tripping on `[text](url)` or `*bold*` markup.
 */
export function normalizeForVerbatimMatch(text: string): string {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function quoteAppearsVerbatimInSource(quote: string, sourceText: string): boolean {
  const needle = normalizeForVerbatimMatch(quote);
  const haystack = normalizeForVerbatimMatch(sourceText);
  if (!needle || !haystack) return false;
  return haystack.includes(needle);
}

const CITATION_ID_RE = /\[(\d+)\]/g;
const UNVERIFIED_SENTENCE_RE = /\[unverified\]|\bnot_measured\b|\bnot\s+measured\b/i;
const SOURCES_HEADING_RE = /^(?:##\s+Sources|Sources:)\s*$/im;

function extractCitedIds(text: string, maxRegisteredId?: number): number[] {
  const withoutCode = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ');
  const seen = new Set<number>();
  CITATION_ID_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_ID_RE.exec(withoutCode)) !== null) {
    const id = Number(match[1]);
    if (!Number.isInteger(id) || id <= 0) continue;
    if ((maxRegisteredId ?? 0) < 100 && id >= 1900 && id <= 2100) continue;
    seen.add(id);
  }
  return [...seen].sort((a, b) => a - b);
}

function splitSourcesSection(draft: string): { prosePart: string; sourcesPart: string } {
  const hit = SOURCES_HEADING_RE.exec(draft);
  if (!hit || hit.index === undefined) return { prosePart: draft, sourcesPart: '' };
  const afterHeading = hit.index + hit[0].length;
  const rest = draft.slice(afterHeading);
  const nextSection = /\n#{1,3}\s+\S/.exec(rest);
  if (!nextSection || nextSection.index === undefined) {
    return {
      prosePart: draft.slice(0, hit.index),
      sourcesPart: rest,
    };
  }
  const sourcesEnd = afterHeading + nextSection.index;
  return {
    prosePart: `${draft.slice(0, hit.index)}\n${draft.slice(sourcesEnd)}`,
    sourcesPart: draft.slice(afterHeading, sourcesEnd),
  };
}

function extractProseSentences(prosePart: string): string[] {
  const withoutCode = prosePart.replace(/```[\s\S]*?```/g, '\n');
  const lines = withoutCode.split(/\r?\n/);
  const sentences: string[] = [];
  for (const rawLine of lines) {
    const stripped = rawLine.replace(/^\s*>\s?/, '').trim();
    if (!stripped || stripped.startsWith('#') || stripped.startsWith('|')) continue;
    const fragments = stripped.split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/);
    for (const frag of fragments) {
      const clean = frag.trim();
      const words = clean.replace(/\[\d+\]|\[unverified\]/gi, '').trim().split(/\s+/).filter(Boolean);
      if (words.length >= 4) sentences.push(clean);
    }
  }
  return sentences;
}

export class GroundedCitationLedger {
  private readonly byId = new Map<number, GroundedSourceEntry>();
  private readonly idByNormalizedUrl = new Map<string, number>();

  list(): GroundedSourceEntry[] {
    return [...this.byId.values()].map((e) => ({ ...e, quotes: [...e.quotes] }));
  }

  /** Register a retrieved URL and return its stable 1-based `[n]` identifier. */
  registerSource(url: string, opts?: { title?: string; fetchedText?: string }): number {
    const normalizedUrl = normalizeSourceUrl(url);
    const existingId = this.idByNormalizedUrl.get(normalizedUrl);
    if (existingId !== undefined) {
      const entry = this.byId.get(existingId);
      if (entry) {
        if (opts?.title && !entry.title) entry.title = opts.title.trim();
        if (opts?.fetchedText) entry.fetchedText = opts.fetchedText;
      }
      return existingId;
    }
    const nextId = this.byId.size + 1;
    this.byId.set(nextId, {
      id: nextId,
      url: String(url).trim(),
      normalizedUrl,
      title: opts?.title?.trim() || '',
      fetchedText: opts?.fetchedText || '',
      quotes: [],
    });
    this.idByNormalizedUrl.set(normalizedUrl, nextId);
    return nextId;
  }

  /**
   * Attach a verbatim quote to source `id`. Rejects paraphrases or misquoted numbers
   * that do not literally appear in the fetched source text.
   */
  attachQuote(
    id: number,
    quote: string,
    pageText?: string,
  ): { ok: true } | { ok: false; error: string } {
    const entry = this.byId.get(id);
    if (!entry) return { ok: false, error: `Unknown source id [${id}].` };
    const trimmedQuote = String(quote || '').trim();
    if (!trimmedQuote) return { ok: false, error: 'Quote text is required.' };
    const evidenceText = pageText !== undefined ? pageText : entry.fetchedText;
    if (!evidenceText.trim()) {
      return { ok: false, error: `No fetched page text available to verify quote for [${id}].` };
    }
    if (!quoteAppearsVerbatimInSource(trimmedQuote, evidenceText)) {
      return {
        ok: false,
        error: `Quote for [${id}] does not appear verbatim in the fetched source text.`,
      };
    }
    if (pageText !== undefined && !entry.fetchedText) {
      entry.fetchedText = pageText;
    }
    if (!entry.quotes.includes(trimmedQuote)) {
      entry.quotes.push(trimmedQuote);
    }
    return { ok: true };
  }

  /** Render the `## Sources` block mechanically from ledger entries. */
  renderSourcesBlock(opts?: { style?: 'markdown' | 'evidence'; citedIn?: string; onlyIds?: number[] }): string {
    const style = opts?.style ?? 'markdown';
    let targetIds: number[];
    if (opts?.onlyIds) {
      targetIds = opts.onlyIds.filter((id) => this.byId.has(id));
    } else if (opts?.citedIn !== undefined) {
      const { prosePart } = splitSourcesSection(opts.citedIn);
      targetIds = extractCitedIds(prosePart).filter((id) => this.byId.has(id));
    } else {
      targetIds = [...this.byId.keys()];
    }

    if (targetIds.length === 0) return '';
    const lines: string[] = ['## Sources'];
    for (const id of targetIds) {
      const entry = this.byId.get(id);
      if (!entry) continue;
      const label = entry.title ? `${entry.title} - ${entry.url}` : entry.url;
      lines.push(`[${entry.id}] ${label}`);
      if (style === 'evidence') {
        for (const q of entry.quotes) {
          lines.push(`  > "${q}"`);
        }
      }
    }
    return lines.join('\n');
  }

  /** Verify draft inline `[n]` citations, `## Sources` agreement, evidence quotes, and coverage. */
  verifyDraft(
    draft: string,
    opts?: { requireEvidenceQuotes?: boolean; minCoverage?: number },
  ): GroundedVerificationResult {
    const { prosePart, sourcesPart } = splitSourcesSection(String(draft || ''));
    const allCited = extractCitedIds(prosePart, this.byId.size);
    const unknownIds = allCited.filter((id) => !this.byId.has(id));
    const knownCited = allCited.filter((id) => this.byId.has(id));

    const missingEvidenceIds = opts?.requireEvidenceQuotes
      ? knownCited.filter((id) => (this.byId.get(id)?.quotes.length ?? 0) === 0)
      : [];

    const mismatchedSources: string[] = [];
    if (sourcesPart.trim()) {
      const listedIds = new Set<number>();
      for (const rawLine of sourcesPart.split(/\r?\n/)) {
        const line = rawLine.trim();
        const match = line.match(/^\[(\d+)\]\s+(.+)$/);
        if (!match) continue;
        const id = Number(match[1]);
        listedIds.add(id);
        const entry = this.byId.get(id);
        if (!entry) {
          mismatchedSources.push(`Sources block lists unknown id [${id}].`);
          continue;
        }
        const urlMatch = match[2].match(/https?:\/\/\S+/);
        if (!urlMatch) {
          mismatchedSources.push(`Sources block entry [${id}] is missing a URL.`);
          continue;
        }
        try {
          if (normalizeSourceUrl(urlMatch[0].replace(/[),.]+$/, '')) !== entry.normalizedUrl) {
            mismatchedSources.push(`Sources block URL for [${id}] disagrees with the ledger.`);
          }
        } catch {
          mismatchedSources.push(`Sources block URL for [${id}] is malformed.`);
        }
      }
      for (const id of knownCited) {
        if (!listedIds.has(id)) {
          mismatchedSources.push(`Cited id [${id}] is missing from the Sources block.`);
        }
      }
    }

    const proseSentences = extractProseSentences(prosePart);
    const overCitedSentences: string[] = [];
    const sentenceRecords: SentenceProvenance[] = [];
    let coveredCount = 0;

    for (const sentence of proseSentences) {
      const citedIds = extractCitedIds(sentence, this.byId.size);
      if (citedIds.length > 3) overCitedSentences.push(sentence);
      const markedUnverified = UNVERIFIED_SENTENCE_RE.test(sentence);
      const validCited = citedIds.filter((id) => this.byId.has(id));
      const hasVerbatimEvidence =
        validCited.length > 0 && validCited.every((id) => (this.byId.get(id)?.quotes.length ?? 0) > 0);

      let status: ClaimStatus;
      if (validCited.length > 0) {
        status = hasVerbatimEvidence ? 'measured' : 'estimated';
        coveredCount += 1;
      } else if (markedUnverified) {
        status = 'not_measured';
        coveredCount += 1;
      } else {
        status = 'unknown';
      }

      sentenceRecords.push({
        sentence,
        citedIds,
        markedUnverified,
        status,
      });
    }

    const coverage = proseSentences.length > 0 ? coveredCount / proseSentences.length : 1;
    const minCoverage = opts?.minCoverage ?? 0;
    const uncitedSourceIds = [...this.byId.keys()].filter((id) => !knownCited.includes(id));

    const ok =
      unknownIds.length === 0 &&
      missingEvidenceIds.length === 0 &&
      mismatchedSources.length === 0 &&
      coverage >= minCoverage;

    return {
      ok,
      unknownIds,
      missingEvidenceIds,
      overCitedSentences,
      mismatchedSources,
      uncitedSourceIds,
      proseSentenceCount: proseSentences.length,
      coveredSentenceCount: coveredCount,
      coverage,
      sentences: sentenceRecords,
    };
  }
}
