/**
 * Links built from model or search output. In the desktop shell a link without a new-window
 * target navigates the main window, so other-site links must never render as same-site paths.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditReportArticle } from '../components/audit/AuditReportArticle';
import { CitedSourceList } from '../components/audit/FreeAiAnswerCard';
import MessageList from '../components/MessageList';
import { GroundedCitationsList } from '../components/suite/ResearchView';
import { EmpiricalEvidenceDrawer } from '../components/audit/EmpiricalEvidenceDrawer';
import { EntityAuthorityCard } from '../components/audit/EntityAuthorityCard';
import { MarkdownRenderer } from '../components/pdf/MarkdownRenderer';
import { createExecutiveTheme } from '../components/pdf/theme';
import { sanitizeExportLogoSrc } from '../components/audit/WhiteLabelExportModal';
import { injectCitationPills } from '../components/notebook/panels/NotebookChatPanel';

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

    expect(html).toContain('<a href="/fixes/schema" class="text-gold-light underline underline-offset-2 hover:text-white [overflow-wrap:anywhere]">the fix</a>');
    expect(html).toContain('<a href="https://example.com/guide" class="text-gold-light underline underline-offset-2 hover:text-white [overflow-wrap:anywhere]" target="_blank" rel="noopener noreferrer">the guide</a>');
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

describe('M-24 gated component hrefs', () => {
  it('MessageList gates groundingUrls to http(s) and omits unsafe hrefs', () => {
    const html = renderToStaticMarkup(createElement(MessageList, {
      messages: [
        {
          id: 'm1',
          role: 'model',
          content: 'Summary',
          timestamp: 1,
          groundingUrls: [
            { uri: 'https://example.com/ok', title: 'Valid Source' },
            { uri: 'javascript:alert(1)', title: 'Bad Script' },
            { uri: 'data:text/html,<b>x</b>', title: 'Bad Data' },
          ],
        },
      ],
    }));
    expect(html).toContain('href="https://example.com/ok"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Bad Script');
    expect(html).toContain('Bad Data');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
  });

  it('ResearchView GroundedCitationsList gates chunk URIs to http(s)', () => {
    const html = renderToStaticMarkup(createElement(GroundedCitationsList, {
      chunks: [
        { web: { uri: 'https://example.com/research', title: 'Research' } },
        { maps: { uri: 'javascript:alert(1)', title: 'Bad Map' } },
      ],
    }));
    expect(html).toContain('href="https://example.com/research"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Bad Map');
    expect(html).not.toContain('javascript:');
  });

  it('EmpiricalEvidenceDrawer omits non-web citedUrl links', () => {
    const html = renderToStaticMarkup(createElement(EmpiricalEvidenceDrawer, {
      isOpen: true,
      onClose: () => {},
      summary: {
        targetDomain: 'example.com',
        brandName: 'Example',
        totalQueriesTested: 2,
        queriesCitedCount: 1,
        citationRatePercent: 50,
        topCitedCompetitor: null,
        entityClarityScore: 70,
        lastAudited: 1,
        evidenceList: [
          {
            id: 'e1',
            query: 'safe query',
            intent: 'informational',
            brandCited: true,
            brandRank: 1,
            competitorsCited: [],
            citationConfidence: 90,
            citedUrl: 'https://example.com/proof',
          },
          {
            id: 'e2',
            query: 'bad query',
            intent: 'commercial',
            brandCited: false,
            competitorsCited: [],
            citationConfidence: 40,
            citedUrl: 'javascript:alert(1)',
          },
        ],
      },
    }));
    expect(html).toContain('href="https://example.com/proof"');
    expect(html).not.toContain('javascript:');
  });

  it('EntityAuthorityCard gates wikidata, wayback, and sameAsUrls to http(s)', () => {
    const html = renderToStaticMarkup(createElement(EntityAuthorityCard, {
      enriched: {
        domain: 'example.com',
        brandName: 'Example',
        wikidata: {
          id: 'Q1',
          label: 'Example',
          description: 'Desc',
          url: 'javascript:alert(1)',
        },
        wayback: {
          hasArchive: true,
          status: 'established',
          earliestDate: '2015',
          archivedYearsAgo: 10,
          snapshotUrl: 'data:text/html,x',
        },
        metadata: null,
        security: {
          httpsEnforced: true,
          redirectsToHttps: true,
          hstsEnabled: true,
          cspDetected: false,
          referrerPolicy: false,
          xFrameOptions: false,
          securityTxtPresent: false,
          trustScore: 80,
          measurementConfidence: 'full',
        },
        sameAsUrls: ['https://www.wikidata.org/wiki/Q1', 'javascript:alert(2)'],
        timestamp: 1,
      },
    }));
    expect(html).toContain('href="https://www.wikidata.org/wiki/Q1"');
    expect(html).toContain('Q1');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
  });

  it('PDF MarkdownRenderer omits href on non-web markdown links', () => {
    const tree = MarkdownRenderer({
      content: 'Visit [Safe](https://example.com/ok), [Bad](javascript:alert(1)), and [Data](data:text/html,x).',
      theme: createExecutiveTheme('#BF953F'),
    });
    const hrefs: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const el = node as { props?: { href?: unknown; children?: unknown } };
      if (typeof el.props?.href === 'string') hrefs.push(el.props.href);
      if (el.props?.children) walk(el.props.children);
    };
    walk(tree);
    expect(hrefs).toEqual(['https://example.com/ok']);
  });
});

describe('M-27 WhiteLabelExportModal logo validation', () => {
  it('allows public https images and valid raster base64 data URLs, rejecting SVG and javascript:', () => {
    expect(sanitizeExportLogoSrc('https://cdn.harbour.co/logo.png')).toBe('https://cdn.harbour.co/logo.png');
    expect(sanitizeExportLogoSrc('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(sanitizeExportLogoSrc('data:image/jpeg;base64,/9j/4AAQ')).toBe('data:image/jpeg;base64,/9j/4AAQ');
    expect(sanitizeExportLogoSrc('data:image/webp;base64,UklGRgAAAABXRUJQ')).toBe('data:image/webp;base64,UklGRgAAAABXRUJQ');

    expect(sanitizeExportLogoSrc('https://cdn.harbour.co/logo.svg')).toBeNull();
    expect(sanitizeExportLogoSrc('javascript:alert(1)')).toBeNull();
    expect(sanitizeExportLogoSrc('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(sanitizeExportLogoSrc('data:image/png;base64,PHN2Zz4=')).toBeNull();
    expect(sanitizeExportLogoSrc('http://127.0.0.1/logo.png')).toBeNull();
  });
});

describe('H-15 NotebookChatPanel citation injection', () => {
  it('returns sanitized HTML untouched in SSR when document is unavailable', () => {
    const html = '<p>See [1] and <a href="https://example.com/?q=[1]">link</a>.</p>';
    expect(injectCitationPills(html, undefined)).toBe(html);
  });

  it('replaces [n] strictly in eligible text nodes without mutating attribute values or code/link tags', () => {
    type FakeNode = {
      nodeType: number;
      tagName?: string;
      nodeValue?: string;
      textContent?: string;
      attrs?: Map<string, string>;
      childNodes: FakeNode[];
      parentNode: FakeNode | null;
      setAttribute?: (k: string, v: string) => void;
      appendChild: (child: FakeNode) => FakeNode;
      replaceChild: (next: FakeNode, old: FakeNode) => void;
    };

    const makeNode = (nodeType: number, tagName?: string, nodeValue?: string): FakeNode => {
      const node: FakeNode = {
        nodeType,
        tagName,
        nodeValue,
        attrs: nodeType === 1 ? new Map() : undefined,
        childNodes: [],
        parentNode: null,
        setAttribute(k: string, v: string) {
          this.attrs?.set(k, v);
        },
        appendChild(child: FakeNode) {
          if (child.nodeType === 11) {
            for (const c of child.childNodes) {
              c.parentNode = this;
              this.childNodes.push(c);
            }
            child.childNodes = [];
            return child;
          }
          child.parentNode = this;
          this.childNodes.push(child);
          return child;
        },
        replaceChild(next: FakeNode, old: FakeNode) {
          const idx = this.childNodes.indexOf(old);
          if (idx === -1) return;
          old.parentNode = null;
          if (next.nodeType === 11) {
            const items = next.childNodes.map((c) => {
              c.parentNode = this;
              return c;
            });
            next.childNodes = [];
            this.childNodes.splice(idx, 1, ...items);
          } else {
            next.parentNode = this;
            this.childNodes.splice(idx, 1, next);
          }
        },
      };
      return node;
    };

    const serialize = (node: FakeNode): string => {
      if (node.nodeType === 3) return node.nodeValue || '';
      if (node.nodeType === 11) return node.childNodes.map(serialize).join('');
      const tag = (node.tagName || '').toLowerCase();
      const attrs = [...(node.attrs?.entries() || [])].map(([k, v]) => ` ${k}="${v}"`).join('');
      const inner = node.textContent !== undefined && node.childNodes.length === 0
        ? node.textContent
        : node.childNodes.map(serialize).join('');
      return `<${tag}${attrs}>${inner}</${tag}>`;
    };

    // Build a pre-parsed DOM tree representing:
    // <p>Fact [1] and [2].</p><a href="https://example.com/?q=[1]" title="ref [2]">Link [3]</a><code>arr[1]</code>
    const root = makeNode(11);
    const p = makeNode(1, 'P');
    p.appendChild(makeNode(3, undefined, 'Fact [1] and [2].'));
    const a = makeNode(1, 'A');
    a.setAttribute?.('href', 'https://example.com/?q=[1]');
    a.setAttribute?.('title', 'ref [2]');
    a.appendChild(makeNode(3, undefined, 'Link [3]'));
    const code = makeNode(1, 'CODE');
    code.appendChild(makeNode(3, undefined, 'arr[1]'));
    root.appendChild(p);
    root.appendChild(a);
    root.appendChild(code);

    const fakeDoc = {
      createElement(tag: string) {
        if (tag === 'template') {
          return {
            content: root,
            get innerHTML() {
              return serialize(root);
            },
            set innerHTML(_v: string) {
              // tree already populated above
            },
          };
        }
        return makeNode(1, tag.toUpperCase());
      },
      createDocumentFragment() {
        return makeNode(11);
      },
      createTextNode(text: string) {
        return makeNode(3, undefined, text);
      },
      createTreeWalker(start: FakeNode, whatToShow: number) {
        const collected: FakeNode[] = [];
        const visit = (n: FakeNode) => {
          for (const c of n.childNodes) {
            if (whatToShow === 4 && c.nodeType === 3) collected.push(c);
            visit(c);
          }
        };
        visit(start);
        let idx = 0;
        return {
          nextNode: () => (idx < collected.length ? collected[idx++] : null),
        };
      },
    } as unknown as Document;

    const output = injectCitationPills('placeholder', fakeDoc);
    expect(output).toContain('<button type="button" data-citation-num="1" class="inline-citation-pill');
    expect(output).toContain('<button type="button" data-citation-num="2" class="inline-citation-pill');
    expect(output).toContain('href="https://example.com/?q=[1]"');
    expect(output).toContain('title="ref [2]"');
    expect(output).toContain('>Link [3]</a>');
    expect(output).toContain('<code>arr[1]</code>');
  });
});
