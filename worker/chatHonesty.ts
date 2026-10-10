/**
 * Honesty guard for the Telegram bot's free-text chat (Track SW task SW0a-8).
 *
 * That chat fetches no site and runs no measurement, and the only prices that exist are the
 * ones in the plan table. So before a reply is stored in history or sent:
 * - a sentence that states a plan price is checked against the plan table and, when it is
 *   wrong, replaced by the true line built from that table;
 * - a sentence that states a number as a fact beside a site-metric word is replaced by one
 *   "not measured" sentence. The claim ledger (services/evidenceBound) owns the
 *   measured / not_measured status.
 *
 * The filter is a backstop. The prompt rules are the main control.
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

// ---------------------------------------------------------------------------------------
// Plan prices: they come from the plan table, never from the model.
// ---------------------------------------------------------------------------------------

/** The part of a plan this file needs. `PLANS` in worker/telegramBot.ts fits it. */
export type PlanPrice = { title: string; stars: number; days: number };
export type PlanPriceTable = Record<string, PlanPrice>;

export const SEND_PLAN_FOR_ALL_PLANS = 'Send /plan for all plans.';
export const SEND_PLAN_FOR_PRICES = 'Send /plan for current prices.';

const groupThousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The one true price line for a plan, for example "Luminara Starter is 2,500 Stars for 30 days." */
export function planPriceLine(plan: PlanPrice): string {
  return `${plan.title} is ${groupThousands(plan.stars)} Stars for ${plan.days} ${plan.days === 1 ? 'day' : 'days'}.`;
}

/** The price block for the system prompt. Call it with the live plan table on every turn. */
export function planPricePromptBlock(plans: PlanPriceTable): string {
  const lines = Object.values(plans).map((plan) => `- ${planPriceLine(plan)}`);
  if (lines.length === 0) return '';
  return (
    '\n\nPlan prices (from the live plan table; inside Telegram plans are paid in Stars only):\n' +
    `${lines.join('\n')}\n` +
    `State a price only from this block, word for word. For anything else about price say "${SEND_PLAN_FOR_PRICES}"`
  );
}

type PlanNameMatcher = { planId: string; re: RegExp };
type PlanNameHit = { planId: string; at: number; end: number };

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Names a reply can use for each plan, taken from the plan titles: "Luminara Pro / Agency"
 * gives "Pro" and "Agency". A one-word name must be capitalised as in the title, or be
 * followed by "plan", so that ordinary words such as growth and agency are not plan names.
 */
function planNameMatchers(plans: PlanPriceTable): PlanNameMatcher[] {
  const matchers: PlanNameMatcher[] = [];
  for (const [planId, plan] of Object.entries(plans)) {
    const names = plan.title.replace(/^Luminara\s+/i, '').split('/').map((n) => n.trim()).filter(Boolean);
    for (const name of names) {
      const src = name.split(/\s+/).map(escapeRegExp).join(String.raw`\s+`);
      if (name.includes(' ')) {
        matchers.push({ planId, re: new RegExp(String.raw`\b${src}\b`, 'gi') });
      } else {
        matchers.push({ planId, re: new RegExp(String.raw`\b${src}\b`, 'g') });
        matchers.push({ planId, re: new RegExp(String.raw`\b${src}(?=\s+(?:plan|tier|subscription|package)\b)`, 'gi') });
      }
    }
  }
  return matchers;
}

function findPlanNames(sentence: string, matchers: PlanNameMatcher[]): PlanNameHit[] {
  const hits: PlanNameHit[] = [];
  for (const { planId, re } of matchers) {
    for (const m of sentence.matchAll(re)) {
      const at = m.index ?? 0;
      hits.push({ planId, at, end: at + m[0].length });
    }
  }
  return hits.sort((a, b) => a.at - b.at);
}

