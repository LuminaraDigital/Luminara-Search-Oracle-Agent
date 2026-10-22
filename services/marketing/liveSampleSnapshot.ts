/**
 * Dated static Live crawl snapshot for luminarasuite.com (sample-report page).
 * Crawl signals only. This snapshot did not measure answer engines.
 * Prefer this over Growth share tokens (no expiry).
 */
import { LIVE_ANSWER_CHECKS } from './engineCoverage';

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
  label: 'Example report (snapshot from 2 Oct 2026)',
  verdict:
    `Example snapshot from 2 Oct 2026: robots.txt and llms.txt are present on luminarasuite.com. Google, AI Overviews, ChatGPT, and Perplexity were not measured in this snapshot. ${LIVE_ANSWER_CHECKS}`,
  shipAction:
    'Keep llms.txt current, then run Instant Audit for a site and web-search check and one fix.',
  rows: [
    {
      id: 'crawl_readiness',
      label: 'Crawl readiness',
      status: 'measured' as const,
      note: 'Example snapshot · robots.txt found; llms.txt found. Collected 2 Oct 2026.',
    },
    {
      id: 'web_serp',
      label: 'Google + SERP',
      status: 'not_measured' as const,
      note: 'Not measured in this snapshot. A signed-in audit can check live web search.',
    },
    {
      id: 'google_aio',
      label: 'AI Overviews',
      status: 'not_measured' as const,
      note: 'Not measured in this snapshot. Live answers need Agency or your own DataForSEO login.',
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      status: 'not_measured' as const,
      note: 'Not measured in this snapshot. Live answers need Agency or your own DataForSEO login.',
    },
    {
      id: 'perplexity',
      label: 'Perplexity',
      status: 'not_measured' as const,
      note: 'Not measured in this snapshot. Live answers need Agency or your own DataForSEO login.',
    },
  ] satisfies LiveSampleRow[],
} as const;
