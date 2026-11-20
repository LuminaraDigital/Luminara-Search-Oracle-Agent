/** Shared marketing page meta (browser + Worker). No DOM APIs. */

import { listPriceSummary, pricingMetaDescription } from '../../components/paywall/planCopy';
import {
  COMPANY_SERVICES_URL,
  COMPANY_SITE_URL,
  CONTACT_EMAIL,
  LEGAL_ABN,
  LEGAL_ENTITY,
  PUBLIC_BRAND,
} from '../legal/consumerTerms';
import { parseUrlSwapRoute } from '../../utils/urlSwapRouting';
import { LIVE_ANSWER_CHECKS } from './engineCoverage';
import { buildFaqPageJsonLd, MARKETING_FAQ } from './marketingFaqContent';
import { REAL_ESTATE_AUDIENCE } from './marketingHeroCopy';
import {
  MCP_BODY,
  MCP_DOCS_PATH,
  MCP_HEADING,
  PRACTITIONER,
  PROOF_BODY,
  PROOF_HEADING,
  STACK_HEADING,
  STACK_INTRO,
  STACK_ROWS,
  TRUST_ITEMS,
} from './marketingPositioning';
import { PLAY_STORE_URL, TELEGRAM_BOT_URL, TELEGRAM_MINI_APP_PUBLIC_URL } from './platformSurfaces';
import { HUB_FAQ_HEADING, HUB_PAGES, HUB_REVIEWED, type HubPage } from './seoHubPages';
import { FREE_TOOLS, FREE_TOOLS_CLOSING, FREE_TOOLS_HUB, FREE_TOOLS_PATH, type FreeTool } from './freeTools';
import {
  LEARN_ARTICLES,
  LEARN_AUTHOR_NAME,
  LEARN_AUTHOR_ORG,
  LEARN_INDEX,
  LEARN_PATH,
  formatLearnDate,
  learnInline,
  learnLinksForPath,
  type LearnArticle,
  type LearnSection,
} from './learnPages';
import { checkHostFromPath, checkPathForHost } from './homepageSnippet';
import { CONTACT_CRAWLER, FAQ_CRAWLER } from '../help/helpPages';
import { privacyCrawlerBody } from '../legal/privacyCrawler';
import {
  WHITE_PAPER_DESCRIPTION,
  WHITE_PAPER_H1,
  WHITE_PAPER_MODIFIED,
  WHITE_PAPER_OG_PATH,
  WHITE_PAPER_PUBLISHED,
} from './whitePaper';
import { WHITE_PAPER_SOURCES } from './whitePaperSources';

const HOME_META = 'An AI employee for your agency. It checks whether AI answers name you, flags page leaks, and hands you the next fix. No invented scores.';

export const MARKETING_ORIGIN = 'https://www.luminarasuite.com';
export const DEFAULT_OG_IMAGE = `${MARKETING_ORIGIN}/og-image.png`;

export interface MarketingShellMeta {
  path: string;
  title: string;
  description: string;
  jsonLd: Record<string, unknown>;
  /** Plain HTML fragment for noscript / non-JS crawlers (already trusted static copy). */
  crawlerBody: string;
  /** Set on unbounded per-domain pages so they are not indexed and not folded into another URL. */
  robots?: 'noindex, nofollow';
  /** Absolute image URL. Defaults to the site OG image. */
  ogImage?: string;
  ogType?: string;
}

const ORG_NODE = {
  '@type': 'Organization',
  '@id': `${MARKETING_ORIGIN}/#organization`,
  name: 'Luminara Suite',
  legalName: LEGAL_ENTITY,
  taxID: LEGAL_ABN,
  brand: { '@type': 'Brand', name: PUBLIC_BRAND, url: COMPANY_SITE_URL },
  url: MARKETING_ORIGIN,
  logo: `${MARKETING_ORIGIN}/icon-512.png`,
  email: CONTACT_EMAIL,
  address: {
    '@type': 'PostalAddress',
    addressRegion: 'VIC',
    postalCode: '3128',
    addressCountry: 'AU',
  },
  contactPoint: {
    '@type': 'ContactPoint',
    email: CONTACT_EMAIL,
    contactType: 'sales',
  },
  sameAs: [
    'https://github.com/LuminaraDigital/Luminara-Search-Oracle-Agent',
    TELEGRAM_BOT_URL,
    PLAY_STORE_URL,
    'https://www.linkedin.com/company/luminara-digital',
  ],
};

const SOFTWARE_NODE = {
  '@type': 'SoftwareApplication',
  '@id': `${MARKETING_ORIGIN}/#software`,
  name: 'Luminara Suite',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, Android, Windows',
  url: MARKETING_ORIGIN,
  description: HOME_META,
  publisher: { '@id': `${MARKETING_ORIGIN}/#organization` },
};
// No Offer price here. Card prices are Australian dollars for a 30-day pass. Telegram Stars are not an ISO 4217 currency.

