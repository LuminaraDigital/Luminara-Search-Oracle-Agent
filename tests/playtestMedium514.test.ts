import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    expect(html.split('Live ChatGPT, Perplexity and AI Overviews').length - 1).toBe(1);
  });
});

describe('instant audit top bar on a narrow screen', () => {
  it('scrolls the phone nav and keeps Quick and Thorough on the phone and from 1280px', () => {
    const app = readFileSync(resolve(__dirname, '..', 'App.tsx'), 'utf8');
    const navAt = app.indexOf('aria-label="Primary tools"');
    const nav = app.slice(navAt - 520, navAt);
    expect(nav).toContain('flex-nowrap');
    expect(nav).toContain('overflow-x-auto');
    expect(nav).toContain('mask-image:linear-gradient');
    expect(nav).not.toContain('flex-wrap items-center');

    const memoryAt = app.indexOf('aria-pressed={view === AppView.BRAND_MEMORY}');
    const memory = app.slice(memoryAt, memoryAt + 240);
    expect(memory).toContain('hidden 2xl:inline-flex');
    expect(memory).toContain('min-h-11');

    const studioAt = app.indexOf('aria-pressed={view === AppView.NOTEBOOK}');
    const studio = app.slice(studioAt, studioAt + 240);
    expect(studio).toContain('hidden 2xl:inline-flex');
    expect(studio).toContain('min-h-11');

    const modeAt = app.indexOf('aria-label="Answer mode"');
    const modeOpen = app.slice(modeAt - 280, modeAt);
    expect(modeOpen).toContain('hidden max-lg:flex xl:flex');
    expect(modeOpen).not.toContain('hidden sm:flex');
    const mode = app.slice(modeAt, modeAt + 1400);
    expect(mode).toContain('min-h-11');
    expect(mode).toContain('Quick');
    expect(mode).toContain('Thorough');

    const pillAt = app.indexOf('data-testid="add-business-pill"');
    const pill = app.slice(pillAt, pillAt + 420);
    expect(pill).toContain('hidden lg:inline-flex');
    expect(pill).toContain('whitespace-nowrap');
    expect(pill).not.toContain('max-w-[90px]');
  });
});
