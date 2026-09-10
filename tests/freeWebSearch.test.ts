import { describe, it, expect } from 'vitest';
import {
  parseDuckDuckGoLite,
  decodeEntities,
  stripTags,
  resolveResultUrl,
  MAX_HTML_BYTES,
} from '../services/search/freeWebSearch';

describe('freeWebSearch - DuckDuckGo Lite Scraper', () => {
  it('decodes HTML entities properly without double-unescaping vulnerability', () => {
    expect(decodeEntities('Hello &amp; welcome &lt;world&gt;')).toBe('Hello & welcome <world>');
    expect(decodeEntities('&#39;test&#39; and &quot;quotes&quot;')).toBe("'test' and \"quotes\"");
    expect(decodeEntities('Non-breaking&nbsp;space')).toBe('Non-breaking space');
  });

  it('strips HTML tags and handles unclosed tags securely', () => {
    expect(stripTags('<div><p>Hello <b>World</b></p></div>')).toBe('Hello World');
    expect(stripTags('<script>alert(1)</script>Safe Text')).toBe('Safe Text');
    expect(stripTags('Text with trailing unclosed <tag')).toBe('Text with trailing unclosed');
  });

  it('resolves result URLs and unwraps DDG redirect tokens', () => {
    const directUrl = 'https://example.com/page';
    expect(resolveResultUrl(directUrl)).toBe('https://example.com/page');

    const ddgRedirect = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fluminarasuite.com%2Ffeatures&rut=...';
    expect(resolveResultUrl(ddgRedirect)).toBe('https://luminarasuite.com/features');

    const invalidScheme = 'javascript:alert(1)';
    expect(resolveResultUrl(invalidScheme)).toBe('');
  });

  it('parses realistic DuckDuckGo Lite HTML snippet', () => {
    const mockHtml = `
      <html>
      <body>
        <table border="0">
          <tr>
            <td>1.&nbsp;</td>
            <td>
              <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fluminarasuite.com" class="result-link"><b>Luminara</b> Suite - AI Search Visibility</a>
            </td>
          </tr>
          <tr>
            <td></td>
            <td class="result-snippet">
              Luminara Suite helps brands audit their AEO, GEO and SEO performance across Google and LLMs.
            </td>
          </tr>
          <tr>
            <td>2.&nbsp;</td>
            <td>
              <a rel="nofollow" href="https://github.com/diegosouzapw/OmniRoute" class="result-link">OmniRoute - AI Gateway</a>
            </td>
          </tr>
          <tr>
            <td></td>
            <td class="result-snippet">
              Never stop coding. Free MIT AI gateway: one endpoint, 350+ providers.
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const results = parseDuckDuckGoLite(mockHtml);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Luminara Suite - AI Search Visibility');
    expect(results[0].url).toBe('https://luminarasuite.com');
    expect(results[0].snippet).toContain('Luminara Suite helps brands');

    expect(results[1].title).toBe('OmniRoute - AI Gateway');
    expect(results[1].url).toBe('https://github.com/diegosouzapw/OmniRoute');
    expect(results[1].snippet).toContain('Never stop coding');
  });

  it('handles empty input and bounds oversized inputs to MAX_HTML_BYTES', () => {
    expect(parseDuckDuckGoLite('')).toEqual([]);
    const hugeInput = 'a'.repeat(MAX_HTML_BYTES + 5000);
    expect(parseDuckDuckGoLite(hugeInput)).toEqual([]);
  });
});
