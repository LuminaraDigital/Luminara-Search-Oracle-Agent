/**
 * Crawl surfaces served by the Worker (and mirrored under public/ for Vite).
 * Keep copy factual; no invented metrics.
 */
import { CHECKOUT_TERM_LINE, listPriceSummary } from '../components/paywall/planCopy';
import { PAID_PLAN_PRICES, type PaidPlanId } from '../components/paywall/planPrices';
import { LIVE_ANSWER_CHECKS } from '../services/marketing/engineCoverage';
import { REAL_ESTATE_AUDIENCE } from '../services/marketing/marketingHeroCopy';
import { HUB_PAGES, HUB_REVIEWED } from '../services/marketing/seoHubPages';
import { FREE_TOOLS, FREE_TOOLS_PATH } from '../services/marketing/freeTools';
import { COMPANY_SERVICES_URL, COMPANY_SITE_URL } from '../services/legal/consumerTerms';
import { PLAN_ENTITLEMENTS } from '../services/plans/planEntitlements';

export const ROBOTS_TXT = `# Luminara Suite crawl policy
# Public marketing pages, /llms.txt, /ai.txt, and redacted /share/teaser/ cards are meant to be cited.
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
Allow: /faq
Allow: /contact
Allow: /desktop
Allow: /compare/
Allow: /best/
Allow: /docs/
Allow: /docs/what-is-aeo.html
Allow: /llms.txt
Allow: /ai.txt
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
Allow: /faq
Allow: /contact
Allow: /desktop
Allow: /compare/
Allow: /best/
Allow: /docs/
Allow: /docs/what-is-aeo.html
Allow: /llms.txt
Allow: /ai.txt
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
  <url><loc>${base}/faq</loc></url>
  <url><loc>${base}/contact</loc></url>
  <url><loc>${base}/docs/mcp.html</loc></url>
  <url><loc>${base}/docs/what-is-aeo.html</loc></url>
  <url><loc>${base}/desktop</loc></url>
${HUB_PAGES.map((page) => `  <url><loc>${base}${page.path}</loc></url>`).join('\n')}
  <url><loc>${base}${FREE_TOOLS_PATH}</loc></url>
${FREE_TOOLS.map((tool) => `  <url><loc>${base}${tool.path}</loc></url>`).join('\n')}
  <url><loc>${base}/llms.txt</loc></url>
  <url><loc>${base}/ai.txt</loc></url>
</urlset>
`;
}

export const SITEMAP_XML = buildSitemapXml('https://www.luminarasuite.com');

function llmsPaidPlanBlock(): string {
  const ids: PaidPlanId[] = ['starter', 'growth', 'agency'];
  return ids.map((id) => {
    const price = PAID_PLAN_PRICES[id];
    const ent = PLAN_ENTITLEMENTS[id];
    const parts = [
      `${ent.title}: list price ${price.audLabel}, pay ${price.starsLabel}`,
      `${ent.domainLimit} monitored domains`,
      ent.mcpAccess ? 'IDE access' : 'No IDE access',
      ent.shareLinks ? 'Public share links' : 'No public share links',
    ];
    if (ent.scheduledReaudit !== 'none') {
      const cadence = ent.scheduledReaudit.charAt(0).toUpperCase() + ent.scheduledReaudit.slice(1);
      parts.push(`${cadence} re-audit reminders in Telegram`);
    }
    if (ent.apiAccess) parts.push('API access');
    if (ent.agencyClientLimit > 0) {
      parts.push(`${ent.agencyClientLimit} client workspaces`);
    }
    if (id === 'agency') {
      parts.push('Daily drift check');
      if (ent.whiteLabelPdf) parts.push('White-label PDF');
      parts.push(LIVE_ANSWER_CHECKS);
    }
    const line = parts.join('. ');
    return `- ${line.endsWith('.') ? line : `${line}.`}`;
  }).join('\n');
}

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
Luminara Suite checks whether AI answers name a real estate agency, then ranks one fix to ship next. ${LIVE_ANSWER_CHECKS} Rather than inventing 0-100 scores, it measures crawler directives, structured data, and answer density, ranking one prioritized remediation action per week. ${REAL_ESTATE_AUDIENCE}

