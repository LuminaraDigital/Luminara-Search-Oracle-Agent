import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditProgress, PlaceLoader, SKYLINE_D } from '../components/ui/PlaceLoader';
import { advanceAuditStep, auditStepIndex } from '../services/audit/auditProgress';

describe('audit progress steps', () => {
  it('follows the crew and does not move backward', () => {
    expect(auditStepIndex('Navigating to https://example.com.au to map internal link structure')).toBe(0);
    expect(auditStepIndex('Page fetch is ready · Search is ready')).toBe(0);
    expect(auditStepIndex('Checking web search results for "Ray White"…')).toBe(1);
    expect(auditStepIndex('Auditing 2 page(s) against official AEO/SEO scoring playbooks…')).toBe(2);
    expect(auditStepIndex('Mapping competitive landscape and market share of voice…')).toBe(1);
    expect(auditStepIndex('Comparing other sites in your market…')).toBe(1);
    expect(auditStepIndex('Writing your fixes for the page…')).toBe(3);
    expect(advanceAuditStep(2, 'Mapping competitive landscape and market share of voice…')).toBe(2);
    expect(auditStepIndex('Translating technical findings into an 8th-grade plain English executive summary…')).toBe(3);
    expect(auditStepIndex('Synthesizing executive report & action plan…')).toBe(3);
  });

  it('paints the current step and keeps the skyline in sync with the boot splash', () => {
    const html = renderToStaticMarkup(createElement(AuditProgress, { stage: 'Checking web search results for the agency…' }));
    expect(html).toContain('Searching the web for your agency');
    expect(html).toContain('Reading your site');
    expect(html).toContain('Writing your fixes');
    expect(html).toContain('aria-current="step"');
    expect(html).not.toContain('SCANNING');
    expect(html).toContain(SKYLINE_D);
    const boot = readFileSync('index.html', 'utf8');
    expect(boot).toContain(SKYLINE_D);
    const quiet = renderToStaticMarkup(createElement(PlaceLoader, { holdMs: 300 }));
    expect(quiet).toContain('hidden');
    const shown = renderToStaticMarkup(createElement(PlaceLoader, { holdMs: 0 }));
    expect(shown).toContain('Loading…');
    expect(shown).not.toContain('hidden=""');
  });
});
