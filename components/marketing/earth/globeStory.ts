/**
 * Landing story copy and illustrative globe data.
 * ILLUSTRATIVE ONLY. Places, arcs and evidence markers are not customers, offices,
 * traffic or audit output. Real audit data (demoFixtures, liveSampleSnapshot) stays out.
 */

export type EvidenceState = 'Measured' | 'Estimated' | 'Not measured';

export interface GlobePlace {
  id: string;
  lat: number;
  lon: number;
}

export interface StoryChapter {
  id: 'scan' | 'ask' | 'prove' | 'fix';
  step: string;
  /** What runs at this step, in plain words. */
  stage: string;
  title: string;
  body: string;
  /** Globe orientation for this chapter: this point faces the viewer. */
  focus: { lat: number; lon: number };
}

export const STORY_CHAPTERS: readonly StoryChapter[] = [
  {
    id: 'scan',
    step: '01',
    stage: 'Site crawl',
    title: 'Read your site the way AI does.',
    body: 'Luminara checks whether search crawlers and AI bots can reach your pages, and whether robots.txt, llms.txt and your schema tell them who you are.',
    focus: { lat: 36, lon: 8 },
  },
  {
    id: 'ask',
    step: '02',
    stage: 'Four-engine check',
    title: 'Ask the engines your buyers ask.',
    body: 'Buyer questions in your category go to Google Search, AI Overviews, ChatGPT and Perplexity. You see who gets named, and whether it is you.',
    focus: { lat: 22, lon: -34 },
  },
  {
    id: 'prove',
    step: '03',
    stage: 'Evidence labels',
    title: 'Know what is proven, and what is not.',
    body: 'Every result carries a label. No blended visibility score, no guesswork dressed up as data.',
    focus: { lat: 22, lon: 26 },
  },
  {
    id: 'fix',
    step: '04',
    stage: 'Next fix',
    title: 'Ship one fix, then check again.',
    body: 'You get the single change most likely to help, with copy and schema ready to paste. Publish it, re-check in one click, and see what moved.',
    focus: { lat: 44, lon: -18 },
  },
];

/** Methodology semantics: Measured = live evidence, Estimated = directional, Not measured = missing. */
export const EVIDENCE_LEGEND: ReadonlyArray<{ state: EvidenceState; meaning: string }> = [
  { state: 'Measured', meaning: 'Observed in a live check.' },
  { state: 'Estimated', meaning: 'Directional, not directly observed.' },
  { state: 'Not measured', meaning: 'No data yet. Shown as missing, never as a poor result.' },
];

export const ENGINES = ['Google Search', 'AI Overviews', 'ChatGPT', 'Perplexity'] as const;

export const GLOBE_NOTICE = 'Illustrative globe. Your results come from a live audit.';

/** The example business the story arcs point at. Illustrative, not a customer. */
export const EXAMPLE_BUSINESS: GlobePlace = { id: 'business', lat: 51.51, lon: -0.13 };

/** Example audience locations for the story chapters, with an illustrative evidence state each. */
export const AUDIENCE_PLACES: ReadonlyArray<GlobePlace & { state: EvidenceState }> = [
  { id: 'new-york', lat: 40.71, lon: -74.0, state: 'Measured' },
  { id: 'toronto', lat: 43.65, lon: -79.38, state: 'Not measured' },
  { id: 'sao-paulo', lat: -23.55, lon: -46.63, state: 'Estimated' },
  { id: 'lagos', lat: 6.52, lon: 3.38, state: 'Measured' },
  { id: 'cairo', lat: 30.04, lon: 31.24, state: 'Estimated' },
  { id: 'nairobi', lat: -1.29, lon: 36.82, state: 'Not measured' },
  { id: 'dubai', lat: 25.2, lon: 55.27, state: 'Measured' },
  { id: 'istanbul', lat: 41.01, lon: 28.98, state: 'Estimated' },
  { id: 'madrid', lat: 40.42, lon: -3.7, state: 'Measured' },
  { id: 'stockholm', lat: 59.33, lon: 18.07, state: 'Not measured' },
  { id: 'mumbai', lat: 19.08, lon: 72.88, state: 'Estimated' },
  { id: 'johannesburg', lat: -26.2, lon: 28.05, state: 'Measured' },
];

/** The one arc the "fix" chapter lights up. */
export const FIX_PLACE_ID = 'new-york';

/** Ambient network for the hero and the statement: illustrative links between world cities. */
export const NETWORK_PLACES: readonly GlobePlace[] = [
  { id: 'london', lat: 51.51, lon: -0.13 },
  { id: 'paris', lat: 48.86, lon: 2.35 },
  { id: 'berlin', lat: 52.52, lon: 13.4 },
  { id: 'moscow', lat: 55.76, lon: 37.62 },
  { id: 'istanbul', lat: 41.01, lon: 28.98 },
  { id: 'dubai', lat: 25.2, lon: 55.27 },
  { id: 'delhi', lat: 28.61, lon: 77.21 },
  { id: 'beijing', lat: 39.9, lon: 116.4 },
  { id: 'seoul', lat: 37.57, lon: 126.98 },
  { id: 'tokyo', lat: 35.68, lon: 139.69 },
  { id: 'new-york', lat: 40.71, lon: -74.0 },
  { id: 'chicago', lat: 41.88, lon: -87.63 },
  { id: 'san-francisco', lat: 37.77, lon: -122.42 },
  { id: 'mexico-city', lat: 19.43, lon: -99.13 },
  { id: 'reykjavik', lat: 64.15, lon: -21.94 },
  { id: 'madrid', lat: 40.42, lon: -3.7 },
  { id: 'cairo', lat: 30.04, lon: 31.24 },
  { id: 'almaty', lat: 43.24, lon: 76.89 },
  { id: 'anchorage', lat: 61.22, lon: -149.9 },
  { id: 'vancouver', lat: 49.28, lon: -123.12 },
];

export const NETWORK_LINKS: ReadonlyArray<readonly [string, string]> = [
  ['london', 'new-york'],
  ['london', 'dubai'],
  ['paris', 'moscow'],
  ['berlin', 'istanbul'],
  ['madrid', 'reykjavik'],
  ['dubai', 'delhi'],
  ['delhi', 'beijing'],
  ['moscow', 'almaty'],
  ['beijing', 'seoul'],
  ['seoul', 'tokyo'],
  ['tokyo', 'anchorage'],
  ['anchorage', 'vancouver'],
  ['vancouver', 'chicago'],
  ['san-francisco', 'new-york'],
  ['chicago', 'mexico-city'],
  ['new-york', 'reykjavik'],
  ['cairo', 'istanbul'],
  ['almaty', 'delhi'],
];

/** Literal RGB triplets mirroring tokens.css gold scale (canvas needs literal colors). */
export const GLOBE_RGB = {
  gold: '191,149,63',
  goldLight: '252,246,186',
  goldWarm: '232,190,110',
} as const;
