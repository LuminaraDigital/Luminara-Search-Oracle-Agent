import type { BusinessDNA } from '../../types';
import { shouldSearch, toSearchQuery } from './searchIntent';

export interface PlannedSearch {
  /** Up to three focused queries, most important first. */
  queries: string[];
  /** Why the planner chose these; surfaced in the UI tool card. */
  rationale: string;
}

const STOPWORDS = new Set('a an the and or of to for in on at by with from is are be can you my our your me i we it this that how what which who where when why do does please tell about into vs versus'.split(' '));

/** Pulls the first URL or bare domain out of free text. */
export function extractDomain(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)]+|(?:^|\s)((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[\s/,.;:!?)]|$)/i);
  if (!m) return null;
  const raw = (m[1] || m[0]).trim();
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Keeps the meaningful words of a prompt so the search engine sees a topic, not a sentence. */
export function topicWords(prompt: string, max = 8): string {
  return prompt
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w.toLowerCase()))
    .slice(0, max)
    .join(' ');
}

/**
 * Turns "how do I show up in AI answers for my dental clinic" into queries a search API can use,
 * anchored on the user's brand and competitors when Business DNA is linked.
 */
export function planSearch(prompt: string, dna?: BusinessDNA | null): PlannedSearch | null {
  if (!shouldSearch(prompt)) return null;

  const promptDomain = extractDomain(prompt);
  const brand = dna?.name?.trim();
  const fallbackDomain = !brand && dna ? extractDomain(dna.rawContext || '') : null;
  const domain = promptDomain || fallbackDomain;
  const topic = topicWords(prompt);
  const queries: string[] = [];
  const reasons: string[] = [];

  if (promptDomain) {
    queries.push(toSearchQuery(`${promptDomain} ${topic}`.trim()));
    reasons.push(`site ${promptDomain}`);
  } else if (brand) {
    queries.push(toSearchQuery(`${brand} ${topic}`.trim()));
    reasons.push(`brand ${brand}`);
  } else if (domain) {
    queries.push(toSearchQuery(`${domain} ${topic}`.trim()));
    reasons.push(`site ${domain}`);
  } else if (topic) {
    queries.push(toSearchQuery(topic));
    reasons.push('topic');
  }

  // A competitor angle makes AEO answers concrete ("who is cited instead of you").
  const competitors = (dna?.competitors || []).filter(Boolean).slice(0, 2);
  if (competitors.length && /competitor|compare|vs|versus|instead|alternative|market|rank/i.test(prompt)) {
    queries.push(toSearchQuery(`${competitors.join(' vs ')} ${topic}`.trim()));
    reasons.push(`competitors ${competitors.join(', ')}`);
  }

  // Generic AEO questions benefit from a "latest guidance" query.
  if (/ai overview|ai answer|chatgpt|perplexity|aeo|geo|generative|cited|citation/i.test(prompt) && queries.length < 3) {
    queries.push(toSearchQuery(`${topic} AI Overviews citation 2026`.trim()));
    reasons.push('AI search guidance');
  }

  const unique = [...new Set(queries.filter(q => q.length > 2))].slice(0, 3);
  if (!unique.length) return null;
  return { queries: unique, rationale: reasons.join(' + ') };
}
