import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SampleReportPage from '../components/SampleReportPage';
import { LIVE_SAMPLE_SNAPSHOT } from '../services/marketing/liveSampleSnapshot';

describe('sample report label', () => {
  it('calls the dated snapshot an example, not a live crawl', () => {
    expect(LIVE_SAMPLE_SNAPSHOT.label).toBe('Illustrative example');
    const html = renderToStaticMarkup(createElement(SampleReportPage, {
      onOpenAudit: () => {},
      onNavigatePricing: () => {},
      onNavigateMethodology: () => {},
    }));
    expect(html).toContain('Illustrative example');
    expect(html).toContain('example-agency.com.au');
    expect(html).not.toContain('Live crawl');
    expect(html.split('Live answers from specific AI products stay Not measured').length - 1).toBe(1);
    expect(html).not.toMatch(/ChatGPT|Perplexity/);
  });
});