const WEBSITE_NODE = {
  '@type': 'WebSite',
  '@id': `${MARKETING_ORIGIN}/#website`,
  name: 'Luminara Suite',
  url: MARKETING_ORIGIN,
  publisher: { '@id': `${MARKETING_ORIGIN}/#organization` },
};

function pageNode(path: string, name: string, description: string) {
  const url = path === '/' ? `${MARKETING_ORIGIN}/` : `${MARKETING_ORIGIN}${path}`;
  return {
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name,
    description,
    isPartOf: { '@id': `${MARKETING_ORIGIN}/#website` },
    about: { '@id': `${MARKETING_ORIGIN}/#software` },
  };
}

function graph(
  path: string,
  name: string,
  description: string,
  includeWebsite = false,
  extraNodes: Record<string, unknown>[] = [],
): Record<string, unknown> {
  const nodes = includeWebsite
    ? [ORG_NODE, WEBSITE_NODE, SOFTWARE_NODE, pageNode(path, name, description), ...extraNodes]
    : [ORG_NODE, SOFTWARE_NODE, pageNode(path, name, description), ...extraNodes];
  return { '@context': 'https://schema.org', '@graph': nodes };
}

/** Hub copy is data that a skill may draft from transcripts, so crawler HTML escapes it. */
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const listItems = (items: readonly string[]) => items.map((item) => `<li>${esc(item)}</li>`).join('');

const linkList = (links: readonly { label: string; href: string }[]) =>
  links.map((link) => `<a href="${esc(link.href)}">${esc(link.label)}</a>`).join(' · ');

const faqHtml = (items: readonly { question: string; answer: string }[]) =>
  items.map((item) => `<h3>${esc(item.question)}</h3><p>${esc(item.answer)}</p>`).join('');

function inlineHtml(source: string): string {
  return learnInline(source).map((run) => {
    if (run.kind === 'text') return esc(run.text);
    const external = run.href.startsWith('http') ? ' rel="noopener noreferrer" target="_blank"' : '';
    return `<a href="${esc(run.href)}"${external}>${esc(run.label)}</a>`;
  }).join('');
}

function learnReadingHtml(path: string): string {
  const links = learnLinksForPath(path);
  if (links.length === 0) return '';
  return `<h2>From the knowledge hub</h2><p>${linkList(links)}</p>`;
}

/**
 * A crawler paragraph that names ChatGPT, Perplexity, or AI Overviews has to name who can
 * measure those products. Guides explain the vendors' own crawlers, so the measurement
 * limit is repeated in any chunk that would otherwise fail that check.
 */
function withEngineCaveat(html: string): string {
  const caveat = `<p>${esc(LIVE_ANSWER_CHECKS)}</p>`;
  return html.split(/\n\s*\n/).map((chunk) => {
    if (!/ChatGPT|Perplexity|AI Overviews/.test(chunk)) return chunk;
    const named = /Agency|DataForSEO/.test(chunk) && /Not measured|not measured|not_measured/.test(chunk);
    return named ? chunk : `${chunk}\n${caveat}`;
  }).join('\n\n');
}

