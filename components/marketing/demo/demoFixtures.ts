/**
 * Sample Instant Audit playback for the landing Visibility Probe.
 * Fixtures only. Never invent live SEO metrics.
 */

export type DemoPhase =
  | 'empty'
  | 'typing'
  | 'analyzing'
  | 'results_sample'
  | 'error';

export type DemoEngineId = 'web_serp' | 'google_aio' | 'chatgpt' | 'perplexity';

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

export const SAMPLE_FIXTURE: DemoFixture = {
  domain: 'luminarasuite.com',
  focus: 'AEO',
  verdict:
    'Sample scout: classic search signals look clearer than AI answer presence. Entity and citation clarity usually need work before ChatGPT or Perplexity mention you.',
  shipAction: 'Clarify the brand entity on the homepage and add one citable FAQ block.',
  engines: [
    {
      id: 'web_serp',
      label: 'Google + SERP',
      status: 'measured',
      note: 'Sample · illustrative presence in classic results',
    },
    {
      id: 'google_aio',
      label: 'AI Overviews',
      status: 'not_measured',
      note: 'Sample · not measured in this fixture',
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      status: 'not_measured',
      note: 'Sample · not measured until a live scout runs',
    },
    {
      id: 'perplexity',
      label: 'Perplexity',
      status: 'estimated',
      note: 'Sample · illustrative gap only, not a product KPI',
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
    { id: 'web_serp', label: 'Google + SERP', status: 'idle', note: 'Not measured until run' },
    { id: 'google_aio', label: 'AI Overviews', status: 'idle', note: 'Not measured until run' },
    { id: 'chatgpt', label: 'ChatGPT', status: 'idle', note: 'Not measured until run' },
    { id: 'perplexity', label: 'Perplexity', status: 'idle', note: 'Not measured until run' },
  ];
}
