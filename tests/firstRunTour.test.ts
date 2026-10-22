import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuestScoutSummaryPanel } from '../components/audit/GuestScoutSummaryPanel';
import { WeeklyDecisionCard } from '../components/audit/WeeklyDecisionCard';
import { buildGuestScoutSummary } from '../services/audit/guestScoutSummary';
import type { BoardFinding } from '../services/audit/findingBoardService';
import {
  FIRST_RUN_TOUR_KEY,
  TOUR_COPY,
  flagAfterBack,
  flagAfterNext,
  persistTourFlag,
  progressLabel,
  readTourFlag,
  replayTour,
  tourIsWaiting,
  tourStepToShow,
  type TourAnchors,
  type TourPersistDeps,
} from '../services/onboarding/firstRunTour';

function memory(): TourPersistDeps {
  const data = new Map<string, string>();
  return {
    store: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => { data.set(key, value); },
      removeItem: (key) => { data.delete(key); },
    },
    push: () => {},
  };
}

const urlOnly: TourAnchors = { hasUrl: true, hasResult: false, hasFix: false, hasRecheck: false };
const result: TourAnchors = { hasUrl: true, hasResult: true, hasFix: true, hasRecheck: false };
const full: TourAnchors = { hasUrl: true, hasResult: true, hasFix: true, hasRecheck: true };

describe('first run tour', () => {
  it('shows step 1 once for a signed-in web user, then stays hidden', () => {
    const deps = memory();
    expect(tourStepToShow({ signedInWeb: true, flag: readTourFlag(deps), anchors: urlOnly })).toBe(1);
    expect(tourStepToShow({ signedInWeb: false, flag: null, anchors: urlOnly })).toBeNull();
    persistTourFlag('done', deps);
    expect(readTourFlag(deps)).toBe('done');
    expect(tourStepToShow({ signedInWeb: true, flag: readTourFlag(deps), anchors: full })).toBeNull();
  });

  it('skips from any step and still stores done when the account write fails', () => {
    const deps = memory();
    deps.push = () => { throw new Error('account write failed'); };
    expect(() => persistTourFlag('done', deps)).not.toThrow();
    expect(readTourFlag(deps)).toBe('done');
    expect(tourStepToShow({ signedInWeb: true, flag: readTourFlag(deps), anchors: full })).toBeNull();
  });

  it('replays from the start after the flag is cleared', () => {
    const deps = memory();
    persistTourFlag('done', deps);
    replayTour(deps);
    expect(readTourFlag(deps)).toBeNull();
    expect(tourStepToShow({ signedInWeb: true, flag: null, anchors: urlOnly })).toBe(1);
    expect(progressLabel(1)).toBe('1 of 4');
  });

  it('waits for a real result before step 2 and for the recheck before step 4', () => {
    expect(flagAfterNext({ step: 1, anchors: urlOnly })).toBe('2');
    expect(tourStepToShow({ signedInWeb: true, flag: '2', anchors: urlOnly })).toBeNull();
    expect(tourIsWaiting({ signedInWeb: true, flag: '2', anchors: urlOnly })).toBe(true);
    expect(tourIsWaiting({ signedInWeb: true, flag: '2', anchors: result })).toBe(false);
    expect(tourStepToShow({ signedInWeb: true, flag: '2', anchors: result })).toBe(2);
    expect(flagAfterNext({ step: 2, anchors: result })).toBe('3');
    expect(flagAfterNext({ step: 3, anchors: result })).toBe('stay');
    expect(tourStepToShow({ signedInWeb: true, flag: '4', anchors: result })).toBeNull();
    expect(flagAfterNext({ step: 3, anchors: full })).toBe('4');
    expect(tourStepToShow({ signedInWeb: true, flag: '4', anchors: full })).toBe(4);
    expect(flagAfterNext({ step: 4, anchors: full })).toBe('done');
    expect(flagAfterBack(4)).toBe('3');
    expect(flagAfterBack(2)).toBeNull();
  });

  it('starts at the result when the website field is already gone', () => {
    const anchors: TourAnchors = { ...full, hasUrl: false };
    expect(tourStepToShow({ signedInWeb: true, flag: null, anchors })).toBe(2);
  });

  it('uses plain copy and the account workspace key', () => {
    expect(TOUR_COPY.map((item) => item.body)).toEqual([
      "Enter your agency's website.",
      'This is your result. The score is how many checks passed.',
      'This is the first fix.',
      'Mark it done. We will recheck it.',
    ]);
    const blob = TOUR_COPY.map((item) => `${item.title} ${item.body}`).join('\n');
    expect(blob).not.toContain('\u2014');
    expect(blob).not.toContain('\u2013');
    const sync = readFileSync('services/sync/workspaceSyncService.ts', 'utf8');
    expect(sync).toContain(FIRST_RUN_TOUR_KEY);
  });

  it('anchors the result, the first fix, and the recheck control', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://agency.example',
      measurementStatus: 'measured',
      citationRatePercent: 2,
      shareOfVoiceScore: 2,
      healthScore: 70,
      healthChecks: { passed: 3, total: 4 },
      scrapedPageCount: 1,
      serpCount: 4,
      findings: [{ title: 'Add the agency name to the homepage title' }],
      hostedRail: 'signed_in_hosted',
    });
    const summaryHtml = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary }));
    expect(summaryHtml).toContain('id="tour-audit-result"');
    expect(summaryHtml).toContain('id="tour-top-fix"');
    const primary: BoardFinding = {
      id: 'fix-1',
      domain: 'agency.example',
      stableKey: 'fix-1',
      category: 'content_quality',
      severity: 'high',
      title: 'Add the agency name to the homepage title',
      description: 'The homepage title does not name the agency.',
      status: 'open',
    };
    const cardHtml = renderToStaticMarkup(createElement(WeeklyDecisionCard, {
      domain: 'agency.example',
      primary,
      findings: [primary],
      commitment: null,
    }));
    expect(cardHtml).toContain('id="tour-mark-done"');
    expect(cardHtml).toContain('Re-check');
  });
});
