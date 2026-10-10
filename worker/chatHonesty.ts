/**
 * Honesty guard for the Telegram bot's free-text chat (Track SW task SW0a-8).
 *
 * That chat fetches no site and runs no measurement, so a number the model puts beside a
 * site-metric word has no source. The claim ledger (services/evidenceBound) owns the
 * measured / not_measured status. A sentence the ledger does not hold as measured is
 * replaced before the reply is stored in history or sent.
 *
 * Pure functions only: no I/O, no env, no model calls.
 */
import { ClaimLedger, coerceClaimStatus } from '../services/evidenceBound';
import type { Claim, ClaimSource } from '../services/evidenceBound';
import { UNTRUSTED_CONTENT_RULE, wrapUntrustedContent } from '../utils/untrustedContent';

/** Appended to the Telegram chat system prompt. */
export const TELEGRAM_CHAT_HONESTY_RULES = `Honesty rules (these override the style guidelines):
- Cite or stay silent. State a number about the user's site (visibility, rank, citations, traffic, score, share of voice or any other metric) only when that number was measured and supplied in this conversation. Otherwise say plainly that it has not been measured. Do not estimate or guess one.
- This chat does not fetch, crawl or audit any website. Do not describe the current state of a site as if you had looked at it.
- Write plain text. This reply is shown without formatting, so do not use Markdown symbols such as asterisks or underscores.
- ${UNTRUSTED_CONTENT_RULE}`;

/**
 * The saved Business DNA profile as a prompt block. Every value sits inside an
 * untrusted-content fence: the profile is text saved from the app (typed in, or extracted
 * from a web page), so it is data and never an instruction.
 */
export function businessDnaPromptBlock(dna: unknown): string {
  if (!dna || typeof dna !== 'object') return '';
  const d = dna as Record<string, unknown>;
  const fields =
    `- Company: ${d.companyName || d.name || 'Unknown'}\n` +
    `- Primary Domain: ${d.domain || d.primaryDomain || 'Unknown'}\n` +
    `- USP: ${d.uniqueSellingPoint || d.usp || 'N/A'}\n` +
    `- Known Competitors: ${Array.isArray(d.competitors) ? d.competitors.join(', ') : 'N/A'}`;
  return (
    '\n\nKnown User Business DNA Memory (saved profile text: unverified, not a measurement):' +
    wrapUntrustedContent('BUSINESS_DNA', fields)
  );
}

/** The one sentence that takes the place of an unmeasured site-metric claim. */
export const NOT_MEASURED_SENTENCE = 'I have not measured that, so I will not give a number for it.';

export type ChatHonestyResult = {
  /** The reply that may be stored in history and sent. */
  text: string;
  /** One ledger entry per site-metric sentence found, with the status the ledger gave it. */
  claims: readonly Claim[];
};

// The site-metric words named in SW0a-8, with their common forms.
const SITE_METRIC_RE =
  /\b(?:visib(?:le|ility)|(?:out)?rank(?:s|ed|ing|ings)?|cit(?:e|es|ed|ing|ation|ations)|traffic|scor(?:e|es|ed|ing)|shares?)\b/i;

