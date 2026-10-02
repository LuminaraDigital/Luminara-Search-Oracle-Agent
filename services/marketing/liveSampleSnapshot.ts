/**
 * Dated static Live crawl snapshot for luminarasuite.com (sample-report page).
 * Crawl signals only. Engine rows stay not_measured until Instant Audit.
 * Prefer this over Growth share tokens (no expiry).
 */

export type LiveSampleRow = {
  id: string;
  label: string;
  status: 'measured' | 'not_measured';
  note: string;
};

export const LIVE_SAMPLE_SNAPSHOT = {
  domain: 'luminarasuite.com',
  focus: 'AEO' as const,
  /** ISO date of the crawl collection (UTC calendar day). */
  measuredAt: '2026-10-02',
  label: 'Live crawl',
  verdict:
    'Live crawl on 2026-10-02: robots.txt and llms.txt are present on luminarasuite.com. Google, AI Overviews, ChatGPT, and Perplexity were not measured in this snapshot. Run Instant Audit for engine evidence.',
  shipAction:
    'Keep llms.txt current, then run Instant Audit to measure answer-engine presence and pick one fix.',
  rows: [
    {
      id: 'crawl_readiness',
      label: 'Crawl readiness',
      status: 'measured' as const,
      note: 'Live crawl · robots.txt found; llms.txt found. Collected 2026-10-02.',
    },
    {
      id: 'web_serp',
      label: 'Google + SERP',
      status: 'not_measured' as const,
      note: 'Not measured in this snapshot. Run Live Instant Audit.',
    },
    {
      id: 'google_aio',
      label: 'AI Overviews',
      status: 'not_measured' as const,
      note: 'Not measured in this snapshot. Run Live Instant Audit.',
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      status: 'not_measured' as const,
      note: 'Not measured in this snapshot. Run Live Instant Audit.',
    },
    {
      id: 'perplexity',
      label: 'Perplexity',
      status: 'not_measured' as const,
      note: 'Not measured in this snapshot. Run Live Instant Audit.',
    },
  ] satisfies LiveSampleRow[],
} as const;
