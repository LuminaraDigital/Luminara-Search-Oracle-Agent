/** Shared marketing page meta (browser + Worker). No DOM APIs. */

import { listPriceSummary } from '../../components/paywall/planCopy';
import { PAID_PLAN_PRICES } from '../../components/paywall/planPrices';
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

/** Slash list of the Stars amounts checkout charges. Not a monthly USD price. */
const soldStarsAmounts = [PAID_PLAN_PRICES.starter, PAID_PLAN_PRICES.growth, PAID_PLAN_PRICES.agency]
  .map((plan) => plan.starsLabel.replace(/ Stars$/, ''))
  .join(' / ');

export const MARKETING_SHELL_BY_PATH: Record<string, MarketingShellMeta> = {
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
  <p>Free check of robots.txt and llms.txt. No card. A full audit needs sign-in or your own keys. Every result is labeled Measured, Estimated or Not measured. No blended AI visibility score.</p>
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
  <p>The live crawl check on the landing page reads robots.txt, llms.txt and ai.txt. ${LIVE_ANSWER_CHECKS}</p>
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
      'How an audit checks a site. Competitor scan, impact ranking, and saved progress need sign-in.',
    jsonLd: graph('/how-it-works', 'How it works', 'Audit modules and workflow.'),
    crawlerBody: `
<section>
  <h1>How it works</h1>
  <p>Luminara Suite runs checks across search and AI answers, then returns a ranked list of fixes in plain English.</p>
  <ul>
    <li>Site crawl for titles, meta and technical blockers</li>
    <li>${LIVE_ANSWER_CHECKS}</li>
    <li>Schema mapping. Competitor comparison needs a signed-in business profile</li>
    <li>Impact ranking and saved progress need sign-in. Guests see Not measured</li>
  </ul>
  <p><a href="/docs/what-is-aeo.html">What is AEO</a> · <a href="/">Home</a> · <a href="/pricing">Pricing</a></p>
</section>`,
  },
  '/ai': {
    path: '/ai',
    title: 'Our AI | Luminara Suite',
    description:
      'Live search grounding plus the models you connect in Settings. Findings stay tied to evidence you actually collected.',
    jsonLd: graph('/ai', 'Our AI', 'Search grounding and AI providers.'),
    crawlerBody: `
<section>
  <h1>Our AI</h1>
  <p>Live search grounding plus the models you choose. Findings stay tied to evidence when data is available; otherwise the product marks them as not measured.</p>
  <p>Connect your own model and search providers in Settings, or use the hosted allowance on a plan.</p>
  <p><a href="/">Home</a> · <a href="/how-it-works">How it works</a></p>
</section>`,
  },
  '/why': {
    path: '/why',
    title: 'Why Luminara | Luminara Suite',
    description:
      'For real estate agencies that need a clear plan for Google and AI answers, without a full consultancy engagement or a new website.',
    jsonLd: graph('/why', 'Why Luminara', 'Why real estate agencies choose Luminara Suite.'),
    crawlerBody: `
<section>
  <h1>Why Luminara</h1>
  <p>Luminara Suite is for real estate agencies that need a clear plan for Google and AI answers, without buying a full consultancy engagement or rebuilding their website.</p>
  <ul>
    <li>Instant audits with ranked fixes</li>
    <li>Honest AEO signals (not invented scores)</li>
    <li>BYOK or hosted keys</li>
  </ul>
  <p><a href="/pricing">Pricing</a> · <a href="/">Home</a></p>
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
  '/compare/profound': {
    path: '/compare/profound',
    title: 'Luminara vs Profound | Luminara Suite',
    description:
      'Compare Luminara Suite and Profound. Evidence-bound citation tracking versus synthetic visibility scores. Prioritized weekly fixes without opaque indexes.',
    jsonLd: graph('/compare/profound', 'Luminara vs Profound', 'Empirical comparison of AI visibility tracking methodology.'),
    crawlerBody: `
<section>
  <h1>Luminara Suite vs Profound</h1>
  <p>An objective comparison between Luminara Suite and Profound for generative search and AI visibility auditing.</p>
  <table>
    <thead>
      <tr><th>Dimension</th><th>Profound</th><th>Luminara Suite</th></tr>
    </thead>
    <tbody>
      <tr><td>Metric Validity</td><td>Proprietary 0-100 composite scores</td><td>Strictly Measured, Estimated, or Not measured labels</td></tr>
      <tr><td>Search Grounding</td><td>Simulated engine scrapes</td><td>Search-grounded live probes with tamper-evident receipts</td></tr>
      <tr><td>Remediation</td><td>Data dashboards and telemetry</td><td>Exportable llms.txt and JSON-LD schema fix packs</td></tr>
      <tr><td>Pricing Model</td><td>Enterprise retainers</td><td>30-day passes. Pay by card or Telegram Stars (${soldStarsAmounts}), or bring your own keys</td></tr>
    </tbody>
  </table>
  <p><a href="/">Run Instant Audit</a> · <a href="/methodology">Methodology</a> · <a href="/pricing">Pricing</a></p>
</section>`,
  },
  '/compare/ahrefs': {
    path: '/compare/ahrefs',
    title: 'Luminara vs Ahrefs | Luminara Suite',
    description:
      'Compare traditional keyword rank tracking with LLM Answer Engine Optimization. Why blue link ranks differ from conversational AI search citations.',
    jsonLd: graph('/compare/ahrefs', 'Luminara vs Ahrefs', 'Comparing traditional SEO search monitoring with LLM citability and answer targets.'),
    crawlerBody: `
<section>
  <h1>Luminara Suite vs Ahrefs Brand Monitoring</h1>
  <p>Why traditional blue-link keyword tracking does not answer whether ChatGPT, Perplexity, or Google AI Overviews cite your brand.</p>
  <table>
    <thead>
      <tr><th>Dimension</th><th>Ahrefs</th><th>Luminara Suite</th></tr>
    </thead>
    <tbody>
      <tr><td>Search Surface</td><td>Traditional 10 blue links on Google</td><td>Site crawl and live web search on every plan. ${LIVE_ANSWER_CHECKS}</td></tr>
      <tr><td>Measurement Target</td><td>Keyword rankings and backlink graphs</td><td>Entity citability, LLM answer targets, and crawler governance</td></tr>
      <tr><td>Action Guidance</td><td>Backlink acquisition and keyword stuffing</td><td>Structured knowledge graph and machine-readable llms.txt</td></tr>
      <tr><td>Verification</td><td>Third-party crawl estimates</td><td>Cryptographic verification receipts and crawler directives</td></tr>
    </tbody>
  </table>
  <p><a href="/">Run Instant Audit</a> · <a href="/why">Why Luminara</a> · <a href="/pricing">Pricing</a></p>
</section>`,
  },
  '/compare/otterly': {
    path: '/compare/otterly',
    title: 'Luminara vs Otterly | Luminara Suite',
    description:
      'Compare Luminara Suite and Otterly AI. Evidence-bound Measured vs Estimated labels, reproducible receipts, and single-action weekly decisions.',
    jsonLd: graph('/compare/otterly', 'Luminara vs Otterly AI', 'Comparative audit of LLM search tracking and generative engine optimization.'),
    crawlerBody: `
<section>
  <h1>Luminara Suite vs Otterly AI</h1>
  <p>Comparing generative engine optimization (GEO) platforms on evidence honesty, verification, and actionable remediation.</p>
  <table>
    <thead>
      <tr><th>Dimension</th><th>Otterly AI</th><th>Luminara Suite</th></tr>
    </thead>
    <tbody>
      <tr><td>Label Honesty</td><td>Synthesized sentiment & visibility scores</td><td>Never invent SEO metrics. Unmeasured engines labeled not_measured</td></tr>
      <tr><td>Agent Tools</td><td>Web UI only</td><td>MCP server for Cursor and Claude plus Telegram Mini App</td></tr>
      <tr><td>Fix Verification</td><td>Periodic scraping runs</td><td>Re-check and prove verification loop with local and remote sync</td></tr>
      <tr><td>Key Flexibility</td><td>Hosted subscription only</td><td>Hosted allowance with daily resets plus Enterprise BYOK</td></tr>
    </tbody>
  </table>
  <p><a href="/">Run Instant Audit</a> · <a href="/methodology">Methodology</a> · <a href="/pricing">Pricing</a></p>
</section>`,
  },
  '/compare/peec': {
    path: '/compare/peec',
    title: 'Luminara vs Peec | Luminara Suite',
    description:
      'Luminara Suite versus Peec AI. Contrast synthetic composite scores with strict evidence-bound labeling and verifiable remediation fix packs.',
    jsonLd: graph('/compare/peec', 'Luminara vs Peec AI', 'Comparing synthetic AI visibility scores with verifiable search receipts.'),
    crawlerBody: `
<section>
  <h1>Luminara Suite vs Peec AI</h1>
  <p>Contrast synthetic visibility approximations with verifiable, evidence-bound answer engine audits.</p>
  <table>
    <thead>
      <tr><th>Dimension</th><th>Peec AI</th><th>Luminara Suite</th></tr>
    </thead>
    <tbody>
      <tr><td>Integrity Baseline</td><td>Black-box score weighting</td><td>Cryptographically signed receipts verified offline via Ed25519</td></tr>
      <tr><td>Execution Loop</td><td>Static chart exports</td><td>Weekly decision card: one verdict, one fix, and what changed</td></tr>
      <tr><td>Remediation Output</td><td>Generic text advice</td><td>Downloadable schema.jsonld and llms.txt tailored to findings</td></tr>
      <tr><td>Audit Grounding</td><td>Uncited response text</td><td>Direct prompt and citation excerpt evidence bound to source URLs</td></tr>
    </tbody>
  </table>
  <p><a href="/">Run Instant Audit</a> · <a href="/docs/what-is-aeo.html">What is AEO</a> · <a href="/pricing">Pricing</a></p>
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

/** Marketing shell, or a per-domain audit shell. Null for app paths the SPA shell serves as-is. */
export function marketingPageForPath(pathname: string): MarketingShellMeta | null {
  const key = marketingShellKey(pathname);
  if (key) return MARKETING_SHELL_BY_PATH[key] ?? null;
  return perDomainShell(pathname);
}
