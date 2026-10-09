import { describe, it, expect } from 'vitest';
import {
  generatePortableDossierHtml,
  PortableDossierData,
} from '../services/reports/portableDossierService';

describe('PortableDossierService', () => {
  it('generates a zero-dependency HTML dossier with sticky TOC and trust seal', () => {
    const data: PortableDossierData = {
      title: 'Executive AEO Audit Dossier',
      targetDomain: 'luminara-suite.ai',
      overallScore: 92,
      grade: 'A',
      generatedAt: 1760000000000,
      trustReceiptHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sections: [
        {
          id: 'summary',
          title: 'Executive Summary',
          badge: 'Verified',
          contentHtml: '<p>Top 5% visibility across Perplexity and ChatGPT.</p>',
        },
        {
          id: 'schema',
          title: 'Schema Graph Diagnostics',
          contentHtml: '<p>Organization JSON-LD verified without errors.</p>',
        },
      ],
    };

    const html = generatePortableDossierHtml(data);

    // Verify critical elements
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Executive AEO Audit Dossier');
    expect(html).toContain('luminara-suite.ai');
    expect(html).toContain('92/100 (Grade A)');
    expect(html).toContain('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    // Verify TOC links
    expect(html).toContain('<a href="#summary">Executive Summary</a>');
    expect(html).toContain('<a href="#schema">Schema Graph Diagnostics</a>');

    // Verify zero external scripts or CDN fonts
    expect(html).not.toContain('<script');
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).not.toContain('cdnjs.cloudflare.com');
  });

  it('escapes special characters to prevent HTML injection in titles and domains', () => {
    const maliciousData: PortableDossierData = {
      title: '<script>alert("xss")</script>',
      targetDomain: 'target.com"><img src=x onerror=alert(1)>',
      overallScore: 70,
      grade: 'C',
      generatedAt: Date.now(),
      trustReceiptHash: 'abc123',
      sections: [],
    };

    const html = generatePortableDossierHtml(maliciousData);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });
});
