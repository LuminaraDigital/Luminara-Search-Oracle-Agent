import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SampleReportPage from '../components/SampleReportPage';
import { LIVE_SAMPLE_SNAPSHOT } from '../services/marketing/liveSampleSnapshot';

describe('sample report label', () => {
  it('calls the dated snapshot an example, not a live crawl', () => {
    expect(LIVE_SAMPLE_SNAPSHOT.label).toBe('Example report (snapshot from 2 Oct 2026)');
    const html = renderToStaticMarkup(createElement(SampleReportPage, {
      onOpenAudit: () => {},
      onNavigatePricing: () => {},
      onNavigateMethodology: () => {},
    }));
    expect(html).toContain('Example report (snapshot from 2 Oct 2026)');
    expect(html).not.toContain('Live crawl');
  });
});

describe('instant audit top bar on a narrow screen', () => {
  it('wraps the primary tools and keeps Memory, Studio, and Quick/Thorough in the bar', () => {
    const app = readFileSync(resolve(__dirname, '..', 'App.tsx'), 'utf8');
    const navAt = app.indexOf('aria-label="Primary tools"');
    const nav = app.slice(navAt - 420, navAt);
    expect(nav).toContain('flex-nowrap');
    expect(nav).toContain('overflow-x-auto');
    expect(nav).toContain('mask-image:linear-gradient');
    expect(nav).not.toContain('flex-wrap items-center');

    const memoryAt = app.indexOf('aria-pressed={view === AppView.BRAND_MEMORY}');
    const memory = app.slice(memoryAt, memoryAt + 220);
    expect(memory).toContain('inline-flex');
    expect(memory).toContain('min-h-11');
    expect(memory).not.toContain('hidden sm:inline-flex');

    const studioAt = app.indexOf('aria-pressed={view === AppView.NOTEBOOK}');
    const studio = app.slice(studioAt, studioAt + 220);
    expect(studio).toContain('inline-flex');
    expect(studio).toContain('min-h-11');
    expect(studio).not.toContain('hidden sm:inline-flex');

    const modeAt = app.indexOf('aria-label="Answer mode"');
    const modeOpen = app.slice(modeAt - 240, modeAt);
    expect(modeOpen).toContain('className="flex ');
    expect(modeOpen).not.toContain('hidden sm:flex');
    const mode = app.slice(modeAt, modeAt + 1400);
    expect(mode).toContain('min-h-11');
    expect(mode).toContain('Quick');
    expect(mode).toContain('Thorough');
  });
});
