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
}

const CLAIM = /\b\d+(?:\.\d+)?\s*(?:\/\s*\d+|%|stars?\b|reviews?\b)|\b(?:score|rating|rated)\s*(?:of|:)?\s*\d+(?:\.\d+)?\b/gi;

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

  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part, index) => (index % 2 === 1 ? part : part.split('\n').map((line) => guardLine(line, facts, values, percents)).join('\n')))
    .join('');
}
