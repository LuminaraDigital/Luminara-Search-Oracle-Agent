/** Shared marketing page meta (browser + Worker). No DOM APIs. */

import { buildFaqPageJsonLd } from './marketingFaqContent';

export const MARKETING_ORIGIN = 'https://www.luminarasuite.com';
export const DEFAULT_OG_IMAGE = `${MARKETING_ORIGIN}/icon-512.png`;

export interface MarketingShellMeta {
  path: string;
  title: string;
  description: string;
  jsonLd: Record<string, unknown>;
  /** Plain HTML fragment for noscript / non-JS crawlers (already trusted static copy). */
  crawlerBody: string;
}

const ORG_NODE = {
  '@type': 'Organization',
  '@id': `${MARKETING_ORIGIN}/#organization`,
  name: 'Luminara Digital',
  url: 'https://luminaradigital.io',
  logo: DEFAULT_OG_IMAGE,
  sameAs: ['https://github.com/LuminaraDigital/Luminara-Search-Oracle-Agent'],
};

const SOFTWARE_NODE = {
  '@type': 'SoftwareApplication',
  '@id': `${MARKETING_ORIGIN}/#software`,
  name: 'Luminara Suite',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web, Windows',
  url: MARKETING_ORIGIN,
  description:
    'Audits whether AI search recommends your brand across Google, AI Overviews, ChatGPT and Perplexity, then ranks what to fix first.',
  publisher: { '@id': `${MARKETING_ORIGIN}/#organization` },
  offers: {
    '@type': 'AggregateOffer',
    lowPrice: '49',
    highPrice: '149',
    priceCurrency: 'USD',
    offerCount: 3,
    url: `${MARKETING_ORIGIN}/pricing`,
  },
};

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

export const MARKETING_SHELL_BY_PATH: Record<string, MarketingShellMeta> = {
  '/': {
    path: '/',
    title: 'Luminara Suite | AI visibility audit and action plan',
    description:
      'Find out whether AI search recommends your business. Audit Google, AI Overviews, ChatGPT and Perplexity, then get a prioritised action plan. No invented scores.',
    jsonLd: graph(
      '/',
      'Luminara Suite',
      'AI visibility audits across Google, AI Overviews, ChatGPT and Perplexity with a prioritised action plan.',
      true,
      [buildFaqPageJsonLd()],
    ),
    crawlerBody: `
<section>
  <h1>Luminara Suite</h1>
  <p>See if AI search recommends you. Luminara audits your website across Google, AI Overviews, ChatGPT and Perplexity, then gives a prioritised action plan so you grow without rebuilding your stack.</p>
  <p>Sample scouts are labeled Measured, Estimated or Not measured. Live Instant Audit follows account and key rules. No bare composite AI visibility scores.</p>
  <ul>
    <li><a href="/sample-report">Sample report</a></li>
    <li><a href="/methodology">Methodology</a></li>
    <li><a href="/how-it-works">How it works</a></li>
    <li><a href="/ai">Our AI</a></li>
    <li><a href="/why">Why Luminara</a></li>
    <li><a href="/pricing">Pricing</a></li>
    <li><a href="/docs/mcp.html">MCP for agents</a></li>
    <li><a href="/privacy">Privacy</a></li>
    <li><a href="/terms">Terms</a></li>
  </ul>
  <p>Produced by <a href="https://luminaradigital.io">Luminara Digital</a>.</p>
</section>`,
  },
  '/methodology': {
    path: '/methodology',
    title: 'Methodology | Luminara Suite',
    description:
      'How Luminara labels Measured, Estimated, and Not measured across Google, AI Overviews, ChatGPT and Perplexity. Sample versus Live explained.',
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
  <p>Sample scouts on the landing Workbench are labeled fixtures. Live Instant Audit follows account and key rules.</p>
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
  <p>Illustrative Sample for luminarasuite.com. Engines show Measured, Estimated, or Not measured. Verdict and ship action match Instant Audit shape.</p>
  <p><a href="/">Run a scout</a> · <a href="/methodology">Methodology</a> · <a href="/pricing">Pricing</a></p>
</section>`,
  },
  '/how-it-works': {
    path: '/how-it-works',
    title: 'How it works | Luminara Suite',
    description:
      'How Luminara Suite audits SEO, AI answers, schema gaps and competitors, then ranks the highest-impact fixes.',
    jsonLd: graph('/how-it-works', 'How it works', 'Audit modules and workflow.'),
    crawlerBody: `
<section>
  <h1>How it works</h1>
  <p>Luminara Suite runs checks across search and AI answers, then returns a ranked list of fixes in plain English.</p>
  <ul>
    <li>Site crawl for titles, meta and technical blockers</li>
    <li>AI visibility across ChatGPT, Perplexity and AI Overviews</li>
    <li>Schema mapping and competitor comparison</li>
    <li>Impact-ranked action list</li>
  </ul>
  <p><a href="/">Home</a> · <a href="/pricing">Pricing</a></p>
</section>`,
  },
  '/ai': {
    path: '/ai',
    title: 'Our AI | Luminara Suite',
    description:
      'Luminara Suite combines live search grounding with your chosen AI providers (Groq, NIM, Ollama, OpenRouter) for factual audits.',
    jsonLd: graph('/ai', 'Our AI', 'Search grounding and AI providers.'),
    crawlerBody: `
<section>
  <h1>Our AI</h1>
  <p>Live search grounding plus the models you choose. Findings stay tied to evidence when data is available; otherwise the product marks them as not measured.</p>
  <p>Supported providers include Groq, NVIDIA NIM, Ollama, OpenRouter, Firecrawl and Tavily.</p>
  <p><a href="/">Home</a> · <a href="/how-it-works">How it works</a></p>
</section>`,
  },
  '/why': {
    path: '/why',
    title: 'Why Luminara | Luminara Suite',
    description:
      'Owner-first search and AI visibility audits: plain-English priorities, BYOK or hosted keys, without agency report theater.',
    jsonLd: graph('/why', 'Why Luminara', 'Why owners choose Luminara Suite.'),
    crawlerBody: `
<section>
  <h1>Why Luminara</h1>
  <p>Built for owners who need a clear plan for Google and AI answers without buying a full agency engagement.</p>
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
    description:
      'Free insight and sample scouts. Starter for web audits. Growth adds share links and MCP for Cursor and Claude. Agency adds API access.',
    jsonLd: graph('/pricing', 'Pricing', 'Plans: Free insight, Starter audits, Growth MCP and share, Agency API.'),
    crawlerBody: `
<section>
  <h1>Pricing</h1>
  <p>Free: labeled sample insight and Instant Audit with your own keys where configured. Save, share, and hosted spend need an account.</p>
  <p>Starter: web audits for a small site set. No MCP. No share links.</p>
  <p>Growth: shareable audit links plus MCP access for Cursor, Claude, and the Luminara plugin.</p>
  <p>Agency / Pro: Growth capabilities plus API access and client workspaces.</p>
  <p>Telegram Stars or TON billing is available in the Mini App. No invented SEO scores on any plan.</p>
  <p><a href="/">Home</a> · <a href="/why">Why Luminara</a> · <a href="/docs/mcp.html">MCP docs</a></p>
</section>`,
  },
};

/** Normalize pathname to a marketing shell key, or null. */
export function marketingShellKey(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/infrastructure' || clean === '/modules') return '/how-it-works';
  if (clean === '/intelligence') return '/ai';
  if (clean === '/why-us') return '/why';
  if (MARKETING_SHELL_BY_PATH[clean]) return clean;
  return null;
}