// "2,500 Stars", "2.5k Stars", "25 XTR", "250⭐". Lower-case "stars" is read as a price only
// in a sentence that names a plan: elsewhere "5 star reviews" is not a price.
const STARS_AMOUNT_RE = /\b(\d[\d,]*(?:\.\d+)?)(k)?\+?\s?(?:(?:Telegram\s+)?(?:Stars?|XTR)\b|⭐)/gi;
const CERTAIN_STARS_RE = /Stars?\b|XTR|⭐|[Tt]elegram/;
// A price in a currency the bot does not sell in.
const OTHER_CURRENCY_RE = /[$€£]\s?\d[\d,.]*|\b\d[\d,.]*k?\s?(?:USDT|USD|TON|EUR|GBP|[Dd]ollars?|[Ee]uros?)\b/g;
// The words that may stand between a plan name and its price: "Growth costs $49", "$49 for Growth".
const PRICE_LINK_RE =
  /^[\s,:;()~=/-]*(?:(?:plan|tier|subscription|package|is|was|costs?|at|for|runs|starts|priced|will|would|be|only|just|about|around|roughly|now|currently|the|a|an|per|you|get|gets|buys|on|to|of|from)\b[\s,:;()~=/-]*){0,6}$/i;
// The term right after a price: "for 30 days", "a month", "/mo", "per year", "yearly".
const TERM_AFTER_PRICE_RE =
  /^[\s,(]*(?:(?:for|per|each|every|a|an|one|\/)\s*){0,2}(?:(\d+(?:\.\d+)?)[- ]?)?(hour|day|week|mo|month|yr|year)s?\b|^\s+(daily|weekly|monthly|yearly|annually)\b/i;
const UNIT_DAYS: Record<string, number> = {
  hour: 1 / 24, day: 1, daily: 1, week: 7, weekly: 7, mo: 30, month: 30, monthly: 30, yr: 365, year: 365, yearly: 365, annually: 365,
};

/** The length in days stated right after a price, or null when none is stated. */
function termAfterPrice(rest: string): number | null {
  const m = TERM_AFTER_PRICE_RE.exec(rest);
  if (!m) return null;
  return (m[1] ? Number(m[1]) : 1) * UNIT_DAYS[(m[2] || m[3]).toLowerCase()];
}

/**
 * Checks one sentence against the plan table. Returns null when the sentence states no plan
 * price or states it correctly, otherwise the text that takes its place.
 * - A Stars amount in a sentence that names a plan must be that plan's price, and a term
 *   stated right after it must be that plan's length ("a month" is 30 days).
 * - A dollar, TON, USDT or other currency amount next to a plan name is never right: plans
 *   are sold in Stars.
 * - A Stars amount with no plan name must at least be the price, and the term, of some plan.
 */
function correctPlanPrices(sentence: string, plans: PlanPriceTable, matchers: PlanNameMatcher[]): string | null {
  const allPlans = Object.values(plans);
  if (allPlans.length === 0) return null;
  const stars = [...sentence.matchAll(STARS_AMOUNT_RE)].map((m) => {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    return {
      at,
      certain: CERTAIN_STARS_RE.test(m[0]),
      amount: Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1),
      days: termAfterPrice(sentence.slice(end)),
    };
  });
  const sameTerm = (plan: PlanPrice, days: number | null): boolean => days === null || Math.abs(plan.days - days) < 0.01;
  const names = findPlanNames(sentence, matchers);
  if (names.length === 0) {
    const unknown = stars.some(
      (s) => s.certain && !allPlans.some((plan) => plan.stars === s.amount && sameTerm(plan, s.days)),
    );
    return unknown ? SEND_PLAN_FOR_PRICES : null;
  }
  const planNear = (at: number): PlanPrice =>
    plans[names.reduce((best, n) => (Math.abs(n.at - at) < Math.abs(best.at - at) ? n : best)).planId];
  const otherCurrency = [...sentence.matchAll(OTHER_CURRENCY_RE)].some((m) => {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    return names.some((n) => PRICE_LINK_RE.test(n.end <= at ? sentence.slice(n.end, at) : sentence.slice(end, n.at)));
  });
  if (stars.length === 0 && !otherCurrency) return null;
  const wrongStars = stars.some((s) => planNear(s.at).stars !== s.amount || !sameTerm(planNear(s.at), s.days));
  if (!otherCurrency && !wrongStars) return null;
  const planIds = [...new Set(names.map((n) => n.planId))];
  return `${planIds.map((id) => planPriceLine(plans[id])).join(' ')} ${SEND_PLAN_FOR_ALL_PLANS}`;
}

