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
Allow: /privacy
Allow: /terms
Allow: /desktop
Allow: /docs/
Allow: /llms.txt
Allow: /sitemap.xml

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

> Owner-first product for SEO, AEO and GEO visibility. Audits Google, AI Overviews, ChatGPT and Perplexity, then ranks what to fix.

## Product
- Home: https://www.luminarasuite.com/
- How it works: https://www.luminarasuite.com/how-it-works
- Our AI: https://www.luminarasuite.com/ai
- Why Luminara: https://www.luminarasuite.com/why
- Pricing: https://www.luminarasuite.com/pricing
- Windows desktop: https://www.luminarasuite.com/desktop

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
