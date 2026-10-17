/** Shared marketing page meta (browser + Worker). No DOM APIs. */

import { buildFaqPageJsonLd } from './marketingFaqContent';

export const MARKETING_ORIGIN = 'https://www.luminarasuite.com';
export const DEFAULT_OG_IMAGE = `${MARKETING_ORIGIN}/og-image.png`;

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
  logo: `${MARKETING_ORIGIN}/icon-512.png`,
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
  <h1>Be the answer AI gives.</h1>
  <p>Customers now ask ChatGPT, Perplexity, Google and AI Overviews who to trust. Luminara Suite checks whether those answers name your business, then gives you the one fix to ship next.</p>
  <p>Start with a free live crawl check of your site: no card, no signup. Create a free account to run the full audit. Every result is labeled Measured, Estimated or Not measured. No blended AI visibility score.</p>
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
  <p>The live crawl check on the landing page reads robots.txt, llms.txt and ai.txt and keeps the four engines Not measured. Instant Audit checks the engines and labels each row Measured, Estimated or Not measured.</p>
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
  <p><a href="/">Check your site</a> · <a href="/methodology">Methodology</a> · <a href="/pricing">Pricing</a></p>
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
  <p><a href="/docs/what-is-aeo.html">What is AEO</a> · <a href="/">Home</a> · <a href="/pricing">Pricing</a></p>
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
      'Free live crawl check and a daily hosted audit allowance. Starter for web audits. Growth adds share links and MCP for Cursor and Claude. Agency adds API access.',
    jsonLd: graph('/pricing', 'Pricing', 'Plans: Free insight, Starter audits, Growth MCP and share, Agency API.'),
    crawlerBody: `
<section>
  <h1>Pricing</h1>
  <p>Free: labeled sample insight and Instant Audit with your own keys where configured. Save, share, and hosted spend need an account.</p>
  <p>Starter: web audits for a small site set. No MCP. No share links.</p>
  <p>Growth: shareable audit links plus MCP access for Cursor, Claude, and the Luminara plugin.</p>
  <p>Agency: Growth capabilities plus API access and client workspaces.</p>
  <p>Telegram Stars billing is available in the Mini App. No invented SEO scores on any plan.</p>
  <p><a href="/">Home</a> · <a href="/why">Why Luminara</a> · <a href="/docs/mcp.html">MCP docs</a></p>
</section>`,
  },
  '/compare/profound': {
    path: '/compare/profound',
    title: 'Luminara vs Profound | AI Search Visibility Comparison',
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
      <tr><td>Pricing Model</td><td>Enterprise retainers</td><td>Self-serve plans from $49/mo, BYOK, or Telegram Stars</td></tr>
    </tbody>
  </table>
  <p><a href="/">Run Instant Audit</a> · <a href="/methodology">Methodology</a> · <a href="/pricing">Pricing</a></p>
</section>`,
  },
  '/compare/ahrefs': {
    path: '/compare/ahrefs',
    title: 'Luminara vs Ahrefs Brand Monitoring | Traditional SEO vs AEO',
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
      <tr><td>Search Surface</td><td>Traditional 10 blue links on Google</td><td>AI Overviews, ChatGPT Search, Claude, and Perplexity</td></tr>
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
    title: 'Luminara vs Otterly AI | Honest AEO & GEO Audits',
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
    title: 'Luminara vs Peec AI | Empirical AI Search Monitoring',
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
};

/** Normalize pathname to a marketing shell key, or null. */
export function marketingShellKey(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/how' || clean === '/infrastructure' || clean === '/modules') return '/how-it-works';
  if (clean === '/intelligence') return '/ai';
  if (clean === '/why-us') return '/why';
  if (MARKETING_SHELL_BY_PATH[clean]) return clean;
  return null;
}
