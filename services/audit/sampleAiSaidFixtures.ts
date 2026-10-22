/**
 * Labeled Sample "AI said" rows for Weekly Decision Card Why panel.
 * Not Live measurement. Never invent cite KPIs.
 */
import { readableStem } from './brandName';

export type SampleAiSaidRow = {
  id: string;
  label: 'Sample';
  engine: 'ChatGPT' | 'Perplexity' | 'Google AI Overviews';
  prompt: string;
  excerpt: string;
  presence: 'absent' | 'mentioned' | 'recommended';
  measurementStatus: 'not_measured';
  note: string;
};

/** Deterministic fixture set for a domain (Sample UI only). A prompt names the brand or the site, not both. */
export function sampleAiSaidFixtures(domain: string, brandName?: string | null): SampleAiSaidRow[] {
  const host = domain
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase() || 'yourbrand.com';
  const brand = (brandName || '').trim() || readableStem(host);

  return [
    {
      id: 'sample-chatgpt-local',
      label: 'Sample',
      engine: 'ChatGPT',
      prompt: `Best providers like ${brand}`,
      excerpt: `Sample answer (not Live): competitors are named first. ${brand} is absent or only vaguely related.`,
      presence: 'absent',
      measurementStatus: 'not_measured',
      note: 'Labeled Sample. Live Instant Audit may measure this engine when keys are connected.',
    },
    {
      id: 'sample-perplexity-compare',
      label: 'Sample',
      engine: 'Perplexity',
      prompt: `Who is recommended instead of ${brand}?`,
      excerpt: 'Sample answer (not Live): a rival is recommended. This site is not cited as a source.',
      presence: 'mentioned',
      measurementStatus: 'not_measured',
      note: 'Mention without recommendation. Sample row, not measured.',
    },
    {
      id: 'sample-aio-trust',
      label: 'Sample',
      engine: 'Google AI Overviews',
      prompt: `Is ${brand} reputable?`,
      excerpt: 'Sample answer (not Live): overview leans on third-party directories; owned pages are not the primary citation.',
      presence: 'absent',
      measurementStatus: 'not_measured',
      note: 'Sample only. Do not report as measured citation rate.',
    },
  ];
}
