/**
 * Shape of /learn. Article bodies live beside this file. pageMeta, the React view,
 * the sitemap, and llms.txt all read the finished objects from learnPages.ts.
 */
import type { MarketingFaqItem } from '../marketingFaqContent';

export const LEARN_PATH = '/learn';

export const LEARN_PATHS = {
  aeo: '/learn/what-is-aeo',
  how: '/learn/how-ai-recommends-an-agency',
  llms: '/learn/llms-txt-for-real-estate',
  robots: '/learn/robots-txt-and-ai-crawlers',
  schema: '/learn/real-estate-agent-schema',
  suburb: '/learn/suburb-pages',
  check: '/learn/check-if-ai-names-your-agency',
  claim: '/learn/claim-your-agency-in-chatgpt',
  mcp: '/learn/mcp-for-marketing-data',
} as const;

export const LEARN_AUTHOR_NAME = 'Tunji Williams-Fulwood';
export const LEARN_AUTHOR_ORG = 'Luminara Digital';
export const LEARN_PUBLISHED = '2026-11-15';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** `2026-11-15` to `15 November 2026`. The ISO date is the schema value. */
export function formatLearnDate(iso: string): string {
  const [year, month, day] = iso.split('-').map((part) => Number(part));
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export interface LearnLink {
  label: string;
  href: string;
}

export interface LearnSection {
  heading: string;
  paragraphs: string[];
  steps?: string[];
  bullets?: string[];
  /** Example file or markup. Not counted as article words. */
  code?: string;
}

export interface LearnArticle {
  path: (typeof LEARN_PATHS)[keyof typeof LEARN_PATHS];
  label: string;
  description: string;
  h1: string;
  published: string;
  updated: string;
  sections: LearnSection[];
  faq: MarketingFaqItem[];
  sources: LearnLink[];
  related: LearnLink[];
}

export type LearnRun =
  | { kind: 'text'; text: string }
  | { kind: 'link'; label: string; href: string };

function linkPattern(): RegExp {
  return /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
}

/** Paragraphs use [label](href). No other markup. */
export function learnInline(source: string): LearnRun[] {
  const runs: LearnRun[] = [];
  let last = 0;
  for (const match of source.matchAll(linkPattern())) {
    const index = match.index ?? 0;
    if (index > last) runs.push({ kind: 'text', text: source.slice(last, index) });
    runs.push({ kind: 'link', label: match[1], href: match[2] });
    last = index + match[0].length;
  }
  if (last < source.length) runs.push({ kind: 'text', text: source.slice(last) });
  return runs;
}

function visible(source: string): string {
  return source.replace(linkPattern(), '$1');
}

/** Words a reader sees: title, sections, steps, bullets, and the FAQ. Code samples are extra. */
export function learnWordCount(article: LearnArticle): number {
  const parts = [
    article.h1,
    ...article.sections.flatMap((section) => [
      section.heading,
      ...section.paragraphs,
      ...(section.steps ?? []),
      ...(section.bullets ?? []),
    ]),
    ...article.faq.flatMap((item) => [item.question, item.answer]),
  ];
  return parts.map(visible).join(' ').split(/\s+/).filter(Boolean).length;
}
