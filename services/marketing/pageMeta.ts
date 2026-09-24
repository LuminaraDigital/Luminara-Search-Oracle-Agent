/** Shared marketing page meta (browser + Worker). No DOM APIs. */

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
    'Audits how a brand shows up in Google, AI Overviews, ChatGPT and Perplexity, then ranks what to fix first.',
  publisher: { '@id': `${MARKETING_ORIGIN}/#organization` },
  offers: {
    '@type': 'Offer',
    price: '49',
    priceCurrency: 'USD',
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

function graph(path: string, name: string, description: string, includeWebsite = false): Record<string, unknown> {
  const nodes = includeWebsite
    ? [ORG_NODE, WEBSITE_NODE, SOFTWARE_NODE, pageNode(path, name, description)]
    : [ORG_NODE, SOFTWARE_NODE, pageNode(path, name, description)];
  return { '@context': 'https://schema.org', '@graph': nodes };
}

export const MARKETING_SHELL_BY_PATH: Record<string, MarketingShellMeta> = {
  '/': {
    path: '/',
    title: 'Luminara Suite | AI search and AEO visibility',
    description:
      'See how your business appears in Google, AI Overviews, ChatGPT and Perplexity. Get a plain-English list of what to fix first.',
    jsonLd: graph('/', 'Luminara Suite', 'AI search and AEO visibility for business owners.', true),
    crawlerBody: `
<section>
  <h1>Luminara Suite</h1>
  <p>Show up where customers ask. See how your business appears in Google, AI Overviews, ChatGPT and Perplexity. Get a plain-English list of what to fix first.</p>
  <ul>
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
      'Luminara Suite Starter plan: US$49 per month for up to two sites, monthly audits and AI answer checks.',
    jsonLd: graph('/pricing', 'Pricing', 'Plans and subscription options.'),
    crawlerBody: `
<section>
  <h1>Pricing</h1>
  <p>Starter plan: US$49 per month for up to two sites. Monthly audits, AI answer checks and branded reports.</p>
  <p>Telegram Stars or TON billing is available in the Mini App.</p>
  <p><a href="/">Home</a> · <a href="/why">Why Luminara</a></p>
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