// Numbers that are not site measurements: a price in Stars (the only rail inside Telegram),
// a date or a length of time.
const PRICE_RE = /\b\d[\d,.]*\+?\s?(?:Telegram\s+)?(?:Stars?|XTR)\b/gi;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DATE_RE = new RegExp(
  [
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\b\d{1,2}/\d{1,2}/\d{2,4}\b`,
    String.raw`\b24/7\b`,
    String.raw`\b${MONTH}\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?:,?\s+(?:19|20)\d{2}\b)?`,
    String.raw`\b(?:${MONTH}|in|since|during|until|before|after)\s+(?:19|20)\d{2}\b`,
    String.raw`\b\d+(?:\.\d+)?[- ]?(?:millisecond|second|minute|hour|day|week|month|year)s?\b`,
  ].join('|'),
  'gi',
);
// A plan allowance ("10 sites", "25+ domains") counts as plan copy only in a sentence that
// names a plan or a Stars price. Elsewhere "37 sites cite you" is a site claim.
const PLAN_NAME_RE = /\b(?:Starter|Growth|Agency|Pro)\b|\bStars?\b|\bXTR\b/;
const PLAN_ALLOWANCE_RE =
  /\b\d[\d,]*\+?\s?(?:client\s+)?(?:sites?|domains?|workspaces?|clients?)\b|\b\d+-agent\b/gi;
// Names that only look numeric: H1, GA4, Web3, GPT-4, and a keycap list emoji (a digit, an
// optional variation selector, then an enclosing mark).
const LABEL_RE = /\b[A-Za-z]+\d+[A-Za-z0-9]*\b|\b[A-Z]{2,}-\d+(?:\.\d+)?[A-Za-z]?\b|\d\p{Mn}?\p{Me}/gu;

function carriesSiteMetricNumber(sentence: string): boolean {
  if (!SITE_METRIC_RE.test(sentence)) return false;
  let rest = sentence.replace(PRICE_RE, ' ').replace(DATE_RE, ' ').replace(LABEL_RE, ' ');
  if (PLAN_NAME_RE.test(sentence)) rest = rest.replace(PLAN_ALLOWANCE_RE, ' ');
  return /\d/.test(rest);
}

// A sentence ends at closing punctuation followed by a gap and anything but a lowercase
// letter (so "3.5%" and "vs. competitors" stay whole), or at a line break.
const SENTENCE_END_RE = /([.!?]+["')\]*_]*)[ \t]+(?=[^a-z\s])|\s*\n\s*/g;
// "ranked No. 3" must stay one sentence, or the number and its metric word part ways.
const ABBREVIATION_RE = /(?:^|[^A-Za-z])(?:no|nos|vs|approx|est|etc|e\.g|i\.e)\.$/i;
// A hyphen, asterisk or bullet dot, or a list number, at the start of a line is layout.
const BULLET = '[-*•]';
const LIST_MARKER_RE = new RegExp(String.raw`^\s*(?:${BULLET}\s+)?(?:\d{1,2}[.)]\s+)?`);
const STARTS_LIST_ITEM_RE = new RegExp(String.raw`^(?:${BULLET}\s+|\d{1,2}[.)]\s+)`);
const ENDS_SENTENCE_RE = /[.!?]["')\]*_]*$/;

/** Splits into pieces that join back to the exact input. When unsure it does not split. */
function splitSentences(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  for (const m of text.matchAll(SENTENCE_END_RE)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (m[1]) {
      if (ABBREVIATION_RE.test(text.slice(start, at + m[1].length))) continue;
    } else if (
      // One line break after a line with no closing punctuation: a heading and its value
      // ("Visibility score" then "37/100") stay together unless a list item starts next.
      m[0].split('\n').length === 2 &&
      !ENDS_SENTENCE_RE.test(text.slice(start, at)) &&
      !STARTS_LIST_ITEM_RE.test(text.slice(end))
    ) {
      continue;
    }
    pieces.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces;
}

// This chat has no measurement to cite, so a claim found here has no source.
const NO_SOURCES: ClaimSource[] = [];

/**
 * Replaces each sentence that carries a number and a site-metric word with
 * NOT_MEASURED_SENTENCE. Prices, plan allowances and dates are not counted as numbers.
 * A run of replaced sentences collapses to one. Everything else comes back unchanged.
 */
export function replaceUnmeasuredSiteMetrics(reply: string): ChatHonestyResult {
  const ledger = new ClaimLedger();
  const out: string[] = [];
  let lastWasReplaced = false;
  for (const piece of splitSentences(String(reply || ''))) {
    const lead = LIST_MARKER_RE.exec(piece)?.[0] ?? '';
    const body = piece.slice(lead.length).trimEnd();
    const trail = piece.slice(lead.length + body.length);
    // The ledger rule decides: a claim proposed as measured with no source is not_measured.
    const status = carriesSiteMetricNumber(body) ? coerceClaimStatus('measured', NO_SOURCES) : null;
    if (status) ledger.append({ text: body, status, sources: NO_SOURCES });
    if (!status || status === 'measured') {
      out.push(piece);
      lastWasReplaced = false;
    } else if (lastWasReplaced) {
      out[out.length - 1] = out[out.length - 1].trimEnd() + trail;
    } else {
      out.push(lead + NOT_MEASURED_SENTENCE + trail);
      lastWasReplaced = true;
    }
  }
  return { text: out.join(''), claims: ledger.list() };
}
