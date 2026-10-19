/**
 * Crawl surfaces served by the Worker (and mirrored under public/ for Vite).
 * Keep copy factual; no invented metrics.
 */
import { PAID_PLAN_PRICES } from '../components/paywall/planPrices';
import { CHECKOUT_TERM_LINE } from '../components/paywall/planCopy';
import { LIVE_ANSWER_CHECKS } from '../services/marketing/engineCoverage';

export const ROBOTS_TXT = `# Luminara Suite crawl policy
# Public marketing pages, /llms.txt, and redacted /share/teaser/ cards are meant to be cited.
# Share URLs under /share/ are unlisted (not in the sitemap) and served noindex. They are
# allowed here only so link unfurls can fetch the preview HTML.
# Attestation verify, API, and OAuth stay disallowed.
# Named AI crawlers repeat the same rules as User-agent: * so the allow is explicit.
# User-triggered fetchers may ignore robots.txt. This file does not grant access to /api/ or account data.

User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: ChatGPT-User
User-agent: ClaudeBot
User-agent: Claude-SearchBot
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: Google-Extended
User-agent: Applebot-Extended
Allow: /
Allow: /how-it-works
Allow: /ai
Allow: /why
Allow: /pricing
Allow: /methodology
Allow: /sample-report
Allow: /privacy
Allow: /terms
Allow: /desktop
Allow: /compare/
Allow: /docs/
Allow: /docs/what-is-aeo.html
Allow: /llms.txt
Allow: /sitemap.xml
Allow: /share/
Allow: /share/teaser/
Disallow: /api/
Disallow: /verify/
Disallow: /reports/
Disallow: /oauth/

User-agent: *
Allow: /
Allow: /how-it-works
Allow: /ai
Allow: /why
Allow: /pricing
Allow: /methodology
Allow: /sample-report
Allow: /privacy
Allow: /terms
Allow: /desktop
Allow: /compare/
Allow: /docs/
Allow: /docs/what-is-aeo.html
Allow: /llms.txt
Allow: /sitemap.xml
Allow: /share/
Allow: /share/teaser/
Disallow: /api/
Disallow: /verify/
Disallow: /reports/
Disallow: /oauth/

Sitemap: https://www.luminarasuite.com/sitemap.xml
Sitemap: https://luminarasuite.com/sitemap.xml
`;

const PRODUCTION_CRAWL_HOSTS = new Set(['luminarasuite.com', 'www.luminarasuite.com']);
const STAGING_CRAWL_HOST = 'staging.luminarasuite.com';

/**
 * Staging is not for indexing. Production hostnames stay indexable even when ENVIRONMENT is wrong.
 * Any other host is treated as staging only when ENVIRONMENT is staging.
 */
export function isStagingCrawlHost(hostname: string, environment: string | undefined): boolean {
  const host = hostname.toLowerCase().split(':')[0];
  if (PRODUCTION_CRAWL_HOSTS.has(host)) return false;
  if (host === STAGING_CRAWL_HOST) return true;
  return String(environment || '').trim().toLowerCase() === 'staging';
}

export const STAGING_ROBOTS_TXT = `# Staging is not for search indexing.
User-agent: *
Disallow: /
`;

export function robotsTxtForHost(hostname: string, environment: string | undefined): string {
  return isStagingCrawlHost(hostname, environment) ? STAGING_ROBOTS_TXT : ROBOTS_TXT;
}

