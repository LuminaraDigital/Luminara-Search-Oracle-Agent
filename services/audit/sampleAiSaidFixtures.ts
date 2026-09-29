/**
 * Labeled Sample "AI said" rows for Weekly Decision Card Why panel.
 * Not Live measurement. Never invent cite KPIs.
 */

export type SampleAiSaidRow = {
  id: string;
  label: 'Sample';
  engine: 'ChatGPT' | 'Perplexity' | 'Google AI Overviews';
  prompt: string;
  excerpt: string;
  presence: 'absent' | 'mentioned' | 'recommended';
  measurementStatus: 'estimated';
  note: string;
};

/** Deterministic fixture set for a domain (Sample UI only). */
export function sampleAiSaidFixtures(domain: string): SampleAiSaidRow[] {
  const host = domain
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase() || 'yourbrand.com';
  const brand = host.split('.')[0] || 'brand';

  return [
    {
      id: 'sample-chatgpt-local',
      label: 'Sample',
      engine: 'ChatGPT',
      prompt: `Best providers like ${brand} for ${host} customers`,
      excerpt: `Sample answer (not Live): competitors are named first. ${brand} is absent or only vaguely related.`,
      presence: 'absent',
      measurementStatus: 'estimated',
      note: 'Labeled Sample. Live Instant Audit may measure this engine when keys are connected.',
    },
    {
      id: 'sample-perplexity-compare',
      label: 'Sample',
      engine: 'Perplexity',
      prompt: `${brand} vs alternatives for AI search visibility`,
      excerpt: `Sample answer (not Live): a rival is recommended; ${host} is not cited as a source.`,
      presence: 'mentioned',
      measurementStatus: 'estimated',
      note: 'Mention without recommendation. Treat as estimated until Live probes run.',
    },
    {
      id: 'sample-aio-trust',
      label: 'Sample',
      engine: 'Google AI Overviews',
      prompt: `Is ${brand} reputable for ${host.replace(/\.\w+$/, '')} services?`,
      excerpt: 'Sample answer (not Live): overview leans on third-party directories; owned pages are not the primary citation.',
      presence: 'absent',
      measurementStatus: 'estimated',
      note: 'Sample only. Do not report as measured citation rate.',
    },
  ];
}
