import { describe, it, expect } from 'vitest';
import { contentDistiller } from '../services/scraping/contentDistiller';

describe('ContentDistiller', () => {
  it('extracts metadata, JSON-LD schema, and headings while stripping boilerplate', () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Acme Corporation - Next-Gen AEO & AI Visibility</title>
          <meta name="description" content="Acme provides cutting-edge Answer Engine Optimization.">
          <meta property="og:title" content="Acme Corporation">
          <link rel="canonical" href="https://acme.example.com">
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "Acme Corp",
              "url": "https://acme.example.com"
            }
          </script>
        </head>
        <body>
          <nav class="navbar main-nav">
            <a href="/">Home</a>
            <a href="/pricing">Pricing</a>
          </nav>
          <div class="cookie-banner-container">
            <p>We use cookies. Click accept to continue.</p>
            <button>Accept</button>
          </div>
          <main>
            <h1>Unlocking AI Search Visibility</h1>
            <p>Traditional SEO is evolving into Answer Engine Optimization (AEO). Modern search engines prioritize generative synthesis over blue links.</p>
            <h2>The Three Pillars of GEO</h2>
            <p>Entities, citation probability, and clear knowledge-graph alignment dictate visibility across Claude, ChatGPT, and Gemini.</p>
          </main>
          <footer class="site-footer">
            <p>&copy; 2026 Acme Corp. All rights reserved.</p>
          </footer>
        </body>
      </html>
    `;

    const result = contentDistiller.distill(rawHtml, '', { maxChars: 2000 });

    // Assert title and metadata
    expect(result.title).toBe('Acme Corporation - Next-Gen AEO & AI Visibility');
    expect(result.description).toBe('Acme provides cutting-edge Answer Engine Optimization.');
    expect(result.canonicalUrl).toBe('https://acme.example.com');

    // Assert JSON-LD schema extraction
    expect(result.schemaTypes).toContain('Organization');
    expect(result.schemas.length).toBe(1);
    expect(result.schemas[0].raw.name).toBe('Acme Corp');

    // Assert Headings
    expect(result.headings).toHaveLength(2);
    expect(result.headings[0]).toEqual({ level: 1, text: 'Unlocking AI Search Visibility' });
    expect(result.headings[1]).toEqual({ level: 2, text: 'The Three Pillars of GEO' });

    // Assert Boilerplate stripping
    expect(result.distilledText).not.toContain('cookie-banner-container');
    expect(result.distilledText).not.toContain('We use cookies');
    expect(result.distilledText).toContain('Unlocking AI Search Visibility');
    expect(result.distilledText).toContain('Traditional SEO is evolving into Answer Engine Optimization');

    // Assert formatted evidence block
    expect(result.formattedEvidence).toContain('[PAGE TITLE]: Acme Corporation - Next-Gen AEO & AI Visibility');
    expect(result.formattedEvidence).toContain('[STRUCTURED DATA / JSON-LD]: Detected schemas: Organization');
    expect(result.formattedEvidence).toContain('[HEADING OUTLINE]:');
    expect(result.formattedEvidence).toContain('# Unlocking AI Search Visibility');
  });

  it('handles markdown input with heading extraction', () => {
    const markdown = `
      # Luminara Overview
      Luminara Suite helps brands audit their AEO performance.

      ## Key Capabilities
      - Multi-engine search grounding
      - Business DNA personalization
      - Real-time competitive radar
    `;

    const result = contentDistiller.distill('', markdown, { maxChars: 500 });
    expect(result.headings).toHaveLength(2);
    expect(result.headings[0].text).toBe('Luminara Overview');
    expect(result.distilledText).toContain('Luminara Suite helps brands audit their AEO performance.');
  });
});