/** Home crawler copy. First paint already supplies the only h1 and the hero lede. */
function homeCrawlerBody(): string {
  const stack = STACK_ROWS.map((row) => `<tr><td>${esc(row.label)}</td><td>${esc(row.them)}</td><td>${esc(row.us)}</td></tr>`).join('');
  const trust = TRUST_ITEMS.map((item) => `<li>${esc(item.title)}: ${esc(item.body)}</li>`).join('');
  return `
<section>
  <h2>${esc(PROOF_HEADING)}</h2>
  <p>${esc(PROOF_BODY)}</p>
  <p>${esc(LIVE_ANSWER_CHECKS)}</p>
  <h2>${esc(STACK_HEADING)}</h2>
  <p>${esc(STACK_INTRO)}</p>
  <table><thead><tr><th>Job</th><th>By hand</th><th>One Suite plan</th></tr></thead><tbody>${stack}</tbody></table>
  <h2>${esc(PRACTITIONER.eyebrow)}</h2>
  <h3>${esc(PRACTITIONER.name)}</h3>
  <p>${esc(PRACTITIONER.role)}. ${esc(PRACTITIONER.body)}</p>
  <h2>${esc(MCP_HEADING)}</h2>
  <p>${esc(MCP_BODY)} <a href="${MCP_DOCS_PATH}">MCP docs</a></p>
  <h2>Common questions</h2>${faqHtml(MARKETING_FAQ)}
  <h2>Before you pay</h2>
  <ul>${trust}</ul>
  <p>Illustrative example, not a real agency and not a measurement: an independent agency, checked for a suburb question.</p>
  <p>Luminara Suite is on the web, in the Telegram Mini App, and on Android from Google Play. Card upgrades stay on the website. Stars checkout is in Telegram. The Play app is a free companion and does not take card checkout.</p>
  <ul>
    <li><a href="/sample-report">Sample report</a></li>
    <li><a href="/methodology">Methodology</a></li>
    <li><a href="/white-paper">White paper</a></li>
    <li><a href="/docs/what-is-aeo.html">What is AEO</a></li>
    <li><a href="/how-it-works">How it works</a></li>
    <li><a href="/ai">Our AI</a></li>
    <li><a href="/why">Why Luminara</a></li>
    <li><a href="/pricing">Pricing</a></li>
    <li><a href="${MCP_DOCS_PATH}">MCP for agents</a></li>
    <li><a href="/index.md">Home markdown</a></li>
    <li><a href="/pricing.md">Pricing markdown</a></li>
    <li><a href="/mcp.md">MCP markdown</a></li>
    <li><a href="${TELEGRAM_MINI_APP_PUBLIC_URL}">Telegram Mini App</a></li>
    <li><a href="${TELEGRAM_BOT_URL}">Telegram bot</a></li>
    <li><a href="${PLAY_STORE_URL}">Google Play</a></li>
    <li><a href="/desktop">Windows app</a></li>
    <li><a href="/privacy">Privacy</a></li>
    <li><a href="/terms">Terms</a></li>
  </ul>
  <p>Produced by <a href="${COMPANY_SERVICES_URL}">Luminara Digital</a>.</p>
</section>`;
}

function itemListNode(id: string, name: string, items: readonly { name: string; url: string }[]) {
  return {
    '@type': 'ItemList',
    '@id': id,
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, url: item.url })),
  };
}

/** Static crawler HTML for a hub page. Same data as the React view. */
function hubCrawlerBody(page: HubPage): string {
  const body = page.kind === 'compare'
    ? `<table><thead><tr><th>Dimension</th><th>${esc(page.competitor)}</th><th>Luminara Suite</th></tr></thead><tbody>${page.rows
      .map((row) => `<tr><td>${esc(row.label)}</td><td>${esc(row.them)}</td><td>${esc(row.us)}</td></tr>`)
      .join('')}</tbody></table>
  <h2>When to choose ${esc(page.competitor)}</h2><ul>${listItems(page.chooseThem)}</ul>
  <h2>When to choose Luminara Suite</h2><ul>${listItems(page.chooseUs)}</ul>`
    : `<ol>${page.picks
      .map((pick) => `<li><h2>${esc(pick.name)}: ${esc(pick.bestFor)}</h2><p>${esc(pick.icp)}</p><p>Pros:</p><ul>${listItems(pick.pros)}</ul><p>Cons:</p><ul>${listItems(pick.cons)}</ul><p>${esc(pick.pricing)}</p></li>`)
      .join('')}</ol>
  <h2>How we picked</h2><ul>${listItems(page.methodology)}</ul>`;
  const faq = faqHtml(page.faq);
  const sources = linkList(page.sources.map((source) => ({ label: source.label, href: source.url })));
  const related = linkList(HUB_PAGES.filter((other) => other !== page).map((other) => ({ label: other.label, href: other.path })));
  const reading = learnReadingHtml(page.path);
  return `
<section>
  <h1>${esc(page.h1)}</h1>
  <p>${esc(page.verdict)}</p>
  ${body}
  <h2>${HUB_FAQ_HEADING}</h2>${faq}
  <p>Reviewed ${HUB_REVIEWED}. Sources: ${sources}</p>
  ${reading}
  <p>More comparisons: ${related}</p>
  <p><a href="/">Run the free check</a> · <a href="/methodology">Methodology</a> · <a href="/pricing">Pricing</a></p>
</section>`;
}

function hubShell(page: HubPage): MarketingShellMeta {
  const url = `${MARKETING_ORIGIN}${page.path}`;
  const itemList = page.kind === 'best'
    ? [itemListNode(`${url}#picks`, page.h1, page.picks.map((pick) => ({ name: pick.name, url: pick.url })))]
    : [];
  return {
    path: page.path,
    title: `${page.label} | Luminara Suite`,
    description: page.description,
    jsonLd: graph(page.path, page.h1, page.description, false, [buildFaqPageJsonLd(page.faq, `${url}#faq`), ...itemList]),
    crawlerBody: hubCrawlerBody(page),
  };
}

const toolLinks = (tools: readonly FreeTool[]) => linkList(tools.map((tool) => ({ label: tool.label, href: tool.path })));

