/**
 * Honesty guard for the Telegram bot's free-text chat (Track SW task SW0a-8).
 *
 * That chat fetches no site, measures nothing, and has no say over prices or payments.
 *
 * 1. chatRoute() reads the user's message. Two kinds never reach the model, and each gets a
 *    fixed reply: a payment problem ("I paid but nothing happened") gets the /paysupport
 *    text, and a question about Luminara's own plans, prices or how to pay gets the block
 *    built from the plan table. A payment cue in the first person ("I paid", "charged me")
 *    wins over everything else in the message. Without one it routes only when sure: a
 *    message that names another company or tool, or is about the user's own site or
 *    business, goes to the model. It has no memory: each message is read by itself.
 * 2. Every model reply passes through filterChatReply() before it is stored or sent:
 *    - a sentence that tells the user to pay again, or claims to have changed their account,
 *      gives way to the /paysupport text;
 *    - a sentence that names one of our plans with a number, or gives a number of Stars,
 *      gives way to the plan block;
 *    - any other talk of money stays as it is, and one fixed line is added at the end;
 *    - a sentence that states a measurement nobody made becomes one "not measured" sentence;
 *    - a link to a host that is neither ours nor the user's is spelled out in words, and a
 *      sentence that asks for a code, password or key is removed.
 *    Only JSON-LD and head tags are set aside as something to paste. Any other JSON, markup
 *    or fenced text is read as prose.
 *
 * The filter is a backstop. The router and the prompt rules are the main controls.
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

// ---------------------------------------------------------------------------------------
// Business DNA: saved profile text, fenced and capped.
// ---------------------------------------------------------------------------------------

/** Longest value kept for one Business DNA field, in characters. */
export const BUSINESS_DNA_FIELD_MAX_CHARS = 300;
/** Longest Business DNA text that reaches the prompt, in characters. */
export const BUSINESS_DNA_BLOCK_MAX_CHARS = 1500;
const BUSINESS_DNA_MAX_COMPETITORS = 10;

/** One field on one line, capped. Anything that is not text or a number is dropped. */
function dnaField(value: unknown, fallback: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const text = String(value).slice(0, BUSINESS_DNA_FIELD_MAX_CHARS * 4).replace(/\s+/g, ' ').trim();
  return text.slice(0, BUSINESS_DNA_FIELD_MAX_CHARS) || fallback;
}

/**
 * The saved Business DNA profile as a prompt block. Every value sits inside an
 * untrusted-content fence whose markers carry a one-time code: the profile is text saved
 * from the app (typed in, or extracted from a web page), so it is data and never an
 * instruction.
 */
export function businessDnaPromptBlock(dna: unknown): string {
  if (!dna || typeof dna !== 'object') return '';
  const d = dna as Record<string, unknown>;
  const competitors = Array.isArray(d.competitors)
    ? d.competitors
        .slice(0, BUSINESS_DNA_MAX_COMPETITORS)
        .map((name) => dnaField(name, ''))
        .filter(Boolean)
        .join(', ')
        .slice(0, BUSINESS_DNA_FIELD_MAX_CHARS)
    : '';
  const fields =
    `- Company: ${dnaField(d.companyName || d.name, 'Unknown')}\n` +
    `- Primary Domain: ${dnaField(d.domain || d.primaryDomain, 'Unknown')}\n` +
    `- USP: ${dnaField(d.uniqueSellingPoint || d.usp, 'N/A')}\n` +
    `- Known Competitors: ${competitors || 'N/A'}`;
  return (
    '\n\nKnown User Business DNA Memory (saved profile text: unverified, not a measurement):' +
    wrapUntrustedContent('BUSINESS_DNA', fields, { nonce: true, maxChars: BUSINESS_DNA_BLOCK_MAX_CHARS })
  );
}

// ---------------------------------------------------------------------------------------
// Plan facts: they come from the plan table, never from the model.
// ---------------------------------------------------------------------------------------

/** The part of a plan this file needs. `PLANS` in worker/telegramBot.ts fits it. */
export type PlanPrice = { title: string; stars: number; days: number };
export type PlanPriceTable = Record<string, PlanPrice>;

/** The first line of the plan block: whose plans these are. */
export const PLAN_BLOCK_HEADING = "Luminara's own plans:";
/** The last line of the plan block: how a plan is paid for, that it does not renew, and where to buy one. */
export const PLAN_BLOCK_FOOTER =
  'Plans are paid with Telegram Stars, inside Telegram. They do not renew on their own. Send /plan to buy.';
/**
 * The very last line of the plan block. A buyer whose payment went wrong may land on the plan
 * block, and must not read "Send /plan to buy." as the last word.
 */
export const PLAN_BLOCK_PAID_LINE = 'Already paid? Send /paysupport. Do not pay again.';
/** The whole reply to a payment problem. A person handles those, and the model never does. */
export const BILLING_HELP_REPLY =
  'Billing problems are handled by a person. Send /paysupport and then your message. Your receipt ID is in /status. Please do not pay again.';
/** Added once, at the end of a model reply that talks about money. */
export const MONEY_NOTE =
  "For Luminara's own plans and prices send /plan. For billing help send /paysupport. I cannot quote prices or take payments here.";

const groupThousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The one true price line for a plan, for example "Luminara Starter is 2,500 Stars for 30 days." */
export function planPriceLine(plan: PlanPrice): string {
  return `${plan.title} is ${groupThousands(plan.stars)} Stars for ${plan.days} ${plan.days === 1 ? 'day' : 'days'}.`;
}

/** The plan block: the heading, one line per plan, how to pay, and where to go after paying. */
export function planFactsBlock(plans: PlanPriceTable): string {
  return [PLAN_BLOCK_HEADING, ...Object.values(plans).map(planPriceLine), PLAN_BLOCK_FOOTER, PLAN_BLOCK_PAID_LINE].join('\n');
}

