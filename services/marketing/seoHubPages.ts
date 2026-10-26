/**
 * Comparison (/compare/*) and buyer's guide (/best/*) pages.
 * One source for the React view, crawler HTML, JSON-LD, sitemap, and llms.txt.
 *
 * Honesty: competitor claims come only from the vendor's own public product, pricing, or docs
 * pages as of HUB_REVIEWED. No competitor scores, no prices in figures, no claims we cannot source.
 * Re-check every vendor row when HUB_REVIEWED changes.
 */

import { PAID_PLAN_PRICES } from '../../components/paywall/planPrices';
import { LIVE_ANSWER_CHECKS } from './engineCoverage';
import type { MarketingFaqItem } from './marketingFaqContent';

export const HUB_REVIEWED = 'October 2026';
export const HUB_FAQ_HEADING = 'Common questions';

/** One matrix row. Also the row shape of MarketingCompareTable. */
export interface HubRow {
  label: string;
  them: string;
  us: string;
}

interface HubSource {
  label: string;
  url: string;
}

interface HubPageBase {
  path: string;
  /** Short name for link lists, llms.txt, and the tab title (kept under 60 characters with the suffix). */
  label: string;
  description: string;
  h1: string;
  /** Two-sentence direct answer shown first. Answer engines lift this block. */
  verdict: string;
  faq: MarketingFaqItem[];
  sources: HubSource[];
}

export interface ComparePage extends HubPageBase {
  kind: 'compare';
  competitor: string;
  rows: HubRow[];
  chooseThem: string[];
  chooseUs: string[];
}

export interface BestPick {
  name: string;
  url: string;
  bestFor: string;
  icp: string;
  pros: string[];
  cons: string[];
  pricing: string;
}

export interface BestPage extends HubPageBase {
  kind: 'best';
  picks: BestPick[];
  methodology: string[];
}

export type HubPage = ComparePage | BestPage;

const SUITE = 'Luminara Suite';
const SUITE_URL = 'https://www.luminarasuite.com/';

/** Stars amounts checkout charges, slash separated. Not a monthly USD price. */
const STARS_AMOUNTS = [PAID_PLAN_PRICES.starter, PAID_PLAN_PRICES.growth, PAID_PLAN_PRICES.agency]
  .map((plan) => plan.starsLabel.replace(/ Stars$/, ''))
  .join(' / ');

const US = {
  audience: 'Independent real estate agencies and small teams that want one clear next fix',
  metrics: 'No blended score. Every result is labeled Measured, Estimated, or Not measured',
  engines: `Site crawl and live web search on every plan. ${LIVE_ANSWER_CHECKS}`,
  output: 'One ranked fix per week, plus llms.txt and JSON-LD fix packs',
  access: 'MCP for Cursor and Claude on Growth and Agency. API access on Agency',
  pricing: `30-day passes that do not auto-renew. Pay by card or Telegram Stars (${STARS_AMOUNTS}), or run a guest audit with your own keys`,
} as const;

const SUITE_PICK_BASE: Pick<BestPick, 'name' | 'url' | 'pricing' | 'cons'> = {
  name: SUITE,
  url: SUITE_URL,
  pricing: 'Free live crawl check. Paid plans are 30-day passes listed on the pricing page.',
  cons: [
    LIVE_ANSWER_CHECKS,
    'No large prompt-volume database or backlink index.',
  ],
};

const SUITE_SOURCE: HubSource = { label: 'Luminara Suite methodology', url: 'https://www.luminarasuite.com/methodology' };

