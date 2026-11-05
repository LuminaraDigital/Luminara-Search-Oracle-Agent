import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CitationWatchList, shareText, type WatchWithRuns } from '../components/citationWatch/CitationWatchesPanel';
import type { CitationWatchRun } from '../services/citationWatch/citationWatchClient';
import type { WatchNote } from '../services/citationWatch/agentNote';

const NOV_5 = Date.UTC(2026, 10, 5, 2);
const OCT_29 = Date.UTC(2026, 9, 29, 2);

const note: WatchNote = {
  at: NOV_5,
  runId: 'run_2',
  previousRunId: 'run_1',
  kind: 'down',
  verdict: 'drift',
  sentence: 'Citation share fell to 30% (3 of 10 prompts), from 50% (5 of 10) on the previous check.',
  action: 'Review the prompts where your domain was no longer cited.',
  actionSource: 'template',
  numbers: {
    citedCount: 3,
    promptCount: 10,
    sharePercent: 30,
    deltaShare: -0.2,
    previousCitedCount: 5,
    previousPromptCount: 10,
    previousSharePercent: 50,
  },
};

const run = (over: Partial<CitationWatchRun>): CitationWatchRun => ({
  id: 'run_1',
  ranAt: OCT_29,
  measurementStatus: 'measured',
  citedCount: 5,
  promptCount: 10,
  share: 0.5,
  verdict: 'consistent',
  deltaShare: null,
  reason: '',
  agentNote: null,
  ...over,
});

const watch = (runs: CitationWatchRun[] | null, over: Partial<WatchWithRuns['watch']> = {}): WatchWithRuns => ({
  watch: {
    id: 'cw_1',
    clientId: null,
    domain: 'acme.com',
    engine: 'google_aio',
    cadence: 'weekly',
    active: true,
    nextRunAt: null,
    createdAt: OCT_29,
    ...over,
  },
  runs,
});

const render = (props: Partial<Parameters<typeof CitationWatchList>[0]>) =>
  renderToStaticMarkup(createElement(CitationWatchList, { state: 'ready', watches: [], planIncludesWatches: true, ...props }));

describe('Citation watches panel', () => {
  it('shows the watch, its last check, and the latest Oracle note with its date', () => {
    const html = render({
      watches: [watch([run({ id: 'run_2', ranAt: NOV_5, verdict: 'drift', citedCount: 3, share: 0.3, agentNote: note }), run({})])],
    });
    expect(html).toContain('acme.com');
    expect(html).toContain('Google AI Overviews');
    expect(html).toContain('Weekly');
    expect(html).toContain('Last check 5 Nov 2026');
    expect(html).toContain('Drift');
    expect(html).toContain('30% (3 of 10 prompts)');
    expect(html).toContain('Checked by Oracle');
    expect(html).toContain(note.sentence);
    expect(html).toContain('Review the prompts where your domain was no longer cited.');
    expect(html).toContain('Recent checks');
  });

  it('shows the newest note even when the latest run has none', () => {
    const html = render({ watches: [watch([run({ id: 'run_3', ranAt: NOV_5 }), run({ id: 'run_2', agentNote: note })])] });
    expect(html).toContain('Checked by Oracle');
  });

  it('shows no note block and no invented share when nothing was measured', () => {
    const html = render({
      watches: [watch([run({ verdict: 'not_measured', measurementStatus: 'not_measured', share: null, citedCount: null, promptCount: null })])],
    });
    expect(html).toContain('Not measured');
    expect(html).toContain('share not measured');
    expect(html).not.toContain('Checked by Oracle');
    expect(html).not.toMatch(/\d+%/);
  });

  it('says so plainly when a watch has no runs yet', () => {
    expect(render({ watches: [watch([])] })).toContain('No checks have run yet.');
  });

  it('gives plans without scheduled re-audits a plain line instead of an empty list', () => {
    const html = render({ planIncludesWatches: false });
    expect(html).toContain('Your plan does not include scheduled re-audits');
    expect(html).not.toContain('<ul');
  });

  it('shows the signed-out and unavailable states', () => {
    expect(render({ state: 'signed_out' })).toContain('Sign in to see your citation watches.');
    expect(render({ state: 'unavailable' })).toContain('not available on this site yet');
  });

  it('formats share only from returned figures', () => {
    expect(shareText({ share: 0.4, citedCount: 4, promptCount: 10 })).toBe('40% (4 of 10 prompts)');
    expect(shareText({ share: 0.4, citedCount: null, promptCount: null })).toBe('40%');
    expect(shareText({ share: null, citedCount: null, promptCount: null })).toBe('not measured');
  });

  it('uses no em dashes and no agent wording', () => {
    const html = render({ watches: [watch([run({ agentNote: note }), run({ id: 'run_0' })], { active: false })] }).toLowerCase();
    expect(html).not.toContain('—');
    expect(html).not.toMatch(/\bagent|autonomous|does the work/);
  });
});
