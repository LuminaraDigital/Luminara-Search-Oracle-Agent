/**
 * Customer-facing sentence parts for audit summaries.
 * Counts, lists, and articles stay grammatical. This does not invent a metric.
 */

const YOU_SOUND = /^(url|user|use|uni|eu)/i;

/** "a" or "an" for the next word. Acronyms use the letter's sound (an FAQ, a URL). */
export function indefiniteArticle(nextWord: string): 'a' | 'an' {
  const word = nextWord.trim();
  if (!word) return 'a';
  if (YOU_SOUND.test(word)) return 'a';
  if (/^[aeiou]/i.test(word)) return 'an';
  if (/^[FHLMNRSX]([^a-z]|$)/.test(word)) return 'an';
  return 'a';
}

export function withArticle(noun: string): string {
  const word = noun.trim();
  return `${indefiniteArticle(word)} ${word}`;
}

/** "0 issues", "1 issue", "2 issues". */
export function countPhrase(count: number, singular: string, plural?: string): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const noun = n === 1 ? singular : (plural ?? `${singular}s`);
  return `${n} ${noun}`;
}

/** "", "A", "A and B", "A, B and C". */
export function joinList(items: readonly string[]): string {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
}

/** Collapse repeated spaces and a second punctuation mark. Does not add a new claim. */
export function tidySentence(text: string): string {
  return text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([.!?])\1+/g, '$1')
    .trim();
}

/** "No issues were found." / "Found 1 issue: A." / "Found 2 issues: A and B." */
export function findingSummary(titles: readonly string[]): string {
  const items = titles.map((title) => title.trim()).filter(Boolean);
  if (items.length === 0) return 'No issues were found.';
  return tidySentence(`Found ${countPhrase(items.length, 'issue')}: ${joinList(items)}.`);
}
