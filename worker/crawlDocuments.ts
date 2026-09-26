/**
 * Crawl surfaces served by the Worker (and mirrored under public/ for Vite).
 * Keep copy factual; no invented metrics.
 */

export const ROBOTS_TXT = `# Luminara Suite crawl policy
# Public marketing pages, /llms.txt, and redacted /share/teaser/ cards are meant to be cited.
# Full branded share reports (/share/<token>), attestation verify, API, and OAuth stay disallowed.
# Named AI crawlers repeat the same rules as User-agent: * so the allow is explicit.
# Allow: /share/teaser/ is more specific than Disallow: /share/, so teaser cards stay readable.
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
Allow: /privacy
Allow: /terms
Allow: /desktop
Allow: /docs/
Allow: /llms.txt
Allow: /sitemap.xml
Allow: /share/teaser/
Disallow: /api/
Disallow: /share/
Disallow: /verify/
Disallow: /reports/
Disallow: /oauth/

User-agent: *
Allow: /
Allow: /how-it-works
Allow: /ai
Allow: /why
Allow: /pricing
Allow: /privacy
Allow: /terms
Allow: /desktop
Allow: /docs/
Allow: /llms.txt
Allow: /sitemap.xml
Allow: /share/teaser/
Disallow: /api/
Disallow: /share/
Disallow: /verify/
Disallow: /reports/
Disallow: /oauth/

Sitemap: https://www.luminarasuite.com/sitemap.xml
Sitemap: https://luminarasuite.com/sitemap.xml
`;

export function buildSitemapXml(origin: string = 'https://www.luminarasuite.com'): string {
  const base = origin.replace(/\/+$/, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc></url>
  <url><loc>${base}/how-it-works</loc></url>
  <url><loc>${base}/ai</loc></url>
  <url><loc>${base}/why</loc></url>
  <url><loc>${base}/pricing</loc></url>
  <url><loc>${base}/privacy</loc></url>
  <url><loc>${base}/terms</loc></url>
  <url><loc>${base}/docs/mcp.html</loc></url>
  <url><loc>${base}/desktop</loc></url>
  <url><loc>${base}/llms.txt</loc></url>
</urlset>
`;
}

export const SITEMAP_XML = buildSitemapXml('https://www.luminarasuite.com');

export const LLMS_TXT = `# Luminara Suite

> Luminara Suite audits how a website shows up in Google, AI Overviews, ChatGPT, and Perplexity, then ranks one next fix. Web app, Windows desktop, and a Telegram Mini App.

## What Instant Audit measures

Instant Audit can report citation rate, share of voice, and page health only when that run collected live page or search evidence.

Honesty policy:
- measured: the figure comes from evidence collected in that run
- estimated: a labelled estimate, never presented as a measured score
- not_measured: the provider failed, the sample was empty, or the signal was not collected
- Suite does not invent citation percentages, health scores, or share of voice when evidence is missing

LLM crawler readiness is pass, fail, or not_measured for llms.txt presence and common AI bot directives in robots.txt. It is not a score.

## Pricing (30 days)

Published USD labels. Telegram Stars or TON can pay inside the app. Card checkout is not available yet.

- Starter: US$49. Up to 2 sites. No MCP. No full public share links.
- Growth: US$149. MCP, full share links, 3 seats, weekly re-audits.
- Agency: US$349. API access, 10 client seats, daily Sentinel, white-label PDF.
- Free: 1 domain. Telegram initData or a signed-in account can use a capped hosted scout. Anonymous web visitors use their own API keys. Redacted teaser links are free. Full branded share links are Growth and Agency only.

## MCP

- Docs: https://www.luminarasuite.com/docs/mcp.html
- Endpoint: https://luminarasuite.com/api/mcp
- MCP access is included on Growth and Agency.

## Telegram Mini App

- https://t.me/LuminaraSuiteBot/app

## Product

- Home: https://www.luminarasuite.com/
- How it works: https://www.luminarasuite.com/how-it-works
- Our AI: https://www.luminarasuite.com/ai
- Why Luminara: https://www.luminarasuite.com/why
- Pricing: https://www.luminarasuite.com/pricing
- Windows desktop: https://www.luminarasuite.com/desktop

## Studio

- Luminara Digital: https://luminaradigital.io
- Source: https://github.com/LuminaraDigital/Luminara-Search-Oracle-Agent

## Legal

- Privacy: https://www.luminarasuite.com/privacy
- Terms: https://www.luminarasuite.com/terms
`;