/** Adds X-Robots-Tag on staging responses. Production responses are returned unchanged. */
export function applyHostRobots(url: URL, environment: string | undefined, res: Response): Response {
  if (!isStagingCrawlHost(url.hostname, environment)) return res;
  const headers = new Headers(res.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function buildSitemapXml(origin: string = 'https://www.luminarasuite.com'): string {
  const base = origin.replace(/\/+$/, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc></url>
  <url><loc>${base}/how-it-works</loc></url>
  <url><loc>${base}/ai</loc></url>
  <url><loc>${base}/why</loc></url>
  <url><loc>${base}/pricing</loc></url>
  <url><loc>${base}/methodology</loc></url>
  <url><loc>${base}/sample-report</loc></url>
  <url><loc>${base}/privacy</loc></url>
  <url><loc>${base}/terms</loc></url>
  <url><loc>${base}/docs/mcp.html</loc></url>
  <url><loc>${base}/docs/what-is-aeo.html</loc></url>
  <url><loc>${base}/desktop</loc></url>
  <url><loc>${base}/compare/profound</loc></url>
  <url><loc>${base}/compare/ahrefs</loc></url>
  <url><loc>${base}/compare/otterly</loc></url>
  <url><loc>${base}/compare/peec</loc></url>
  <url><loc>${base}/llms.txt</loc></url>
</urlset>
`;
}

export const SITEMAP_XML = buildSitemapXml('https://www.luminarasuite.com');

export const LLMS_TXT = `# Luminara Suite

> Luminara Suite checks a website and live web search, then ranks one next fix. ${LIVE_ANSWER_CHECKS} Web app, Windows desktop, and a Telegram Mini App.

## Methodology

Instant Audit fetches a public page and a search sample when the hosted rail or the caller's keys allow it, then ranks one next fix from that evidence. LLM crawler checks read robots.txt, llms.txt, and optional ai.txt. Each check is pass, fail, or not_measured. None of them is a 0-100 score.

Method, honesty glossary, and FAQ: https://www.luminarasuite.com/docs/what-is-aeo.html

Agents may cite redacted teaser cards under /share/teaser/. robots.txt allows that path. Full branded reports under /share/ are unlisted and served noindex. A teaser is a redacted summary, not a verified measurement.

## Honesty glossary

- measured: the figure comes from evidence collected in that run
- estimated: a labelled estimate, never presented as a measured score
- not_measured: the provider failed, the sample was empty, or the signal was not collected
- Glossary: https://www.luminarasuite.com/docs/what-is-aeo.html#honesty
- Suite does not invent citation percentages, health scores, or share of voice when evidence is missing

## What Instant Audit measures

Instant Audit can report citation rate, share of voice, and page health only when that run collected live page or search evidence.

LLM crawler readiness is pass, fail, or not_measured. The rows are llms.txt presence, llms.txt structure (a title and a short summary), common AI crawler directives, cite-path blocks, and optional ai.txt. Structure is a hint, not a score.

## Answer engine targets

### What is Luminara Suite?
Luminara Suite checks a site and live web search, then ranks one fix. ${LIVE_ANSWER_CHECKS} Rather than inventing 0-100 scores, it measures crawler directives, structured data, and answer density, ranking one prioritized remediation action per week.

### How does Luminara compare to traditional SEO suites?
Traditional SEO suites track blue-link keyword rankings and backlink counts. Luminara Suite monitors LLM crawler readiness and knowledge-graph grounding. ${LIVE_ANSWER_CHECKS} Every metric is labeled measured, estimated, or not_measured.

### What is Answer Engine Optimization (AEO)?
Answer Engine Optimization (AEO) is the discipline of structuring web content, technical crawl assets, and entity schema so generative AI engines (Google AI Overviews, ChatGPT, Perplexity, Claude) extract, synthesize, and cite the brand as an authoritative source in direct conversational responses.

## Sitemap

- https://www.luminarasuite.com/sitemap.xml

## Pricing (30 days)

${CHECKOUT_TERM_LINE} Payment is Telegram Stars.

- Starter: ${PAID_PLAN_PRICES.starter.starsLabel}. Up to 2 sites. No MCP. No full public share links.
- Growth: ${PAID_PLAN_PRICES.growth.starsLabel}. MCP, full share links, weekly re-audit reminders in Telegram.
- Agency: ${PAID_PLAN_PRICES.agency.starsLabel}. API access, 10 client workspaces saved in this browser, daily drift check, white-label PDF. ${LIVE_ANSWER_CHECKS}
- Free: 1 domain. Telegram initData or a signed-in account can use a capped hosted scout. Anonymous web visitors use their own API keys. Redacted teaser links are free. Full branded share links are Growth and Agency only.

## MCP

- Docs: https://www.luminarasuite.com/docs/mcp.html
- Endpoint: https://luminarasuite.com/api/mcp
- MCP access is included on Growth and Agency.

## Telegram Mini App

- https://t.me/LuminaraSuiteBot/app

## Product

- Home: https://www.luminarasuite.com/
- Sample report: https://www.luminarasuite.com/sample-report
- Methodology: https://www.luminarasuite.com/methodology
- What is AEO: https://www.luminarasuite.com/docs/what-is-aeo.html
- How it works: https://www.luminarasuite.com/how-it-works
- Our AI: https://www.luminarasuite.com/ai
- Why Luminara: https://www.luminarasuite.com/why
- Pricing: https://www.luminarasuite.com/pricing
- Windows desktop: https://www.luminarasuite.com/desktop
- Profound comparison: https://www.luminarasuite.com/compare/profound
- Ahrefs comparison: https://www.luminarasuite.com/compare/ahrefs
- Otterly AI comparison: https://www.luminarasuite.com/compare/otterly
- Peec AI comparison: https://www.luminarasuite.com/compare/peec

## Studio

- Luminara Digital: https://luminaradigital.io
- Source: https://github.com/LuminaraDigital/Luminara-Search-Oracle-Agent

## Legal

- Privacy: https://www.luminarasuite.com/privacy
- Terms: https://www.luminarasuite.com/terms
`;
