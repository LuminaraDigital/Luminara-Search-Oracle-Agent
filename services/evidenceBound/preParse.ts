/**
 * Pre-parse candidates in code; model may only choose an observed id.
 */
export type ParsedCandidate = {
  id: string;
  kind: 'email' | 'url' | 'money' | 'heading' | 'date_like';
  value: string;
  index: number;
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /https?:\/\/[^\s<>"']+/g;
const MONEY_RE = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d+)?\s?(?:USD|EUR|GBP)/gi;
const DATE_LIKE_RE =
  /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/gi;
const HEADING_RE = /^(#{1,3})\s+(.+)$/gm;

function pushUnique(
  out: ParsedCandidate[],
  kind: ParsedCandidate['kind'],
  value: string,
  index: number,
): void {
  const v = value.trim();
  if (!v || out.some((c) => c.kind === kind && c.value === v)) return;
  out.push({ id: `${kind}:${out.length + 1}`, kind, value: v, index });
}

/** Extract closed candidate sets from plain text / markdown. */
export function preParseCandidates(text: string, max = 40): ParsedCandidate[] {
  const out: ParsedCandidate[] = [];
  if (!text) return out;

  for (const m of text.matchAll(EMAIL_RE)) {
    pushUnique(out, 'email', m[0], m.index ?? 0);
    if (out.length >= max) return out;
  }
  for (const m of text.matchAll(URL_RE)) {
    pushUnique(out, 'url', m[0], m.index ?? 0);
    if (out.length >= max) return out;
  }
  for (const m of text.matchAll(MONEY_RE)) {
    pushUnique(out, 'money', m[0], m.index ?? 0);
    if (out.length >= max) return out;
  }
  for (const m of text.matchAll(DATE_LIKE_RE)) {
    pushUnique(out, 'date_like', m[0], m.index ?? 0);
    if (out.length >= max) return out;
  }
  for (const m of text.matchAll(HEADING_RE)) {
    pushUnique(out, 'heading', m[2], m.index ?? 0);
    if (out.length >= max) return out;
  }
  return out;
}

/**
 * Resolve a chosen candidate id. Rejects unknown ids (fail closed).
 */
export function pickCandidate(
  candidates: ParsedCandidate[],
  choiceId: string,
): ParsedCandidate | null {
  return candidates.find((c) => c.id === choiceId) ?? null;
}
