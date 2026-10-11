/**
 * Honesty guard for the Telegram bot's free-text chat (Track SW task SW0a-8).
 *
 * That chat fetches no site, measures nothing, and has no say over prices.
 *
 * 1. A question about our own plans, prices, payment or offers never reaches the model.
 *    isPlanQuestion() reads the user's message, and the handler answers with one fixed block
 *    built from the plan table.
 * 2. Every other reply passes through filterChatReply() before it is stored or sent:
 *    - a sentence about our plans, prices or offers gives way to that same block;
 *    - a sentence that states a measurement nobody made becomes one "not measured" sentence;
 *    - a link to a host that is neither ours nor the user's is spelled out in words, and a
 *      sentence that asks for a code, password or key is removed.
 *    Inline code is read as prose. A block of JSON, markup or robots.txt is not read for
 *    measurements, because it is something to paste, but the plan and link rules apply to it.
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

/** The last line of the plan block: where to buy, that nothing renews, where billing help is. */
export const PLAN_BLOCK_FOOTER =
  'Send /plan to see or buy a plan. Plans do not renew on their own. For billing help send /paysupport.';

const groupThousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The one true price line for a plan, for example "Luminara Starter is 2,500 Stars for 30 days." */
export function planPriceLine(plan: PlanPrice): string {
  return `${plan.title} is ${groupThousands(plan.stars)} Stars for ${plan.days} ${plan.days === 1 ? 'day' : 'days'}.`;
}

/** The block that stands in for anything the model says about plans, prices or offers. */
export function planFactsBlock(plans: PlanPriceTable): string {
  return [...Object.values(plans).map(planPriceLine), PLAN_BLOCK_FOOTER].join('\n');
}

