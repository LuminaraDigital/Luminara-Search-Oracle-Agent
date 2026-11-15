/**
 * One capped live answer sample for the free check.
 * The Worker asks Tavily (web search with its own answer). The label names that
 * provider only. A single sample is not a score and not a ranking.
 */
import { classifyMention, sameSite } from './entityMatch';

export const AI_SAMPLE_PROVIDER = 'Tavily';

export const AI_SAMPLE_ANON_DAILY = 1;
export const AI_SAMPLE_FREE_DAILY = 3;
/** Tavily calls per UTC day for every caller. 0 pauses live calls. */
export const AI_SAMPLE_BUDGET_DEFAULT = 30;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export type AiSamplePrompt = {
  prompt: string;
  answer: string;
  named: boolean;
  citedDomains: string[];
};

export type AiSampleReasonCode =
  | 'paused'
  | 'budget'
  | 'no_key'
  | 'no_signal'
  | 'cap'
  | 'unavailable'
  | 'empty'
  | 'paid';

export type AiAnswerSample =
  | {
      status: 'measured';
      label: string;
      provider: typeof AI_SAMPLE_PROVIDER;
      answeredAt: string;
      named: boolean;
      citedDomains: string[];
      prompts: AiSamplePrompt[];
      nextStep: string;
    }
  | {
      status: 'not_measured';
      label: 'Not measured';
      reasonCode: AiSampleReasonCode;
      reason: string;
      nextStep: string;
    };

export function sampleBudget(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return AI_SAMPLE_BUDGET_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return AI_SAMPLE_BUDGET_DEFAULT;
  return Math.floor(parsed);
}

/** Buyer, reviews, then a seller question. At most three. Empty when the page named neither. */
export function buyerPrompts(input: { agencyName: string; suburb: string }): string[] {
  const suburb = input.suburb.trim();
  const agency = input.agencyName.trim();
  const prompts: string[] = [];
  if (suburb) prompts.push(`best real estate agent in ${suburb}`);
  if (agency) prompts.push(`${agency} reviews`);
  if (suburb && prompts.length < 3) prompts.push(`who should I use to sell my home in ${suburb}`);
  return prompts.slice(0, 3);
}

export function sampleDate(answeredAt: string): string {
  const at = new Date(answeredAt);
  if (Number.isNaN(at.getTime())) return answeredAt.slice(0, 10);
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** Tavily does not return a model id. The label names Tavily and no other product. */
export function sampleLabel(count: number, answeredAt: string): string {
  const word = count === 1 ? 'one sample' : count === 2 ? 'two samples' : 'three samples';
  return `Measured: ${word} on ${sampleDate(answeredAt)} from ${AI_SAMPLE_PROVIDER}`;
}

export function sampleNextStep(tier: 'guest' | 'free' | 'paid'): string {
  if (tier === 'paid') {
    return 'Weekly re-audit reminders start on Growth. Live answers from specific AI products stay on Agency or your own search login.';
  }
  if (tier === 'free') return 'Upgrade for weekly re-audit reminders.';
  return 'Create a free account for more daily samples. Upgrade for weekly re-audit reminders.';
}

export function answerNamesAgency(input: {
  domain: string;
  agencyName: string;
  answer: string;
  urls: readonly string[];
}): boolean {
  const entity = { domain: input.domain, brandName: input.agencyName };
  if (classifyMention(entity, { text: input.answer }) === 'same') return true;
  return input.urls.some((url) => classifyMention(entity, { url }) === 'same');
}

/** Hosts cited in the answer or the search results, excluding the audited site. At most eight. */
export function citedDomains(urls: readonly string[], auditedDomain: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    let host = '';
    try {
      host = new URL(raw).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    } catch {
      continue;
    }
    if (!host.includes('.') || sameSite(host, auditedDomain) || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
    if (out.length === 8) break;
  }
  return out;
}

export function urlsInText(text: string): string[] {
  return text.match(/https:\/\/[^\s)>\],"']+/g) || [];
}
