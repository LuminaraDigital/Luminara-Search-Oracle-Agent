/**
 * Illustrative sample report. Not a measurement of a real agency.
 */
import { LIVE_ANSWER_CHECKS } from './engineCoverage';

export type LiveSampleRow = {
  id: string;
  label: string;
  status: 'measured' | 'not_measured';
  note: string;
};

export const LIVE_SAMPLE_SNAPSHOT = {
  domain: 'example-agency.com.au',
  focus: 'AEO' as const,
  /** ISO date shown on the example. It is not a live collection. */
  measuredAt: '2026-10-02',
  label: 'Illustrative example',
  verdict:
    'Example: the suburb page opens with a slogan, so an answer engine has no direct sentence to quote for "best real estate agent in [suburb]".',
  shipAction:
    "Example: add a 50-word direct answer to 'Who sells homes in [suburb]?' on the suburb page.",
  rows: [
    {
      id: 'crawl_readiness',
      label: 'Crawl readiness',
      status: 'measured' as const,
      note: 'Example: robots.txt and llms.txt found.',
    },
    {
      id: 'schema',
      label: 'RealEstateAgent schema',
      status: 'measured' as const,
      note: 'Example: the homepage names the agency in RealEstateAgent markup.',
    },
    {
      id: 'nap',
      label: 'Name, address, phone',
      status: 'measured' as const,
      note: 'Example: the contact page matches the homepage.',
    },
    {
      id: 'web_serp',
      label: 'Google search',
      status: 'not_measured' as const,
      note: 'Example: not measured in this illustration.',
    },
    {
      id: 'google_aio',
      label: 'AI Overviews',
      status: 'not_measured' as const,
      note: 'Example: not measured in this illustration.',
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      status: 'not_measured' as const,
      note: 'Example: not measured in this illustration.',
    },
    {
      id: 'perplexity',
      label: 'Perplexity',
      status: 'not_measured' as const,
      note: 'Example: not measured in this illustration.',
    },
  ] satisfies LiveSampleRow[],
} as const;

export const SAMPLE_PAGE_LEDE =
  `Illustrative example of an independent real estate agency. These fields show the report shape. They are not a measurement. ${LIVE_ANSWER_CHECKS}`;
