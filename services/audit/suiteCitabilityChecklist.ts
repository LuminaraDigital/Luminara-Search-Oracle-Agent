/**
 * Suite-as-client GEO checklist.
 * Items stay not_measured until a caller passes a real probe status.
 * This module does not invent pass from files that exist in the repo.
 */
import type { LlmCrawlerStatus } from './llmCrawlerReadiness';

export interface SuiteCitabilityItem {
  id: string;
  label: string;
  href: string;
  note: string;
  status: LlmCrawlerStatus;
}

const ITEMS: Array<Omit<SuiteCitabilityItem, 'status'>> = [
  {
    id: 'suite_llms',
    label: 'llms.txt',
    href: '/llms.txt',
    note: 'Product facts, methodology, and the honesty glossary link.',
  },
  {
    id: 'suite_robots',
    label: 'robots.txt',
    href: '/robots.txt',
    note: 'Named AI crawlers, marketing allows, and the teaser path.',
  },
  {
    id: 'suite_sitemap',
    label: 'sitemap.xml',
    href: '/sitemap.xml',
    note: 'Canonical public URLs, including What is AEO.',
  },
  {
    id: 'suite_aeo',
    label: 'What is AEO?',
    href: '/docs/what-is-aeo.html',
    note: 'Definition, method, and citeable FAQ.',
  },
  {
    id: 'suite_honesty',
    label: 'Honesty glossary',
    href: '/docs/what-is-aeo.html#honesty',
    note: 'measured, estimated, and not_measured.',
  },
  {
    id: 'suite_entity',
    label: 'Entity pages',
    href: '/',
    note: 'Home, how it works, pricing, and legal pages.',
  },
  {
    id: 'suite_teaser',
    label: 'Redacted teaser path',
    href: '/docs/what-is-aeo.html#methodology',
    note: 'robots.txt allows /share/teaser/. Full /share/ reports stay disallowed.',
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