// ---------------------------------------------------------------------------------------
// Site metrics: a number stated as a fact beside a metric word has no source in this chat.
// ---------------------------------------------------------------------------------------

/** The one sentence that takes the place of an unmeasured site-metric claim. */
export const NOT_MEASURED_SENTENCE = 'I have not measured that, so I will not give a number for it.';

// The site-metric words: the ones named in SW0a-8 with their common forms, plus position,
// mentions, backlinks, authority and the usual words for traffic.
const METRIC = String.raw`visib(?:le|ility)|(?:out)?rank(?:s|ed|ing|ings)?|positions?|cit(?:e|es|ed|ing|ation|ations)|mention(?:s|ed|ing)?|backlinks?|traffic|visits?|visitors?|clicks?|impressions?|scor(?:e|es|ed|ing)|shares?|authority`;
const COUNT_NOUN = String.raw`citations?|mentions?|backlinks?|visits?|visitors?|clicks?|impressions?`;
const SITE_METRIC_RE = new RegExp(String.raw`\b(?:${METRIC})\b`, 'i');
// "37% of answers", "4 of 10 prompts": a share of AI answers needs no other metric word.
const ANSWER_SHARE_RE =
  /\d\s?(?:%|percent)\s+of\s+(?:[\w-]+\s+){0,2}?(?:answers|responses|prompts|queries|searches|results|conversations)\b|\b\d+\s+(?:out\s+)?of\s+\d+\s+(?:[\w-]+\s+){0,2}?(?:answers|responses|prompts|queries|searches|results|conversations)\b/i;

// Numbers that are not site measurements. A date or a length of time:
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
// A plan allowance ("10 sites", "25+ domains"), counted as plan copy only in a sentence that
// names a plan or a Stars price. Elsewhere "37 sites cite you" is a site claim.
const PLAN_ALLOWANCE_RE =
  /\b\d[\d,]*\+?\s?(?:client\s+)?(?:sites?|domains?|workspaces?|clients?)\b|\b\d+-agent\b/gi;
// Names that only look numeric: H1, GA4, Web3, GPT-4, and a keycap list emoji (a digit, an
// optional variation selector, then an enclosing mark).
const LABEL_RE = /\b[A-Za-z]+\d+[A-Za-z0-9]*\b|\b[A-Z]{2,}-\d+(?:\.\d+)?[A-Za-z]?\b|\d\p{Mn}?\p{Me}/gu;
// A count of advice items ("3 ways", "top 5 tips") and a step label ("step 2").
const ITEM_COUNT_RE =
  /\b(?:top\s+)?\d+\s+(?:[\w-]+\s+)?(?:ways|tips|steps|things|ideas|moves|tactics|actions|fixes|options|reasons|levers|wins|rules|mistakes)\b|\b(?:step|tip|option|phase|part|stage|point|item|priority)\s*#?\d+\b/gi;

/** The sentence with every number that is not a site measurement blanked out. */
function withoutOtherNumbers(sentence: string, hasPlanContext: boolean): string {
  const rest = sentence
    .replace(STARS_AMOUNT_RE, (price) => (hasPlanContext || CERTAIN_STARS_RE.test(price) ? ' ' : price))
    .replace(DATE_RE, ' ')
    .replace(LABEL_RE, ' ')
    .replace(ITEM_COUNT_RE, ' ');
  return hasPlanContext ? rest.replace(PLAN_ALLOWANCE_RE, ' ') : rest;
}

