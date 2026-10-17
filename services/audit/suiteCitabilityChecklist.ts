/**
 * GEO checklist for the site being audited.
 * Rows stay not_measured until a caller passes a real probe status.
 * This module does not invent pass from files that exist in the repo.
 */
import type { LlmCrawlerStatus } from './llmCrawlerReadiness';

export interface SuiteCitabilityItem {
  id: string;
  label: string;
  note: string;
  status: LlmCrawlerStatus;
}

/** User-facing status. Never show the raw token not_measured. */
export function citabilityStatusLabel(status: string): string {
  if (status === 'not_measured') return 'Not measured';
  if (status === 'pass') return 'Pass';
  if (status === 'fail') return 'Fail';
  return status;
}

const ITEMS: Array<Omit<SuiteCitabilityItem, 'status'>> = [
  {
    id: 'site_robots',
    label: 'robots.txt',
    note: 'Whether AI crawlers can read your homepage.',
  },
  {
    id: 'site_llms',
    label: 'llms.txt',
    note: 'A short summary of your site that agents can quote.',
  },
  {
    id: 'site_sitemap',
    label: 'sitemap.xml',
    note: 'The public URLs on your site.',
  },
  {
    id: 'site_answers',
    label: 'Direct answers',
    note: 'A page that answers the buyer question in the first screen.',
  },
  {
    id: 'site_entity',
    label: 'Entity details',
    note: 'Your name, location, and what you sell, in visible text.',
  },
  {
    id: 'site_schema',
    label: 'Schema',
    note: 'FAQ or organization markup, when you publish it.',
  },
];

const STATUSES = new Set<LlmCrawlerStatus>(['pass', 'fail', 'not_measured']);

export function suiteCitabilityChecklist(
  probed?: Partial<Record<string, LlmCrawlerStatus>> | null,
): SuiteCitabilityItem[] {
  return ITEMS.map((item) => {
    const fromProbe = probed?.[item.id];
    const status = fromProbe && STATUSES.has(fromProbe) ? fromProbe : 'not_measured';
    return { ...item, status };
  });
}
