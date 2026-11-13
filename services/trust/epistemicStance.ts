/**
 * Epistemic stance prompt rules, hypothesis parser, and fact-leakage detector.
 *
 * Adapted from NousResearch/hermes-agent (`agent/context_compressor_prompt_rules.py`)
 * at commit ca2269588fd028adb41f3cc45875b04f3c0b88b4. Copyright (c) 2025 Nous Research (MIT).
 * Em dashes replaced with ASCII `-` to satisfy repository copy standards.
 */

export const UNVERIFIED_SECTION_HEADING = '## Unverified / Working Hypotheses';

export const EPISTEMIC_STANCE_RULE =
  'Never restate an uncertain claim (suspicion, hypothesis, unverified inference) as fact: list ' +
  `each under ${UNVERIFIED_SECTION_HEADING} as "UNVERIFIED: <claim> - <basis>".`;

export const UNVERIFIED_HYPOTHESES_SECTION =
  `\n\n${UNVERIFIED_SECTION_HEADING}\n` +
  '[UNVERIFIED: <claim> - <basis so far>, one per line. If none, write "None."]';

export interface UnverifiedHypothesis {
  claim: string;
  basis: string;
  raw: string;
}

export interface ParsedEpistemicDocument {
  hasSection: boolean;
  declaredNone: boolean;
  bodyWithoutSection: string;
  sectionSpan: { start: number; end: number } | null;
  items: UnverifiedHypothesis[];
}

export interface UnverifiedLeakageHit {
  kind: 'inline_unverified_outside_section' | 'hypothesis_restated_as_fact';
  claim: string;
  span: { start: number; end: number };
  excerpt: string;
}

const HEADING_LINE_RE = /^#{1,3}\s+Unverified\s*\/\s*Working\s+Hypotheses\s*$/im;
const NEXT_HEADING_RE = /\n#{1,3}\s+\S/;
const INLINE_UNVERIFIED_RE = /\bUNVERIFIED:\s*([^\n]+)/gi;
const UNVERIFIED_MARKER_RE = /\bUNVERIFIED:|\[unverified\]/i;
const QUALIFIER_RE =
  /\b(?:unverified|not_measured|not\s+measured|not\s+verified|unknown|hypothesis|hypotheses|suspect(?:ed)?|uncertain|unconfirmed|may|might|could|possible|possibly)\b/i;

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'because',
  'before',
  'being',
  'between',
  'could',
  'every',
  'first',
  'found',
  'from',
  'have',
  'into',
  'other',
  'page',
  'pages',
  'site',
  'some',
  'such',
  'than',
  'that',
  'their',
  'there',
  'these',
  'they',
  'this',
  'through',
  'under',
  'until',
  'using',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'with',
  'would',
  'your',
]);

/** True when a string carries an explicit `UNVERIFIED:` or `[unverified]` marker. */
export function containsUnverifiedMarker(text: string): boolean {
  return UNVERIFIED_MARKER_RE.test(String(text || ''));
}

function parseHypothesisLine(line: string): UnverifiedHypothesis | null {
  const cleaned = line
    .trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^\[|\]$/g, '')
    .trim();
  const match = cleaned.match(/^UNVERIFIED:\s*(.+)$/i);
  if (!match) return null;
  const payload = match[1].trim();
  const sep = payload.match(/\s+(?:-|:)\s+/);
  if (!sep || sep.index === undefined) {
    return { claim: payload, basis: '', raw: cleaned };
  }
  return {
    claim: payload.slice(0, sep.index).trim(),
    basis: payload.slice(sep.index + sep[0].length).trim(),
    raw: cleaned,
  };
}

export function parseUnverifiedSection(text: string): ParsedEpistemicDocument {
  const raw = String(text || '');
  const headingMatch = HEADING_LINE_RE.exec(raw);
  if (!headingMatch || headingMatch.index === undefined) {
    return {
      hasSection: false,
      declaredNone: false,
      bodyWithoutSection: raw,
      sectionSpan: null,
      items: [],
    };
  }

  const sectionStart = headingMatch.index;
  const afterHeadingStart = sectionStart + headingMatch[0].length;
  const rest = raw.slice(afterHeadingStart);
  const nextHeading = NEXT_HEADING_RE.exec(rest);
  const sectionEnd = nextHeading && nextHeading.index !== undefined
    ? afterHeadingStart + nextHeading.index
    : raw.length;

  const sectionContent = raw.slice(afterHeadingStart, sectionEnd).trim();
  const bodyWithoutSection = `${raw.slice(0, sectionStart).trimEnd()}\n${raw.slice(sectionEnd).trimStart()}`.trim();

  const items: UnverifiedHypothesis[] = [];
  let declaredNone = false;
  for (const line of sectionContent.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^[-*+]\s+/, '');
    if (!trimmed) continue;
    if (/^none\.?$/i.test(trimmed)) {
      declaredNone = true;
      continue;
    }
    const parsed = parseHypothesisLine(trimmed);
    if (parsed && parsed.claim) items.push(parsed);
  }

  return {
    hasSection: true,
    declaredNone: declaredNone && items.length === 0,
    bodyWithoutSection,
    sectionSpan: { start: sectionStart, end: sectionEnd },
    items,
  };
}

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 4 && !STOP_WORDS.has(tok));
}

/**
 * Detects two epistemic stance violations:
 * 1. `UNVERIFIED:` lines emitted outside `## Unverified / Working Hypotheses`.
 * 2. A hypothesis from `## Unverified / Working Hypotheses` restated as an
 *    unqualified factual assertion in the main body.
 */
export function detectUnverifiedFactLeakage(text: string): UnverifiedLeakageHit[] {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  const parsed = parseUnverifiedSection(raw);
  const hits: UnverifiedLeakageHit[] = [];

  INLINE_UNVERIFIED_RE.lastIndex = 0;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = INLINE_UNVERIFIED_RE.exec(raw)) !== null) {
    const idx = inlineMatch.index;
    const inSection =
      parsed.sectionSpan !== null && idx >= parsed.sectionSpan.start && idx < parsed.sectionSpan.end;
    if (!inSection) {
      hits.push({
        kind: 'inline_unverified_outside_section',
        claim: inlineMatch[1].trim(),
        span: { start: idx, end: idx + inlineMatch[0].length },
        excerpt: inlineMatch[0].slice(0, 80),
      });
    }
  }

  if (parsed.items.length === 0 || !parsed.bodyWithoutSection) return hits;

  const sentences = parsed.bodyWithoutSection
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 16 && !s.startsWith('#'));

  for (const item of parsed.items) {
    const claimNorm = item.claim.toLowerCase().replace(/[.!?]+$/, '').trim();
    const claimToks = contentTokens(item.claim);
    if (!claimNorm) continue;

    for (const sentence of sentences) {
      if (QUALIFIER_RE.test(sentence)) continue;
      const sentLower = sentence.toLowerCase();
      const verbatimMatch = claimNorm.length >= 12 && sentLower.includes(claimNorm);
      let tokenMatch = false;
      if (!verbatimMatch && claimToks.length >= 3) {
        const matched = claimToks.filter((t) => sentLower.includes(t));
        tokenMatch = matched.length >= Math.max(3, Math.ceil(claimToks.length * 0.8));
      }
      if (verbatimMatch || tokenMatch) {
        const pos = Math.max(0, raw.indexOf(sentence));
        hits.push({
          kind: 'hypothesis_restated_as_fact',
          claim: item.claim,
          span: { start: pos, end: Math.min(raw.length, pos + sentence.length) },
          excerpt: sentence.slice(0, 80),
        });
        break;
      }
    }
  }

  return hits;
}
