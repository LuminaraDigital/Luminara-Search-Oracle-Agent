/**
 * Free robots.txt generator with a switch per AI crawler.
 * The crawler list is the one the audit checks (LLM_CRAWLER_BOTS), plus the common
 * training-only crawlers, so a generated file reads the same way in our own audit.
 */
import { LLM_CRAWLER_BOTS } from '../audit/llmCrawlerReadiness';
import { toHttpUrl } from './httpUrl';

export type BotPurpose = 'search' | 'user' | 'training';

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
  'Google-Extended': { operator: 'Google', purpose: 'training' },
  'Applebot-Extended': { operator: 'Apple', purpose: 'training' },
};

const TRAINING_ONLY_BOTS: AiBot[] = [
  { agent: 'CCBot', operator: 'Common Crawl', purpose: 'training' },
  { agent: 'Meta-ExternalAgent', operator: 'Meta', purpose: 'training' },
  { agent: 'Bytespider', operator: 'ByteDance', purpose: 'training' },
];

export const AI_BOTS: readonly AiBot[] = [
  ...LLM_CRAWLER_BOTS.map((agent) => ({ agent, ...AUDITED_BOTS[agent] })),
  ...TRAINING_ONLY_BOTS,
];

export const BOT_PURPOSE_LABEL: Record<BotPurpose, string> = {
  search: 'Answer search',
  user: 'Fetches a page a user asked about',
  training: 'Model training',
};

export type RobotsPreset = 'allow_all' | 'answers_not_training' | 'block_all_ai';

export const ROBOTS_PRESETS: ReadonlyArray<{ id: RobotsPreset; label: string; note: string }> = [
  { id: 'allow_all', label: 'Allow every AI crawler', note: 'Best chance to be cited and trained on.' },
  {
    id: 'answers_not_training',
    label: 'Answers yes, training no',
    note: 'AI search can cite you. Training crawlers are blocked.',
  },
  { id: 'block_all_ai', label: 'Block every AI crawler', note: 'AI answers can no longer read your pages.' },
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

export interface RobotsOptions {
  /** Agent name to true when that crawler is blocked from the whole site. */
  blocked: Record<string, boolean>;
  /** Paths every crawler should skip, such as /admin/. */
  disallowPaths: string[];
  sitemapUrl: string;
}

function cleanPath(raw: string): string | null {
  const path = raw.trim();
  if (!path || /\s/.test(path)) return null;
  return path.startsWith('/') ? path : `/${path}`;
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