const COMPARE_PAGES: ComparePage[] = [
  {
    kind: 'compare',
    path: '/compare/profound',
    label: 'Luminara vs Profound',
    competitor: 'Profound',
    description:
      'Luminara Suite vs Profound: enterprise AI visibility analytics versus one labeled, evidence-bound fix per week for small teams.',
    h1: 'Luminara Suite vs Profound',
    verdict:
      'Choose Profound if you are an enterprise brand that needs SSO, SOC 2, and analytics across many answer engines. Choose Luminara Suite if you are a small team or independent agency that wants one ranked fix per week with every result labeled Measured, Estimated, or Not measured.',
    rows: [
      { label: 'Built for', them: 'Enterprise brands, with SSO, SOC 2, and dedicated support', us: US.audience },
      { label: 'Headline metrics', them: 'Share of voice and citation metrics across answer engines', us: US.metrics },
      { label: 'Coverage', them: 'Multiple AI answer engines on enterprise plans', us: US.engines },
      { label: 'Output', them: 'Dashboards plus agents for citation gaps and content briefs', us: US.output },
      { label: 'Developer access', them: 'API on the Enterprise tier', us: US.access },
      { label: 'Pricing model', them: 'Free trial, then custom-quoted enterprise packages', us: US.pricing },
    ],
    chooseThem: [
      'You need enterprise procurement items such as SSO, SAML, and SOC 2.',
      'You report AI share of voice across many engines to leadership.',
      'You want prompt-volume research and content agents in one platform.',
    ],
    chooseUs: [
      'You want one fix to ship this week, not a dashboard to interpret.',
      'You need to see which results were measured and which were not.',
      'You prefer a 30-day pass or your own keys over an annual contract.',
    ],
    faq: [
      {
        question: 'Is Luminara Suite cheaper than Profound?',
        answer:
          'Profound sells custom-quoted enterprise packages after a free trial. Luminara Suite sells 30-day passes listed on its pricing page that do not auto-renew. Check both vendors for current prices before you buy.',
      },
      {
        question: 'Does Luminara Suite track the same AI engines as Profound?',
        answer: `No. Profound tracks multiple answer engines on enterprise plans. Luminara checks your site and live web search on every plan. ${LIVE_ANSWER_CHECKS}`,
      },
      {
        question: 'Can I use Profound and Luminara Suite together?',
        answer:
          'Yes. Teams use enterprise analytics for reporting and Luminara for a labeled weekly fix list and llms.txt or schema fix packs.',
      },
    ],
    sources: [{ label: 'Profound pricing', url: 'https://www.tryprofound.com/pricing' }, SUITE_SOURCE],
  },
  {
    kind: 'compare',
    path: '/compare/ahrefs',
    label: 'Luminara vs Ahrefs',
    competitor: 'Ahrefs',
    description:
      'Luminara Suite vs Ahrefs Brand Radar: a full SEO suite with AI share of voice versus a labeled AI visibility audit with one weekly fix.',
    h1: 'Luminara Suite vs Ahrefs Brand Radar',
    verdict:
      'Choose Ahrefs if you already run SEO in Ahrefs and want AI share of voice next to backlinks and keywords. Choose Luminara Suite if you want a focused AI visibility audit that labels every result and hands you one fix to ship next.',
    rows: [
      { label: 'Built for', them: 'SEO teams and agencies already using the Ahrefs suite', us: US.audience },
      { label: 'Headline metrics', them: 'AI Share of Voice, weighted by estimated search impressions', us: US.metrics },
      { label: 'Coverage', them: 'ChatGPT, Google AI Overviews and AI Mode, Perplexity, Gemini, Copilot, plus a large pre-built prompt index', us: US.engines },
      { label: 'Output', them: 'Brand Radar reports alongside backlink and keyword data', us: US.output },
      { label: 'Developer access', them: 'Hosted MCP server and API, metered in API units', us: US.access },
      { label: 'Pricing model', them: 'Monthly subscription with public tiers', us: US.pricing },
    ],
    chooseThem: [
      'You need backlinks, keywords, and AI visibility in one tool.',
      'You want a large pre-built prompt index with no prompt setup.',
      'Your team already lives in Ahrefs.',
    ],
    chooseUs: [
      'You want a short audit and one fix, not a full SEO suite.',
      'You want no blended score and clear Not measured labels.',
      'You want llms.txt and JSON-LD fix packs tied to findings.',
    ],
    faq: [
      {
        question: 'Is Luminara Suite a replacement for Ahrefs?',
        answer:
          'No. Ahrefs goes deep on backlinks, keywords, and AI share of voice. Luminara focuses on whether your site is ready to be cited and the one fix to make next. Many teams use both.',
      },
      {
        question: 'Do both tools have an MCP server?',
        answer:
          'Yes. Ahrefs offers a hosted MCP server metered in API units. Luminara includes MCP for Cursor and Claude on Growth and Agency plans.',
      },
      {
        question: 'Does Luminara Suite show an AI share of voice number?',
        answer:
          'Only when that run measured it. Luminara never fills in a share of voice or visibility score from missing data. Missing evidence is labeled Not measured.',
      },
    ],
    sources: [{ label: 'Ahrefs Brand Radar', url: 'https://ahrefs.com/brand-radar' }, SUITE_SOURCE],
  },
  {
    kind: 'compare',
    path: '/compare/otterly',
    label: 'Luminara vs Otterly',
    competitor: 'Otterly.AI',
    description:
      'Luminara Suite vs Otterly.AI: low-cost AI search monitoring with a Brand Visibility Index versus labeled evidence and one weekly fix.',
    h1: 'Luminara Suite vs Otterly.AI',
    verdict:
      'Choose Otterly.AI if you want low-cost, ongoing monitoring of brand mentions across AI search in many countries. Choose Luminara Suite if you want an audit that labels every result Measured, Estimated, or Not measured and ranks one fix to ship next.',
    rows: [
      { label: 'Built for', them: 'Individuals and small businesses up to enterprise, with a low-cost entry tier', us: US.audience },
      { label: 'Headline metrics', them: 'Brand Visibility Index and share of voice', us: US.metrics },
      { label: 'Coverage', them: 'ChatGPT, Google AI Overviews, Perplexity, and Copilot, with add-on engines and 65+ countries', us: US.engines },
      { label: 'Output', them: 'Ongoing monitoring plus GEO page audits for crawlability', us: US.output },
      { label: 'Developer access', them: 'API quotas, MCP requests on higher plans, and a Looker Studio connector', us: US.access },
      { label: 'Pricing model', them: 'Monthly or annual subscription with a public entry tier', us: US.pricing },
    ],
    chooseThem: [
      'You want steady monitoring at a low monthly cost.',
      'You track brand mentions across many countries.',
      'You report into Looker Studio.',
    ],
    chooseUs: [
      'You want one ranked fix each week, not only monitoring.',
      'You want unmeasured engines labeled, never estimated silently.',
      'You want to pay for 30 days at a time, by card or Telegram Stars.',
    ],
    faq: [
      {
        question: 'Is Otterly.AI or Luminara Suite better for a small business?',
        answer:
          'Otterly.AI suits ongoing low-cost monitoring. Luminara suits a small team that wants a labeled audit and one fix to ship next. Pick by the job, monitoring or fixing.',
      },
      {
        question: 'Do both tools offer an MCP server?',
        answer:
          'Yes. Otterly.AI lists MCP requests on higher plans. Luminara includes MCP for Cursor and Claude on Growth and Agency.',
      },
      {
        question: 'Does Luminara Suite use a visibility index?',
        answer:
          'No. Luminara does not blend results into an index. Each row is labeled Measured, Estimated, or Not measured.',
      },
    ],
    sources: [{ label: 'Otterly.AI pricing', url: 'https://otterly.ai/pricing' }, SUITE_SOURCE],
  },
  {
    kind: 'compare',
    path: '/compare/peec',
    label: 'Luminara vs Peec',
    competitor: 'Peec AI',
    description:
      'Luminara Suite vs Peec AI: multi-client AI search analytics for marketing teams versus a labeled audit with one weekly fix.',
    h1: 'Luminara Suite vs Peec AI',
    verdict:
      'Choose Peec AI if you are a marketing team or agency that needs AI search analytics across many clients with unlimited seats. Choose Luminara Suite if you want a labeled audit and one ranked fix per week, priced as a 30-day pass.',
    rows: [
      { label: 'Built for', them: 'Brands and agencies, with separate agency tiers and unlimited users', us: US.audience },
      { label: 'Headline metrics', them: 'Visibility, position, sentiment, and cited sources', us: US.metrics },
      { label: 'Coverage', them: 'ChatGPT, Gemini, Google AI Overviews and AI Mode, Perplexity, Claude, and more', us: US.engines },
      { label: 'Output', them: 'Analytics dashboards with per-project permissions', us: US.output },
      { label: 'Developer access', them: 'API on higher tiers, an MCP server, and a Looker Studio connector', us: US.access },
      { label: 'Pricing model', them: 'Monthly subscription with public brand and agency tiers', us: US.pricing },
    ],
    chooseThem: [
      'You run AI search reporting for many clients.',
      'You need unlimited seats and per-project permissions.',
      'You want sentiment and position tracked across many engines.',
    ],
    chooseUs: [
      'You want a ranked fix list, not another analytics dashboard.',
      'You want missing data labeled Not measured, never filled in.',
      'You want to pay 30 days at a time or bring your own keys.',
    ],
    faq: [
      {
        question: 'Is Peec AI or Luminara Suite better for agencies?',
        answer:
          'Peec AI is built around multi-client agency analytics with unlimited seats. Luminara Agency adds client workspaces, API access, and white-label PDFs to a labeled audit. Pick Peec for reporting depth and Luminara for a weekly fix loop.',
      },
      {
        question: 'Do Peec AI and Luminara Suite both have MCP?',
        answer:
          'Yes. Peec AI offers an MCP server for Claude, Cursor, and other IDEs. Luminara includes MCP on Growth and Agency plans.',
      },
      {
        question: 'Does Luminara Suite measure sentiment?',
        answer:
          'Not as a score. Luminara records what the evidence in that run shows and labels anything it did not collect as Not measured.',
      },
    ],
    sources: [{ label: 'Peec AI pricing', url: 'https://peec.ai/pricing' }, SUITE_SOURCE],
  },
  {
    kind: 'compare',
    path: '/compare/semrush',
    label: 'Luminara vs Semrush',
    competitor: 'Semrush',
    description:
      'Luminara Suite vs the Semrush AI Visibility Toolkit: a 0-100 AI Visibility Score inside a full marketing suite versus labeled evidence and one weekly fix.',
    h1: 'Luminara Suite vs Semrush AI Visibility Toolkit',
    verdict:
      'Choose Semrush if you already use its SEO and PPC suite and want an AI Visibility Score next to it. Choose Luminara Suite if you want no blended score, every result labeled Measured, Estimated, or Not measured, and one fix to ship next.',
    rows: [
      { label: 'Built for', them: 'Marketers and agencies already using Semrush', us: US.audience },
      { label: 'Headline metrics', them: 'AI Visibility Score (0-100), mentions, cited pages, sentiment, and share of voice', us: US.metrics },
      { label: 'Coverage', them: 'Multiple AI answer engines, including ChatGPT and Google AI Overviews', us: US.engines },
      { label: 'Output', them: 'AI visibility reports beside the full SEO and PPC suite', us: US.output },
      { label: 'Developer access', them: 'Semrush MCP server with OAuth or API key', us: US.access },
      { label: 'Pricing model', them: 'Monthly subscription, with the AI toolkit sold alongside Semrush plans', us: US.pricing },
    ],
    chooseThem: [
      'You already pay for Semrush and want AI visibility in the same place.',
      'Leadership wants a single 0-100 score to track.',
      'You need SEO, PPC, and AI visibility data together.',
    ],
    chooseUs: [
      'You do not want a blended score that hides missing data.',
      'You want one ranked fix and a fix pack, not a suite.',
      'You want a 30-day pass instead of a monthly suite subscription.',
    ],
    faq: [
      {
        question: 'Why does Luminara Suite not show a 0-100 AI visibility score?',
        answer:
          'A blended score hides which inputs were measured and which were guessed. Luminara labels every result Measured, Estimated, or Not measured instead.',
      },
      {
        question: 'Does Semrush have an MCP server like Luminara Suite?',
        answer:
          'Yes. Semrush offers an MCP server with OAuth or an API key. Luminara includes MCP for Cursor and Claude on Growth and Agency.',
      },
      {
        question: 'Can I use Semrush and Luminara Suite together?',
        answer:
          'Yes. Use Semrush for keyword and competitor research and Luminara for a labeled weekly fix and llms.txt or schema fix packs.',
      },
    ],
    sources: [{ label: 'Semrush knowledge base: AI Visibility Toolkit', url: 'https://www.semrush.com/kb/' }, { label: 'Semrush pricing', url: 'https://www.semrush.com/prices/' }, SUITE_SOURCE],
  },
];