/** Static crawler HTML for /free-tools/*. Same data as the React view; the tool itself needs JavaScript. */
function freeToolShell(tool: FreeTool): MarketingShellMeta {
  const url = `${MARKETING_ORIGIN}${tool.path}`;
  const app = {
    '@type': 'WebApplication',
    '@id': `${url}#tool`,
    name: tool.label,
    url,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    isAccessibleForFree: true,
    publisher: { '@id': `${MARKETING_ORIGIN}/#organization` },
  };
  return {
    path: tool.path,
    title: `${tool.label} | Luminara Suite`,
    description: tool.description,
    jsonLd: graph(tool.path, tool.h1, tool.description, false, [app, buildFaqPageJsonLd(tool.faq, `${url}#faq`)]),
    crawlerBody: `
<section>
  <h1>${esc(tool.h1)}</h1>
  <p>${esc(tool.lede)}</p>
  <h2>How to use it</h2><ol>${listItems(tool.steps)}</ol>
  ${tool.why.map((block) => `<h2>${esc(block.heading)}</h2><p>${esc(block.body)}</p>`).join('')}
  <h2>Common questions</h2>${faqHtml(tool.faq)}
  ${learnReadingHtml(tool.path)}
  <p>More free tools: ${toolLinks(FREE_TOOLS.filter((other) => other !== tool))}</p>
  <p>${esc(FREE_TOOLS_CLOSING.body)} <a href="/">Run the free check</a> · <a href="${FREE_TOOLS_PATH}">All free tools</a></p>
</section>`,
  };
}

const FREE_TOOLS_HUB_SHELL: MarketingShellMeta = {
  path: FREE_TOOLS_PATH,
  title: `${FREE_TOOLS_HUB.label} | Luminara Suite`,
  description: FREE_TOOLS_HUB.description,
  jsonLd: graph(FREE_TOOLS_PATH, FREE_TOOLS_HUB.h1, FREE_TOOLS_HUB.description, false, [
    itemListNode(
      `${MARKETING_ORIGIN}${FREE_TOOLS_PATH}#tools`,
      FREE_TOOLS_HUB.h1,
      FREE_TOOLS.map((tool) => ({ name: tool.label, url: `${MARKETING_ORIGIN}${tool.path}` })),
    ),
    buildFaqPageJsonLd(FREE_TOOLS_HUB.faq, `${MARKETING_ORIGIN}${FREE_TOOLS_PATH}#faq`),
  ]),
  crawlerBody: `
<section>
  <h1>${esc(FREE_TOOLS_HUB.h1)}</h1>
  <p>${esc(FREE_TOOLS_HUB.lede)}</p>
  <ul>${FREE_TOOLS.map((tool) => `<li><a href="${tool.path}">${esc(tool.label)}</a>: ${esc(tool.blurb)}</li>`).join('')}</ul>
  <h2>Common questions</h2>${faqHtml(FREE_TOOLS_HUB.faq)}
  ${learnReadingHtml(FREE_TOOLS_PATH)}
  <p>${esc(FREE_TOOLS_CLOSING.body)} <a href="/">Run the free check</a> · <a href="/pricing">Pricing</a></p>
</section>`,
};

function breadcrumbNode(id: string, items: readonly { name: string; item: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${id}#breadcrumb`,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.item,
    })),
  };
}

function learnSectionHtml(section: LearnSection): string {
  const paragraphs = section.paragraphs.map((paragraph) => `<p>${inlineHtml(paragraph)}</p>`).join('');
  const steps = section.steps ? `<ol>${section.steps.map((step) => `<li>${inlineHtml(step)}</li>`).join('')}</ol>` : '';
  const bullets = section.bullets ? `<ul>${section.bullets.map((item) => `<li>${inlineHtml(item)}</li>`).join('')}</ul>` : '';
  const code = section.code ? `<pre><code>${esc(section.code)}</code></pre>` : '';
  return `<h2>${esc(section.heading)}</h2>${paragraphs}${steps}${bullets}${code}`;
}