/** The plan facts for the system prompt. Call it with the live plan table on every turn. */
export function planPricePromptBlock(plans: PlanPriceTable): string {
  if (Object.keys(plans).length === 0) return '';
  return (
    '\n\nPlan facts (from the live plan table):\n' +
    `${planFactsBlock(plans)}\n` +
    'Do not state prices, plan limits or offers yourself. When the user asks about plans, price, payment, refunds, trials or discounts, say: send /plan.\n' +
    'Never tell the user to pay again or to retry a payment. For a payment problem say: send /paysupport.'
  );
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;
const stripEmphasis = (s: string): string => s.replace(/[*_`~]+/g, '');
// "pricing page" is a page of the user's site, and a link such as acme.io/pricing says nothing
// about our prices.
const PRICING_PAGE_RE = /\bpric(?:e|ing)\s+(?:pages?|tables?|sections?|blocks?|schema|copy)\b/gi;
const wordsForPlanRules = (s: string): string =>
  stripEmphasis(s).replace(LINK_OR_HOST_RE, ' ').replace(PRICING_PAGE_RE, ' ');

type PlanNames = {
  /** A title of several words: "Single Autonomous Audit Run". */
  phrases: RegExp[];
  /** A plan id of several words, as a user types it: "single audit" for single_audit. */
  idPhrases: RegExp[];
  /** A title of one word: "Starter", and "Pro" and "Agency" from "Luminara Pro / Agency". */
  words: Array<{ word: string; re: RegExp }>;
};

/** The names a message can use for a plan, taken from the plan table. */
function planNames(plans: PlanPriceTable): PlanNames {
  const names: PlanNames = { phrases: [], idPhrases: [], words: [] };
  const phrase = (parts: string[]): RegExp => new RegExp(String.raw`\b${parts.map(escapeRegExp).join(String.raw`[\s_-]+`)}\b`, 'i');
  for (const [id, plan] of Object.entries(plans)) {
    for (const name of plan.title.replace(/^Luminara\s+/i, '').split('/').map((n) => n.trim()).filter(Boolean)) {
      if (name.includes(' ')) names.phrases.push(phrase(name.split(/\s+/)));
      else names.words.push({ word: name, re: new RegExp(String.raw`\b${escapeRegExp(name)}\b`, 'gi') });
    }
    const idWords = id.split(/[\s_-]+/).filter(Boolean);
    if (idWords.length > 1) names.idPhrases.push(phrase(idWords));
  }
  return names;
}

// "Starter plan", "the growth tier", "Starter-Tarif".
const PLAN_WORD_AFTER_RE = /^[\s-]+(?:plans?|tiers?|subscriptions?|packages?|memberships?|tarif|forfait)\b/i;
// A plan name that is also an everyday word is not a plan in these phrases:
// "pro tip", "starter content", "growth in traffic", "agency clients", "organic growth".
const ORDINARY_AFTER: Record<string, RegExp> = {
  pro: /^[\s-]*(?:tips?|moves?|level|grade|bono|advice|writers?|designers?)\b/i,
  starter: /^[\s-]*(?:content|kits?|packs?|templates?|guides?|pages?|posts?|questions?|projects?|sets?|ideas?|lists?|prompts?|topics?|sites?|checklists?)\b/i,
  growth: /^[\s-]*(?:in|of|from|rates?|hacking|hacks?|marketing|teams?|loops?|strateg(?:y|ies)|stages?|curves?|engines?|channels?|levers?|goals?|targets?|over|through|tips?|ideas?)\b/i,
  agency: /^[\s-]*(?:owners?|teams?|clients?|retainers?|work|life|models?|partners?|side|fees|rates|staff|world|folks|people|leads?|sites?)\b/i,
};
// "organic growth", "a marketing agency", "Perplexity Pro", and the user's own "your Starter tier".
const ORDINARY_BEFORE: Record<string, RegExp> = {
  pro: /\b(?:a|an|like\s+a|your|their|his|her|its|my|ChatGPT|Perplexity|Gemini|Claude|Copilot|Grok|Google|Bing|GPT|Semrush|Ahrefs|Moz|Canva|Notion|Yoast|Surfer|Jasper|LinkedIn|YouTube|iPhone|MacBook|iPad|Midjourney|Grammarly|Zapier|Shopify|WordPress|Wix|Squarespace)\s+$/i,
  starter: /\b(?:a|an|your|their|his|her|its|my)\s+$/i,
  growth: /\b(?:organic|revenue|traffic|business|sustainable|steady|fast|faster|rapid|slow|future|long[- ]term|audience|sales|user|customer|brand|market|economic|compound|real|more|their|his|her|its|your|our|my)\s+$/i,
  agency: /\b(?:a|an|your|their|my|our|marketing|seo|pr|creative|digital|ad|advertising|design|own|another|any)\s+$/i,
};

const TON_RE = /\bTON\b/;
const STARS_WORD_RE = /\bStars\b|⭐|\bXTR\b/;
// "500 Stars", "25 XTR", "⭐ 1500".
const STARS_AMOUNT_RE = /(\d[\d,.]*)\s*[kK]?\+?\s*(telegram\s+)?(stars?\b|xtr\b|⭐)|(⭐|\bxtr\b|\bstars\b)\s*[:=]?\s*(\d[\d,.]*)/i;
// Stars beside these words are a rating, not our price: "a 4.8 Star average", "50 stars on GitHub".
const RATING_CONTEXT_RE =
  /\b(?:ratings?|rated|reviews?|hotels?|github|repos?|repository|aggregaterating|ratingvalue|bestrating|trustpilot|yelp|capterra|tripadvisor|app\s+store|play\s+store)\b/i;

/** A number of Telegram Stars: "500 Stars", "25 XTR". A rating ("5 stars") is not one. */
function mentionsStarsPrice(s: string): boolean {
  const m = STARS_AMOUNT_RE.exec(s);
  if (!m) return false;
  const unit = (m[3] ?? m[4] ?? '').toLowerCase();
  if (unit === 'xtr' || m[2]) return true;
  const amount = Number((m[1] ?? m[5] ?? '').replace(/,/g, ''));
  return amount > 5 && !RATING_CONTEXT_RE.test(s);
}

// "content plan" and "plan your week" are not our plans.
const ORDINARY_PLAN_RE =
  /\b(?:content|action|marketing|growth|editorial|project|launch|business|seo|media|posting|publishing|outreach|pr|link[- ]building|testing|test|game|meal|lesson|study|site|migration|rollout|backup|recovery|\d+[- ](?:day|week|month|step)|weekly|quarterly|step[- ]by[- ]step)\s+plans?\b/gi;
const PLAN_AS_VERB_RE =
  /(?:^|[.!?:]\s+|\b(?:to|and|then|should|could|can|will|would|must|i|we|you|let['’]?s|please)\s+)plan\s+(?:to|on|for|your|my|our|a|an|the|out|ahead|each|every|this|next|\d)/gi;
const ORDINARY_TIER_RE = /\b[\w-]+-tier\b|\btier[- ]?\d\b|\btier\s+(?:one|two|three)\b/gi;
// "My plan is to publish weekly."
const PLAN_AS_INTENT_RE = /\b(?:my|our|the)\s+plan\s+(?:is|was)\s+to\b/gi;
const withoutOrdinaryPlans = (s: string): string =>
  s.replace(ORDINARY_PLAN_RE, ' ').replace(PLAN_AS_VERB_RE, ' ').replace(ORDINARY_TIER_RE, ' ').replace(PLAN_AS_INTENT_RE, ' ');

// ---------------------------------------------------------------------------------------
// Words in other languages: a handful per language, read as they stand.
// ---------------------------------------------------------------------------------------

/** The plan and payment words read in other languages. They route to the plan block. */
export const PLAN_QUESTION_WORDS: Record<string, readonly string[]> = {
  es: ['precio', 'precios', 'cuánto cuesta', 'cuanto cuesta', 'cuánto vale', 'cuánto es', 'cuanto es', 'cuánto sale', 'cuanto sale', 'cuesta', 'costo', 'coste', 'pagar', 'pago', 'comprar', 'suscripción', 'suscripcion', 'renovar', 'renovación', 'se renueva', 'prueba gratis', 'descuento', 'gratis', 'estrellas', 'planes'],
  pt: ['preço', 'preços', 'quanto custa', 'quanto é', 'custa', 'custo', 'pagamento', 'assinatura', 'assinar', 'renovação', 'teste grátis', 'desconto', 'grátis', 'gratuito', 'estrelas', 'planos'],
  ru: ['цена', 'цены', 'цену', 'сколько стоит', 'скок стоит', 'стоимость', 'почём', 'почем', 'оплата', 'оплатить', 'платить', 'заплатить', 'платно', 'платный', 'платная', 'купить', 'подписка', 'подписку', 'подписки', 'продление', 'продлить', 'продлевается', 'пробный', 'пробная', 'скидка', 'скидки', 'скидку', 'бесплатно', 'бесплатный', 'бесплатная', 'тариф', 'тарифы', 'тарифа', 'звёзд', 'звезд', 'звёзды', 'звезды', 'картой'],
  fr: ['prix', "c'est combien", 'combien coûte', 'combien coute', 'combien ça coûte', 'coûte', 'coût', 'tarif', 'tarifs', 'payer', 'payant', 'paiement', 'acheter', 'abonnement', 'renouveler', 'renouvellement', 'essai gratuit', 'réduction', 'remise', 'gratuit', 'étoiles', 'forfait'],
  de: ['preis', 'preise', 'was kostet', 'wie viel kostet', 'wieviel kostet', 'kosten', 'kostet', 'teuer', 'bezahlen', 'muss ich zahlen', 'zahle ich', 'zahlung', 'kaufen', 'abo', 'abonnement', 'abonnieren', 'verlängern', 'verlängerung', 'testphase', 'probezeit', 'rabatt', 'kostenlos', 'gratis', 'sterne'],
};
/** The payment-problem words read in other languages. They route to the /paysupport reply. */
export const BILLING_PROBLEM_WORDS: Record<string, readonly string[]> = {
  es: ['reembolso', 'devolución', 'ya pagué', 'me cobraron'],
  pt: ['reembolso', 'estorno', 'já paguei', 'cobraram'],
  ru: ['возврат', 'вернуть деньги', 'верните деньги', 'деньги вернёте', 'деньги вернете', 'оплатил', 'оплатила', 'заплатил', 'заплатила', 'списали'],
  fr: ['remboursement', 'rembourser', "j'ai payé", 'débité'],
  de: ['rückerstattung', 'erstattung', 'geld zurück', 'habe bezahlt', 'abgebucht'],
};
/** "I paid" and "I was charged" in other languages. Like the English cue, they win over every guard. */
export const FIRST_PERSON_PAYMENT_WORDS: Record<string, readonly string[]> = {
  es: ['ya pagué', 'pagué', 'me cobraron', 'me cobró'],
  pt: ['já paguei', 'paguei', 'me cobraram', 'cobraram'],
  ru: ['оплатил', 'оплатила', 'заплатил', 'заплатила', 'купил', 'купила', 'списали', 'списались', 'списалось', 'верните деньги', 'деньги вернёте', 'деньги вернете'],
  fr: ["j'ai payé", 'débité', 'débitée'],
  de: ['habe bezahlt', 'habe gezahlt', 'abgebucht', 'geld zurück'],
};
// These words carry accents and Cyrillic, where \b does not work, so the edges are tested as
// "no letter or digit on either side".
const foreignWordsRe = (lists: Record<string, readonly string[]>): RegExp =>
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:${Object.values(lists)
      .flat()
      .map((w) => w.split(' ').map(escapeRegExp).join(String.raw`\s+`))
      .join('|')})(?![\p{L}\p{N}])`,
    'iu',
  );
const FOREIGN_PLAN_WORD_RE = foreignWordsRe(PLAN_QUESTION_WORDS);
const FOREIGN_BILLING_WORD_RE = foreignWordsRe(BILLING_PROBLEM_WORDS);
const FOREIGN_FIRST_PERSON_PAYMENT_RE = foreignWordsRe(FIRST_PERSON_PAYMENT_WORDS);

// ---------------------------------------------------------------------------------------
// The reply: what is certainly a price of ours, and what is only talk of money.
// ---------------------------------------------------------------------------------------

// Beside a plan name these make the sentence a price: "for 30 days", "a month", Stars, a currency.
const PRICE_CUE_RE = new RegExp(
  [
    String.raw`\b(?:price[sd]?|prices|pricing|costs?|fees?|charge[sd]?|stars?|xtr|dollars?|bucks|usd|eur|euros?|gbp|usdt)\b`,
    String.raw`\b(?:off|discount(?:s|ed)?|free|trials?|refund(?:s|ed|able)?|renew(?:s|al|ed|ing)?|money[- ]back|guarantee[sd]?)\b`,
    String.raw`[$€£⭐]`,
    String.raw`\bfor\s+\d+\s+(?:days?|weeks?|months?|years?)\b`,
    String.raw`\b(?:a|per|each|every)\s+(?:day|week|month|year)\b|\/\s?mo\b|\b(?:monthly|yearly|annually)\b`,
  ].join('|'),
  'i',
);
const hasPriceCue = (s: string): boolean => PRICE_CUE_RE.test(s) || TON_RE.test(s) || FOREIGN_PLAN_WORD_RE.test(s);
// "Starter is 1,000", "Growth costs 3000", "Starter: 2,500", "Starter | 1,000". Not "Growth is 3
// times harder" or "Growth: 3 steps".
const NOT_A_PRICE = String.raw`(?!\s?(?:%|x\b|times\b|of\b|to\b|[\w-]*\s*(?:steps?|ways|tips|things|rules|parts|ideas|pages?|posts?|days?|weeks?|months?|years?)\b))`;
const PRICE_RIGHT_AFTER_RE = new RegExp(
  String.raw`^(?:\s+(?:is|was|costs?)\s+(?:(?:only|just|about|around|now)\s+)?|["'\s]*[:=|(-]["'\s]*)[$€£⭐]?\d[\d,.]*${NOT_A_PRICE}`,
  'i',
);
// "Starter covers 5 sites", "Growth includes 10 audits".
const PLAN_VERB_AFTER_RE = /^\s+(?:covers|includes|comes\s+with|unlocks|gets\s+you|offers|allows|gives\s+you|lets\s+you|is\s+limited\s+to)\b/i;
const NUMBER_SOON_RE = /^[^.!?\n\d]{0,30}\d/;
// A limit of a plan is a plan fact, like its price: "10 sites", "25 domains", "5 audits".
const PLAN_FACT_RE = /\b\d[\d,.]*\s+(?:[\w-]+\s+)?(?:sites?|domains?|audits?|clients?|seats?|workspaces?)\b/i;
// "Your Starter tier at $29 is a good anchor for the pricing page": a tier of the user's own
// product. Without one of these words, "your Starter plan" is ours: the user is a subscriber.
const USERS_OWN_PRICING_RE = /\b(?:tiers?|pages?|pricing)\b/i;
const YOUR_PLAN_RE = /\byour\s+(?:(?:current|new|luminara)\s+)?(?:plan|subscription)\b/i;

/**
 * True when the sentence names one of our plans as a plan and carries a number: "The Growth
 * plan covers 10 sites.", "Luminara Starter: 500", "Starter is 1,000 for 30 days", "Your plan
 * includes 25 domains.". The plan name must be written as in the title, so "growth takes 3
 * months" is not one. `asWritten` is the sentence before links and "pricing page" were taken
 * out of it.
 */
function namesPlanWithNumber(s: string, asWritten: string, names: PlanNames): boolean {
  if (!/\d/.test(s)) return false;
  if (names.phrases.some((re) => re.test(s))) return true;
  const usersOwnPricing = USERS_OWN_PRICING_RE.test(asWritten);
  if (!usersOwnPricing && YOUR_PLAN_RE.test(withoutOrdinaryPlans(s)) && PLAN_FACT_RE.test(s)) return true;
  for (const { word, re } of names.words) {
    const key = word.toLowerCase();
    for (const m of s.matchAll(re)) {
      const at = m.index ?? 0;
      const before = s.slice(0, at);
      const after = s.slice(at + m[0].length);
      if (/\bLuminara\s+$/i.test(before)) return true;
      // As in the title ("Growth"), or shouted ("GROWTH"). "growth" is the everyday word.
      if (m[0] !== word && m[0] !== word.toUpperCase()) continue;
      // "Their Starter plan" is somebody else's. "Your Starter plan" is ours, unless the
      // sentence is about the user's own tiers or pricing page.
      const owner = /\b(your|their|his|her|its|my)\s+$/i.exec(before)?.[1].toLowerCase();
      if (owner && (owner !== 'your' || usersOwnPricing)) continue;
      if (PLAN_WORD_AFTER_RE.test(after)) return true;
      if (ORDINARY_AFTER[key]?.test(after) || (!owner && ORDINARY_BEFORE[key]?.test(before))) continue;
      if (PRICE_RIGHT_AFTER_RE.test(after) || PLAN_VERB_AFTER_RE.test(after)) return true;
      // "Starter for 30 days is 1,000 Stars", "You get 14 days free on Growth", "On Starter you get 10 sites".
      const midSentence = /[\p{L}\p{N}]/u.test(before);
      if ((midSentence || NUMBER_SOON_RE.test(after)) && (hasPriceCue(s) || PLAN_FACT_RE.test(s))) return true;
    }
  }
  return false;
}

/** True when a block of JSON-LD or head tags gives a number of Stars, or names "Luminara <plan>" beside a number. */
function dataQuotesOurPrice(text: string, names: PlanNames): boolean {
  if (mentionsStarsPrice(text)) return true;
  if (!/\d/.test(text)) return false;
  return (
    names.phrases.some((re) => re.test(text)) ||
    names.words.some(({ word }) => new RegExp(String.raw`\bLuminara\s+${escapeRegExp(word)}\b`, 'i').test(text))
  );
}

// Talk of money, read broadly. Nothing is removed for it: one line is added at the end.
const MONEY_TALK_RE = new RegExp(
  [
    String.raw`\b(?:price[sd]?|prices|pricing|costs?|fees?|charge[sd]?|billing|billed|invoices?|refund(?:s|ed|able)?|money|(?:auto[- ]?)?renew(?:s|al|als|ing|ed)?|discount(?:s|ed)?|coupons?|promo\s*codes?|subscri(?:be|bed|bes|bing|ption|ptions)|payments?|crypto|usdt|usdc|bitcoin|paypal|visa|mastercard)\b`,
    String.raw`\bpa(?:y|ys|id|ying)\b(?!\s+(?:attention|off)\b)`,
    String.raw`\btrials?\b(?!\s+and\s+error)`,
    // "free", but not "feel free", "error-free" or "free of".
    String.raw`(?<!\bfeel\s)(?<![\w-])free\b(?!-|\s+(?:of|from|up)\b)`,
    // "card", but not "Twitter card" or "product card".
    String.raw`(?<!\b(?:twitter|x|og|graph|knowledge|summary|product|rich|business|info|score|report)\s)\bcards?\b`,
    String.raw`\b(?:paid|premium|monthly|yearly|annual|cheaper|cheapest|each|every|which|our|luminara['’]?s?)\s+(?:plans?|tiers?)\b|\bplans?\s+(?:start|cost|costs|include|includes|renew|renews)\b`,
    // A price with no unit: "It's 1,000 for a month.", "Roughly $50 a month.", "about 50 dollars".
    String.raw`[$€£]\s?\d|\b\d[\d,.]*\s?(?:dollars?|bucks|usd|eur|euros?|gbp)\b|\b\d[\d,.]*\s+(?:for\s+)?(?:a|an|per|each|every|\d+)\s+(?:days?|weeks?|months?|years?)\b`,
  ].join('|'),
  'i',
);

// A reply must never send a payer back to pay, and the model cannot touch an account. A
// sentence that does either gives way to the /paysupport text.
const PAY_WORD = String.raw`(?:\b(?:pay|pays|paying)\b(?!\s+(?:attention|off)\b)|\b(?:payments?|buy|buying|purchase|purchasing|checkout)\b|\bsend(?:ing)?\s+(?:the\s+|your\s+|more\s+)?stars\b|\/buy\w*|\/plan\b)`;
const AGAIN_WORD = String.raw`\b(?:again|once\s+more|one\s+more\s+time|a\s+second\s+time|another\s+time|retry|re-try|retrying|repeat)\b`;
const PAY_AGAIN_RE = new RegExp(
  String.raw`${PAY_WORD}[^.!?\n]*?${AGAIN_WORD}|${AGAIN_WORD}[^.!?\n]*?${PAY_WORD}|\brepurchas\w*|\bre-?(?:pay|buy)\b`,
  'i',
);
// "Do not pay again." says the opposite, and "customers who buy again" is about somebody else.
const NOT_PAY_AGAIN_RE = new RegExp(
  String.raw`\b(?:do\s+not|don['’]?t|never|no\s+need\s+to|not\s+need\s+to|without|instead\s+of|rather\s+than|avoid)\b[^.!?\n]{0,40}?${PAY_WORD}|\b(?:customers?|buyers?|shoppers?|users?|clients?|people|visitors?|subscribers?|they|them|their)\b|\brepeat\s+(?:purchases?|buyers?|customers?|orders?|business|sales)\b`,
  'i',
);
const DONE_TO_ACCOUNT = String.raw`(?:activated|refunded|upgraded|credited|unlocked)`;
const ACCOUNT_CLAIM_RE = new RegExp(
  [
    // "I have activated it for you.", "I've refunded you.", "I upgraded your plan."
    String.raw`\bI(?:['’]ve|\s+have)?\s+(?:(?:just|now|already)\s+)?${DONE_TO_ACCOUNT}(?=\s+(?:it|you|your|the\s+(?:plan|account|subscription|payment|purchase))\b|\s*[.,!]|\s*$)`,
    String.raw`\bI(?:['’]ll|\s+will)\s+(?:refund|activate|upgrade|credit|unlock)\b`,
    // "Your plan is now active.", "Your payment was received."
    String.raw`\byour\s+(?:plan|subscription|account|premium|access|payment|purchase|refund)\s+(?:is|has\s+been|was)\s+(?:now\s+)?(?:active|${DONE_TO_ACCOUNT}|received|confirmed|processed|successful)\b`,
    // "You will get your Stars back within 3 days.", "the first is reversed automatically"
    String.raw`\byou(?:['’]ll|\s+will)\s+(?:be\s+refunded|get\s+(?:a\s+refund|your\s+(?:stars|money)\s+back)|receive\s+a\s+refund)\b|\b(?:is|are|will\s+be)\s+(?:reversed|refunded)\s+automatically\b`,
  ].join('|'),
  'i',
);
/** True when the sentence tells the user to pay again, or claims to have changed their account. */
const sendsPayerBack = (sentence: string): boolean =>
  ACCOUNT_CLAIM_RE.test(sentence) || (PAY_AGAIN_RE.test(sentence) && !NOT_PAY_AGAIN_RE.test(sentence));

function talksAboutMoney(sentence: string): boolean {
  const s = withoutOrdinaryPlans(sentence);
  return (
    MONEY_TALK_RE.test(s) ||
    TON_RE.test(s) ||
    (STARS_WORD_RE.test(s) && !RATING_CONTEXT_RE.test(s)) ||
    FOREIGN_PLAN_WORD_RE.test(s) ||
    FOREIGN_BILLING_WORD_RE.test(s)
  );
}

// ---------------------------------------------------------------------------------------
// The router: two kinds of message never reach the model. It routes only when sure.
// ---------------------------------------------------------------------------------------

/** 'billing': a payment problem. 'plans': a question about our own plans, prices or how to pay. */
export type ChatRoute = 'billing' | 'plans';

// "What is your refund policy?" is about us, though "a refund policy" is a page of the user's.
const YOUR_POLICY_RE = /\b(?:your|luminara['’]?s)\s+(?:refund|returns?|cancell?ation|billing|payment)\s+polic(?:y|ies)\b/gi;

// Another company or tool. A message that names one is not about our plans.
const OTHER_COMPANY = String.raw`(?:semrush|ahrefs|moz|majestic|screaming\s+frog|yoast|surfer|clearscope|google(?!\s+pay\b)|bing|chatgpt|openai|perplexity|gemini|claude|copilot|grok|stripe|shopify|woocommerce|wordpress|wix|squarespace|webflow|hubspot|mailchimp|zapier|notion|canva|g2|capterra|trustpilot|yelp|amazon|github|linkedin|youtube|tiktok|reddit|instagram|facebook|wikipedia|netflix|spotify|search\s+console)`;
const OTHER_COMPANY_RE = new RegExp(String.raw`\b${OTHER_COMPANY}\b`, 'i');
// The user's own customers and business.
const THEIR_BUSINESS_RE =
  /\b(?:my|our|his|her|their)\s+(?:[\w-]+\s+)?(?:customers?|clients?|buyers?|users?|subscribers?|members?|audience|visitors?|readers?|competitors?|site|website|store|shop|saas|products?|startup|brand|blog|newsletter|pricing|prices?|tiers|offers?|checkout|homepage|domain|hosting)\b|\b(?:i|we)\s+(?:sell|own)\b|\b(?:i|we)\s+run\s+(?:an?|\d+|my|our|the|several|multiple|two|three)\b|\bsells\b/i;
// Work on a site: markup, pages, links, reviews, and paying somebody else for it.
const SITE_WORK_RE = new RegExp(
  [
    String.raw`\b(?:schema|markup|mark(?:ing)?\s+up|json-?ld|structured\s+data|rich\s+results?|h[1-6]|faqs?|meta|title\s+tags?|alt\s+text|robots|llms|sitemaps?|redirects?|canonicals?|noindex|index(?:ed|ing)?|backlinks?|link[- ]building|reviews?|ratings?|testimonials?|polic(?:y|ies)|press\s+releases?|registrar|hosting|ads?|advertising|ppc|followers|traffic|freelancers?|writers?|consultants?|agencies|search\s+results?|serps?|listings?|snippets?)\b`,
    String.raw`\b(?:pric(?:e|ing)|plans?|billing|checkout|product|landing|home|returns?|refunds?|coupon|receipt|invoice|unsubscribe|category|web)\s*(?:pages?|tables?|sections?)\b`,
    String.raw`\b(?:a|an|the|aged|expired|new|old)\s+(?:[\w-]+\s+)?domain\b|\bdomain\s+names?\b`,
    String.raw`\b(?:an?|the|another|any)\s+(?:[\w-]+\s+)?agency\b(?!\s+(?:plan|tier|subscription|package|one)\b)|\bhir(?:e|ing)\b|\boutsourc(?:e|ing)\b`,
  ].join('|'),
  'i',
);
// The everyday subjects of this chat. They keep a message away from the plan block only: a
// payment problem that mentions "the visibility audit" is still a payment problem.
const SEARCH_TOPIC_RE =
  /\b(?:visibility|seo|aeo|geo|serps?|search|keywords?|citations?|cit(?:e|es|ed|ing)|mentions?|(?:out)?rank(?:s|ed|ing|ings)?|content|blogs?|posts?|articles?|copy|pages?|links?|tools?|software|plugins?|campaigns?|competitors?|authority|conversions?|results?|snippets?|headings?|headlines?|brands?|audience|strateg(?:y|ies)|marketing)\b/i;

// What "I paid" must not be followed by: then the money went to somebody else. "I paid for
// Semrush", "I paid a writer", "I bought an aged domain".
const NOT_OURS_AFTER = String.raw`(?!\s+(?:attention\b|(?:for\s+|to\s+)?(?:(?:an?|some|the|more|my|our)\s+)?(?:${OTHER_COMPANY}\b|(?:seo|aeo|geo)\b(?!\s+(?:audit|report|scan|check|plan)\b)|(?:[\w-]+\s+)?(?:backlinks?|links?|reviews?|ads?|traffic|content|followers|writers?|freelancers?|agency|consultants?|experts?|specialists?|someone|somebody|tools?|software|domains?|hosting|courses?|posts?|articles?|plugins?|themes?|templates?|newsletters?|podcasts?|press|pr|marketing)\b)))`;
const OUR_THING = String.raw`(?:payment|purchase|plan|subscription|access|premium|stars|receipt|invoice|charge)`;
const WENT_WRONG = String.raw`(?:not|isn['’]?t|wasn['’]?t|never|no\s+longer|gone|disappear\w*|vanish\w*|missing|lost|chang\w+|downgrad\w+|locked|expired|stopp\w+|fail\w*|declin\w+|pending|stuck|didn['’]?t|doesn['’]?t|won['’]?t)`;
// A payment cue in the first person. It wins over every guard: whatever else the message
// mentions (a page, a tool, another company), the user paid us and something is wrong.
const FIRST_PERSON_PAYMENT_RE = new RegExp(
  [
    // "I paid but the pricing page still says locked", "I already paid", "I bought Growth"
    String.raw`\bi(?:['’]ve|\s+have)?\s+(?:(?:already|just|also)\s+)?(?:paid|payed|bought|purchased|subscribed|renewed)\b${NOT_OURS_AFTER}`,
    // "I was charged twice", "I got double billed", "Stripe charged me twice", "you charged me"
    String.raw`\b(?:i|we)\s+(?:was|were|got|am|have\s+been|['’]ve\s+been)\s+(?:double[- ]?)?(?:charged|billed|downgraded)\b(?!\s+with\b)`,
    String.raw`\b(?:charged|billed)\s+me\b`,
    // "my payment failed", "where is my money", "it took my stars", "refund me"
    String.raw`\bmy\s+payment\b(?!\s+(?:pages?|forms?|schema|methods?|options?|gateway|provider|processor)\b)`,
    String.raw`\b(?:where\s+(?:is|are|did|has|have)|why\s+(?:did|is|was|has|have|are))\s+my\s+(?:payment|purchase|money|receipt|charge)\b`,
    String.raw`\b(?:took|ate|stole|kept)\s+my\s+(?:money|stars)\b|\bmy\s+(?:money|stars)\s+(?:back|returned|(?:is|are|was|were)\s+(?:gone|taken))\b`,
    String.raw`\b(?:return|give\s+me)\s+my\s+(?:stars|money)\b`,
    String.raw`\brefund\s+(?:me\b|my\s+(?:money|stars|payment|purchase)\b)|\b(?:my|i\s+(?:want|need|would\s+like|demand)\s+(?:a|my))\s+refund\b(?!\s+(?:polic|pages?|terms|schema)\w*)`,
  ].join('|'),
  'i',
);
// Other signs of a payment problem that name a payment, a charge, the Stars or a plan. These
// give way to the first set of guards: "a refund policy" is a page of the user's, and "my
// client was charged twice by Stripe" is not about us.
const PAYMENT_PROBLEM_RE = new RegExp(
  [
    // "paid. nothing.", "Paid!! where is it", "just paid, now what", "telegram says paid but bot says free"
    String.raw`\bpa(?:id|yed)\b[.,;:!]*\s+(?:but|and|yet|still|no|not|nothing|already|twice|double|by\s+mistake|yesterday|today|where|now)\b|\b(?:already|just)\s+pa(?:id|yed)\b(?!\s+attention\b)`,
    // "bought starter still limited", "bought twice by accident", "pressed buy twice", "clicked pay two times"
    String.raw`\bbought\b[^.?!\n]{0,40}?\b(?:still|but|not|nothing|twice|wrong)\b|\b(?:pay|buy)\s+(?:twice|two\s+times|2\s+times)\b`,
    // "charged twice", "it charged again", "you charged 2500 stars for nothing", "why two charges", "duplicate payment"
    String.raw`(?<!\bbe\s)\b(?:charged|billed)\s+(?:twice|double|again|two\s+times|2\s+times)\b|\b(?:you|it|they|bot)\s+(?:charged|billed)\b|\bdouble[- ]?(?:charged?|billed|billing|payments?|paid)\b`,
    String.raw`\b(?:duplicate|second|two|2|extra)\s+(?:payments?|charges?)\b`,
    // "sent the stars, still free version", "stars sent but no premium", "the stars were deducted", "2500 stars gone"
    String.raw`\b(?:sent|transferred)\s+(?:you\s+)?(?:the\s+|my\s+|\d[\d,.]*\s+)?stars\b|\bstars\s+(?:sent|(?:were\s+|was\s+|got\s+)?(?:deducted|taken|gone|charged|missing|lost|disappeared))\b|\b(?:took|ate|stole|kept)\s+(?:the\s+)?stars\b`,
    // "my plan is not active", "my access is gone", "where is my plan", "subscription missing"
    String.raw`\bmy\s+${OUR_THING}\b(?!\s+is\s+to\b)[^.?!\n]{0,40}?\b${WENT_WRONG}\b`,
    String.raw`\b(?:where\s+(?:is|are|did|has|have)|why\s+(?:did|is|was|has|have|are))\s+my\s+${OUR_THING}\b`,
    String.raw`\b(?:subscription|plan|premium|access)\s+(?:is\s+)?(?:missing|gone|lost|disappeared)\b|\blost\s+my\s+(?:subscription|plan|access|premium|stars)\b|\bplan\s+ended\b`,
    // "payment went through but no access", "money was taken", "the purchase is not showing", "payment stuck"
    String.raw`\b(?:payment|money|stars|charge|invoice|transaction|purchase)\s+(?:went\s+through|was\s+taken|were\s+taken|taken|failed|declined|gone|missing|lost|didn['’]?t|did\s+not)\b`,
    String.raw`\b(?:the|my)\s+(?:purchase|payment)\b[^.?!\n]{0,20}?\bnot\b|\bdid\s+(?:my|the)\s+(?:purchase|payment|invoice|transaction)\s+go\s+through\b|\btransaction\s+(?:successful|failed|done|complete)\b|\bpurchase\s+done\b`,
    String.raw`\bpayment\s+(?:is\s+|was\s+|keeps\s+)?(?:pending|stuck|error|fail\w*|declined)\b|\bcan(?:not|['’]?t)\s+pay\b|\bpay\s+button\b|\binvoice\s+(?:expired|failed|error)\b`,
    String.raw`\b(?:reverse|undo)\s+(?:the|my|this)\s+(?:payment|purchase|charge|transaction)\b|\bwrong\s+(?:plan|tier)\b`,
    String.raw`\b(?:money|stars)\s+back\b|\bmoney[- ]back\b`,
    String.raw`\brefund(?:s|ed|able|ing)?\b|\bchargebacks?\b`,
    // "cancel", "how do I cancel", "cancel my subscription". Not "cancel a redirect".
    String.raw`\bcancel(?:l?ing|l?ed|lation)?\b(?=\s*(?:$|[?.!,]|it\b|this\b|that\b|(?:my|the|this)\s+(?:subscription|plan|membership|payment|renewal|trial)\b))`,
    String.raw`\b(?:an?|the|my)\s+(?:invoice|receipt)\b|\binvoice\s+for\b`,
  ].join('|'),
  'i',
);
// Signs of a payment problem that name no payment: "I upgraded and nothing changed", "it did
// not activate", "still locked". They also give way to the everyday subjects of this chat, so
// "we upgraded and rankings fell" goes to the model.
const NOTHING_HAPPENED_RE = new RegExp(
  [
    String.raw`\bupgraded\b(?=\s*(?:$|[,.!?]|and\b|but\b|yesterday\b|today\b|already\b|just\b))`,
    String.raw`\bdid\s*n(?:o|['’])?t\s+activate\b|\bnot\s+activated?\b|\bactivation\s+(?:failed|error)\b`,
    String.raw`\bstill\s+(?:locked|limited)\b|\bnothing\s+unlocked\b|\bstill\s+says?\b[^.?!\n]{0,30}?\b(?:free|limit|locked)\b|\bstill\s+(?:on\s+free\b|(?:on\s+)?(?:the\s+)?free\s+(?:version|plan|tier|limit)\b)`,
    String.raw`\b(?:it|this)\s+went\s+through\b|\bdid\s+it\s+go\s+through\b|\bgive\s+(?:it|them)\s+back\b|\bwrong\s+one\b|\b(?:expired|ended)\s+early\b`,
  ].join('|'),
  'i',
);
// "got starter but it says limit reached", "starter not working after purchase".
const NOT_WORKING_RE = /\b(?:not\s+working|doesn['’]?t\s+work|limit\s+reached|still\s+(?:limited|locked|free)|not\s+(?:active|activated|unlocked|showing))\b/i;
const GOT_IT_RE = /\b(?:got|have|bought|paid|purchase|purchased|upgraded?|subscribed)\b/i;

const FIRST_PERSON_RE = /\b(?:i|we|me|my|mine|our|us)\b|\bi['’](?:m|ve|d|ll)\b/i;
const TO_US_RE = /\b(?:you|your|yours|luminara|it|this|here|(?:the|this)\s+(?:bot|app|suite))\b/i;

// "How much is it?" Not "how much traffic", "how much is too much" or "how much should I write".
const HOW_MUCH_RE =
  /\bhow\s?much\b(?=\s*(?:[?$€£]|$|(?:is|are|was)\s*(?:\?|$|(?:it|this|that|the|a|an|one|each|every|all)\b)|(?:does|do|did|would|will|can|could)\s+(?:it|this|that|you|they|one|the\s+[\w-]+|[\w-]+\s+plan)\s+(?:cost|charge|run|set)\b|(?:do|would|will|should|must)\s+(?:i|we)\s+(?:pay|owe|have\s+to\s+pay|need\s+to\s+pay)\b|for\b|per\b|a\s+(?:month|year|week|day)\b|money\b|to\s+(?:pay|buy|subscribe|upgrade|get\s+started|start|join|unlock)\b))/i;
// A price word. "How do I price it?" uses the verb and is not one.
const PRICE_WORD = String.raw`(?<!\b(?:i|we|to|should|can|could|would)\s)\bprice[sd]?\b|\b(?:prices|pricing|costs?|fees?|charge[sd]?|cheap(?:er|est)?|expensive|afford(?:able)?)\b`;
const PRICE_WORD_RE = new RegExp(PRICE_WORD, 'i');
const EVERY_PRICE_WORD_RE = new RegExp(PRICE_WORD, 'gi');
// What a short message may hold beside a price word and still be only about our price: "team
// pricing", "is there a monthly fee", "the cheap one", "deep crawl price". "Pricing psychology
// tips" holds more, and goes to the model.
const PRICE_FILLER_RE =
  /\b(?:what['’]s|whats|what|is|are|was|the|a|an|any|there|it|this|that|how|much|many|do|does|for|per|of|or|and|not|too|so|very|something|anything|options?|ones?|please|team|student|monthly|yearly|annual|month|year|deep|crawl|single|audits?|plans?|tiers?|here|now|really)\b/gi;
const saysOnlyAPrice = (text: string): boolean =>
  !/[\p{L}\p{N}]/u.test(text.replace(EVERY_PRICE_WORD_RE, ' ').replace(PRICE_FILLER_RE, ' '));
// "How much does it cost to rank?" is about ranking, "how much does it cost to subscribe?" is about us.
// So is "are cheap domains ok?": the price word describes something that is not ours.
const GENERIC_COST_RE =
  /\b(?:costs?|prices?|priced|expensive|cheap(?:er|est)?|charge[sd]?)\s+(?:to|of|for|way)\s+(?!use\b|get\s+(?:it|this|started)\b|buy\b|subscribe\b|upgrade\b|start\b|try\b|join\b|unlock\b|run\b|audit\b|this\b|it\b|that\b|the\s+(?:bot|app|plan|subscription)\b|luminara\b|your\b|a\s+(?:plan|subscription)\b|me\b|one\b|\d)|\b(?:cheap|cheaper|cheapest|expensive|affordable)\s+(?!plans?\b|tiers?\b|options?\b|ones?\b|version\b|subscription\b|here\b|or\b|than\b|is\b|for\b|to\b|way\b)[a-z]/i;
// "which plan", "what plans do you have", "plans".
const OUR_PLAN_WORD_QUESTION_RE =
  /\b(?:your|which|any|paid|free|cheapest|cheaper|monthly|yearly|annual|current|my|available)\s+(?:\w+\s+)?(?:plans?|tiers?)\b|\bwhat\s+plans\b|\bplans?\s+(?:do\s+you|are\s+there|cost|costs|prices?|pricing|options?|comparison|start|available)\b|^\W*(?:plans?|tiers?)\W*$/i;
// "how many stars", "stars?", "the 75 stars thing". Not "how do I get more stars".
const STARS_QUESTION_RE = /\bhow\s+many\s+stars\b|\d\s*stars\b|\b(?:in|with|for|using|by|telegram)\s+stars\b|^\W*stars\W*$|⭐|\bxtr\b/i;
// The whole message is one of these: "price?", "crypto?", "upgrade". "Buy button color" is not.
const BARE_MONEY_WORD_RE =
  /^\W*(?:price|prices|pricing|costs?|fees?|free|paid|pay|payments?|buy|purchase|subscribe|subscription|upgrade|unlock|premium|trial|free\s+trial|demo|discounts?|coupons?|promo|promo\s*codes?|deals?|sale|limits?|unlimited|cards?|credit\s+card|visa|mastercard|paypal|apple\s+pay|google\s+pay|crypto|usdt|usdc|bitcoin|wallet|monthly|yearly|annual|lifetime|recurring|renew|renewal|cheap|cheaper|cheapest|expensive|\$+)\W*$/i;
const BARE_TON_RE = /^\W*TON\W*$/;
// What "pay" and "buy" must be followed by to be about us. Not "pay a writer" or "buy backlinks".
const PAY_AFTER = String.raw`(?=\s*(?:$|[?.!,]|with\b|in\b|by\b|via\b|using\b|for\s+(?:this|it|that|the\s+(?:bot|app|plan|subscription|audit)|luminara|a\s+plan|more|anything)\b|you\b|here\b|more\b|now\b|monthly\b|yearly\b|again\b|anything\b|something\b|to\s+(?:use|unlock|continue|keep|get)\b|or\b|first\b|later\b|once\b|upfront\b))`;
const BUY_AFTER = String.raw`(?=\s*(?:$|[?.!,]|it\b|this\b|that\b|one\b|a\s+plan\b|the\s+(?:plan|subscription|[\w-]+\s+plan)\b|here\b|now\b|more\b|stars\b|premium\b|access\b|from\s+you\b|in\b|with\b))`;
const OUR_NOUNS = String.raw`(?:sites|domains|audits|queries|questions|messages|reports|projects|seats|engines)`;
const PAY_METHOD = String.raw`(?:cards?|credit\s+cards?|debit\s+cards?|visa|mastercard|paypal|apple\s+pay|google\s+pay|crypto|usdt|usdc|bitcoin|dollars|euros?|wallet)`;
const ASKS_HOW_TO_PAY_RE = /\b(?:do|does|can|could|will)\s+(?:you|i|we|it)\b/i;
// Phrases that are about our plans when the message is short, or speaks of "I" or "you".
const CUED_PLAN_RES: RegExp[] = [
  // pay, buy, subscribe, upgrade, unlock, join
  new RegExp(String.raw`\bpay\b${PAY_AFTER}|\bme\s+pay\b|\bbuy\b${BUY_AFTER}|\bpurchase\b${BUY_AFTER}`, 'i'),
  /\bsubscribe\b(?=\s*(?:$|[?.!,]|to\s+(?:luminara|this|it|the\s+(?:bot|app|plan)|a\s+plan|premium)\b|here\b|now\b|monthly\b|again\b))|\b(?:a|the|my|your)\s+subscription\b(?!\s+(?:product|business|box|model|service|site|software|company))/i,
  /\bupgrad(?:e|ing)\b(?=\s*(?:$|[?.!,]|my\s+plan\b|to\s+(?:premium|a\s+[\w-]+\s+plan|the\s+[\w-]+\s+plan)\b|later\b|now\b|it\b|plan\b|from\b))/i,
  /\bunlock\b(?=\s*(?:$|\?|everything\b|premium\b|all\b|more\b|it\b|the\s+(?:rest|full|other)\b))|\bhow\s+do\s+i\s+join\s*(?:$|\?)|\bsign\s+me\s+up\b|\btake\s+my\s+money\b/i,
  /\bpremium\s+(?:plans?|tiers?|version|features?|engines?|access|subscription)\b|\b(?:go|get|is|are)\s+premium\b|\benterprise\s+(?:plan|option|tier|pricing|version)\b/i,
  // free or paid
  /\bfor\s+free\b|\bfree\s+(?:plan|tier|version|trial|audits?|to\s+use|or\s+paid|or\s+not|forever|credits?|queries|limit)\b|\b(?:is|are|was)\s+(?:it|this|that|you|luminara|the\s+(?:bot|app|audit))\s+(?:really\s+)?(?:free|paid)\b|\bfree\s*\?|\bpaid\s+or\s+free\b|\b(?:paid|premium)\s+(?:plans?|tiers?|version|features?)\b/i,
  // trials, discounts and deals
  /\b(?:free\s+)?trial\s*\?|\b(?:do|does|is|are|can)\s+(?:you|there|it|i|luminara)\b[^?.!\n]{0,25}\b(?:trial|discount|coupon|promo|sale|deal)s?\b|\b(?:any|a)\s+(?:discounts?|deals?)(?=\s*(?:$|\?|for\s+(?:students?|teams?|me|us)\b|right\s+now\b|today\b|now\b))|\b(?:student|team|special|bulk)\s+(?:discounts?|deals?)\b|\bpromo\s*codes?\b|\btry\s+(?:it\s+)?before\b|\btest\s+it\s+first\b/i,
  // renewal and how long a plan lasts
  // "does it renew?" Not "does it renew my crawl budget".
  /\b(?:does|will|do|did)\s+(?:it|this|that|they|mine|my\s+plan|the\s+plan|plans)\s+(?:(?:auto[- ]?)?renew\b(?=\s*(?:$|[?.!,]|automatically\b|every\b|each\b|after\b|on\s+its\b|by\s+itself\b|monthly\b|yearly\b|itself\b|again\b))|(?:auto[- ]?)?(?:recur|charge|expire|end|stop)\b)|\bauto[- ]?(?:renew\w*|pay\w*|charge\w*|bill\w*)\b|\bbe\s+charged\b/i,
  /\bhow\s+long\s+(?:does|will|do)\s+(?:it|this|that|mine|my\s+plan|a\s+plan|the\s+plan|plans?)\s+last\b|\bwhen\s+(?:does|will|do)\s+(?:it|this|mine|my\s+plan|the\s+plan)\s+(?:end|expire|run\s+out|stop|renew)\b|\bwhen\s+(?:it|mine|my\s+plan|the\s+plan)\s+(?:ends|expires|runs\s+out)\b/i,
  /\bwhat\s+happens\s+(?:after\s+(?:\d+|the|it|that|my)\b|when\s+(?:it|my|the)\s+(?:plan\s+|trial\s+|subscription\s+)?(?:ends?|expires?|runs?\s+out|is\s+over))|\b(?:is|are)\s+(?:it|this|that)\s+(?:a\s+)?(?:one[- ]?time|one[- ]?off|recurring|lifetime)\b|\bone[- ]?time\s+or\s+recurring\b|\brecurring\s+or\s+one[- ]?time\b|\blifetime\s+(?:plan|access|deal|license|subscription)\b|\b(?:monthly|yearly|annual)\s+(?:fee|plan|price|payment|or)\b|\bper\s+month\b/i,
  // how to pay
  new RegExp(String.raw`\b(?:do|does|can|could|will)\s+(?:you|i|we|it)\b[^?.!\n]{0,30}\b${PAY_METHOD}\b|\bmy\s+card\b`, 'i'),
  // limits
  new RegExp(
    String.raw`\b(?:the|a|my|any|your|daily)\s+limits?\b|\b(?:am|was)\s+i\s+limited\b|\bget\s+unlimited\b|\bunlimited\s+(?:plan|access|audits|sites|use)\b|\bquota\b|\bhow\s+many\s+${OUR_NOUNS}\s+(?:(?:can|may)\s+(?:i|we)\b|do\s+(?:i|we)\s+get\b)|\b(?:i|we)\s+need\s+more\s+${OUR_NOUNS}\b|\bcan\s+(?:i|we)\s+add\s+(?:more\s+)?${OUR_NOUNS}\b`,
    'i',
  ),
];
// "What is included in the top one?", "Is the Drift Sentinel included or separate?"
const WHAT_IS_INCLUDED_RE = /\bwhat(?:['’]?s|\s+is|\s+are)\s+included\b|\bis\s+(?:it|this|that|the\s+[\w\s-]{1,30}?)\s+included\b/i;
// What may stand beside "pro", "growth" or "agency" for the word to mean a plan in a question.
const PLAN_COMPANION_RE =
  /\bhow\s?much\b|\bwhat\s+do\s+i\s+get\b|\b(?:price[sd]?|prices|pricing|costs?|plans?|tiers?|vs\.?|versus|difference|between|compare|comparison|which|include[sd]?|limits?|features?|upgrade|downgrade|switch|choose|pick|worth|buy|pay)\b/i;

/** How a message names one of our plans, if it does: any spelling of the name, apart from its everyday uses. */
function planNamedIn(text: string, names: PlanNames): { titledMidMessage: boolean; planWordAfter: boolean; rest: string } | null {
  for (const { word, re } of names.words) {
    const key = word.toLowerCase();
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      const before = text.slice(0, at);
      const after = text.slice(at + m[0].length);
      if (!/\bLuminara\s+$/i.test(before) && (ORDINARY_AFTER[key]?.test(after) || ORDINARY_BEFORE[key]?.test(before))) continue;
      return {
        // Written as in the title, in the middle of the message: "How much is Starter?"
        titledMidMessage: /\bLuminara\s+$/i.test(before) || (m[0] === word && /[\p{L}\p{N}]/u.test(before)),
        planWordAfter: PLAN_WORD_AFTER_RE.test(after),
        rest: `${before} ${after}`,
      };
    }
  }
  return null;
}

/** A plan named in a question: "starter", "is growth worth it", "pro vs agency", "single audit". */
function namesPlanInQuestion(text: string, names: PlanNames, words: number): boolean {
  if (names.phrases.some((re) => re.test(text)) || names.idPhrases.some((re) => re.test(text))) return true;
  const named = planNamedIn(text, names);
  return named !== null && (words <= 3 || named.titledMidMessage || named.planWordAfter || PLAN_COMPANION_RE.test(named.rest));
}

/** A plan the user has, and it does not work: "got starter but it says limit reached". */
const planDoesNotWork = (text: string, names: PlanNames): boolean =>
  NOT_WORKING_RE.test(text) && GOT_IT_RE.test(text) && planNamedIn(text, names) !== null;

function asksAboutOurPlans(text: string, names: PlanNames): boolean {
  const words = wordCount(text);
  if (namesPlanInQuestion(text, names, words) || STARS_QUESTION_RE.test(text)) return true;
  if (BARE_MONEY_WORD_RE.test(text) || BARE_TON_RE.test(text)) return true;
  if (FOREIGN_PLAN_WORD_RE.test(text) || OUR_PLAN_WORD_QUESTION_RE.test(withoutOrdinaryPlans(text))) return true;
  if (WHAT_IS_INCLUDED_RE.test(text)) return true;
  // The rest needs a cue: a short message, or one that speaks of "I" or "you".
  const person = FIRST_PERSON_RE.test(text) || TO_US_RE.test(text);
  const short = words <= 6;
  if (!person && !short) return false;
  if (HOW_MUCH_RE.test(text) && !GENERIC_COST_RE.test(text)) return true;
  // A price word alone proves little: with no "I" or "you" the message must hold nothing else.
  if (PRICE_WORD_RE.test(text) && !GENERIC_COST_RE.test(text) && (person || saysOnlyAPrice(text))) return true;
  return CUED_PLAN_RES.some((re) => re.test(text)) || (TON_RE.test(text) && ASKS_HOW_TO_PAY_RE.test(text));
}

/**
 * Where the user's message goes. 'billing' and 'plans' get a fixed reply (chatRouteReply) and
 * the model is not called; null goes to the model.
 *
 * It answers only what is clearly a payment problem of the user's, or a question about
 * Luminara's own plans, prices or how to pay. A payment cue in the first person ("I paid",
 * "charged me", "my payment") wins over everything else in the message. Without one, a
 * message that names another company or tool, or is about the user's own site or business,
 * is never routed. Each message is read by itself: what was said before changes nothing.
 */
export function chatRoute(userText: string, plans: PlanPriceTable): ChatRoute | null {
  const text = stripEmphasis(String(userText || ''))
    .replace(LINK_OR_HOST_RE, ' ')
    .replace(YOUR_POLICY_RE, ' refund ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (FIRST_PERSON_PAYMENT_RE.test(text) || FOREIGN_FIRST_PERSON_PAYMENT_RE.test(text)) return 'billing';
  if (OTHER_COMPANY_RE.test(text) || THEIR_BUSINESS_RE.test(text) || SITE_WORK_RE.test(text)) return null;
  if (PAYMENT_PROBLEM_RE.test(text) || FOREIGN_BILLING_WORD_RE.test(text)) return 'billing';
  const names = planNames(plans);
  if (planDoesNotWork(text, names)) return 'billing';
  if (SEARCH_TOPIC_RE.test(text)) return null;
  if (NOTHING_HAPPENED_RE.test(text)) return 'billing';
  return asksAboutOurPlans(text, names) ? 'plans' : null;
}

/** The fixed reply for a routed message. */
export function chatRouteReply(route: ChatRoute, plans: PlanPriceTable): string {
  return route === 'billing' ? BILLING_HELP_REPLY : planFactsBlock(plans);
}

// ---------------------------------------------------------------------------------------
// Site numbers. Step 1: set aside what is not a measurement, or is the user's own.
// ---------------------------------------------------------------------------------------

const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
// A link, or a bare host name such as acme.io.
const LINK_OR_HOST_RE = /\bhttps?:\/\/[^\s<>()"']+|\bwww\.[^\s<>()"']+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>()"']*)?/gi;
const PHONE_RE = /\+\d[\d\s().-]{6,}\d|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{2,4}-\d{3,4}-\d{3,4}\b/g;
const TIME_RE = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\b\.?)?|\b\d{1,2}\s?[ap]\.?m\b\.?/gi;
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
const PRODUCT = String.raw`Gemini|GPT|ChatGPT|Claude|Llama|Mistral|Grok|DeepSeek|Qwen|Sonnet|Opus|Haiku|Copilot|iOS|Android|Windows|macOS|PHP|Python|Node(?:\.js)?|React|Angular|Vue|Next(?:\.js)?|WordPress|Shopify|Chrome|Safari|Firefox|Edge|HTTP|TLS|WCAG|Lighthouse|Schema(?:\.org)?|PageSpeed`;
const VERSION_RE = new RegExp(
  String.raw`\bv\d+(?:\.\d+)*\b|\bversion\s+\d+(?:\.\d+)*\b|\b(?:${PRODUCT})[\s/-]?\d+(?:\.\d+)*[a-z]?\b|\b\d+\.\d+\.\d+\b`,
  'gi',
);
const STATUS = String.raw`(?:200|201|204|301|302|303|304|307|308|400|401|403|404|405|410|418|429|500|501|502|503|504)`;
const HTTP_STATUS_RE = new RegExp(
  // "status 404", "a 404", "returns 301", "404s", "404 page". Not "a 200% rise" or "every 500 visits".
  String.raw`\b(?:status(?:\s+code)?|error|code)\s+${STATUS}\b|\b(?:a|an|every|each|any|returns?|returned|returning)\s+${STATUS}\b(?!\s?(?:%|percent|x\b|[,./]\d)|\s+(?:citations?|mentions?|backlinks?|visits?|visitors?|clicks?|impressions?|sessions?|views|points|times|more|fewer)\b)|\b${STATUS}s\b|\b${STATUS}(?=\s+(?:pages?|errors?|status|redirects?|responses?|codes?|not\s+found|gone|server)\b)`,
  'gi',
);
// Names that only look numeric: H1, GA4, Web3, GPT-4, and a keycap list emoji (a digit, an
// optional variation selector, then an enclosing mark).
const LABEL_RE = /\b[A-Za-z]+\d+[A-Za-z0-9]*\b|\b[A-Z]{2,}-\d+(?:\.\d+)?[A-Za-z]?\b|\d\p{Mn}?\p{Me}/gu;
// A count of advice items ("3 ways", "top 5 tips", "2 parts"), a step label ("step 2") and a
// list mark inside a sentence ("1) sources, 2) structure").
const ITEM_COUNT_RE =
  /\b(?:top\s+)?\d+\s+(?:[\w-]+\s+)?(?:ways|tips|steps|things|ideas|moves|tactics|actions|fixes|options|reasons|levers|wins|rules|mistakes|parts|jobs|pieces|kinds|types|layers|stages|areas|factors|pillars|signals|basics)\b|\b(?:step|tip|option|phase|part|stage|point|item|priority)\s*#?\d+\b|\(\d\)|(?<![\w.])\d\)(?=\s)/gi;
// A scale, not a reading: "a score out of 100", "from 0 to 100", "1 to 5".
const SCALE_RE = /(?<!\d\s)\bout\s+of\s+(?:5|10|100)\b|\b(?:from\s+)?[01]\s?(?:-|to)\s?(?:5|10|100)\b/gi;
// "100% sure", "100% focus": an idiom, not a share of anything.
const WHOLLY_RE =
  /\b100\s?%\s+(?:focus|focused|sure|certain|clear|ready|committed|confident|original|unique|accurate|honest|human|natural|necessary|required|crawlable|indexable|accessible|correct|complete|consistent|true)\b/gi;
// A price cut or a price ratio is talk of money, not a reading: "20% off", "a 10% discount",
// "at about 2x Starter", "3x the price".
const DISCOUNT_RE =
  /\b\d+(?:\.\d+)?\s?(?:%|percent)\s+(?:off|discounts?|cheaper|commission|deposit|tax|vat)\b|\b\d+(?:\.\d+)?x\s+(?:the\s+)?(?:price|cost|fee|starter|basic|pro|premium|standard|enterprise)\b/gi;
// A number with its marks: "#3", "2nd", "1,200", "40%", "40 percent". The marks are part of
// what the user said: "2 competitors" does not make "2nd" or "#2" the user's own.
const NUMBER_TOKEN_RE = /(#\s?)?(\d[\d,]*(?:\.\d+)?)(st\b|nd\b|rd\b|th\b)?(\s?%|\s+percent\b)?/g;

const numberKey = (hash: string | undefined, digits: string, ordinal: string | undefined, percent: string | undefined): string =>
  `${hash ? '#' : ''}${digits.replace(/,/g, '').replace(/\.0+$/, '')}${ordinal ? 'th' : ''}${percent ? '%' : ''}`;

/** The numbers the user wrote, each with its marks. */
function numbersIn(texts: string[]): Set<string> {
  const keys = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(NUMBER_TOKEN_RE)) keys.add(numberKey(m[1], m[2], m[3], m[4]));
  }
  return keys;
}

// A number the user wrote may be repeated only where the sentence hands it back to the user:
// "you said", "you told me", "as you wrote", "your figure of". Anywhere else it is a number
// like any other, so "You rank 2nd" does not pass because the user wrote "2 competitors".
const ATTRIBUTED_RE =
  /\byou\s+(?:said|say|mentioned|mention|told\s+me|tell\s+me|wrote|write|shared|noted|gave|reported|stated|quoted|typed|sent)\b|\bas\s+you\s+(?:said|wrote|mentioned|noted|say|put\s+it)\b|\byour\s+(?:own\s+)?(?:figure|number|count|estimate|guess)\s+of\b|\b(?:according\s+to|going\s+by|based\s+on)\s+(?:you|your\s+(?:message|numbers?|figures?|data))\b/i;
const CLAUSE_END_RE = /[,;:]\s|\s(?:so|and|but|which|then|because|therefore)\s/i;

/** Blanks the user's own numbers inside the clause that hands them back to the user. */
function withoutAttributedNumbers(sentence: string, userNumbers: Set<string>): string {
  const said = ATTRIBUTED_RE.exec(sentence);
  if (!said || userNumbers.size === 0) return sentence;
  // "As you said, ..." puts the quoted part after the comma.
  const from = said.index + said[0].length + (/^\s*[,:]\s*/.exec(sentence.slice(said.index + said[0].length))?.[0].length ?? 0);
  const stop = CLAUSE_END_RE.exec(sentence.slice(from));
  const to = stop ? from + stop.index : sentence.length;
  const clause = sentence
    .slice(from, to)
    .replace(NUMBER_TOKEN_RE, (token, hash, digits, ordinal, percent) =>
      userNumbers.has(numberKey(hash, digits, ordinal, percent)) ? ' ' : token,
    );
  return sentence.slice(0, from) + clause + sentence.slice(to);
}

/** The sentence with everything that is not a measurement blanked. Inline code is read as prose. */
function setAside(sentence: string, userNumbers: Set<string>): string {
  return withoutAttributedNumbers(sentence.replace(/[*_~`]+/g, ''), userNumbers)
    .replace(EMAIL_RE, ' ')
    .replace(LINK_OR_HOST_RE, ' ')
    .replace(PHONE_RE, ' ')
    .replace(TIME_RE, ' ')
    .replace(DATE_RE, ' ')
    .replace(VERSION_RE, ' ')
    .replace(HTTP_STATUS_RE, ' ')
    .replace(LABEL_RE, ' ')
    .replace(ITEM_COUNT_RE, ' ')
    .replace(SCALE_RE, ' ')
    .replace(WHOLLY_RE, ' ')
    .replace(DISCOUNT_RE, ' ');
}

// ---------------------------------------------------------------------------------------
// Site numbers. Step 2: the shapes of a measurement.
// ---------------------------------------------------------------------------------------

/** The one sentence that takes the place of an unmeasured claim. */
export const NOT_MEASURED_SENTENCE = 'I have not checked or measured that in this chat.';

const NUM_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)`;
const ORDINAL = String.raw`(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)`;
const SELECTION_NOUN = String.raw`ways|tips|steps|things|ideas|moves|tactics|actions|fixes|options|reasons|levers|wins|rules|mistakes|pages|posts|articles|keywords|queries|prompts|questions|competitors|priorities|products|features|channels|sources|sites|customers|topics|categories|pieces|formats`;
const COUNT_NOUN = String.raw`citations?|mentions?|backlinks?|referring\s+domains|visits?|visitors?|clicks?|impressions?|sessions?|page\s?views?`;
const METRIC_NOUN = String.raw`visibility|traffic|authority|share\s+of\s+voice|${COUNT_NOUN}|rating|reach`;
const METRIC_WORD = String.raw`visib(?:le|ility)|(?:out)?rank(?:s|ed|ing|ings)?|positions?|cit(?:e|es|ed|ing|ation|ations)|mention(?:s|ed|ing)?|backlinks?|traffic|visits?|visitors?|clicks?|impressions?|scor(?:e|es|ed|ing)|shares?|authority`;
const HEDGE = String.raw`(?:(?:about|around|roughly|approximately|only|just|nearly|almost|over|under|above|below|at|up|down|to|now|currently|worth|close\s+to)\s+){0,3}`;

const PERCENT_RE = new RegExp(
  String.raw`\d\s?%|\d[\d,.]*\s+(?:percent|per\s+cent|percentage\s+points?)\b|\b${NUM_WORD}(?:[- ]${NUM_WORD})?\s+(?:percent|per\s+cent)\b`,
  'i',
);
// "3x", but not "post 2x a week".
const MULTIPLE_RE = /\b\d+(?:\.\d+)?x\b(?!\s+(?:a|per|each|every)\s+(?:day|week|month|year)\b)/i;
// "double your citations", "your citations will double", "twice as many citations".
const MULTIPLE_WORD_RE = new RegExp(
  [
    String.raw`\b(?:doubl|tripl|quadrupl)(?:e|es|ed|ing)\s+(?:(?:your|the|their|our|its)\s+)?(?:[\w-]+\s+)?(?:${METRIC_WORD})\b`,
    String.raw`\b(?:${METRIC_WORD})\b\s+(?:(?:will|would|can|could|may|might|should|has|have|had)\s+)?(?:doubl|tripl|quadrupl)(?:e|es|ed)\b`,
    String.raw`\btwice\s+(?:as\s+(?:many|much|high|often)|the)\b[^.;!?]{0,30}\b(?:${METRIC_WORD})\b`,
    String.raw`\b(?:${METRIC_WORD})\b[^.;!?]{0,20}\btwice\s+as\b`,
  ].join('|'),
  'i',
);
const SHAPE_RES: RegExp[] = [
  PERCENT_RE,
  MULTIPLE_RE,
  MULTIPLE_WORD_RE,
  // "#3"
  /(?:^|[^\w&])#\s?\d+\b/,
  // a metric as a key in JSON that is not JSON-LD: "rank": 3, "ai_visibility": "37"
  /"[\w\s-]*(?:visib|rank|citation|mention|traffic|score|share|authority|backlink|visit|click|impression)[\w\s-]*"\s*:\s*"?#?\d/i,
  // "37/100", "8/10"
  /\b\d+(?:\.\d+)?\s?\/\s?(?:5|10|100)\b(?!\s?\/)/,
  // "62 out of 100", "8 of 10 prompts", "3 of your 10 products"
  new RegExp(String.raw`\b\d+(?:\.\d+)?\s+(?:out\s+)?of\s+(?:(?:the|your|our|their|its)\s+)?\d+\b|\b${NUM_WORD}\s+out\s+of\s+(?:\d+|${NUM_WORD})\b`, 'i'),
  // "rank 3", "ranked 4th", "ranked No. 3", "ranking is 12", "position 2", "Rank: #3"
  /\b(?:out)?rank(?:s|ed|ing)?\b(?:\s+[\w.'’-]+){0,3}?\s+(?:#\s?\d+|no\.?\s*\d+|number\s+(?:\d+|one)\b|\d+(?:st|nd|rd|th)?\b)/i,
  /\b(?:rank|ranking|position)s?\s*(?:is|was|of|at|:|=)?\s*(?:#\s?|no\.?\s*|number\s+)?\d+(?:st|nd|rd|th)?\b/i,
  // "ranked third", "you rank first", "you come up fourth", "position two", "second place"
  new RegExp(String.raw`\b(?:out)?rank(?:s|ed)\s+(?:[\w'’-]+\s+){0,2}?${ORDINAL}\b|\b(?:you|we|they|i)\s+(?:[\w'’-]+\s+){0,2}?rank\s+(?:[\w'’-]+\s+){0,2}?${ORDINAL}\b`, 'i'),
  new RegExp(String.raw`\b(?:you|we|they|your\s+[\w-]+)\s+(?:[\w'’-]+\s+){0,2}?(?:come|comes|came|show|shows|showed|land|lands|landed|place|places|placed|finish|finishes|finished)\s+(?:up\s+)?(?:in\s+)?${ORDINAL}\b`, 'i'),
  new RegExp(String.raw`\bpositions?\s+${NUM_WORD}\b|\b(?:\d+(?:st|nd|rd|th)|${ORDINAL})\s+(?:place|position|spot)\b`, 'i'),
  // "4th" on its own: "you come up 4th". Not "3rd party", "2nd paragraph", "1st step".
  /\b\d+(?:st|nd|rd|th)\b(?![\s-]+(?:party|century|step|time|paragraph|sentence|line|person|edition|quarter|week|day|month|year|generation|draft|version|item|point|option|section|chapter|heading|attempt|floor|grade)\b)/i,
  // "page one of Google", "the first page of Google"
  /\bpage\s+(?:one|two|three|\d)\s+(?:of|on|in)\s+(?:google|bing|search|the\s+results)\b|\b(?:first|second|third)\s+page\s+(?:of|on|in)\s+(?:google|bing|search|the\s+results)\b/i,
  // "in the top 5", "you're top 3", "Top 5." but not "your top 5 pages" or "the top 3 results get"
  new RegExp(String.raw`(?:\b(?:in|into|within|among|inside|at|are|is|am|be|was|were|reach(?:ed)?|hit|made|make|crack(?:ed)?|enter(?:ed)?)\s+(?:the\s+)?|\b(?:you|we|they)['’]re\s+(?:in\s+)?(?:the\s+)?|^\s*)top[\s-]?(?:\d+|three|five|ten)\b(?!\s+(?:[\w-]+\s+){0,2}?(?:${SELECTION_NOUN})\b)`, 'i'),
  // "No. 3", "number one"
  /\bno\.\s?\d+\b|\bnumber\s+one\b(?!\s+(?:mistake|reason|rule|tip|priority|thing|way|goal|question|problem|issue|cause|factor|lever|job)\b)/i,
  // a score: "score of 62", "scores 62", "a 62 score", "DA 45"
  /\bscor(?:e|es|ed|ing)\b[^.;!?\d]{0,25}?#?\d|\d[\d,.]*\+?\s+(?:[\w-]+\s+){0,2}?scor(?:e|es)\b/i,
  /\b(?:DA|DR|PA)\s*(?:of|is|:|=)?\s*\d+\b/,
  // "your number is 37", "your GEO grade is 72"
  new RegExp(String.raw`\byour\s+(?:[\w-]+\s+){0,3}?(?:grade|rating|index|level|number|figure|result|reading|value|total|count|percentage|share|score)\s*(?:\b(?:is|was|stands\s+at|sits\s+at|comes\s+to)\b|[:=])\s*${HEDGE}#?\d`, 'i'),
  // a count of a metric: "230 citations", "1,200 visits", "cited you 14 times", "37 sites cite you"
  // (not "3 clicks from the home page", which is a distance)
  new RegExp(String.raw`\d[\d,.]*\s?[kKmM]?\+?\s+(?:[\w-]+\s+){0,2}?(?:${COUNT_NOUN})\b(?!\s+(?:from|away|deep)\b)`, 'i'),
  /\b(?:cit|mention|recommend|link)\w*\s+(?:[\w'’-]+\s+){0,3}?\d[\d,.]*\s+times\b/i,
  /\d[\d,.]*\+?\s+(?:[\w-]+\s+)?(?:sites?|pages?|sources?|engines?|domains?|publishers?|outlets?|answers?|prompts?|queries|models?)\s+(?:(?:now|also|already|currently|each|all)\s+)?(?:cite|cites|cited|citing|mention|mentions|mentioned|link|links|linked|recommend|recommends|recommended)\b/i,
  // "1,200 people visit your site each month"
  /\d[\d,.]*\s?[kKmM]?\+?\s+(?:[\w-]+\s+)?(?:people|users|readers|buyers|customers|shoppers)\s+(?:[\w'’-]+\s+)?(?:visit|visits|visited|see|saw|click|clicked|read|find|found)\b[^.;!?]*\byour\b/i,
  // a metric and its value: "traffic is 1,200", "domain authority is 45", "Brand mentions: 14"
  new RegExp(String.raw`\b(?:${METRIC_NOUN})\b(?:\s+[\w'’-]+){0,3}?\s*(?:\b(?:is|are|was|were|sits\s+at|stands\s+at|stood\s+at|hit|hits|reached|totals?|totaled|came\s+to|of|at)\b|[:=])\s*${HEDGE}#?\d`, 'i'),
  // "your site has 14 pages without schema", "there are 3 pages on your site"
  /\byour\s+(?:site|website|domain|homepage|home\s+page|pages?|blog|store|sitemap|schema|markup|content)\s+(?:currently\s+|now\s+|already\s+|only\s+|still\s+)?(?:has|have|had|shows?|lists?|contains?|includes?|is\s+missing|lacks?|uses?|loads?|returns?|gets?|receives?)\b[^.;!?]*\d/i,
  /\bthere\s+(?:are|is|were|was)\s+(?:[\w-]+\s+){0,2}?\d[^.;!?]*\b(?:on|in|across)\s+your\s+(?:site|website|domain|homepage|pages?|blog|store|sitemap)\b/i,
];
// A claim of having looked. Nothing in this chat fetches a site, so it is replaced wherever it stands.
const LOOKED_RES: RegExp[] = [
  /\bI(?:['’]ve|\s+have)?\s+(?:(?:just|already|now|also)\s+)?(?:checked|scanned|crawled|audited|analy[sz]ed|reviewed|inspected|examined|tested|fetched|visited|opened|measured|pulled\s+up|looked\s+(?:at|into|through|over)|ran|took\s+a\s+look)\b/,
  /\bI\s+(?:(?:can|could|also)\s+)?(?:found|find|see|saw|noticed|detected|counted|spotted)\b(?:[^.;!?]*\d|\s+(?:that\s+)?your\b|\s+(?:on|in|across|at)\s+your\b)/,
  /\d[^.;!?]*\bI\s+(?:found|saw|noticed|detected|counted|spotted)\b/,
  /\b(?:my|the|this|a\s+quick)\s+(?:scan|crawl|audit|check|analysis|review|test)\s+(?:of\s+[^.;!?]{1,40}?\s+)?(?:shows?|showed|found|finds|reveals?|revealed|returned|indicates?|turned\s+up)\b/i,
];
// A speed reading is a measurement too, though lengths of time are otherwise set aside:
// "your homepage loads in 2.5 seconds", "your LCP is 2.5s".
const SPEED_RES: RegExp[] = [
  /\byour\s+(?:site|website|homepage|home\s+page|pages?|server|store|blog)\s+(?:currently\s+|now\s+)?(?:loads?|takes?|responds?|renders?)\b[^.;!?]*\d/i,
  /\b(?:LCP|INP|CLS|TTFB|FCP|load\s+time|page\s+speed|response\s+time)\b[^.;!?\d]{0,25}?(?:\b(?:is|was|of|at)\b|[:=])\s*(?:(?:about|around|roughly|only|just|under|over)\s+)?\d/i,
];
// "If your page has 3 FAQs, ..." supposes; it does not state.
const HYPOTHETICAL_RE = /^(?:if|when|once|unless|whether|suppose|assuming)\b/i;
// A bare number as the whole answer ("About 1,200 a month.", "Third."), when the user asked for a metric.
const BARE_ANSWER_RE = new RegExp(
  String.raw`^(?:(?:it(?:['’]s|\s+is)|you(?:['’]re|\s+are|\s+have|\s+get)?|that(?:['’]s|\s+is)|currently|now|about|around|roughly|approximately|approx\.?|nearly|almost|over|under|just|only|maybe|probably|likely|at|near|close\s+to|i(?:['’]d|\s+would)\s+(?:say|guess|estimate)|my\s+(?:guess|estimate)\s+is|somewhere\s+(?:around|near))[\s,:]+)*(?:#?\d[\d,.]*\s?[kKmM]?\+?(?:st|nd|rd|th)?|${ORDINAL}|none|zero)(?:\s+(?:or\s+so|give\s+or\s+take|a\s+month|per\s+month|monthly|a\s+week|a\s+day|right\s+now|today|so\s+far|in\s+total|total|overall|on\s+average|at\s+the\s+moment|currently))*[.!]?$`,
  'i',
);
const METRIC_WORD_RE = new RegExp(String.raw`\b(?:${METRIC_WORD})\b`, 'i');
const ASKS_FOR_ADVICE_RE = /\bshould\b|\bhow\s+(?:do|can|could|would)\s+(?:i|we)\b|\bhow\s+to\b|\bneed\s+to\b|\brecommend\b|\bsuggest\b/i;

// ---------------------------------------------------------------------------------------
// Site numbers. Step 3: an instruction keeps its count but loses a promised number.
// ---------------------------------------------------------------------------------------

const VERBS = String.raw`add|aim|write|target|create|publish|build|fix|use|include|post|get|earn|ask|check|update|improve|optimi[sz]e|focus|start|begin|try|make|keep|set|run|test|track|monitor|measure|review|audit|submit|list|link|cite|mention|answer|pick|choose|find|identify|remove|rewrite|refresh|expand|shorten|structure|implement|install|enable|ensure|consider|plan|schedule|send|pitch|claim|verify|compare|benchmark|prioriti[sz]e|ship|launch|draft|record|collect|gather|request|secure|grow|boost|increase|reduce|cut|limit|avoid|stop|repeat|describe|explain|quote|reference|embed|replace|merge|redirect|visit|click|upgrade|compress|trim|raise|lift|be|share(?!\s+of\b)`;
const GERUNDS = String.raw`adding|writing|creating|publishing|building|fixing|using|including|posting|getting|earning|targeting|aiming|updating|improving`;
const MODAL = String.raw`(?:you\s+(?:should|could|can|need\s+to|want\s+to|have\s+to|must)|you['’]ll\s+want\s+to|we\s+(?:should|could|can)|i(?:['’]d|\s+would)|let['’]?s|try\s+to|aim\s+to|be\s+sure\s+to|make\s+sure\s+to|it\s+helps\s+to|remember\s+to|plan\s+to|don['’]?t|do\s+not|never)\s+(?:(?:also|first|then|now|just|simply|definitely)\s+)?`;
const INSTRUCTION_OPENER_RE = new RegExp(
  [
    // Not "Share: 18%", "Increase of 40%" or "Mention count": there the first word is a noun.
    String.raw`^(?:${MODAL})?(?:${VERBS})\b(?!\s*[:=#]|\s+(?:of|in|is|was|are|were|count|counts|rate|rates|total)\b)`,
    // "Score each page", "Rank your pages": the metric words as verbs.
    String.raw`^(?:${MODAL})?(?:score|rank|rate|grade)\s+(?:each|every|your|the|all|these|those|them|it)\b`,
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
  // "your visibility is only 37", "share of voice is 18", "Visibility: 37"
  new RegExp(String.raw`\b(?:${METRIC_WORD})\b(?:\s+[\w'’-]+){0,3}?\s*(?:\b(?:is|are|was|were|sits\s+at|stands\s+at|stood\s+at)\b|[:=])[^,;]{0,25}?\d`, 'i'),
  // "your score of 62"
  new RegExp(String.raw`\byour\s+(?:[\w-]+\s+){0,3}?(?:${METRIC_WORD})\s+(?:of|at)\s+#?\d`, 'i'),
  // "your 230 citations"
  new RegExp(String.raw`\byour\s+#?\d[\d,.]*\s+(?:[\w-]+\s+)?(?:${METRIC_WORD})\b`, 'i'),
  // "you rank #3", "you are ranked No. 3", "your site sits in position 4"
  new RegExp(String.raw`\b${SUBJECT}(?:\s+(?:are|is|was|were|have|has|had|currently|now|already|still|only|just)){0,2}\s+(?:rank|ranks|ranked|ranking|score|scores|scored|sit|sits|sitting|appear|appears|appeared|place|placed)\b(?:\s+[\w.-]+){0,2}?\s+(?:#?\d|${ORDINAL}\b)`, 'i'),
  // "your traffic will hit 5,000", "you'll earn 10 citations"
  new RegExp(String.raw`\b${SUBJECT}(?:['’]ll|\s+(?:will|would))\b[^,;]*\d`, 'i'),
  // "you have 230 citations", "you got 1,200 visits"
  new RegExp(String.raw`\b${SUBJECT}(?:['’]ve)?(?:\s+(?:currently|now|already|still|only|just))?\s+(?:have|has|had|get|gets|got|earned|received)\s+(?:[\w-]+\s+){0,2}?\d[\d,.]*\+?\s+(?:[\w-]+\s+)?(?:${COUNT_NOUN})\b`, 'i'),
];
// "A score of 90 or more is a good target": a target, not a reading.
const TARGET_PHRASE_RE =
  /\b(?:good|solid|reasonable|realistic|healthy|safe|sensible)\s+(?:target|goal|benchmark|sign|aim|bar|rule\s+of\s+thumb)\b/i;
// The promised number: a percentage or a multiple of an outcome, or a metric taken "to N".
// "Compress images by 50%" promises nothing about the site's results and passes, and so does
// "add schema to the top 5 pages by traffic", where "top 5" picks pages.
const OUTCOME_WORD_RE = new RegExp(
  String.raw`\b(?:${METRIC_WORD}|more|fewer|higher|lower|increase[sd]?|growth|lift|boost|gain|rise|jump|uplift|bounce|conversions?|revenue|sales|leads|sign-?ups|engagement|ctr|click-through|open\s+rate|roi)\b`,
  'i',
);
const CHANGE_VERB = String.raw`grow|raise|lift|increase|boost|push|bring|take|get|move|improve|drive`;
const PROMISED_RES: RegExp[] = [
  MULTIPLE_RE,
  MULTIPLE_WORD_RE,
  new RegExp(String.raw`\b(?:your|the|our|my|its|their)\s+(?:[\w-]+\s+){0,2}?(?:${METRIC_WORD})\b[^.;!?,]{0,30}?\bto\s+#?\d`, 'i'),
  new RegExp(String.raw`\b(?:${CHANGE_VERB})\s+(?:[\w-]+\s+){0,2}?(?:${METRIC_WORD})\b[^.;!?,]{0,30}?\bto\s+#?\d`, 'i'),
  new RegExp(String.raw`\b(?:to|into|reach|hit)\s+(?:the\s+)?(?:#\s?\d+\b|number\s+one\b|position\s+\d+\b|first\s+place\b|top\s+\d+\b(?!\s+(?:[\w-]+\s+){0,2}?(?:${SELECTION_NOUN})\b))`, 'i'),
  new RegExp(String.raw`\bto\s+\d[\d,.]*\s?[kKmM]?\+?\s+(?:[\w-]+\s+){0,2}?(?:${COUNT_NOUN})\b`, 'i'),
];
const promisesNumber = (rest: string): boolean =>
  (PERCENT_RE.test(rest) && OUTCOME_WORD_RE.test(rest)) || PROMISED_RES.some((re) => re.test(rest));

function isInstruction(sentence: string, rest: string): boolean {
  if (ASSERTION_RES.some((re) => re.test(rest))) return false;
  if (TARGET_PHRASE_RE.test(rest)) return true;
  const opener = sentence.replace(LEAD_IN_RE, '').replace(INTRO_CLAUSE_RE, '').replace(LEAD_IN_RE, '');
  return INSTRUCTION_OPENER_RE.test(opener);
}

/** True when the sentence states a measurement nobody made. */
function statesMeasurement(sentence: string, userNumbers: Set<string>, userAskedForMetric: boolean): boolean {
  // Step 1: set aside what is not a measurement, or is the user's own.
  const rest = setAside(sentence, userNumbers);
  if (LOOKED_RES.some((re) => re.test(rest))) return true;
  // A question states nothing.
  if (/\?["')\]]*$/.test(sentence.trim())) return false;
  // Step 3: an instruction, or a supposition, loses only a promised number.
  if (HYPOTHETICAL_RE.test(sentence.replace(LEAD_IN_RE, '')) || isInstruction(sentence, rest)) {
    return promisesNumber(rest);
  }
  // Step 2: the shapes of a measurement.
  if (SHAPE_RES.some((re) => re.test(rest))) return true;
  if (SPEED_RES.some((re) => re.test(sentence.replace(/[*_~`]+/g, '')))) return true;
  return userAskedForMetric && BARE_ANSWER_RE.test(rest.trim());
}

// ---------------------------------------------------------------------------------------
// Links and secrets
// ---------------------------------------------------------------------------------------

/** Hosts a reply may always link to, with their subdomains. */
export const OWN_LINK_HOSTS: readonly string[] = ['luminarasuite.com'];
/**
 * Reference hosts a reply may name: the schema vocabulary, Google's search documentation,
 * and the three names reserved for examples, which nobody can register.
 */
export const REFERENCE_LINK_HOSTS: readonly string[] = [
  'schema.org',
  'developers.google.com',
  'example.com',
  'example.org',
  'example.net',
];

const URL_CHAR = '[^\\s<>()"\'`]';
// A file name is not a host: robots.txt, sitemap.xml, Next.js.
const FILE_EXTENSION = String.raw`js|ts|jsx|tsx|mjs|py|rb|go|rs|md|txt|xml|json|jsonld|html?|css|scss|php|aspx?|pdf|png|jpe?g|gif|webp|svg|ico|csv|ya?ml|toml|ini|env|lock|zip|mp4|mp3|docx?|xlsx?|pptx?|rss|log|sql|sh`;
const SCHEME_LINK = String.raw`\b[Hh][Tt][Tt][Pp][Ss]?:\/\/${URL_CHAR}+|\b[Ww]{3}\.${URL_CHAR}+`;
// A bare host name is a link too: Telegram links "evil.example" as it stands. The last label
// must be lower case, which leaves "ASP.NET" and a missing space after a full stop alone.
const BARE_HOST = String.raw`(?<![@\w.\/-])(?:[A-Za-z0-9-]+\.)+(?!(?:${FILE_EXTENSION})\b)[a-z]{2,}\b(?![@\w-])(?:\/${URL_CHAR}*)?`;
const LINK_RE = new RegExp(`${SCHEME_LINK}|${BARE_HOST}`, 'g');
const SCHEME_LINK_RE = new RegExp(SCHEME_LINK, 'g');
const HOST_RE = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;

const hostOf = (link: string): string =>
  (link.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].split('@').pop() ?? '')
    .split(':')[0]
    .toLowerCase()
    .replace(/^www\./, '');

function hostsIn(texts: string[]): Set<string> {
  const hosts = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(HOST_RE)) hosts.add(m[0].toLowerCase().replace(/^www\./, ''));
  }
  return hosts;
}

// A sentence that asks the user to enter a code, password, seed phrase or key anywhere is
// removed, whatever host it names. "Paste the code into the page head" is about markup and stays.
const SECRET_NOUN = String.raw`(?:(?:telegram|verification|confirmation|login|log-?in|sign-?in|security|auth\w*|one[- ]time|sms|2fa|otp|access|recovery|backup|pin)\s+code|passcode|pass\s?word|\bpin\b|\botp\b|seed\s+phrase|recovery\s+phrase|secret\s+phrase|mnemonic|private\s+key|secret\s+key|api\s+key|license\s+key|card\s+(?:number|details)|cvv|credentials|login\s+details)`;
const ASKS_FOR_SECRET_RE = new RegExp(
  String.raw`\b(?:enter|type|paste|send|share|give|provide|submit|confirm|input|forward|tell\s+me|dm\s+me|message\s+me)\b[^.!?]{0,80}?${SECRET_NOUN}`,
  'i',
);

// ---------------------------------------------------------------------------------------
// Data and sentences
// ---------------------------------------------------------------------------------------

/** A run of the reply: prose to read, or JSON-LD or head tags to paste. */
type Segment = { data: boolean; text: string };

const CLOSED_FENCE_RE = /```[^\n`]*\n([\s\S]*?)```/g;
// What goes in a page head. Any other tag is read as prose, with the text inside it.
const HEAD_TAG_LINE_RE =
  /^\s*(?:<\/?(?:head|html)\b[^<>\n]*>|<(?:meta|link|base)\b[^<>\n]*>|<title>[^<>\n]*<\/title>|<!--[^\n]*-->)\s*$/i;
const LD_SCRIPT_OPEN_RE = /^\s*<script\b[^<>\n]*\btype\s*=\s*["']?application\/ld\+json["']?[^<>\n]*>/i;
const SCRIPT_CLOSE_RE = /<\/script>\s*$/i;
const MAX_DATA_LINES = 400;

/** JSON-LD: an object with "@context", or a list of such objects. */
function isJsonLd(text: string): boolean {
  const trimmed = text.trim();
  if (!/^[{[]/.test(trimmed)) return false;
  try {
    const value: unknown = JSON.parse(trimmed);
    const items: unknown[] = Array.isArray(value) ? value : [value];
    return items.length > 0 && items.every((item) => typeof item === 'object' && item !== null && '@context' in item);
  } catch {
    return false;
  }
}

/** How many lines from `at` are something to paste: a JSON-LD script element, JSON-LD, or head tags. */
function dataRunLength(lines: string[], at: number): number {
  const limit = Math.min(lines.length, at + MAX_DATA_LINES);
  if (LD_SCRIPT_OPEN_RE.test(lines[at])) {
    for (let j = at; j < limit; j += 1) if (SCRIPT_CLOSE_RE.test(lines[j].trimEnd())) return j - at + 1;
    return 0;
  }
  if (/^\s*[{[]/.test(lines[at])) {
    let text = '';
    for (let j = at; j < limit; j += 1) {
      text += lines[j];
      if (/[}\]],?\s*$/.test(lines[j]) && isJsonLd(text.replace(/,\s*$/, ''))) return j - at + 1;
    }
    return 0;
  }
  let j = at;
  while (j < limit && HEAD_TAG_LINE_RE.test(lines[j])) j += 1;
  return j - at;
}

const linesOf = (text: string): string[] => text.split(/(?<=\n)/).filter((line) => line !== '');

/** What a closed fence must hold to be set aside: nothing but JSON-LD or head tags. */
function isPasteable(text: string): boolean {
  const lines = linesOf(text);
  let at = 0;
  let found = false;
  while (at < lines.length) {
    if (lines[at].trim() === '') {
      at += 1;
      continue;
    }
    const run = dataRunLength(lines, at);
    if (run === 0) return false;
    found = true;
    at += run;
  }
  return found;
}

function splitUnfenced(text: string, segments: Segment[]): void {
  const lines = linesOf(text);
  let at = 0;
  while (at < lines.length) {
    const run = dataRunLength(lines, at);
    const chunk = lines.slice(at, at + Math.max(run, 1)).join('');
    const last = segments[segments.length - 1];
    if (run === 0 && last && !last.data) last.text += chunk;
    else segments.push({ data: run > 0, text: chunk });
    at += Math.max(run, 1);
  }
}

/**
 * The reply as runs of prose and of data. Only JSON-LD (an object with "@context") and head
 * tags are data, fenced or not. Any other JSON, markup or fenced text, and everything after
 * an unclosed fence, is prose and is read for measurements like any sentence.
 */
function splitData(reply: string): Segment[] {
  const segments: Segment[] = [];
  let at = 0;
  for (const m of reply.matchAll(CLOSED_FENCE_RE)) {
    const start = m.index ?? 0;
    splitUnfenced(reply.slice(at, start), segments);
    if (isPasteable(m[1])) segments.push({ data: true, text: m[0] });
    else splitUnfenced(m[0], segments);
    at = start + m[0].length;
  }
  splitUnfenced(reply.slice(at), segments);
  return segments;
}

// A sentence ends at closing punctuation followed by a gap and anything but a lowercase
// letter (so "3.5%" and "vs. competitors" stay whole), or at a line break.
const SENTENCE_END_RE = /([.!?]+["')\]*_`]*)[ \t]+(?=[^a-z\s])|\s*\n\s*/g;
// "ranked No. 3" must stay one sentence, or the number and its metric word part ways.
const ABBREVIATION_RE = /(?:^|[^A-Za-z])(?:no|nos|vs|approx|est|etc|e\.g|i\.e)\.$/i;
// A hyphen, asterisk or bullet dot, or a list number, at the start of a line is layout.
const BULLET = '[-*•]';
const LIST_MARKER_RE = new RegExp(String.raw`^\s*(?:${BULLET}\s+)?(?:\d{1,2}[.)]\s+)?`);
const STARTS_LIST_ITEM_RE = new RegExp(String.raw`^(?:${BULLET}\s+|\d{1,2}[.)]\s+)`);
const ENDS_SENTENCE_RE = /[.!?]["')\]*_`]*$/;

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
      // ("Visibility score" then "37/100") stay together. A list item is never a heading,
      // and a heading does not swallow the list item under it.
      m[0].split('\n').length === 2 &&
      !ENDS_SENTENCE_RE.test(text.slice(start, at)) &&
      !STARTS_LIST_ITEM_RE.test(text.slice(end)) &&
      !STARTS_LIST_ITEM_RE.test(text.slice(text.lastIndexOf('\n', at - 1) + 1, at).trimStart())
    ) {
      continue;
    }
    pieces.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces;
}

// ---------------------------------------------------------------------------------------
// The filter
// ---------------------------------------------------------------------------------------

export type ChatFilterContext = {
  /** The live plan table. */
  plans: PlanPriceTable;
  /** What the user wrote, oldest first, the current message last. */
  userTexts?: string[];
  /** Hosts a reply may link to besides OWN_LINK_HOSTS, REFERENCE_LINK_HOSTS and the hosts the user wrote. */
  allowedHosts?: string[];
};

export type ChatHonestyResult = {
  /** The reply that may be stored in history and sent. Empty when nothing of it may be. */
  text: string;
  /** One ledger entry per unmeasured claim found, with the status the ledger gave it. */
  claims: readonly Claim[];
  /** How many sentences that named one of our plans with a number, or a number of Stars, gave way to the plan block. */
  planSentences: number;
  /** How many sentences that told the user to pay again, or claimed a change to the account, gave way to the /paysupport text. */
  billingSentences: number;
  /** True when the reply talks about money and MONEY_NOTE was added at its end. */
  moneyNote: boolean;
  /** How many links were spelled out because their host is not an allowed one. */
  linksRemoved: number;
  /** How many sentences were removed because they asked for a code, password or key. */
  secretRequests: number;
};

// This chat has no measurement to cite, so a claim found here has no source.
const NO_SOURCES: ClaimSource[] = [];

/** A fixed text of ours that stands in for sentences of the reply, once per reply. */
type FixedText = 'block' | 'billing';

/**
 * The reply as it may be stored and sent. See the top of this file for the rules.
 * Everything the rules do not name comes back unchanged.
 */
export function filterChatReply(reply: string, context: ChatFilterContext): ChatHonestyResult {
  const { plans } = context;
  const userTexts = (context.userTexts ?? []).map((text) => String(text || ''));
  const lastUserText = wordsForPlanRules(userTexts[userTexts.length - 1] ?? '');
  const names = planNames(plans);
  const block = planFactsBlock(plans);
  const fixedTexts: Record<FixedText, string> = { block, billing: BILLING_HELP_REPLY };
  // Lines of the plan block that a reply repeats one at a time are ours to place.
  const blockSentences = new Set(
    [PLAN_BLOCK_HEADING, ...Object.values(plans).map(planPriceLine), PLAN_BLOCK_FOOTER].flatMap(splitSentences).map((s) => s.trim()),
  );
  const noteSentences = new Set(splitSentences(MONEY_NOTE).map((s) => s.trim()));
  const userAskedForMetric = METRIC_WORD_RE.test(lastUserText) && !ASKS_FOR_ADVICE_RE.test(lastUserText);
  const userNumbers = numbersIn(userTexts);
  const userHosts = hostsIn(userTexts);
  const knownHosts = [...OWN_LINK_HOSTS, ...REFERENCE_LINK_HOSTS, ...(context.allowedHosts ?? [])].map((host) =>
    host.toLowerCase().replace(/^www\./, ''),
  );
  const hostAllowed = (host: string): boolean =>
    userHosts.has(host) || knownHosts.some((known) => known && (host === known || host.endsWith(`.${known}`)));

  const ledger = new ClaimLedger();
  const out: string[] = [];
  // Where each fixed text stands in `out`. The slot itself holds only the line break after it.
  const placed = new Map<FixedText, number>();
  let planSentences = 0;
  let billingSentences = 0;
  let moneyTalk = false;
  let linksRemoved = 0;
  let secretRequests = 0;

  const spellOutForeignLinks = (text: string, linkRe: RegExp): string =>
    text.replace(linkRe, (link) => {
      const tail = /[.,;:!?)\]]+$/.exec(link)?.[0] ?? '';
      const host = hostOf(tail ? link.slice(0, -tail.length) : link);
      if (!host || hostAllowed(host)) return link;
      linksRemoved += 1;
      return host.replace(/\./g, ' dot ') + tail;
    });
  // A removed sentence hands its line break to the text before it.
  const dropPiece = (trail: string): void => {
    const last = out.length - 1;
    if (last >= 0 && ![...placed.values()].includes(last)) out[last] = out[last].trimEnd() + trail;
  };
  // The first sentence a fixed text stands in for marks where it goes; the rest are dropped.
  const giveWayTo = (kind: FixedText, trail: string): void => {
    if (placed.has(kind)) {
      dropPiece(trail);
    } else {
      placed.set(kind, out.length);
      out.push(trail);
    }
  };

  const readProse = (text: string): void => {
    let previousWasUnmeasured = false;
    for (const piece of splitSentences(text)) {
      const lead = LIST_MARKER_RE.exec(piece)?.[0] ?? '';
      const body = piece.slice(lead.length).trimEnd();
      const trail = piece.slice(lead.length + body.length);
      const plain = wordsForPlanRules(body);
      const asWritten = stripEmphasis(body).trim();

      // Our own money line: taken out here and put back once, at the end.
      if (body !== '' && noteSentences.has(asWritten)) {
        moneyTalk = true;
        dropPiece(trail);
        continue;
      }

      if (body !== '' && ASKS_FOR_SECRET_RE.test(asWritten)) {
        secretRequests += 1;
        dropPiece(trail);
        continue;
      }

      // "Send /buy_starter again.", "I have activated it for you.": the /paysupport text instead.
      if (body !== '' && sendsPayerBack(asWritten)) {
        billingSentences += 1;
        if (!placed.has('billing')) previousWasUnmeasured = false;
        giveWayTo('billing', trail);
        continue;
      }

      // Certain: one of our plans with a number, or a number of Stars. It gives way to the block.
      if (body !== '' && (blockSentences.has(asWritten) || mentionsStarsPrice(plain) || namesPlanWithNumber(plain, asWritten, names))) {
        planSentences += 1;
        if (!placed.has('block')) previousWasUnmeasured = false;
        giveWayTo('block', trail);
        continue;
      }

      if (body !== '' && statesMeasurement(body, userNumbers, userAskedForMetric)) {
        // The ledger rule decides: a claim proposed as measured with no source is not_measured.
        const status = coerceClaimStatus('measured', NO_SOURCES);
        ledger.append({ text: body, status, sources: NO_SOURCES });
        if (status !== 'measured') {
          if (previousWasUnmeasured) dropPiece(trail);
          else out.push(lead + NOT_MEASURED_SENTENCE + trail);
          previousWasUnmeasured = true;
          continue;
        }
      }
      previousWasUnmeasured = false;
      // Any other talk of money stays, word for word. It earns the one line at the end.
      if (body !== '' && talksAboutMoney(plain)) moneyTalk = true;
      out.push(spellOutForeignLinks(piece, LINK_RE));
    }
  };

  // A fixed text of ours that the reply already holds whole stays where it is, and is not read.
  const wholeFixedTexts = new RegExp(`(${[block, BILLING_HELP_REPLY].map(escapeRegExp).join('|')})`);
  for (const [index, chunk] of String(reply || '').split(wholeFixedTexts).entries()) {
    if (index % 2 === 1) {
      giveWayTo(chunk === block ? 'block' : 'billing', '');
      continue;
    }
    for (const segment of splitData(chunk)) {
      if (!segment.data) {
        readProse(segment.text);
      } else if (dataQuotesOurPrice(segment.text, names)) {
        // JSON-LD and head tags are not read for measurements, but a price of ours is one anywhere.
        planSentences += 1;
        giveWayTo('block', /\s*$/.exec(segment.text)?.[0] ?? '');
      } else {
        out.push(spellOutForeignLinks(segment.text, SCHEME_LINK_RE));
      }
    }
  }

  // Each fixed text stands as a paragraph of its own, where the first sentence it replaced was.
  const parts: string[] = [];
  let from = 0;
  for (const [kind, at] of [...placed.entries()].sort((a, b) => a[1] - b[1])) {
    parts.push(out.slice(from, at).join(''), fixedTexts[kind]);
    from = at;
  }
  parts.push(out.slice(from).join(''));
  let text =
    placed.size === 0
      ? out.join('')
      : parts
          .map((part, index) => (index === 0 ? part.trimEnd() : part.trim()))
          .filter(Boolean)
          .join('\n\n');
  const moneyNote = moneyTalk && text.trim() !== '';
  if (moneyNote) text = `${text.trimEnd()}\n\n${MONEY_NOTE}`;
  return { text, claims: ledger.list(), planSentences, billingSentences, moneyNote, linksRemoved, secretRequests };
}
