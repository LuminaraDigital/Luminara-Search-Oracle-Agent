/**
 * Deterministic check for numbers an audit model states.
 * A percentage or score stays when this run measured it or the evidence text contains it.
 * A third-party rating with no such support is removed with its sentence.
 */

import { isUnmeasuredReviewRating, isUnmeasuredReviewUrl } from './citationIntegrityService';

export interface MeasuredClaimFacts {
  healthScore?: number | null;
  citationRatePercent?: number | null;
  shareOfVoice?: number | null;
  pageSpeed?: {
    lcpMs?: number | null;
    cls?: number | null;
    inpMs?: number | null;
    performanceScore?: number | null;
  } | null;
  wordCounts?: readonly number[];
  schemaTypes?: readonly string[];
  tavilyResultCount?: number | null;
  evidenceText?: string;
  /**
   * False when this run did not measure ChatGPT, Perplexity, or AI Overviews.
   * Omit the field to leave those sentences as written.
   */
  aiEnginesMeasured?: boolean;
}

const CLAIM = /\b\d+(?:\.\d+)?\s*(?:\/\s*\d+|%|stars?\b|reviews?\b)|\b(?:score|rating|rated)\s*(?:of|:)?\s*\d+(?:\.\d+)?\b/gi;

const AI_DRIVEN = /\bai[\s\u2010\u2011\u2012\u2013\u2014-]*driven\b/i;
const AI_ENGINE = /\bchatgpt\b(?!-)|\bperplexity\b|\bai overviews?\b/i;
const AI_APPEARS = /\b(?:mentioned|mentions|mention|appears|appearing|appeared|shows up|showing up|cite|cites|cited|citing|visible|include|includes|included|found in)\b/i;
const AI_HONEST = /\b(?:not measured|not verified|unmeasured)\b/i;
const WILL_AI_MENTION = /\bwill ai mention\b/i;

/** A sentence that says the brand shows up in an AI product this run did not measure. */
function claimsUnmeasuredAiAppearance(sentence: string): boolean {
  if (AI_HONEST.test(sentence)) return false;
  if (AI_DRIVEN.test(sentence) || WILL_AI_MENTION.test(sentence)) return true;
  return AI_ENGINE.test(sentence) && AI_APPEARS.test(sentence);
}

function webSearchTitle(line: string): string | null {
  const heading = line.match(/^(#{1,6}\s+)(.*)$/);
  if (!heading || !WILL_AI_MENTION.test(heading[2])) return null;
  const [before, after = ''] = heading[2].split(/\bwill ai mention\s+/i);
  const name = after.replace(/[?\s]+$/g, '').trim();
  const lead = before.replace(/[:\s]+$/g, '').trim();
  return `${heading[1]}${lead ? `${lead}: ` : ''}Web search check${name ? ` for ${name}` : ''}`;
}

/** Drops AI-engine appearance claims. A web search sentence and a Not measured label stay. */
export function stripUnmeasuredAiClaims(text: string): string {
  if (!text) return text;
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .split('\n')
        .map((line) => {
          const title = webSearchTitle(line);
          if (title) return title;
          const kept = line
            .split(/(?<=[.!?])\s*(?=[A-Z*#])/)
            .filter((sentence) => sentence.trim() && !claimsUnmeasuredAiAppearance(sentence));
          return kept.join(' ');
        })
        .join('\n');
    })
    .join('');
}

function add(set: Set<number>, value: number | null | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) set.add(value);
}

function primaryNumber(span: string): number | null {
  const match = span.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function isRatingSpan(span: string): boolean {
  return /\/\s*(?:5|10)\b|stars?\b|reviews?\b/i.test(span);
}

function tokenInText(value: number, text: string): boolean {
  const body = text.replace(/(\d),(?=\d)/g, '$1');
  const token = String(value).replace('.', '\\.');
  return new RegExp(`(?<![\\d.])${token}(?![\\d.])`).test(body);
}

function verified(span: string, facts: MeasuredClaimFacts, values: Set<number>, percents: Set<number>): boolean {
  const evidence = facts.evidenceText || '';
  const compact = span.replace(/\s+/g, '');
  if (compact && evidence.replace(/\s+/g, '').toLowerCase().includes(compact.toLowerCase())) return true;
  const number = primaryNumber(span);
  if (number == null) return true;
  if (tokenInText(number, evidence)) return true;
  if (/%/.test(span)) return percents.has(number);
  if (/\/\s*100\b/.test(span)) return facts.healthScore === number || facts.pageSpeed?.performanceScore === number;
  return values.has(number);
}

function guardLine(line: string, facts: MeasuredClaimFacts, values: Set<number>, percents: Set<number>): string {
  const sentences = line.split(/(?<=[.!?])\s+(?=[A-Z*])/);
  const kept: string[] = [];
  for (const sentence of sentences) {
    if (isUnmeasuredReviewRating(sentence)) continue;
    const spans = sentence.match(CLAIM) || [];
    const unverified = spans.filter((span) => !verified(span, facts, values, percents));
    if (unverified.some(isRatingSpan)) continue;
    let next = sentence;
    // shortcut: each distinct span is marked once per sentence, upgrade if one sentence repeats it.
    for (const span of unverified) {
      if (next.includes(`${span} (unverified)`)) continue;
      next = next.replace(span, `${span} (unverified)`);
    }
    if (next.trim()) kept.push(next);
  }
  return kept.join(' ');
}

function hostLabel(uri: string): string {
  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return uri;
  }
}

/** Drops review-site URLs. A rating title on any other page becomes the hostname. */
export function visibleGroundingSources(
  sources: ReadonlyArray<{ uri?: string; title?: string }> | null | undefined,
): Array<{ uri: string; title: string }> {
  const out: Array<{ uri: string; title: string }> = [];
  for (const source of sources || []) {
    const uri = source?.uri || '';
    if (!/^https?:\/\//i.test(uri) || isUnmeasuredReviewUrl(uri)) continue;
    const title = source.title?.trim() || uri;
    out.push({ uri, title: isUnmeasuredReviewRating(title) ? hostLabel(uri) : title });
  }
  return out;
}

export function guardUnmeasuredClaims(text: string, facts: MeasuredClaimFacts = {}): string {
  const values = new Set<number>();
  const percents = new Set<number>();
  add(values, facts.healthScore);
  add(values, facts.shareOfVoice);
  add(values, facts.tavilyResultCount);
  add(values, facts.schemaTypes?.length);
  for (const count of facts.wordCounts || []) add(values, count);
  add(values, facts.pageSpeed?.lcpMs);
  add(values, facts.pageSpeed?.cls);
  add(values, facts.pageSpeed?.inpMs);
  add(values, facts.pageSpeed?.performanceScore);
  add(percents, facts.citationRatePercent);
  add(percents, facts.pageSpeed?.performanceScore);

  const numbered = text
    .split(/(```[\s\S]*?```)/g)
    .map((part, index) => (index % 2 === 1 ? part : part.split('\n').map((line) => guardLine(line, facts, values, percents)).join('\n')))
    .join('');
  return facts.aiEnginesMeasured === false ? stripUnmeasuredAiClaims(numbered) : numbered;
}