// An instruction tells the reader what to do ("Add 3 FAQ questions", "Aim for 50 citations").
// Its number is a count or a target, not a measurement, so it passes.
const VERBS = String.raw`add|aim|write|target|create|publish|build|fix|use|include|post|get|earn|ask|check|update|improve|optimi[sz]e|focus|start|begin|try|make|keep|set|run|test|track|monitor|measure|review|audit|submit|list|link|cite|mention|answer|pick|choose|find|identify|remove|rewrite|refresh|expand|shorten|structure|implement|install|enable|ensure|consider|plan|schedule|send|pitch|claim|verify|compare|benchmark|prioriti[sz]e|ship|launch|draft|record|collect|gather|request|secure|grow|boost|increase|reduce|cut|limit|avoid|stop|repeat|describe|explain|quote|reference|embed|replace|merge|redirect|visit|click|upgrade|share(?!\s+of\b)`;
const GERUNDS = String.raw`adding|writing|creating|publishing|building|fixing|using|including|posting|getting|earning|targeting|aiming|updating|improving`;
const MODAL = String.raw`(?:you\s+(?:should|could|can|need\s+to|want\s+to|have\s+to|must)|you['’]ll\s+want\s+to|we\s+(?:should|could|can)|i(?:['’]d|\s+would)|let['’]?s|try\s+to|aim\s+to|be\s+sure\s+to|make\s+sure\s+to|it\s+helps\s+to|remember\s+to|plan\s+to|don['’]?t|do\s+not|never)\s+(?:(?:also|first|then|now|just|simply|definitely)\s+)?`;
const INSTRUCTION_OPENER_RE = new RegExp(
  [
    // Not "Share: 18%", "Increase of 40%" or "Mention count": there the first word is a noun.
    String.raw`^(?:${MODAL})?(?:${VERBS})\b(?!\s*[:=#]|\s+(?:of|in|is|was|are|were|count|counts|rate|rates|total)\b)`,
    String.raw`^(?:it(?:['’]s|\s+is)\s+worth\s+)?(?:${GERUNDS})\b`,
    String.raw`^i(?:['’]d|\s+would)?\s+(?:recommend|suggest)\b`,
    String.raw`^a\s+(?:good|solid|reasonable|realistic|sensible|simple)\s+(?:target|goal|benchmark|rule\s+of\s+thumb|start|starting\s+point)\b`,
    String.raw`^(?:goal|target|action|step|next\s+step|to[- ]?do|homework|priority)\s*:`,
  ].join('|'),
  'i',
);
// What may come before the instruction: list furniture, "Then", "First", "Step 2:".
const LEAD_IN_RE =
  /^(?:[^A-Za-z0-9#]+|(?:then|next|first|second|third|also|finally|now|please|just|simply|instead|always|and|or|so|plus|lastly|step\s+\d+|tip\s+\d+)\b[,:.)]?\s*)+/i;
// "To improve visibility, add ..." and "If you want to rank, add ...".
const INTRO_CLAUSE_RE = /^(?:to|for|if|when|once|before|after|while|as)\b[^,.;:!?\d]*,\s*/i;
// An instruction that also states a value is still a claim:
const SUBJECT = String.raw`(?:you|your\s+[\w-]+(?:\s+[\w-]+)?|it|they|we)`;
const ASSERTION_RES: RegExp[] = [
  // "your visibility is only 37%", "share of voice is 18%", "Visibility: 37%"
  new RegExp(String.raw`\b(?:${METRIC})\b(?:\s+[\w'’-]+){0,3}?\s*(?:\b(?:is|are|was|were|sits\s+at|stands\s+at|stood\s+at)\b|[:=])[^,;]{0,25}?\d`, 'i'),
  // "your score of 62"
  new RegExp(String.raw`\byour\s+(?:[\w-]+\s+){0,3}?(?:${METRIC})\s+(?:of|at)\s+#?\d`, 'i'),
  // "your 37% visibility", "your 230 citations"
  new RegExp(String.raw`\byour\s+#?\d[\d,.]*\s?(?:%|percent)?\s+(?:[\w-]+\s+)?(?:${METRIC})\b`, 'i'),
  // "you rank #3", "you are ranked No. 3", "your site sits in position 4", "you appear in 37%"
  new RegExp(String.raw`\b${SUBJECT}(?:\s+(?:are|is|was|were|have|has|had|currently|now|already|still|only|just)){0,2}\s+(?:rank|ranks|ranked|ranking|score|scores|scored|sit|sits|sitting|appear|appears|appeared|place|placed)\b(?:\s+[\w.-]+){0,2}?\s+#?\d`, 'i'),
  // "your traffic will hit 5,000", "you'll earn 10 citations"
  new RegExp(String.raw`\b${SUBJECT}(?:['’]ll|\s+(?:will|would))\b[^,;]*\d`, 'i'),
  // "you have 230 citations", "you got 1,200 visits"
  new RegExp(String.raw`\b${SUBJECT}(?:['’]ve)?(?:\s+(?:currently|now|already|still|only|just))?\s+(?:have|has|had|get|gets|got|earned|received)\s+(?:[\w-]+\s+){0,2}?\d[\d,.]*\+?\s+(?:[\w-]+\s+)?(?:${COUNT_NOUN})\b`, 'i'),
];

function isInstruction(sentence: string, rest: string): boolean {
  if (ASSERTION_RES.some((re) => re.test(rest))) return false;
  const opener = sentence.replace(LEAD_IN_RE, '').replace(INTRO_CLAUSE_RE, '').replace(LEAD_IN_RE, '');
  return INSTRUCTION_OPENER_RE.test(opener);
}

/** True when the sentence states a number as a fact beside a site-metric word. */
function statesSiteMetric(sentence: string, hasPlanContext: boolean): boolean {
  const rest = withoutOtherNumbers(sentence, hasPlanContext);
  if (!/\d/.test(rest)) return false;
  if (!SITE_METRIC_RE.test(sentence) && !ANSWER_SHARE_RE.test(rest)) return false;
  return !isInstruction(sentence, rest);
}

// ---------------------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------------------

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

export type ChatHonestyResult = {
  /** The reply that may be stored in history and sent. */
  text: string;
  /** One ledger entry per site-metric claim found, with the status the ledger gave it. */
  claims: readonly Claim[];
  /** How many sentences were replaced because of a plan price. */
  priceCorrections: number;
};

// This chat has no measurement to cite, so a claim found here has no source.
const NO_SOURCES: ClaimSource[] = [];

/**
 * The reply as it may be stored and sent. A sentence with a wrong plan price becomes the true
 * price line from `plans`. A sentence that states a number as a fact beside a site-metric
 * word becomes NOT_MEASURED_SENTENCE. A run of identical replacements collapses to one.
 * Everything else comes back unchanged.
 */
export function filterChatReply(reply: string, plans: PlanPriceTable): ChatHonestyResult {
  const ledger = new ClaimLedger();
  const matchers = planNameMatchers(plans);
  const out: string[] = [];
  let priceCorrections = 0;
  let lastReplacement: string | null = null;
  for (const piece of splitSentences(String(reply || ''))) {
    const lead = LIST_MARKER_RE.exec(piece)?.[0] ?? '';
    const body = piece.slice(lead.length).trimEnd();
    const trail = piece.slice(lead.length + body.length);
    let replacement = correctPlanPrices(body, plans, matchers);
    if (replacement !== null) {
      priceCorrections += 1;
    } else {
      const hasPlanContext =
        findPlanNames(body, matchers).length > 0 ||
        [...body.matchAll(STARS_AMOUNT_RE)].some((m) => CERTAIN_STARS_RE.test(m[0]));
      if (statesSiteMetric(body, hasPlanContext)) {
        // The ledger rule decides: a claim proposed as measured with no source is not_measured.
        const status = coerceClaimStatus('measured', NO_SOURCES);
        ledger.append({ text: body, status, sources: NO_SOURCES });
        if (status !== 'measured') replacement = NOT_MEASURED_SENTENCE;
      }
    }
    if (replacement === null) {
      out.push(piece);
    } else if (replacement === lastReplacement) {
      out[out.length - 1] = out[out.length - 1].trimEnd() + trail;
    } else {
      out.push(lead + replacement + trail);
    }
    lastReplacement = replacement;
  }
  return { text: out.join(''), claims: ledger.list(), priceCorrections };
}