const BEST_METHODOLOGY = [
  `We read each vendor's public product, pricing, and documentation pages in ${HUB_REVIEWED}.`,
  'We did not run paid trials of every tool, so we publish no scores or rankings for other products.',
  'Luminara Suite is our product. It is listed first only for the use case it was built for.',
  'Prices change often. Check each vendor before you buy.',
];

const BEST_PAGES: BestPage[] = [
  {
    kind: 'best',
    path: '/best/ai-visibility-tools-for-real-estate-agencies',
    label: 'Best AI visibility tools for real estate',
    description:
      'AI visibility tools for real estate agencies, picked by use case: weekly fixes, low-cost monitoring, multi-client agencies, and existing SEO suites.',
    h1: 'Best AI visibility tools for real estate agencies',
    verdict:
      'For an independent agency that wants one fix to ship each week, start with Luminara Suite. For low-cost monitoring pick Otterly.AI, for multi-client reporting pick Peec AI, and if you already pay for Semrush use its AI Visibility Toolkit.',
    picks: [
      {
        ...SUITE_PICK_BASE,
        bestFor: 'Best for independent agencies that want one weekly fix',
        icp: 'Principals and marketing leads at independent real estate agencies.',
        pros: [
          'Every result labeled Measured, Estimated, or Not measured.',
          'One ranked fix per week plus llms.txt and JSON-LD fix packs.',
          '30-day passes by card or Telegram Stars, or a guest audit with your own keys.',
        ],
      },
      {
        name: 'Otterly.AI',
        url: 'https://otterly.ai/',
        bestFor: 'Best for low-cost monitoring',
        icp: 'Small offices that want steady brand-mention tracking.',
        pros: ['Low-cost public entry tier.', 'Monitors core AI engines with add-ons.', 'GEO page audits for crawlability.'],
        cons: ['Monitoring first: you decide what to fix.', 'Results summarized as a visibility index.'],
        pricing: 'Monthly or annual subscription with a public entry tier.',
      },
      {
        name: 'Peec AI',
        url: 'https://peec.ai/',
        bestFor: 'Best for groups and marketing agencies with many clients',
        icp: 'Franchise groups or agencies reporting on many offices.',
        pros: ['Separate agency tiers with unlimited users.', 'Per-project permissions.', 'API, MCP server, and Looker Studio connector.'],
        cons: ['Analytics first: no built-in weekly fix.', 'More setup than a single-office team needs.'],
        pricing: 'Monthly subscription with public brand and agency tiers.',
      },
      {
        name: 'Semrush AI Visibility Toolkit',
        url: 'https://www.semrush.com/',
        bestFor: 'Best if you already pay for Semrush',
        icp: 'Agencies whose marketing team already uses Semrush.',
        pros: ['AI visibility next to SEO and PPC data.', 'Mentions, cited pages, and sentiment.', 'MCP server.'],
        cons: ['Headline is a blended 0-100 score.', 'Sold alongside a broader suite.'],
        pricing: 'Monthly subscription alongside Semrush plans.',
      },
    ],
    methodology: [...BEST_METHODOLOGY, 'None of these tools is built only for real estate. We picked by the job an agency needs done.'],
    faq: [
      {
        question: 'What is the best AI visibility tool for a small real estate agency?',
        answer:
          'If you want one fix each week with honest labels, start with Luminara Suite. If you only want low-cost monitoring, Otterly.AI is a common choice.',
      },
      {
        question: 'Do real estate agencies need an AI visibility tool at all?',
        answer:
          'Buyers and sellers now ask AI assistants which agency to call in a suburb. A tool shows whether your site is readable and cited, and what to fix first.',
      },
      {
        question: 'Can I check my agency for free?',
        answer:
          'Yes. The Luminara live crawl check reads your robots.txt and llms.txt with no card and no account.',
      },
    ],
    sources: [
      { label: 'Otterly.AI pricing', url: 'https://otterly.ai/pricing' },
      { label: 'Peec AI pricing', url: 'https://peec.ai/pricing' },
      { label: 'Semrush knowledge base', url: 'https://www.semrush.com/kb/' },
      SUITE_SOURCE,
    ],
  },
  {
    kind: 'best',
    path: '/best/aeo-audit-tools-for-small-business',
    label: 'Best AEO audit tools for small business',
    description:
      'Answer engine optimization (AEO) audit tools for small businesses, picked by use case: one weekly fix, low-cost monitoring, and full SEO suites.',
    h1: 'Best AEO audit tools for small business',
    verdict:
      'For a small business that wants an AEO audit with one clear fix, start with Luminara Suite. Pick Otterly.AI for low-cost monitoring, and Ahrefs or Semrush if you also need a full SEO suite.',
    picks: [
      {
        ...SUITE_PICK_BASE,
        bestFor: 'Best for a labeled audit and one weekly fix',
        icp: 'Owners and small marketing teams without an SEO specialist.',
        pros: [
          'Plain-English verdict and one ranked fix.',
          'No blended score. Missing data is labeled Not measured.',
          'Free live crawl check with no card.',
        ],
      },
      {
        name: 'Otterly.AI',
        url: 'https://otterly.ai/',
        bestFor: 'Best for low-cost monitoring',
        icp: 'Small businesses that want to watch brand mentions over time.',
        pros: ['Low-cost public entry tier.', '65+ countries.', 'GEO page audits.'],
        cons: ['Monitoring first, fixes second.', 'Visibility index rather than labeled evidence.'],
        pricing: 'Monthly or annual subscription with a public entry tier.',
      },
      {
        name: 'Ahrefs Brand Radar',
        url: 'https://ahrefs.com/brand-radar',
        bestFor: 'Best if you also need backlinks and keywords',
        icp: 'Small businesses with an in-house SEO who already use Ahrefs.',
        pros: ['AI Share of Voice next to backlink data.', 'Large pre-built prompt index.', 'Hosted MCP server.'],
        cons: ['Full SEO suite is more than many owners need.', 'Share of voice is weighted by estimated impressions.'],
        pricing: 'Monthly subscription with public tiers.',
      },
      {
        name: 'Semrush AI Visibility Toolkit',
        url: 'https://www.semrush.com/',
        bestFor: 'Best if you already run Semrush',
        icp: 'Small businesses already paying for Semrush.',
        pros: ['AI visibility next to SEO and PPC.', 'Mentions, cited pages, and sentiment.', 'MCP server.'],
        cons: ['Headline is a blended 0-100 score.', 'Sold alongside a broader suite.'],
        pricing: 'Monthly subscription alongside Semrush plans.',
      },
    ],
    methodology: BEST_METHODOLOGY,
    faq: [
      {
        question: 'What is an AEO audit?',
        answer:
          'An answer engine optimization audit checks whether AI answer engines can read, trust, and cite your site: crawler access, llms.txt, structured data, and answer-ready content.',
      },
      {
        question: 'What is the cheapest way to start an AEO audit?',
        answer:
          'Run a free live crawl check first. Luminara reads robots.txt and llms.txt with no card and no account, then a free account runs a fuller audit on a daily allowance.',
      },
      {
        question: 'Do I need an SEO suite for AEO?',
        answer:
          'Not to start. A suite helps with keywords and backlinks. A focused AEO audit tells you what blocks AI answers from citing you.',
      },
    ],
    sources: [
      { label: 'Otterly.AI pricing', url: 'https://otterly.ai/pricing' },
      { label: 'Ahrefs Brand Radar', url: 'https://ahrefs.com/brand-radar' },
      { label: 'Semrush knowledge base', url: 'https://www.semrush.com/kb/' },
      SUITE_SOURCE,
    ],
  },
  {
    kind: 'best',
    path: '/best/ai-visibility-tools-with-mcp',
    label: 'Best AI visibility tools with MCP',
    description:
      'AI visibility and SEO tools with an MCP server for Cursor, Claude, and other agents, picked by use case.',
    h1: 'Best AI visibility tools with an MCP server',
    verdict:
      'For agents that should load project context, check a research log, and save a report, use Luminara Suite MCP. For backlink and keyword data in an agent pick Ahrefs or Semrush MCP, and for multi-client analytics pick Peec AI.',
    picks: [
      {
        ...SUITE_PICK_BASE,
        bestFor: 'Best for agent workflows that end in a saved report',
        icp: 'Developers and agencies running Cursor, Claude, or Codex on client sites.',
        pros: [
          'Shared project context and research log between the app and agents.',
          'save_report returns a durable report link, not a chat wall of text.',
          'Same labels in MCP as in the app: Measured, Estimated, Not measured.',
        ],
      },
      {
        name: 'Ahrefs MCP',
        url: 'https://ahrefs.com/',
        bestFor: 'Best for backlink and keyword data in an agent',
        icp: 'SEO teams already on an Ahrefs plan.',
        pros: ['Hosted MCP server.', 'Backlink, keyword, and Brand Radar data.', 'Large prompt index.'],
        cons: ['Metered in API units.', 'Needs a paid Ahrefs plan.'],
        pricing: 'Requires a paid Ahrefs plan, metered in API units.',
      },
      {
        name: 'Semrush MCP',
        url: 'https://www.semrush.com/',
        bestFor: 'Best if your team already runs Semrush',
        icp: 'Marketing teams that want Semrush data inside Claude or Cursor.',
        pros: ['OAuth in Claude and ChatGPT, API key for Cursor.', 'SEO, PPC, and AI visibility data.'],
        cons: ['AI visibility headline is a blended 0-100 score.', 'Needs a Semrush subscription.'],
        pricing: 'Monthly Semrush subscription.',
      },
      {
        name: 'Peec AI MCP',
        url: 'https://peec.ai/',
        bestFor: 'Best for multi-client AI search analytics',
        icp: 'Agencies reporting AI search visibility for many brands.',
        pros: ['MCP server for Claude, Cursor, and VS Code.', 'API on higher tiers.', 'Unlimited users.'],
        cons: ['Analytics first: no built-in weekly fix.'],
        pricing: 'Monthly subscription with public brand and agency tiers.',
      },
    ],
    methodology: BEST_METHODOLOGY,
    faq: [
      {
        question: 'What is an MCP server for SEO?',
        answer:
          'Model Context Protocol lets an AI agent such as Cursor or Claude call a tool directly. An SEO MCP server gives the agent audit, keyword, or visibility data without copy and paste.',
      },
      {
        question: 'Which Luminara plans include MCP?',
        answer:
          'Growth and Agency include MCP for Cursor, Claude, and the Luminara plugin. Paid research tools also need Agency API access or your own DataForSEO keys.',
      },
      {
        question: 'Will an MCP tool invent SEO numbers?',
        answer:
          'Luminara MCP tools never invent metrics. When data is missing they return not_measured or unknown.',
      },
    ],
    sources: [
      { label: 'Luminara MCP docs', url: 'https://www.luminarasuite.com/docs/mcp.html' },
      { label: 'Ahrefs API and MCP', url: 'https://ahrefs.com/api' },
      { label: 'Semrush pricing', url: 'https://www.semrush.com/prices/' },
      { label: 'Peec AI pricing', url: 'https://peec.ai/pricing' },
    ],
  },
];

export const HUB_PAGES: readonly HubPage[] = [...COMPARE_PAGES, ...BEST_PAGES];

const HUB_BY_PATH = new Map(HUB_PAGES.map((page) => [page.path, page]));

/** Hub page for a pathname (trailing slash tolerant, case sensitive like marketingShellKey), or null. */
export function hubPageForPath(pathname: string): HubPage | null {
  return HUB_BY_PATH.get(pathname.replace(/\/+$/, '')) ?? null;
}