/** The plan facts for the system prompt. Call it with the live plan table on every turn. */
export function planPricePromptBlock(plans: PlanPriceTable): string {
  if (Object.keys(plans).length === 0) return '';
  return (
    '\n\nPlan facts (from the live plan table):\n' +
    `${planFactsBlock(plans)}\n` +
    'Do not state prices, plan limits or offers yourself. When the user asks about plans, price, payment, refunds, trials or discounts, say: send /plan.'
  );
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type PlanNames = { phrases: RegExp[]; words: Array<{ word: string; re: RegExp }> };

/**
 * The names a reply can use for a plan, taken from the plan titles: "Luminara Pro / Agency"
 * gives the words "Pro" and "Agency", and a title of several words is matched as a phrase.
 */
function planNames(plans: PlanPriceTable): PlanNames {
  const names: PlanNames = { phrases: [], words: [] };
  for (const plan of Object.values(plans)) {
    for (const name of plan.title.replace(/^Luminara\s+/i, '').split('/').map((n) => n.trim()).filter(Boolean)) {
      if (name.includes(' ')) {
        const src = name.split(/\s+/).map(escapeRegExp).join(String.raw`[\s-]+`);
        names.phrases.push(new RegExp(String.raw`\b${src}\b`, 'i'));
      } else {
        names.words.push({ word: name, re: new RegExp(String.raw`\b${escapeRegExp(name)}\b`, 'gi') });
      }
    }
  }
  return names;
}

// "Starter plan", "the growth tier".
const PLAN_WORD_AFTER_RE = /^\s+(?:plans?|tiers?|subscriptions?|packages?|memberships?)\b/i;
// A plan name that is also an everyday word is not a plan in these phrases:
// "pro tip", "starter content", "growth in traffic", "agency clients", "organic growth".
const ORDINARY_AFTER: Record<string, RegExp> = {
  pro: /^[\s-]*(?:tips?|moves?|level|grade|bono|advice|writers?|designers?)\b/i,
  starter: /^[\s-]*(?:content|kits?|packs?|templates?|guides?|pages?|posts?|questions?|projects?|sets?|ideas?|lists?|prompts?|topics?|sites?)\b/i,
  growth: /^[\s-]*(?:in|of|from|rates?|hacking|hacks?|marketing|teams?|loops?|strateg(?:y|ies)|stages?|curves?|engines?|channels?|levers?|goals?|targets?|over|through|tips?|ideas?)\b/i,
  agency: /^[\s-]*(?:owners?|teams?|clients?|retainers?|work|life|models?|partners?|side|fees|rates|staff|world|folks|people|leads?)\b/i,
};
// "organic growth", "a marketing agency", "Perplexity Pro".
const ORDINARY_BEFORE: Record<string, RegExp> = {
  pro: /\b(?:a|an|like\s+a|ChatGPT|Perplexity|Gemini|Claude|Copilot|Grok|Google|Bing|GPT|Semrush|Ahrefs|Moz|Canva|Notion|Yoast|Surfer|Jasper|LinkedIn|YouTube|iPhone|MacBook|iPad|Midjourney|Grammarly|Zapier|Shopify|WordPress|Wix|Squarespace)\s+$/i,
  starter: /\b(?:a|an)\s+$/i,
  growth: /\b(?:organic|revenue|traffic|business|sustainable|steady|fast|faster|rapid|slow|future|long[- ]term|audience|sales|user|customer|brand|market|economic|compound|real|more|their|his|her|its|your|our|my)\s+$/i,
  agency: /\b(?:a|an|your|their|my|our|marketing|seo|pr|creative|digital|ad|advertising|design|own|another|any)\s+$/i,
};
// At the start of a sentence a capital proves nothing, so the word needs company: a plan-like
// verb, mark or number right after it ("Starter is ...", "Starter: ...", "Starter | 1,000"),
// or a weaker link ("Starter for ...") beside a number or a price word. "Growth" starts many
// ordinary sentences, so it also needs a number, a price word or a plan feature after it.
const NEEDS_VERB_AND_CUE_AT_START = new Set(['growth']);
const NEEDS_VERB_AT_START = new Set(['starter', 'pro', 'agency']);
const PLAN_VERB_AFTER_RE =
  /^(?:\s*[:(/&|=-]|\s+[#$€£]?\d|\s+(?:is|are|was|costs?|cuesta|includes|covers|comes\s+with|unlocks|adds|gives|lets|has|gets\s+you|offers|runs|starts|suits|fits)\b)/i;
const PLAN_LINK_AFTER_RE = /^\s+(?:for|at|with|on)\b/i;
const PLAN_FEATURE_RE = /\b(?:sites?|domains?|workspaces?|re-?audits?|audits?|sentinel|api\s+access|white[- ]label|share\s+links?)\b/i;

// Words of buying, paying and offers. Used as a cue beside a plan name, never alone.
const COMMERCE_RE = new RegExp(
  [
    String.raw`\b(?:price[sd]?|pricing|costs?|fees?|charges?|charged|discount(?:s|ed)?|coupons?|promo(?:tion)?s?|free|trials?|refund(?:s|able|ed)?|money[- ]back|guarantee[sd]?|(?:auto[- ]?)?renew(?:s|al|als|ing|ed)?|subscri(?:be|bed|bes|bing|ption|ptions)|billing|billed|invoices?|payments?|pay(?:s|ing)?\s+(?:for|with|in|by|via|using)|checkout|buy(?:s|ing)?|purchas(?:e|es|ed|ing)|upgrad(?:e|es|ed|ing)|downgrad(?:e|es|ed|ing)|cancel(?:s|led|ed|ling|ing|lation)?|cheap(?:er|est)?|expensive|afford(?:able)?|credit\s+card|debit\s+card|by\s+card|crypto|usdt|usdc|bitcoin|bucks|dollars?|euros?|usd|eur|gbp)\b`,
    String.raw`[$€£]\s?\d`,
    String.raw`\b\d+\s?(?:%|percent)\s+(?:off|discount)\b`,
  ].join('|'),
  'i',
);
const TON_RE = /\bTON\b/;
const isCommerce = (s: string): boolean => COMMERCE_RE.test(s) || TON_RE.test(s);

const STARS_WORD_RE = /\bStars\b|⭐|\bXTR\b/;
// "500 Stars", "⭐1500", "25 XTR". Lower-case "500 stars" counts too, but not a rating:
// "5-star reviews", "5 star reviews" and "4 stars" are left alone.
const CAPITAL_STARS_RE =
  /\d[\d,.]*\s*[kK]?\+?\s*(?:Telegram\s+)?(?:Stars?\b|STARS\b|XTR\b|⭐)|(?:⭐|\bXTR\b|\bStars?\b|\bSTARS\b)\s*[:=]?\s*\d/;
const LOWER_STARS_RE =
  /(\d[\d,.]*)\s*[kK]?\+?\s+(telegram\s+)?stars?\b(?!\s+(?:reviews?|ratings?|rated|average|hotels?|schema|out\s+of|on\s+(?:google|g2|capterra|trustpilot|yelp|amazon)))/;
// The sentence after a plan sentence that goes on about "it".
const FOLLOW_UP_RE =
  /^(?:(?:and|but|also|so|then|plus)\s+)?(?:it|it['’]s|its|they|they['’]re|both|each|either|(?:that|this)\s+(?:plan|tier|one)|the\s+(?:price|cost|fee|plan|tier|subscription))\b/i;

// "content plan" and "plan your week" are not our plans.
const ORDINARY_PLAN_RE =
  /\b(?:content|action|marketing|growth|editorial|project|launch|business|seo|media|posting|publishing|outreach|pr|link[- ]building|testing|test|game|meal|lesson|study|site|migration|rollout|backup|recovery|\d+[- ](?:day|week|month|step)|weekly|quarterly|step[- ]by[- ]step)\s+plans?\b/gi;
const PLAN_AS_VERB_RE =
  /(?:^|[.!?:]\s+|\b(?:to|and|then|should|could|can|will|would|must|i|we|you|let['’]?s|please)\s+)plan\s+(?:to|on|for|your|a|an|the|out|ahead|each|every|this|next|\d)/gi;
const ORDINARY_TIER_RE = /\b[\w-]+-tier\b|\btier[- ]?\d\b|\btier\s+(?:one|two|three)\b/gi;
const withoutOrdinaryPlans = (s: string): string =>
  s.replace(ORDINARY_PLAN_RE, ' ').replace(PLAN_AS_VERB_RE, ' ').replace(ORDINARY_TIER_RE, ' ');
const mentionsPlanWord = (s: string): boolean => /\b(?:plans?|tiers?)\b/i.test(withoutOrdinaryPlans(s));

function mentionsStarsPrice(s: string): boolean {
  if (CAPITAL_STARS_RE.test(s)) return true;
  const m = LOWER_STARS_RE.exec(s);
  return m !== null && (Boolean(m[2]) || Number(m[1].replace(/,/g, '')) > 5);
}

const hasPriceCue = (s: string): boolean => /\d/.test(s) || isCommerce(s) || STARS_WORD_RE.test(s);
const hasPlanCue = (s: string): boolean => hasPriceCue(s) || PLAN_FEATURE_RE.test(s) || mentionsPlanWord(s);

/** True when the sentence names one of our plans, as opposed to using the same everyday word. */
function namesPlan(s: string, names: PlanNames): boolean {
  if (names.phrases.some((re) => re.test(s))) return true;
  for (const { word, re } of names.words) {
    for (const m of s.matchAll(re)) {
      const at = m.index ?? 0;
      const before = s.slice(0, at);
      const after = s.slice(at + m[0].length);
      // As in the title ("Growth"), or shouted ("GROWTH").
      const asTitled = m[0] === word || m[0] === word.toUpperCase();
      if (PLAN_WORD_AFTER_RE.test(after)) {
        // "the Growth plan" is ours. "a growth plan" is ours only beside a price.
        if (asTitled || hasPriceCue(s)) return true;
        continue;
      }
      if (!asTitled) continue;
      if (/\bLuminara\s+$/i.test(before)) return true;
      const key = word.toLowerCase();
      if (ORDINARY_AFTER[key]?.test(after) || ORDINARY_BEFORE[key]?.test(before)) continue;
      const midSentence = /[A-Za-z0-9]/.test(before);
      if (midSentence) return true;
      const verb = PLAN_VERB_AFTER_RE.test(after);
      const link = PLAN_LINK_AFTER_RE.test(after);
      if (NEEDS_VERB_AND_CUE_AT_START.has(key)) {
        if ((verb || link) && hasPlanCue(after)) return true;
      } else if (NEEDS_VERB_AT_START.has(key)) {
        const standsAlone = !/[A-Za-z0-9]/.test(after);
        if (verb || standsAlone || (link && hasPriceCue(after))) return true;
      } else {
        return true;
      }
    }
  }
  return false;
}

// A price word within a few words of Luminara, the bot, a subscription or one of our plans:
// "Luminara is free for the first audit", "plans start at 29 dollars".
const PRICE_WORD = String.raw`(?:price[sd]?|prices|pricing|costs?|fees?|charge[sd]?|cheap(?:er|est)?|expensive|free|[$€£]\s?\d[\d,.]*|\d[\d,.]*\s?(?:dollars?|bucks|usd|eur|euros?|gbp|usdt))`;
const OUR_ANCHOR = String.raw`(?:luminara|(?:the|this|our)\s+bot|subscriptions?|membership|(?:the|our|your|this|that|each|every|any|which|paid|premium|monthly|yearly|annual|cheapest|cheaper|current|higher|lower|basic|top|all)\s+(?:plans?|tiers?)|plans?\s+(?:start|cost|are\s+priced))`;
const FEW_WORDS = String.raw`(?:[^\w.!?]+[\w'’-]+){0,4}?[^\w.!?]+`;
const PRICE_NEAR_OURS_RE = new RegExp(
  String.raw`(?<![\w])${PRICE_WORD}${FEW_WORDS}${OUR_ANCHOR}\b|\b${OUR_ANCHOR}${FEW_WORDS}${PRICE_WORD}(?![A-Za-z])`,
  'i',
);
// "the free plan", "a paid tier".
const FREE_OR_PAID_PLAN_RE = /\b(?:free|paid|premium)\s+(?:plans?|tiers?|version)\b/i;
// "We accept TON and USDT", "we charge monthly".
const WE_SELL_RE =
  /\bwe\s+(?:accept|take)\s+(?:[\w-]+\s+){0,2}?(?:ton|usdt|usdc|crypto|bitcoin|cards?|credit\s+cards?|paypal|payments?|stars|dollars)\b|\bwe\s+(?:charge|bill|refund)\b|\bwe\s+offer\s+(?:[\w-]+\s+){0,2}?(?:discounts?|refunds?|trials?|plans?|free)\b/i;

/** True when the sentence is about Luminara's own plans or prices. */
function isAboutOurPlans(s: string, names: PlanNames): boolean {
  if (namesPlan(s, names) || mentionsStarsPrice(s)) return true;
  const rest = withoutOrdinaryPlans(s);
  return PRICE_NEAR_OURS_RE.test(rest) || FREE_OR_PAID_PLAN_RE.test(rest) || WE_SELL_RE.test(s);
}

// An offer with nothing that ties it to us: "It renews automatically.", "No refunds after 7 days."
// It counts when it speaks of "it", "you", "we" or the plan, and names no third party.
const OFFER_RE =
  /\b(?:auto[- ]?)?renew(?:s|al|als|ing|ed)?\b|\brefund(?:s|able|ed)?\b|\bmoney[- ]back\b|\b(?:free\s+trial|trial\s+(?:period|ends?|lasts?)|\d+[- ]day\s+(?:free\s+)?trial|trials?)\b|\bdiscount(?:s|ed)?\b|\b\d+\s?(?:%|percent)\s+off\b|\b(?:charged|no\s+charge|extra\s+charge|charges?\s+appl(?:y|ies))\b|\b(?:money[- ]back|satisfaction|\d+[- ]day)\s+guarantee\b|\bcancel\s+any\s?time\b|\bfirst\s+(?:month|week|year)\s+(?:is\s+)?free\b/i;
const OFFER_SUBJECT_RE =
  /^(?:(?:yes|no|sure|and|but|also)[,.]?\s+)?(?:it|it['’]s|there(?:['’]s|\s+is|\s+are)|you(?:['’]ll)?|we|payments?|billing|refunds?|renewal|cancell?ation|the\s+(?:first|trial|price|plans?|subscription|charge|fee|refund|renewal)|(?:your|our)\s+(?:plans?|subscription|membership|trial|payment|card|refunds?)|all\s+plans|every\s+plan|each\s+plan|plans|no)\b/i;
const THIRD_PARTY_RE = new RegExp(
  [
    String.raw`\b(?:Google|OpenAI|ChatGPT|Perplexity|Gemini|Microsoft|Bing|Apple|Amazon|Meta|Facebook|Instagram|LinkedIn|YouTube|TikTok|Reddit|Stripe|PayPal|Shopify|WordPress|Wix|Squarespace|Semrush|Ahrefs|Moz|Yoast|HubSpot|Mailchimp|Zapier|Notion|Canva|G2|Capterra|Trustpilot|GoDaddy|Namecheap|Cloudflare|Netflix|Spotify)\b`,
    String.raw`\b(?:your|their|his|her)\s+(?:customers?|buyers?|clients?|users?|visitors?|audience|shoppers?|subscribers?|members?|readers?|products?|pricing|prices?|store|shop|saas|offers?|checkout|pages?|site|website|domain|hosting|brand|company|business|competitors?)\b`,
    String.raw`\b(?:customers?|buyers?|shoppers?|clients?|competitors?|vendors?|tools?|providers?|platforms?|companies|brands?|stores?)\b`,
  ].join('|'),
  'i',
);
// "You could offer a discount" is advice about the user's own business.
const OFFER_ADVICE_RE =
  /^you\s+(?:should|could|can|might|may|need\s+to|want\s+to)\s+(?:also\s+)?(?:offer|add|give|run|show|promote|test|use|include|mention|highlight|create|make|set\s+up|build|try)\b/i;
const isUncuedOffer = (s: string): boolean =>
  OFFER_RE.test(s) && OFFER_SUBJECT_RE.test(s.trim()) && !OFFER_ADVICE_RE.test(s.trim()) && !THIRD_PARTY_RE.test(s);

// ---------------------------------------------------------------------------------------
// Plan questions: answered from the plan table, never by the model.
// ---------------------------------------------------------------------------------------

/** The handful of plan and payment words read in other languages. */
export const PLAN_QUESTION_WORDS: Record<string, readonly string[]> = {
  es: ['precio', 'precios', 'cuánto cuesta', 'cuanto cuesta', 'cuánto vale', 'costo', 'coste', 'pagar', 'pago', 'comprar', 'suscripción', 'suscripcion', 'renovar', 'renovación', 'se renueva', 'reembolso', 'prueba gratis', 'descuento', 'gratis', 'estrellas', 'planes'],
  pt: ['preço', 'preços', 'quanto custa', 'custo', 'pagamento', 'assinatura', 'assinar', 'renovação', 'teste grátis', 'desconto', 'grátis', 'gratuito', 'estrelas', 'planos'],
  ru: ['цена', 'цены', 'цену', 'сколько стоит', 'стоимость', 'оплата', 'оплатить', 'заплатить', 'купить', 'подписка', 'подписку', 'подписки', 'продление', 'продлить', 'продлевается', 'возврат', 'пробный', 'пробная', 'скидка', 'скидки', 'скидку', 'бесплатно', 'бесплатный', 'тариф', 'тарифы', 'тарифа', 'звёзд', 'звезд', 'звёзды', 'звезды'],
  fr: ['prix', 'combien coûte', 'combien coute', 'combien ça coûte', 'coût', 'tarif', 'tarifs', 'payer', 'paiement', 'acheter', 'abonnement', 'renouveler', 'renouvellement', 'remboursement', 'essai gratuit', 'réduction', 'remise', 'gratuit', 'étoiles', 'forfait'],
  de: ['preis', 'preise', 'was kostet', 'wie viel kostet', 'wieviel kostet', 'kosten', 'kostet', 'bezahlen', 'zahlung', 'kaufen', 'abo', 'abonnement', 'abonnieren', 'verlängern', 'verlängerung', 'rückerstattung', 'erstattung', 'testphase', 'probezeit', 'rabatt', 'kostenlos', 'sterne'],
};
// These words carry accents and Cyrillic, where \b does not work, so the edges are tested as
// "no letter or digit on either side".
const FOREIGN_PLAN_WORD_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${Object.values(PLAN_QUESTION_WORDS)
    .flat()
    .map((w) => w.split(' ').map(escapeRegExp).join(String.raw`\s+`))
    .join('|')})(?![\p{L}\p{N}])`,
  'iu',
);

// Words that are about buying from us wherever they stand in a question. Each has its
// everyday use fenced off: "buy backlinks", "subscribe to my newsletter", "renew my domain".
const PLAN_QUESTION_WORD_RE = new RegExp(
  [
    String.raw`\btelegram\s+stars\b|\bhow\s+many\s+stars\b|\b(?:in|with|for|using)\s+stars\b|\bstars\s*\?|\bxtr\b|⭐`,
    String.raw`\bsubscri(?:be|bed|bing|ption|ptions)\b(?!\s+to\s+(?:my|our|a|an|the|their|your)\s+(?:newsletter|list|blog|channel|feed|podcast|emails?))`,
    String.raw`\bunsubscribe\b|\bdowngrad(?:e|es|ed|ing)\b`,
    String.raw`\bupgrad(?:e|es|ed|ing)\b(?!\s+(?:my|our|the|your)\s+(?:site|website|content|schema|pages?|hosting|theme|cms))`,
    String.raw`\b(?:auto[- ]?)?renew(?:s|al|als|ing|ed)?\b(?!\s+(?:my|our|the|your|a)\s+(?:domain|ssl|certificate|hosting))`,
    String.raw`\brefund(?:s|able|ed)?\b|\bmoney[- ]back\b`,
    String.raw`\btrials?\b(?!\s+and\s+error)`,
    String.raw`\bdiscount(?:s|ed)?\b|\bcoupons?\b|\bpromo\s*codes?\b`,
    String.raw`\bbilling\b|\bbilled\b|\binvoices?\b|\breceipts?\b|\bpaywall\b`,
    String.raw`\bcancel(?:s|led|ed|ling|ing|lation)?\b`,
    String.raw`\bpay(?:ing|ment|ments)?\b(?!\s+(?:attention|off)\b|\s+for\s+(?:ads?|links?|backlinks?|reviews?|traffic|tools?|content|seo|a\s+writer|an?\s+agency)\b)`,
    String.raw`\bbuy(?:ing)?\b(?!\s+(?:ads?|links?|backlinks?|reviews?|traffic|followers|domains?|an?\s+(?:aged\s+)?domain|media|citations?|mentions?)\b)`,
    String.raw`\bpurchas(?:e|ed|ing)\b`,
    String.raw`\bexpir(?:e|es|ed|y|ation)\b`,
    String.raw`\bwhat\s+happens\s+(?:after\s+(?:\d+|the|it|that|my)\b|when\s+(?:it|my|the)\s+(?:plan\s+|trial\s+|subscription\s+)?(?:ends?|expires?|runs?\s+out|is\s+over))`,
    String.raw`\b(?:paid|premium)\s+(?:plans?|tiers?|version|features?)\b|\bgo\s+premium\b`,
  ].join('|'),
  'i',
);
// "How much is it?" but not "how much traffic".
const HOW_MUCH_RE =
  /\bhow\s+much\b(?=\s*(?:\?|$|is\b|are\b|does\b|do\b|did\b|for\b|would\b|will\b|per\b|a\b|an\b|it\b|this\b|that\b|money\b|you\b|i\b|we\b|to\s+(?:pay|buy|subscribe|upgrade|get|use|start|join)\b))/i;
const PRICE_QUESTION_RE = /\b(?:price[sd]?|prices|pricing|costs?|fees?|charge[sd]?|cheap(?:er|est)?|expensive|afford(?:able)?)\b/i;
const FREE_QUESTION_RE =
  /\bfor\s+free\b|\bfree\s+(?:plan|tier|version|trial|audits?|to\s+use|or\s+paid|forever|credits?|queries|limit)\b|\b(?:is|are|was)\s+(?:it|this|that|you|luminara|the\s+(?:bot|app|audit))\s+(?:really\s+)?free\b|\bfree\s*\?/i;
// What the price word must be about: us, or nothing else in particular.
const OURS_QUESTION_RE = /\b(?:plans?|tiers?|subscriptions?|membership|luminara|bot|app|suite|this|it|you|your|yours|here)\b/i;
const EXPLICIT_OURS_RE = /\b(?:luminara|subscriptions?|membership|stars|xtr)\b|\b(?:the|this|your)\s+(?:bot|app|suite|plans?|tiers?)\b/i;
// "How much does it cost to rank?" is about ranking, "how much does it cost to subscribe?" is about us.
const GENERIC_COST_RE =
  /\b(?:costs?|prices?|priced|expensive|cheap(?:er)?|charge[sd]?)\s+(?:to|of|for)\s+(?!use\b|get\s+(?:it|this|started)\b|buy\b|subscribe\b|upgrade\b|start\b|try\b|join\b|unlock\b|run\b|audit\b|this\b|it\b|that\b|the\s+(?:bot|app|plan|subscription)\b|luminara\b|your\b|a\s+(?:plan|subscription)\b)/i;
// The user's own business, not ours: "should I offer my customers a discount?"
const THEIR_BUSINESS_RE =
  /\b(?:my|our)\s+(?:customers?|buyers?|clients?|users?|subscribers?|members?|products?|pricing|prices?|store|shop|saas|offers?|checkout|plans?\s+page|newsletter)\b/i;
const OUR_PLAN_WORD_QUESTION_RE =
  /\b(?:your|which|any|paid|free|cheapest|cheaper|monthly|yearly|annual|current|my|available)\s+(?:\w+\s+)?(?:plans?|tiers?)\b|\bwhat\s+plans\b|\bplans?\s+(?:do\s+you|are\s+there|cost|costs|prices?|pricing|options?|comparison|start|available)\b|^\W*(?:plans?|tiers?|pricing|prices?)\W*$/i;
// What may stand beside "pro", "growth" or "agency" for the word to mean a plan in a question.
const PLAN_COMPANION_RE =
  /\bhow\s+much\b|\b(?:price[sd]?|prices|pricing|costs?|plans?|tiers?|vs\.?|versus|difference|between|compare|comparison|which|include[sd]?|limits?|features?|upgrade|downgrade|switch|choose|pick|worth)\b/i;
// A short follow-up to the plan block ("and the cheapest?"), not a new subject and not "thanks".
const SITE_TOPIC_RE = /\b(?:site|website|pages?|schema|visibility|rank\w*|citations?|traffic|seo|aeo|geo|content|backlinks?|domain|keywords?|blog|faq)\b/i;
const ACKNOWLEDGEMENT_RE =
  /^\W*(?:ok(?:ay)?|k|thanks?|thank\s+you|thx|ty|cool|great|nice|got\s+it|fine|good|perfect|yes|yep|yeah|no|nope|bye|hi|hello|hey|sure|alright|understood)\W*$/i;

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/** A plan name typed any way: "starter", "is growth worth it", "pro vs agency". */
function namesPlanLoosely(text: string, names: PlanNames): boolean {
  for (const { word, re } of names.words) {
    const key = word.toLowerCase();
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      const before = text.slice(0, at);
      const after = text.slice(at + m[0].length);
      if (ORDINARY_AFTER[key]?.test(after) || ORDINARY_BEFORE[key]?.test(before)) continue;
      const everydayWord = NEEDS_VERB_AND_CUE_AT_START.has(key) || key === 'pro' || key === 'agency';
      if (!everydayWord || PLAN_COMPANION_RE.test(before + after) || wordCount(text) <= 3) return true;
    }
  }
  return false;
}

/**
 * True when the user's message is about Luminara's own plans, prices, payment, billing,
 * refunds, renewal, trials, discounts or upgrading. Such a message is answered with
 * planFactsBlock() and the model is not called.
 *
 * `previousAssistantText` is the last reply in the chat: after the plan block, a short
 * follow-up ("and the cheapest?") is a plan question too.
 */
export function isPlanQuestion(userText: string, plans: PlanPriceTable, previousAssistantText = ''): boolean {
  const text = wordsForPlanRules(String(userText || ''));
  if (!text.trim()) return false;
  const names = planNames(plans);
  if (namesPlan(text, names) || namesPlanLoosely(text, names) || mentionsStarsPrice(text)) return true;
  if (FOREIGN_PLAN_WORD_RE.test(text)) return true;
  const aboutTheirBusiness = THEIR_BUSINESS_RE.test(text) && !EXPLICIT_OURS_RE.test(text);
  if (!aboutTheirBusiness) {
    if (PLAN_QUESTION_WORD_RE.test(text) || OUR_PLAN_WORD_QUESTION_RE.test(withoutOrdinaryPlans(text))) return true;
    const short = wordCount(text) <= 5;
    const price = HOW_MUCH_RE.test(text) || PRICE_QUESTION_RE.test(text);
    const generic = GENERIC_COST_RE.test(text) && !EXPLICIT_OURS_RE.test(text);
    if (price && !generic && (OURS_QUESTION_RE.test(text) || short)) return true;
    if (FREE_QUESTION_RE.test(text) && (OURS_QUESTION_RE.test(text) || short)) return true;
  }
  return (
    previousAssistantText.trimEnd().endsWith(PLAN_BLOCK_FOOTER) &&
    wordCount(text) <= 6 &&
    !SITE_TOPIC_RE.test(text) &&
    !ACKNOWLEDGEMENT_RE.test(text)
  );
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
    .replace(WHOLLY_RE, ' ');
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

/** A run of the reply: prose to read, or data (JSON, markup, robots.txt) to paste. */
type Segment = { data: boolean; text: string };

const CLOSED_FENCE_RE = /```[^\n`]*\n([\s\S]*?)```/g;
const MARKUP_LINE_RE = /^\s*<[A-Za-z!?/][^\n]*>\s*$/;
const SCRIPT_OPEN_RE = /^\s*<script\b/i;
const SCRIPT_CLOSE_RE = /<\/script>/i;
const ROBOTS_LINE_RE = /^\s*(?:user-agent|allow|disallow|sitemap|crawl-delay|host)\s*:/i;
const URL_LINE_RE = /^\s*https?:\/\/\S+\s*$/i;
const MAX_DATA_LINES = 400;

function isJson(text: string): boolean {
  const trimmed = text.trim();
  if (!/^[{[]/.test(trimmed)) return false;
  try {
    const value: unknown = JSON.parse(trimmed);
    return typeof value === 'object' && value !== null;
  } catch {
    return false;
  }
}

function isRobotsOrSitemap(text: string): boolean {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const content = lines.filter((line) => !line.startsWith('#'));
  return content.length > 0 && content.every((line) => ROBOTS_LINE_RE.test(line) || URL_LINE_RE.test(line));
}

/** What a closed fence must hold to be data: JSON that parses, markup, or a robots.txt or sitemap. */
function isData(text: string): boolean {
  const trimmed = text.trim();
  return /^<[A-Za-z!?/][\s\S]*>$/.test(trimmed) || isJson(trimmed) || isRobotsOrSitemap(trimmed);
}

/** How many lines from `at` form data outside a fence: a script element, JSON, markup, robots.txt. */
function dataRunLength(lines: string[], at: number): number {
  const limit = Math.min(lines.length, at + MAX_DATA_LINES);
  if (SCRIPT_OPEN_RE.test(lines[at])) {
    for (let j = at; j < limit; j += 1) if (SCRIPT_CLOSE_RE.test(lines[j])) return j - at + 1;
    return 0;
  }
  if (/^\s*[{[]/.test(lines[at])) {
    let text = '';
    for (let j = at; j < limit; j += 1) {
      text += lines[j];
      if (/[}\]],?\s*$/.test(lines[j]) && isJson(text.replace(/,\s*$/, ''))) return j - at + 1;
    }
  }
  if (MARKUP_LINE_RE.test(lines[at])) {
    let j = at;
    while (j < limit && MARKUP_LINE_RE.test(lines[j])) j += 1;
    return j - at;
  }
  if (ROBOTS_LINE_RE.test(lines[at])) {
    let j = at;
    while (j < limit && ROBOTS_LINE_RE.test(lines[j])) j += 1;
    return j - at >= 2 ? j - at : 0;
  }
  return 0;
}

function splitUnfenced(text: string, segments: Segment[]): void {
  const lines = text.split(/(?<=\n)/).filter((line) => line !== '');
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
 * The reply as runs of prose and of data. A fence is data only when it closes and holds
 * JSON, markup or a robots.txt; any other fenced text, and everything after an unclosed
 * fence, is prose.
 */
function splitData(reply: string): Segment[] {
  const segments: Segment[] = [];
  let at = 0;
  for (const m of reply.matchAll(CLOSED_FENCE_RE)) {
    const start = m.index ?? 0;
    splitUnfenced(reply.slice(at, start), segments);
    if (isData(m[1])) segments.push({ data: true, text: m[0] });
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
  /** How many sentences about our plans, prices or offers gave way to the plan block. */
  planSentences: number;
  /** How many links were spelled out because their host is not an allowed one. */
  linksRemoved: number;
  /** How many sentences were removed because they asked for a code, password or key. */
  secretRequests: number;
};

// This chat has no measurement to cite, so a claim found here has no source.
const NO_SOURCES: ClaimSource[] = [];
// The words of a sentence as the plan rules read them: no emphasis or code marks, no links (a
// link such as acme.io/pricing says nothing about our prices), and "pricing page" is a page.
const PRICING_PAGE_RE = /\bpric(?:e|ing)\s+(?:pages?|tables?|sections?|blocks?|schema|copy)\b/gi;
const stripEmphasis = (s: string): string => s.replace(/[*_`~]+/g, '');
const wordsForPlanRules = (s: string): string =>
  stripEmphasis(s).replace(LINK_OR_HOST_RE, ' ').replace(PRICING_PAGE_RE, ' ');

/** True when a block of data names one of our plans beside a number, or gives a number of Stars. */
function dataNamesOurPlans(text: string, names: PlanNames): boolean {
  if (mentionsStarsPrice(text) || names.phrases.some((re) => re.test(text))) return true;
  return names.words.some(({ word }) => {
    const name = escapeRegExp(word);
    return new RegExp(String.raw`\b${name}\b["'\s:=|,-]{0,6}\d|\d["'\s:=|,-]{0,6}\b${name}\b`, 'i').test(text);
  });
}

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
  const blockSentences = new Set(block.split('\n').flatMap(splitSentences).map((s) => s.trim()));
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
  let blockAt = -1;
  let planSentences = 0;
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
    if (out.length > 0 && blockAt !== out.length - 1) out[out.length - 1] = out[out.length - 1].trimEnd() + trail;
  };
  // The first sentence about our plans marks where the block goes; the rest are dropped.
  const giveWayToBlock = (trail: string): void => {
    planSentences += 1;
    if (blockAt === -1) {
      blockAt = out.length;
      out.push(trail);
    } else {
      dropPiece(trail);
    }
  };

  for (const segment of splitData(String(reply || ''))) {
    if (segment.data) {
      // Data is not read for measurements. The plan and link rules still apply to it.
      if (dataNamesOurPlans(wordsForPlanRules(segment.text), names)) giveWayToBlock(/\s*$/.exec(segment.text)?.[0] ?? '');
      else out.push(spellOutForeignLinks(segment.text, SCHEME_LINK_RE));
      continue;
    }
    let previousWasPlan = false;
    let previousWasUnmeasured = false;
    for (const piece of splitSentences(segment.text)) {
      const lead = LIST_MARKER_RE.exec(piece)?.[0] ?? '';
      const body = piece.slice(lead.length).trimEnd();
      const trail = piece.slice(lead.length + body.length);
      const plain = wordsForPlanRules(body);

      if (body !== '' && ASKS_FOR_SECRET_RE.test(stripEmphasis(body))) {
        secretRequests += 1;
        dropPiece(trail);
        continue;
      }

      const aboutPlans =
        body !== '' &&
        (blockSentences.has(stripEmphasis(body).trim()) ||
          isAboutOurPlans(plain, names) ||
          isUncuedOffer(plain) ||
          (previousWasPlan && FOLLOW_UP_RE.test(plain)));
      if (aboutPlans) {
        if (blockAt === -1) previousWasUnmeasured = false;
        giveWayToBlock(trail);
        previousWasPlan = true;
        continue;
      }
      previousWasPlan = false;

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
      out.push(spellOutForeignLinks(piece, LINK_RE));
    }
  }

  let text = out.join('');
  if (blockAt !== -1) {
    const before = out.slice(0, blockAt).join('').trimEnd();
    const after = out.slice(blockAt).join('').trim();
    text = [before, block, after].filter(Boolean).join('\n\n');
  }
  return { text, claims: ledger.list(), planSentences, linksRemoved, secretRequests };
}
