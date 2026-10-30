/** Shared marketing page meta (browser + Worker). No DOM APIs. */

import { listPriceSummary } from '../../components/paywall/planCopy';
import {
  COMPANY_SERVICES_URL,
  COMPANY_SITE_URL,
  CONTACT_EMAIL,
  LEGAL_ABN,
  LEGAL_ENTITY,
  PUBLIC_BRAND,
} from '../legal/consumerTerms';
import { parseUrlSwapRoute } from '../../utils/urlSwapRouting';
import { HONEST_VISIBILITY_PROMISE, LIVE_ANSWER_CHECKS } from './engineCoverage';
import { buildFaqPageJsonLd } from './marketingFaqContent';
import { REAL_ESTATE_AUDIENCE } from './marketingHeroCopy';
import { HUB_FAQ_HEADING, HUB_PAGES, HUB_REVIEWED, type HubPage } from './seoHubPages';
import { FREE_TOOLS, FREE_TOOLS_CLOSING, FREE_TOOLS_HUB, FREE_TOOLS_PATH, type FreeTool } from './freeTools';
import { checkHostFromPath, checkPathForHost } from './homepageSnippet';
import { CONTACT_CRAWLER, FAQ_CRAWLER } from '../help/helpPages';
import { privacyCrawlerBody } from '../legal/privacyCrawler';

const HOME_META = `${REAL_ESTATE_AUDIENCE} ${HONEST_VISIBILITY_PROMISE} No invented scores.`;

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
    'https://t.me/LuminaraSuiteBot',
    'https://www.linkedin.com/company/luminara-digital',
  ],
};

const SOFTWARE_NODE = {
  '@type': 'SoftwareApplication',
  '@id': `${MARKETING_ORIGIN}/#software`,
  name: 'Luminara Suite',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, Windows',
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
  return `
<section>
  <h1>${esc(page.h1)}</h1>
  <p>${esc(page.verdict)}</p>
  ${body}
  <h2>${HUB_FAQ_HEADING}</h2>${faq}
  <p>Reviewed ${HUB_REVIEWED}. Sources: ${sources}</p>
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
  <p>${esc(FREE_TOOLS_CLOSING.body)} <a href="/">Run the free check</a> · <a href="/pricing">Pricing</a></p>
</section>`,
};

export const MARKETING_SHELL_BY_PATH: Record<string, MarketingShellMeta> = {
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
    crawlerBody: `
<section>
  <h1>Be the answer AI gives.</h1>
  <p>${REAL_ESTATE_AUDIENCE} ${HONEST_VISIBILITY_PROMISE}</p>
  <p>Illustrative example, not a real agency and not a measurement: an independent agency, checked for a suburb question.</p>
  <p>Free check of your homepage title and description, robots.txt and llms.txt. No card. A full audit needs sign-in or your own keys. Every result is labeled Measured, Estimated or Not measured. No blended AI visibility score.</p>
  <ul>
    <li><a href="/sample-report">Sample report</a></li>
    <li><a href="/methodology">Methodology</a></li>
    <li><a href="/docs/what-is-aeo.html">What is AEO</a></li>
    <li><a href="/how-it-works">How it works</a></li>
    <li><a href="/ai">Our AI</a></li>
    <li><a href="/why">Why Luminara</a></li>
    <li><a href="/pricing">Pricing</a></li>
    <li><a href="/docs/mcp.html">MCP for agents</a></li>
    <li><a href="/privacy">Privacy</a></li>
    <li><a href="/terms">Terms</a></li>
  </ul>
  <p>Produced by <a href="${COMPANY_SERVICES_URL}">Luminara Digital</a>.</p>
</section>`,
  },
  '/methodology': {
    path: '/methodology',
    title: 'Methodology | Luminara Suite',
    description:
      `How Luminara labels Measured, Estimated, and Not measured. ${LIVE_ANSWER_CHECKS} Sample versus Live explained.`,
    jsonLd: graph(
      '/methodology',
      'Methodology',
      'Honest measurement labels for AI visibility audits.',
      false,
      [buildFaqPageJsonLd()],
    ),
    crawlerBody: `
<section>
  <h1>Methodology</h1>
  <p>Measured means live evidence. Estimated is directional only. Not measured means missing data is labeled, never invented.</p>
  <p>The free check on the landing page reads the homepage title and description, robots.txt, llms.txt and ai.txt. ${LIVE_ANSWER_CHECKS}</p>
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
      'How an audit checks a site, generates a ready-to-paste Fix Pack, and qualifies leads in the Enquiry Desk. Competitor scan, impact ranking, and saved progress need sign-in.',
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
    <li>Programmatic MCP server (/api/mcp) on Growth and Agency passes with SHA-256 idempotency and human booking sign-off</li>
  </ul>
  <p><a href="/">Home</a> · <a href="/how-it-works">How it works</a> · <a href="/sample-report">Sample report</a> · <a href="/pricing">Pricing</a></p>
</section>`,
  },
  '/why': {
    path: '/why',
    title: 'Why Luminara | Luminara Suite',
    description:
      'For real estate agencies that need a clear plan for Google and AI answers, ready-to-paste page and schema fixes, and Enquiry Desk qualification without a consultancy retainer.',
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
    description: `${REAL_ESTATE_AUDIENCE} ${listPriceSummary()}`,
    jsonLd: graph('/pricing', 'Pricing', `${REAL_ESTATE_AUDIENCE} ${listPriceSummary()}`),
    crawlerBody: `
<section>
  <h1>Pricing</h1>
  <p>${REAL_ESTATE_AUDIENCE} ${listPriceSummary()}</p>
  <p>Free: labeled sample insight and Instant Audit with your own keys where configured. Save, share, and hosted spend need an account.</p>
  <p>Starter: web audits for a small site set. No MCP. No share links.</p>
  <p>Growth: shareable audit links plus MCP access for Cursor, Claude, and the Luminara plugin.</p>
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
    description: 'FAQ, how a check works, and how to ask for a refund. Email info@luminara.digital.',
    jsonLd: graph('/faq', 'FAQ', 'FAQ, how a check works, and how to ask for a refund.'),
    crawlerBody: FAQ_CRAWLER,
  },
  '/contact': {
    path: '/contact',
    title: 'Contact | Luminara Suite',
    description: 'Email info@luminara.digital. There is no phone line.',
    jsonLd: graph('/contact', 'Contact', 'Email info@luminara.digital. There is no phone line.'),
    crawlerBody: CONTACT_CRAWLER,
  },
  '/privacy': {
    path: '/privacy',
    title: 'Privacy | Luminara Suite',
    description: 'Privacy policy for Luminara Suite, the Telegram Mini App, and the Telegram bot.',
    jsonLd: graph('/privacy', 'Privacy', 'Privacy policy for Luminara Suite.'),
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
  const description = `A free live check of ${host}: its homepage title and description, robots.txt and llms.txt. Run the same check on your site.`;
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