function learnArticleShell(article: LearnArticle): MarketingShellMeta {
  const url = `${MARKETING_ORIGIN}${article.path}`;
  const personId = `${MARKETING_ORIGIN}${LEARN_PATH}#author`;
  const published = formatLearnDate(article.published);
  const updated = formatLearnDate(article.updated);
  const more = linkList([{ label: 'All guides', href: LEARN_PATH }, ...article.related.filter((link) => link.href !== LEARN_PATH)]);
  return {
    path: article.path,
    title: `${article.label} | Luminara Suite`,
    description: article.description,
    jsonLd: graph(article.path, article.h1, article.description, false, [
      {
        '@type': 'Person',
        '@id': personId,
        name: LEARN_AUTHOR_NAME,
        affiliation: { '@type': 'Organization', name: LEARN_AUTHOR_ORG, url: COMPANY_SITE_URL },
      },
      {
        '@type': 'Article',
        '@id': `${url}#article`,
        headline: article.h1,
        description: article.description,
        datePublished: article.published,
        dateModified: article.updated,
        author: { '@id': personId },
        publisher: { '@id': `${MARKETING_ORIGIN}/#organization` },
        mainEntityOfPage: { '@id': `${url}#webpage` },
      },
      breadcrumbNode(url, [
        { name: 'Home', item: `${MARKETING_ORIGIN}/` },
        { name: 'Learn', item: `${MARKETING_ORIGIN}${LEARN_PATH}` },
        { name: article.h1, item: url },
      ]),
      buildFaqPageJsonLd(article.faq, `${url}#faq`),
    ]),
    crawlerBody: withEngineCaveat(`
<section>
  <h1>${esc(article.h1)}</h1>
  <p>Published ${esc(published)}. Updated ${esc(updated)}.</p>
  <p>${esc(LEARN_AUTHOR_NAME)}, ${esc(LEARN_AUTHOR_ORG)}</p>
  ${article.sections.map(learnSectionHtml).join('')}
  <h2>Common questions</h2>${faqHtml(article.faq)}
  <p>Sources: ${linkList(article.sources)}</p>
  <p>More guides: ${more}</p>
  <p><a href="${LEARN_PATH}">All guides</a> · <a href="/">Run the free check</a></p>
</section>`),
  };
}

const LEARN_INDEX_SHELL: MarketingShellMeta = {
  path: LEARN_PATH,
  title: `${LEARN_INDEX.label} | Luminara Suite`,
  description: LEARN_INDEX.description,
  jsonLd: graph(LEARN_PATH, LEARN_INDEX.h1, LEARN_INDEX.description, false, [
    itemListNode(
      `${MARKETING_ORIGIN}${LEARN_PATH}#guides`,
      LEARN_INDEX.h1,
      LEARN_ARTICLES.map((article) => ({ name: article.h1, url: `${MARKETING_ORIGIN}${article.path}` })),
    ),
    breadcrumbNode(`${MARKETING_ORIGIN}${LEARN_PATH}`, [
      { name: 'Home', item: `${MARKETING_ORIGIN}/` },
      { name: 'Learn', item: `${MARKETING_ORIGIN}${LEARN_PATH}` },
    ]),
  ]),
  crawlerBody: `
<section>
  <h1>${esc(LEARN_INDEX.h1)}</h1>
  <p>${esc(LEARN_INDEX.lede)}</p>
  <p>Updated ${esc(formatLearnDate(LEARN_INDEX.updated))}. ${esc(LEARN_AUTHOR_NAME)}, ${esc(LEARN_AUTHOR_ORG)}</p>
  <ul>${LEARN_ARTICLES.map((article) => `<li><a href="${article.path}">${esc(article.h1)}</a>: ${esc(article.description)}</li>`).join('')}</ul>
  <p><a href="/">Run the free check</a></p>
</section>`,
};

const WHITE_PAPER_OG_IMAGE = `${MARKETING_ORIGIN}${WHITE_PAPER_OG_PATH}`;

function whitePaperArticleNode(): Record<string, unknown> {
  return {
    '@type': 'TechArticle',
    '@id': `${MARKETING_ORIGIN}/white-paper#article`,
    headline: WHITE_PAPER_H1,
    description: WHITE_PAPER_DESCRIPTION,
    datePublished: WHITE_PAPER_PUBLISHED,
    dateModified: WHITE_PAPER_MODIFIED,
    image: WHITE_PAPER_OG_IMAGE,
    mainEntityOfPage: `${MARKETING_ORIGIN}/white-paper`,
    author: { '@type': 'Organization', name: LEGAL_ENTITY, '@id': `${MARKETING_ORIGIN}/#organization` },
    publisher: { '@type': 'Organization', name: LEGAL_ENTITY, '@id': `${MARKETING_ORIGIN}/#organization` },
    citation: WHITE_PAPER_SOURCES.flatMap((source) => [...source.urls]),
  };
}

