/**
 * Sample Instant Audit playback for the landing Visibility Probe.
 * Fixtures only. Never invent live SEO metrics. Never mark engines Measured.
 */

export type DemoPhase =
  | 'empty'
  | 'typing'
  | 'analyzing'
  | 'results_sample'
  | 'error';

export type DemoEngineId = 'crawl_readiness' | 'web_serp' | 'google_aio' | 'chatgpt' | 'perplexity';

export type DemoEngineStatus = 'idle' | 'pending' | 'measured' | 'estimated' | 'not_measured';

export type DemoFocus = 'SEO' | 'AEO' | 'GEO';

export interface DemoEngineRow {
  id: DemoEngineId;
  label: string;
  status: DemoEngineStatus;
  note: string;
}

export interface DemoFixture {
  domain: string;
  focus: DemoFocus;
  verdict: string;
  shipAction: string;
  engines: DemoEngineRow[];
}

export const DEMO_PRESETS = ['luminarasuite.com', 'example.com', 'yourbrand.com'] as const;

/** Sample-only fixture: every engine is not_measured. Measured requires a Live collection. */
export const SAMPLE_FIXTURE: DemoFixture = {
  domain: 'luminarasuite.com',
  focus: 'AEO',
  verdict:
    'Sample scout only: this is the shape of a report, not Live evidence for the domain you typed. Run a free Live Instant Audit to measure engines for your site.',
  shipAction: 'Create a free account and run Instant Audit on your domain for Measured engine rows.',
  engines: [
    {
      id: 'web_serp',
      label: 'Google + SERP',
      status: 'not_measured',
      note: 'Sample · not measured. Run Live Instant Audit to collect this engine.',
    },
    {
      id: 'google_aio',
      label: 'AI Overviews',
      status: 'not_measured',
      note: 'Sample · not measured. Run Live Instant Audit to collect this engine.',
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      status: 'not_measured',
      note: 'Sample · not measured. Run Live Instant Audit to collect this engine.',
    },
    {
      id: 'perplexity',
      label: 'Perplexity',
      status: 'not_measured',
      note: 'Sample · not measured. Run Live Instant Audit to collect this engine.',
    },
  ],
};

export const ANALYZE_STAGES = [
  'Fetching page evidence…',
  'Checking answer engines…',
  'Ranking owner-first fixes…',
] as const;

export function normalizeDemoUrl(raw: string): { ok: true; host: string } | { ok: false; error: string } {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return { ok: false, error: 'Enter a domain or URL.' };
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProto);
    const host = u.hostname.replace(/^www\./, '');
    if (!host || !host.includes('.')) return { ok: false, error: 'Use a full domain like yourbrand.com.' };
    return { ok: true, host };
  } catch {
    return { ok: false, error: 'That does not look like a valid URL.' };
  }
}

export function idleEngines(): DemoEngineRow[] {
  return [
    {
      id: 'crawl_readiness',
      label: 'Crawl readiness',
      status: 'idle',
      note: 'Not measured until run',
    },
    { id: 'web_serp', label: 'Google + SERP', status: 'idle', note: 'Not measured until run' },
    { id: 'google_aio', label: 'AI Overviews', status: 'idle', note: 'Not measured until run' },
    { id: 'chatgpt', label: 'ChatGPT', status: 'idle', note: 'Not measured until run' },
    { id: 'perplexity', label: 'Perplexity', status: 'idle', note: 'Not measured until run' },
  ];
}

/** Sample fixture engines (no crawl row). Engines stay not_measured. */
export function sampleEngineRowsForHost(host: string): DemoEngineRow[] {
  return SAMPLE_FIXTURE.engines.map((row) => ({
    ...row,
    note: row.note.replace('the domain you typed', host),
  }));
}