### How does Luminara compare to traditional SEO suites?
Traditional SEO suites track blue-link keyword rankings and backlink counts. Luminara Suite monitors LLM crawler readiness and knowledge-graph grounding. ${LIVE_ANSWER_CHECKS} Every metric is labeled measured, estimated, or not_measured.

### What is Answer Engine Optimization (AEO)?
Answer Engine Optimization (AEO) is the discipline of structuring web content, technical crawl assets, and entity schema so an answer engine can quote the brand. AEO is not a score.

## Sitemap

- https://www.luminarasuite.com/sitemap.xml

## Pricing (30 days)

${CHECKOUT_TERM_LINE} ${listPriceSummary()}

${llmsPaidPlanBlock()}
- Free: ${PLAN_ENTITLEMENTS.free.domainLimit} domain. Telegram initData or a signed-in account can use a capped hosted scout. Anonymous web visitors use their own API keys. Redacted teaser links are free. Full branded share links are Growth and Agency only.

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

## Comparisons and buyer's guides

Competitor rows cite each vendor's public pages as of ${HUB_REVIEWED}. No scores are published for other products.

${HUB_PAGES.map((page) => `- ${page.label}: https://www.luminarasuite.com${page.path}`).join('\n')}

## Free tools

They run in the browser with no account. Nothing typed is sent to Luminara.

- All free tools: https://www.luminarasuite.com${FREE_TOOLS_PATH}
${FREE_TOOLS.map((tool) => `- ${tool.label}: https://www.luminarasuite.com${tool.path}`).join('\n')}

## Studio

- Luminara Digital: ${COMPANY_SITE_URL}
- Services: ${COMPANY_SERVICES_URL}
- Source: https://github.com/LuminaraDigital/Luminara-Search-Oracle-Agent

## Legal

- Privacy: https://www.luminarasuite.com/privacy
- Terms: https://www.luminarasuite.com/terms
`;

export const AI_TXT = `# Luminara Suite AI policy (ai.txt)
# Public marketing pages, /llms.txt, /ai.txt, and redacted /share/teaser/ cards may be crawled and cited with attribution.
# Unlisted full reports under /share/ are served noindex and are not for training or citation.
# API, verification, report storage, and OAuth routes are disallowed.
# Structured product context for answer engines lives at https://www.luminarasuite.com/llms.txt
# Methodology and honesty glossary: https://www.luminarasuite.com/docs/what-is-aeo.html

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
Allow: /faq
Allow: /contact
Allow: /desktop
Allow: /compare/
Allow: /best/
Allow: /docs/
Allow: /docs/what-is-aeo.html
Allow: /llms.txt
Allow: /ai.txt
Allow: /sitemap.xml
Allow: /share/teaser/
Disallow: /api/
Disallow: /verify/
Disallow: /reports/
Disallow: /oauth/
`;

/**
 * Crawl file this Worker would serve for one of its own Custom Domains.
 * A fetch() of that hostname returns Cloudflare 522, so callers read these bytes instead.
 * Returns null when `serveHost` does not serve `fileUrl` (another host, or not a crawl file).
 */
export function readServedCrawlFile(serveHost: string, fileUrl: string): { status: number; body: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(fileUrl);
  } catch {
    return null;
  }
  const serve = serveHost.toLowerCase().split(':')[0];
  const target = parsed.hostname.toLowerCase();
  const ownProduction = PRODUCTION_CRAWL_HOSTS.has(serve) && PRODUCTION_CRAWL_HOSTS.has(target);
  const ownStaging = serve === STAGING_CRAWL_HOST && target === STAGING_CRAWL_HOST;
  if (!ownProduction && !ownStaging) return null;
  if (parsed.pathname === '/robots.txt') return { status: 200, body: robotsTxtForHost(target, undefined) };
  if (parsed.pathname === '/llms.txt') return { status: 200, body: LLMS_TXT };
  if (parsed.pathname === '/ai.txt') return { status: 200, body: AI_TXT };
  return null;
}