export const MARKETING_SHELL_BY_PATH: Record<string, MarketingShellMeta> = {
  [LEARN_PATH]: LEARN_INDEX_SHELL,
  ...Object.fromEntries(LEARN_ARTICLES.map((article) => [article.path, learnArticleShell(article)])),
  ...Object.fromEntries(HUB_PAGES.map((page) => [page.path, hubShell(page)])),
  [FREE_TOOLS_PATH]: FREE_TOOLS_HUB_SHELL,
  ...Object.fromEntries(FREE_TOOLS.map((tool) => [tool.path, freeToolShell(tool)])),
  '/': {
    path: '/',
    title: 'AI visibility audit | Luminara Suite',
    description: HOME_META,
    jsonLd: graph(
      '/',
      'Luminara Suite',
      HOME_META,
      true,
      [buildFaqPageJsonLd()],
    ),
    crawlerBody: homeCrawlerBody(),
  },
  '/white-paper': {
    path: '/white-paper',
    title: 'White paper | Luminara Suite',
    description: WHITE_PAPER_DESCRIPTION,
    ogImage: WHITE_PAPER_OG_IMAGE,
    ogType: 'article',
    jsonLd: graph('/white-paper', WHITE_PAPER_H1, WHITE_PAPER_DESCRIPTION, false, [whitePaperArticleNode()]),
    crawlerBody: `
<section>
  <h1>${WHITE_PAPER_H1}</h1>
  <p>Product and methodology paper for independent real estate agencies in Australia, Oceania and South-East Asia. Traction and market size: Unknown. This paper does not recommend issuing a token.</p>
  <p>Every number on the page is tagged Fact, Estimate, or Speculation and links to a source checked on 2 November 2026.</p>
  <p><a href="/">Free check</a> · <a href="/pricing">Sign up</a> · <a href="${TELEGRAM_MINI_APP_PUBLIC_URL}">Telegram Mini App</a> · <a href="${PLAY_STORE_URL}">Google Play</a> · <a href="/desktop">Windows</a></p>
</section>`,
  },
  '/methodology': {
    path: '/methodology',
    title: 'Methodology | Luminara Suite',
    description:
      'How Luminara labels each result Measured, Estimated, or Not measured. The free check reads your homepage, robots.txt, llms.txt, and one capped Tavily sample.',
    jsonLd: graph(
      '/methodology',
      'Methodology',
      'How Luminara labels each result Measured, Estimated, or Not measured. The free check reads your homepage, robots.txt, llms.txt, and one capped Tavily sample.',
      false,
      [buildFaqPageJsonLd()],
    ),
    crawlerBody: `
<section>
  <p>Measured means live evidence. Estimated is directional only. Not measured means missing data is labeled, never invented.</p>
  <p>The free check on the landing page reads the homepage title and description, robots.txt, llms.txt and ai.txt, and may add one capped Tavily answer sample. ${LIVE_ANSWER_CHECKS}</p>
  <p><a href="/sample-report">Sample report</a> · <a href="/pricing">Pricing</a> · <a href="/">Home</a></p>
</section>`,
  },
  '/sample-report': {
    path: '/sample-report',
    title: 'Sample report | Luminara Suite',
    description:
      'Labeled sample Instant Audit report shape: per-engine status, verdict, and one ship action. Not live data. No invented scores.',
    jsonLd: graph(
      '/sample-report',
      'Sample report',
      'Labeled sample AI visibility audit report fixture.',
    ),
    crawlerBody: `
<section>
  <h1>Sample report</h1>
  <p>Illustrative example of an independent real estate agency. The rows show the report shape. They are not a measurement.</p>
  <p><a href="/">Check your site</a> · <a href="/methodology">Methodology</a> · <a href="/pricing">Pricing</a></p>
</section>`,
  },
  '/how-it-works': {
    path: '/how-it-works',
    title: 'How it works | Luminara Suite',
    description:
      'How an audit checks a site, returns a ready-to-paste Fix Pack, and qualifies leads in the Enquiry Desk. Ranking needs sign-in.',
    jsonLd: graph('/how-it-works', 'How it works', 'Audit modules, Fix Pack deliverables, and Enquiry Desk workflow.'),
    crawlerBody: `
<section>
  <h1>How it works</h1>
  <p>Luminara Suite runs checks across search and AI answers, returns a ranked list of ready-to-paste fixes in plain English, and qualifies inbound enquiries into agent-approved bookings.</p>
  <ul>
    <li>Site crawl for titles, meta and technical blockers</li>
    <li>${LIVE_ANSWER_CHECKS}</li>
    <li>Schema mapping and ready-to-paste LocalBusiness and FAQPage JSON-LD. Competitor comparison needs a signed-in business profile</li>
    <li>Impact ranking, Enquiry Desk qualification, and saved progress need sign-in. Guests see Not measured</li>
  </ul>
  <p><a href="/docs/what-is-aeo.html">What is AEO</a> · <a href="/sample-report">Sample report</a> · <a href="/">Home</a> · <a href="/pricing">Pricing</a></p>
</section>`,
  },
  '/ai': {
    path: '/ai',
    title: 'Our AI | Luminara Suite',
    description:
      'Evidence-before-advice AI grounding: live crawl checks, separate SEO/AEO/GEO diagnostics, multi-provider BYOK switchyard, and MCP agent access.',
    jsonLd: graph('/ai', 'Our AI', 'Search grounding, separate SEO/AEO/GEO checks, BYOK switchyard, and MCP server.'),
    crawlerBody: `
<section>
  <h1>Our AI</h1>
  <p>Live search grounding plus the models you choose, keeping SEO, AEO, and GEO separate without a fake composite score. ${LIVE_ANSWER_CHECKS} Findings stay tied to evidence when data is available; otherwise the product marks them as Not measured.</p>
  <ul>
    <li>Deterministic crawl-file and DOM schema inspection before any model call</li>
    <li>Separate SEO, AEO, and GEO checks with ready-to-paste LocalBusiness and FAQPage JSON-LD</li>
    <li>Connect your own keys (Gemini, Groq, OpenRouter, DataForSEO) in Settings, or use the hosted daily allowance</li>
    <li>Programmatic MCP server (/api/mcp) on every plan, with SHA-256 idempotency and human booking sign-off</li>
  </ul>
  <p><a href="/">Home</a> · <a href="/how-it-works">How it works</a> · <a href="/sample-report">Sample report</a> · <a href="/pricing">Pricing</a></p>
</section>`,
  },
  '/why': {
    path: '/why',
    title: 'Why Luminara | Luminara Suite',
    description:
      'A clear plan for Google and AI answers: ready-to-paste page and schema fixes, and Enquiry Desk qualification without a retainer.',
    jsonLd: graph('/why', 'Why Luminara', 'Why real estate agencies choose Luminara Suite over manual retainers and read-only AI trackers.'),
    crawlerBody: `
<section>
  <h1>Why Luminara</h1>
  <p>Luminara Suite is for real estate agencies that need a clear plan for Google and AI answers, without buying a full consultancy engagement or rebuilding their website. ${LIVE_ANSWER_CHECKS}</p>
  <ul>
    <li>Instant audits with ranked, ready-to-paste LocalBusiness and FAQPage schema fixes</li>
    <li>Enquiry Desk qualification with Australian statutory guardrails and agent-approved booking sign-off</li>
    <li>Honest AEO signals labeled Measured, Estimated, or Not measured (never invented scores)</li>
    <li>Free account (3 checks/day), 30-day passes, or bring your own AI keys</li>
  </ul>
  <p><a href="/how-it-works">How it works</a> · <a href="/sample-report">Sample report</a> · <a href="/pricing">Pricing</a> · <a href="/">Home</a></p>
</section>`,
  },
  '/pricing': {
    path: '/pricing',
    title: 'Pricing | Luminara Suite',
    description: pricingMetaDescription(),
    jsonLd: graph('/pricing', 'Pricing', pricingMetaDescription()),
    crawlerBody: `
<section>
  <p>${REAL_ESTATE_AUDIENCE} ${listPriceSummary()}</p>
  <ul>${TRUST_ITEMS.map((item) => `<li>${esc(item.title)}: ${esc(item.body)}</li>`).join('')}</ul>
  <p>Free: labeled sample insight and Instant Audit with your own keys where configured. Save, share, and hosted spend need an account. A free account gets public share links and MCP with daily caps.</p>
  <p>Starter: web audits for a small site set, with higher daily caps on share links and MCP and your own branding on shared reports.</p>
  <p>Growth: share links and MCP with no daily cap, for Cursor, Claude, and the Luminara plugin.</p>
  <p>Agency: Growth capabilities plus API access and client workspaces. ${LIVE_ANSWER_CHECKS}</p>
  <p>Pay by card for a 30-day pass, or with Telegram Stars in the Mini App. The Mini App takes Stars only. No invented SEO scores on any plan.</p>
  <p><a href="/">Home</a> · <a href="/why">Why Luminara</a> · <a href="/docs/mcp.html">MCP docs</a></p>
</section>`,
  },
  '/labs': {
    path: '/labs',
    title: 'Labs | Luminara Suite',
    description:
      'Directory of Luminara tools. A tool whose feature flag is off is marked not available yet.',
    jsonLd: graph('/labs', 'Labs', 'Luminara Suite tool directory.'),
    crawlerBody: `
<section>
  <h1>Labs</h1>
  <p>Directory of Luminara tools. A tool whose feature flag is off is marked not available yet.</p>
  <p><a href="/">Home</a> · <a href="/pricing">Pricing</a></p>
</section>`,
  },
  '/faq': {
    path: '/faq',
    title: 'FAQ | Luminara Suite',
    description: 'FAQ on how a check works, what stays Not measured, and how to ask for a refund. Email info@luminara.digital. Australian Consumer Law still applies.',
    jsonLd: graph('/faq', 'FAQ', 'FAQ on how a check works, what stays Not measured, and how to ask for a refund. Email info@luminara.digital. Australian Consumer Law still applies.'),
    crawlerBody: FAQ_CRAWLER,
  },
  '/contact': {
    path: '/contact',
    title: 'Contact | Luminara Suite',
    description: 'Email info@luminara.digital about a check, a plan, or a refund. There is no phone line, and the form opens your mail app.',
    jsonLd: graph('/contact', 'Contact', 'Email info@luminara.digital about a check, a plan, or a refund. There is no phone line, and the form opens your mail app.'),
    crawlerBody: CONTACT_CRAWLER,
  },
  '/privacy': {
    path: '/privacy',
    title: 'Privacy | Luminara Suite',
    description: 'Privacy policy for the Luminara Suite web app, the Telegram Mini App, and the bot: what we collect, who receives it, and your rights.',
    jsonLd: graph('/privacy', 'Privacy', 'Privacy policy for the Luminara Suite web app, the Telegram Mini App, and the bot: what we collect, who receives it, and your rights.'),
    crawlerBody: privacyCrawlerBody(),
  },
};

