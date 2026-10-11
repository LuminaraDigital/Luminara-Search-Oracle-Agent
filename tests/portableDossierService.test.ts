import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  buildAuditDossierHtml,
  generatePortableDossierHtml,
  PortableDossierData,
} from '../services/reports/portableDossierService';

const FIXTURE_AUDIT = {
  domain: 'luminara-suite.ai',
  markdownText: [
    '# Luminara: Will AI mention luminara-suite.ai?',
    '',
    '## 1. One move this week',
    'Add an Organization JSON-LD block to the homepage.',
  ].join('\n'),
  generatedAt: 1760000000000,
};

describe('PortableDossierService', () => {
  it('generates a zero-dependency HTML dossier with sticky TOC and a content fingerprint', () => {
    const data: PortableDossierData = {
      title: 'Executive AEO Audit Dossier',
      targetDomain: 'luminara-suite.ai',
      generatedAt: 1760000000000,
      contentFingerprint: 'e3b0c44298fc1c14',
      sections: [
        {
          id: 'summary',
          title: 'Executive Summary',
          contentHtml: '<p>Organization schema is missing on the homepage.</p>',
        },
        {
          id: 'schema',
          title: 'Schema Graph Diagnostics',
          contentHtml: '<p>No Organization JSON-LD block was found.</p>',
        },
      ],
    };

    const html = generatePortableDossierHtml(data);

    // Verify critical elements
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Executive AEO Audit Dossier');
    expect(html).toContain('luminara-suite.ai');
    expect(html).toContain('Score: </span>');
    expect(html).toContain('Not measured');
    expect(html).toContain('Content fingerprint');
    expect(html).toContain('e3b0c44298fc1c14');

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
      generatedAt: Date.now(),
      contentFingerprint: '"><script>alert(2)</script>',
      sections: [],
    };

    const html = generatePortableDossierHtml(maliciousData);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });
});

describe('dossier honesty (SW0a-7)', () => {
  it('renders "Not measured" and no score, grade or badge for an audit with no measured score', () => {
    const html = buildAuditDossierHtml(FIXTURE_AUDIT);

    expect(html).toContain('Not measured');
    expect(html).not.toContain('88');
    expect(html).not.toContain('Grade');
    expect(html).not.toContain('Verified');
    // No out-of-100 figure and no letter grade in any casing.
    expect(html).not.toMatch(/\d+\s*\/\s*100/);
    expect(html).not.toMatch(/grade\s+[a-f]\b/i);
    expect(html).not.toMatch(/verified/i);
    expect(html).not.toContain('section-badge">');
    // The audit text itself is still in the download.
    expect(html).toContain('Add an Organization JSON-LD block to the homepage.');
  });

  it('prints no score, grade or badge that a caller passes, because it takes none', () => {
    // A caller that still passes the old fields gets nothing printed from them.
    const html = generatePortableDossierHtml({
      title: 'Dossier',
      targetDomain: 'example.com',
      generatedAt: 1760000000000,
      overallScore: 88,
      grade: 'B',
      sections: [{ id: 's', title: 'Section', badge: 'Verified', contentHtml: '<p>Text.</p>' }],
    } as unknown as PortableDossierData);
    expect(html).toContain('Not measured');
    expect(html).not.toContain('88');
    expect(html).not.toContain('Grade');
    expect(html).not.toContain('Verified');
    expect(html).not.toMatch(/\d+\s*\/\s*100/);
    expect(html).not.toContain('section-badge');

    const src = fs.readFileSync(path.join(process.cwd(), 'services', 'reports', 'portableDossierService.ts'), 'utf8');
    expect(src).not.toMatch(/overallScore|\bbadge\?\s*:/);
  });

  it('gates the report text it is given, whoever calls it', () => {
    const html = buildAuditDossierHtml({
      ...FIXTURE_AUDIT,
      markdownText: [
        '## AI & Search Visibility Radar',
        '| Query | Est. Organic Rank | Citation Status |',
        '|---|---|---|',
        '| what is luminara | Position 3 | Cited |',
      ].join('\n'),
    });
    expect(html).toContain('| what is luminara | Cited |');
    expect(html).not.toContain('Est. Organic Rank');
    expect(html).not.toContain('Position 3');
  });

  it('names the hash a content fingerprint and never a receipt, seal or cryptographic hash', () => {
    const html = buildAuditDossierHtml(FIXTURE_AUDIT);

    expect(html).toContain('Content fingerprint');
    expect(html).toContain('not a signature');
    expect(html).not.toMatch(/cryptographic/i);
    expect(html).not.toMatch(/trust receipt/i);
    expect(html).not.toMatch(/trust-seal/i);
    // 16 hex characters: the real output of the checksum, not a value shaped like SHA-256.
    const printed = html.match(/class="content-fingerprint">([^<]*)</);
    expect(printed?.[1]).toMatch(/^[0-9a-f]{16}$/);
  });

  it('gives the same fingerprint for the same text and a different one when the text changes', () => {
    const pick = (html: string) => html.match(/class="content-fingerprint">([^<]*)</)?.[1];
    const first = pick(buildAuditDossierHtml(FIXTURE_AUDIT));
    const again = pick(buildAuditDossierHtml({ ...FIXTURE_AUDIT, generatedAt: 1760000999000 }));
    const changed = pick(buildAuditDossierHtml({ ...FIXTURE_AUDIT, markdownText: `${FIXTURE_AUDIT.markdownText}\nEdited.` }));
    expect(first).toBe(again);
    expect(changed).not.toBe(first);
  });

  it('is the builder the report screen downloads, with no score, grade or badge typed into the screen', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components', 'audit', 'ReportDisplay.tsx'), 'utf8');
    expect(src).toContain('const html = buildAuditDossierHtml({');
    expect(src).not.toContain('generatePortableDossierHtml');
    expect(src).not.toContain('overallScore');
    expect(src).not.toContain('trustReceiptHash');
    expect(src).not.toMatch(/grade:\s*['"]/);
    expect(src).not.toMatch(/badge:\s*['"]Verified['"]/);
  });

  it('leaves the fingerprint line out when no fingerprint is passed', () => {
    const html = generatePortableDossierHtml({
      title: 'Dossier',
      targetDomain: 'example.com',
      generatedAt: 1760000000000,
      sections: [],
    });
    expect(html).not.toContain('Content fingerprint');
  });
});
