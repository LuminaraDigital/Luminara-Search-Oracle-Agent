/**
 * Crawl surfaces served by the Worker (and mirrored under public/ for Vite).
 * Keep copy factual; no invented metrics.
 */

export const ROBOTS_TXT = `User-agent: *
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
Allow: /docs/
Allow: /llms.txt
Allow: /sitemap.xml
# Unlisted share URLs (not in sitemap). Allowed so link unfurls can fetch OG HTML.
Allow: /share/

Disallow: /api/
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
  <url><loc>${base}/methodology</loc></url>
  <url><loc>${base}/sample-report</loc></url>
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

> Find out whether AI search recommends your business. Audits Google, AI Overviews, ChatGPT and Perplexity, then ranks what to fix. No invented composite scores.

## Product
- Home: https://www.luminarasuite.com/
- Sample report: https://www.luminarasuite.com/sample-report
- Methodology: https://www.luminarasuite.com/methodology
- How it works: https://www.luminarasuite.com/how-it-works
- Our AI: https://www.luminarasuite.com/ai
- Why Luminara: https://www.luminarasuite.com/why
- Pricing: https://www.luminarasuite.com/pricing
- Windows desktop: https://www.luminarasuite.com/desktop

## Honesty
- Engine labels: Measured, Estimated, or Not measured
- Sample scouts are labeled fixtures; Live Instant Audit follows account and key rules
- Free = insight / sample; Growth = share links + MCP; Agency = API access

## Agents and MCP
- MCP docs: https://www.luminarasuite.com/docs/mcp.html
- MCP endpoint: https://luminarasuite.com/api/mcp

## Studio
- Luminara Digital: https://luminaradigital.io
- Source: https://github.com/LuminaraDigital/Luminara-Search-Oracle-Agent

## Legal
- Privacy: https://www.luminarasuite.com/privacy
- Terms: https://www.luminarasuite.com/terms
`;