export const DASHBOARD_TAB_TITLE = 'Dashboard | Luminara Suite';
export const ENQUIRY_DESK_TAB_TITLE = 'Enquiry Desk | Luminara Suite';

const TAB_TITLE_MAX = 60;
const TAB_TITLE_SUFFIX = ' | Luminara Suite';

/** `Topic | Luminara Suite`, with the topic cut so the whole title stays within 60 characters. */
function brandedTabTitle(topic: string): string {
  const full = `${topic}${TAB_TITLE_SUFFIX}`;
  if (full.length <= TAB_TITLE_MAX) return full;
  const room = TAB_TITLE_MAX - TAB_TITLE_SUFFIX.length - 3;
  return `${topic.slice(0, Math.max(0, room)).trimEnd()}...${TAB_TITLE_SUFFIX}`;
}

/** Tab title for Instant Audit. A long host is shortened so the title stays within 60 characters. */
export function instantAuditTabTitle(target: string | undefined): string {
  const domain = (target || '').replace(/^https?:\/\//i, '').split(/[/?#]/)[0] || '';
  return brandedTabTitle(domain ? `Instant Audit: ${domain}` : 'Instant Audit');
}

/** Normalize pathname to a marketing shell key, or null. */
export function marketingShellKey(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/how' || clean === '/infrastructure' || clean === '/modules') return '/how-it-works';
  if (clean === '/help') return '/faq';
  if (clean === '/upgrade') return '/pricing';
  if (clean === '/intelligence') return '/ai';
  if (clean === '/why-us') return '/why';
  if (clean === '/whitepaper') return '/white-paper';
  if (clean === '/lab') return '/labs';
  if (clean === '/privacy.html' || clean === '/privacy-policy') return '/privacy';
  if (clean === '/faq.html') return '/faq';
  if (clean === '/contact.html') return '/contact';
  if (MARKETING_SHELL_BY_PATH[clean]) return clean;
  return null;
}

/**
 * Per-domain audit, geo, aeo, and seo URLs. They are not in the sitemap.
 * noindex, with a self canonical, so a crawler does not treat them as the homepage.
 */
export function perDomainShell(pathname: string): MarketingShellMeta | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const swap = parseUrlSwapRoute(clean);
  if (!swap?.targetUrl) return null;
  const title = instantAuditTabTitle(swap.targetUrl);
  const description = 'Per-domain Instant Audit. This page is not indexed.';
  return {
    path: clean,
    title,
    description,
    robots: 'noindex, nofollow',
    jsonLd: graph(clean, title, description),
    crawlerBody: `
<section>
  <h1>Instant Audit</h1>
  <p>This per-domain audit page is not indexed.</p>
  <p><a href="/">Home</a></p>
</section>`,
  };
}

