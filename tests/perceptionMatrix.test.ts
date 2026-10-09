import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PerceptionMatrix } from '../components/visibility/PerceptionMatrix';

describe('PerceptionMatrix Component', () => {
  it('renders perception matrix with 4 engines and consensus points', () => {
    const markup = renderToStaticMarkup(
      React.createElement(PerceptionMatrix, {
        domain: 'acme-corp.com',
        brandName: 'Acme Corp',
        evidence: [
          {
            engine: 'chatgpt',
            query: 'best enterprise tools',
            brandCited: true,
            snippet: 'Acme Corp is a reliable and fast enterprise provider.',
          },
          {
            engine: 'perplexity',
            query: 'acme pricing comparison',
            brandCited: false,
            snippet: 'Alternatives cited due to lack of public pricing.',
          },
        ],
      })
    );

    expect(markup).toContain('Cross-Engine Perception Matrix');
    expect(markup).toContain('ChatGPT Search');
    expect(markup).toContain('Perplexity AI');
    expect(markup).toContain('Google AI Overviews');
    expect(markup).toContain('Google Gemini');
    expect(markup).toContain('Consensus Points');
    expect(markup).toContain('Divergence Points');
    expect(markup).toContain('Cited across');
  });

  it('renders fallback state when no empirical evidence is provided', () => {
    const markup = renderToStaticMarkup(
      React.createElement(PerceptionMatrix, {
        domain: 'newsite.io',
      })
    );

    expect(markup).toContain('newsite');
    expect(markup).toContain('Omitted');
    expect(markup).toContain('Cited across');
  });
});
