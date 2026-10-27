/**
 * Free robots.txt generator with a switch per AI crawler.
 * The crawler list is the one the audit checks (LLM_CRAWLER_BOTS) plus a few the audit does not.
 * The audit fails any block of a crawler on its list, training-only ones included, so the
 * "answers yes, training no" preset shows as blocked there. The preset note says so.
 */
import { LLM_CRAWLER_BOTS } from '../audit/llmCrawlerReadiness';
import { toHttpUrl } from './httpUrl';

/** `training_and_answers`: one token covers both, so "answers yes, training no" leaves it allowed. */
export type BotPurpose = 'search' | 'user' | 'training' | 'training_and_answers';

export interface AiBot {
  agent: string;
  operator: string;
  purpose: BotPurpose;
}

const AUDITED_BOTS: Record<(typeof LLM_CRAWLER_BOTS)[number], Omit<AiBot, 'agent'>> = {
  GPTBot: { operator: 'OpenAI', purpose: 'training' },
  'OAI-SearchBot': { operator: 'OpenAI', purpose: 'search' },
  'ChatGPT-User': { operator: 'OpenAI', purpose: 'user' },
  ClaudeBot: { operator: 'Anthropic', purpose: 'training' },
  'Claude-SearchBot': { operator: 'Anthropic', purpose: 'search' },
  PerplexityBot: { operator: 'Perplexity', purpose: 'search' },
  'Perplexity-User': { operator: 'Perplexity', purpose: 'user' },
  // Google: Gemini training and grounding in the Gemini app. Not Google Search.
  'Google-Extended': { operator: 'Google', purpose: 'training_and_answers' },
  'Applebot-Extended': { operator: 'Apple', purpose: 'training' },
};

/** Crawlers the audit does not check but site owners ask about. */
const EXTRA_BOTS: AiBot[] = [
  { agent: 'Claude-User', operator: 'Anthropic', purpose: 'user' },
  { agent: 'CCBot', operator: 'Common Crawl', purpose: 'training' },
  { agent: 'Meta-ExternalAgent', operator: 'Meta', purpose: 'training' },
  { agent: 'Bytespider', operator: 'ByteDance', purpose: 'training' },
];

export const AI_BOTS: readonly AiBot[] = [
  ...LLM_CRAWLER_BOTS.map((agent) => ({ agent, ...AUDITED_BOTS[agent] })),
  ...EXTRA_BOTS,
];

export const BOT_PURPOSE_LABEL: Record<BotPurpose, string> = {
  search: 'Answer search',
  user: 'Fetches a page a user asked about',
  training: 'Model training',
  training_and_answers: 'Gemini training and answers',
};

export type RobotsPreset = 'allow_all' | 'answers_not_training' | 'block_all_ai';

export const ROBOTS_PRESETS: ReadonlyArray<{ id: RobotsPreset; label: string; note: string }> = [
  { id: 'allow_all', label: 'Allow every AI crawler', note: 'Best chance to be read, cited, and trained on.' },
  {
    id: 'answers_not_training',
    label: 'Answers yes, training no',
    note: 'AI search crawlers can still read and cite you. Training crawlers are asked to stay out, and Instant Audit marks that as a failed crawler check.',
  },
  {
    id: 'block_all_ai',
    label: 'Block these AI crawlers',
    note: 'These crawlers are asked not to read your pages. Google AI Overviews use Googlebot and are not affected, and crawlers that fetch a page for a user may ignore robots.txt.',
  },
];

/** Agent name to blocked flag for a preset. */
export function presetBlocks(preset: RobotsPreset): Record<string, boolean> {
  return Object.fromEntries(
    AI_BOTS.map((bot) => [
      bot.agent,
      preset === 'block_all_ai' || (preset === 'answers_not_training' && bot.purpose === 'training'),
    ]),
  );
}

/** The preset the switches currently match, or null once a single crawler was flipped. */
export function matchingPreset(blocked: Record<string, boolean>): RobotsPreset | null {
  const match = ROBOTS_PRESETS.find((preset) => {
    const want = presetBlocks(preset.id);
    return AI_BOTS.every((bot) => Boolean(blocked[bot.agent]) === want[bot.agent]);
  });
  return match?.id ?? null;
}

export interface RobotsOptions {
  /** Agent name to true when that crawler is blocked from the whole site. */
  blocked: Record<string, boolean>;
  /** Paths every crawler should skip, such as /admin/. */
  disallowPaths: string[];
  sitemapUrl: string;
}

/**
 * A private path, or null. A pasted URL keeps only its path and query, `#` starts a robots.txt
 * comment so it is cut, and `/` or `/*` is refused: it would block the whole site for crawlers
 * the switches show as allowed.
 */
function cleanPath(raw: string): string | null {
  const value = raw.split('#')[0].trim();
  if (!value || /\s/.test(value)) return null;
  let path = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      path = `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  if (!path.startsWith('/')) path = `/${path}`;
  return path === '/' || path === '/*' ? null : path;
}

export function buildRobotsTxt(options: RobotsOptions): string {
  const paths = [...new Set(options.disallowPaths.map(cleanPath).filter((p): p is string => p !== null))];
  const openRules = paths.length ? paths.map((path) => `Disallow: ${path}`) : ['Allow: /'];
  const group = (agent: string, rules: string[], comment?: string) =>
    [...(comment ? [comment] : []), `User-agent: ${agent}`, ...rules].join('\n');

  const allowed = AI_BOTS.filter((bot) => !options.blocked[bot.agent]);
  const blocked = AI_BOTS.filter((bot) => options.blocked[bot.agent]);
  const groups = [
    group('*', openRules),
    ...allowed.map((bot, i) => group(bot.agent, openRules, i === 0 ? '# AI crawlers you allow' : undefined)),
    ...blocked.map((bot, i) => group(bot.agent, ['Disallow: /'], i === 0 ? '# AI crawlers you block' : undefined)),
  ];

  // robots.txt needs an absolute sitemap URL.
  const sitemap = toHttpUrl(options.sitemapUrl);
  if (sitemap) groups.push(`Sitemap: ${sitemap}`);
  return `${groups.join('\n\n')}\n`;
}
