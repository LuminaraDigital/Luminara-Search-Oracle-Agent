/**
 * Links built from model or search output. In the desktop shell a link without a new-window
 * target navigates the main window, so other-site links must never render as same-site paths.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditReportArticle } from '../components/audit/AuditReportArticle';
import { CitedSourceList } from '../components/audit/FreeAiAnswerCard';

function articleHtml(markdown: string): string {
  return renderToStaticMarkup(createElement(AuditReportArticle, {
    markdown,
    measured: true,
    findings: [],
    domain: 'example.com',
    clientName: 'Example',
    showActions: false,
  }));
}

describe('report article links', () => {
  it('links same-site paths and web pages, and shows other-site paths as plain text', () => {
    const html = articleHtml([
      '## Notes',
      '',
      'Read [the fix](/fixes/schema), [the guide](https://example.com/guide), [one](//evil.example/a), [two](/\\evil.example/b), [three](</\t/evil.example/c>) and [four](//).',
      '',
    ].join('\n'));

    expect(html).toContain('<a href="/fixes/schema" class="text-gold-light underline underline-offset-2 hover:text-white">the fix</a>');
    expect(html).toContain('<a href="https://example.com/guide" class="text-gold-light underline underline-offset-2 hover:text-white" target="_blank" rel="noopener noreferrer">the guide</a>');
    expect(html).toContain('<span>one</span>');
    expect(html).toContain('<span>two</span>');
    expect(html).toContain('<span>three</span>');
    expect(html).toContain('<span>four</span>');
    expect(html).not.toContain('evil.example');
  });
});

describe('free AI answer sources', () => {
  it('links web sources in a new window and shows any other scheme as text', () => {
    const html = renderToStaticMarkup(createElement(CitedSourceList, {
      sources: [
        { title: 'Agency list', url: 'https://example.com/list' },
        { title: 'Script', url: 'javascript:alert(1)' },
        { title: 'Search', url: 'search-ms:query=x' },
      ],
    }));

    expect(html).toContain('<li><a class="text-gold-light underline" href="https://example.com/list" target="_blank" rel="noopener noreferrer">Agency list</a></li>');
    expect(html).toContain('<li>Script</li>');
    expect(html).toContain('<li>Search</li>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('search-ms:');
  });
});
