/**
 * Knowledge hub (/learn and /learn/*).
 * One source for the React view, crawler HTML, JSON-LD, sitemap, and llms.txt.
 *
 * Articles cite primary docs linked on the page. They do not invent rates, studies, or clients.
 */
import { LIVE_ANSWER_CHECKS } from './engineCoverage';
import { EARLY_ARTICLES } from './learn/articlesEarly';
import { LATE_ARTICLES } from './learn/articlesLate';
import {
  LEARN_AUTHOR_NAME,
  LEARN_AUTHOR_ORG,
  LEARN_PATH,
  LEARN_PATHS,
  formatLearnDate,
  learnInline,
  learnWordCount,
  type LearnArticle,
  type LearnLink,
  type LearnSection,
} from './learn/model';

export {
  LEARN_AUTHOR_NAME,
  LEARN_AUTHOR_ORG,
  LEARN_PATH,
  LEARN_PATHS,
  formatLearnDate,
  learnInline,
  learnWordCount,
};
export type { LearnArticle, LearnLink, LearnSection };

const MEASUREMENT_NOTE: LearnSection = {
  heading: 'What this guide does not measure',
  paragraphs: [
    `The steps above change what a crawler can read and what your pages say. They are not a tally of mentions. ${LIVE_ANSWER_CHECKS} Measured, Estimated, and Not measured are defined on the [methodology](/methodology) page.`,
  ],
};

function finish(article: LearnArticle): LearnArticle {
  return { ...article, sections: [...article.sections, MEASUREMENT_NOTE] };
}

export const LEARN_ARTICLES: readonly LearnArticle[] = [...EARLY_ARTICLES, ...LATE_ARTICLES].map(finish);

export const LEARN_INDEX = {
  path: LEARN_PATH,
  label: 'Learn',
  description:
    'Practical guides for agencies: AEO, AI crawlers, llms.txt, schema, suburb pages, ChatGPT business profiles, and MCP. Not measured unless you are on Agency.',
  h1: 'Guides for agencies and the people who ship their sites',
  lede:
    'How an independent real estate agency, and the developer who ships the site, can make pages readable by search and by answer engines. Each guide says what the vendor documents, what to publish, and what we do not measure.',
  updated: LEARN_ARTICLES[0].updated,
} as const;

const ARTICLE_BY_PATH = new Map<string, LearnArticle>(LEARN_ARTICLES.map((article) => [article.path, article]));

/** Index, one article, or null when the path is not part of /learn. */
export function learnPageForPath(pathname: string): { article: LearnArticle | null } | null {
  const clean = pathname.replace(/\/+$/, '');
  if (clean === LEARN_PATH) return { article: null };
  const article = ARTICLE_BY_PATH.get(clean);
  return article ? { article } : null;
}

/** Guides to surface from a compare, buyer's guide, or free-tool page. */
const READING: Record<string, readonly string[]> = {
  '/compare/profound': [LEARN_PATHS.aeo, LEARN_PATHS.check],
  '/compare/ahrefs': [LEARN_PATHS.aeo, LEARN_PATHS.check],
  '/compare/otterly': [LEARN_PATHS.how, LEARN_PATHS.check],
  '/compare/peec': [LEARN_PATHS.how, LEARN_PATHS.check],
  '/compare/semrush': [LEARN_PATHS.aeo, LEARN_PATHS.robots],
  '/compare/chatseo': [LEARN_PATHS.aeo, LEARN_PATHS.suburb],
  '/best/ai-visibility-tools-for-real-estate-agencies': [LEARN_PATHS.how, LEARN_PATHS.suburb, LEARN_PATHS.check],
  '/best/aeo-audit-tools-for-small-business': [LEARN_PATHS.aeo, LEARN_PATHS.check],
  '/best/ai-visibility-tools-with-mcp': [LEARN_PATHS.mcp, LEARN_PATHS.check],
  '/learn/check-if-ai-names-your-agency': [LEARN_PATHS.claim],
  '/free-tools': [LEARN_PATH],
  '/free-tools/serp-preview': [LEARN_PATHS.suburb],
  '/free-tools/robots-txt-generator': [LEARN_PATHS.robots],
  '/free-tools/llms-txt-generator': [LEARN_PATHS.llms],
  '/free-tools/schema-generator': [LEARN_PATHS.schema],
};

export function learnLinksForPath(path: string): LearnLink[] {
  return (READING[path] ?? []).map((href) => {
    if (href === LEARN_PATH) return { label: LEARN_INDEX.label, href };
    return { label: ARTICLE_BY_PATH.get(href)?.label ?? href, href };
  });
}
