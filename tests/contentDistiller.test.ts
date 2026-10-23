import { describe, it, expect } from 'vitest';
import { contentDistiller, keepDiscoveredSchemas } from '../services/scraping/contentDistiller';

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

  it('reads @graph Organization and ProfessionalService, including a type attribute that is not first', () => {
    const suite = contentDistiller.distill(`
      <html><head>
        <title>Luminara Suite</title>
        <script id="luminara-marketing-jsonld" type="application/ld+json">
          {"@context":"https://schema.org","@graph":[
            {"@type":"Organization","name":"Luminara Suite"},
            {"@type":"WebSite","name":"Luminara Suite"},
            {"@type":["SoftwareApplication","WebApplication"],"name":"Suite"}
          ]}
        </script>
      </head><body><h1>Suite</h1><p>Audit the page.</p></body></html>
    `);
    expect(suite.schemaTypes).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'SoftwareApplication', 'WebApplication']));
    expect(suite.formattedEvidence).not.toContain('None detected');
    expect(suite.schemas.find((schema) => schema.type === 'Organization')?.raw.name).toBe('Luminara Suite');

    const agency = contentDistiller.distill(`
      <html><head>
        <script type="application/ld+json; charset=utf-8">
          {"@context":"https://schema.org","@graph":[
            {"@type":"ProfessionalService","name":"Luminara Digital"},
            {"@type":"Person","name":"Ada"}
          ]}
        </script>
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","name":"Questions"}</script>
      </head><body><p>Agency page.</p></body></html>
    `);
    expect(agency.schemaTypes).toEqual(expect.arrayContaining(['ProfessionalService', 'Person', 'FAQPage']));
    expect(agency.formattedEvidence).toContain('Detected schemas:');
    expect(agency.formattedEvidence).not.toContain('schema types: none');
  });

  it('keeps JSON-LD from the full document when the main-content HTML has none', () => {
    const main = '<main><h1>Luminara</h1><p>Main content only.</p></main>';
    const full = `<html><head><script id="ld" type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Luminara Suite"}]}</script></head><body>${main}</body></html>`;
    const result = contentDistiller.distill(main, '', { schemaHtml: full });
    expect(result.schemaTypes).toContain('Organization');
    expect(result.distilledText).toContain('Main content only');
    expect(result.formattedEvidence).toContain('Detected schemas: Organization');
    expect(result.formattedEvidence).not.toContain('None detected');
  });

  it('keeps head JSON-LD when a later pass only saw main content', () => {
    const full = `<html><head><script type="application/ld+json">{"@type":"Organization","name":"Luminara Suite"}</script></head><body><main><p>Main content only.</p></main></body></html>`;
    const main = '<main><p>Main content only.</p><script type="application/ld+json">{"@type":"FAQPage"}</script></main>';
    const prior = contentDistiller.distill(main, '', { schemaHtml: full });
    const fresh = contentDistiller.distill(main, '');
    const kept = keepDiscoveredSchemas(fresh, prior);
    expect(prior.schemaTypes).toEqual(expect.arrayContaining(['FAQPage', 'Organization']));
    expect(fresh.schemaTypes).toEqual(['FAQPage']);
    expect(kept.schemaTypes).toEqual(expect.arrayContaining(['FAQPage', 'Organization']));
    expect(kept.formattedEvidence).toContain('Organization');
    expect(kept.distilledText).toContain('Main content only');
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