/**
 * A shared free check (/check/<host>). Not indexed: one page per typed host would be thin
 * near-duplicates. The title names the host so a pasted link previews what it checks.
 */
export function checkShell(pathname: string): MarketingShellMeta | null {
  const host = checkHostFromPath(pathname);
  if (!host) return null;
  // Built from the validated host, never the raw path, so percent-encoded junk cannot reach the meta.
  const clean = checkPathForHost(host);
  const title = brandedTabTitle(`Free check: ${host}`);
  const description = `A free live check of ${host}: homepage, robots.txt, llms.txt, and one capped Tavily sample.`;
  return {
    path: clean,
    title,
    description,
    robots: 'noindex, nofollow',
    jsonLd: graph(clean, title, description),
    crawlerBody: `
<section>
  <h1>Free check: ${esc(host)}</h1>
  <p>${esc(description)}</p>
  <p><a href="/">Run the free check</a></p>
</section>`,
  };
}

/** Marketing shell, or a per-domain audit or check shell. Null for app paths the SPA shell serves as-is. */
export function marketingPageForPath(pathname: string): MarketingShellMeta | null {
  const key = marketingShellKey(pathname);
  if (key) return MARKETING_SHELL_BY_PATH[key] ?? null;
  return perDomainShell(pathname) ?? checkShell(pathname);
}
