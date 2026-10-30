import { LIVE_ANSWER_CHECKS, SITE_AND_SEARCH_CHECK } from '../../../services/marketing/engineCoverage';

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
    body: 'Luminara checks whether search crawlers and AI bots can reach your pages, and whether robots.txt, llms.txt, schema and suburb pages give a clear answer and enquiry path.',
    focus: { lat: -30, lon: 140 },
  },
  {
    id: 'ask',
    step: '02',
    stage: 'Buyer questions',
    title: 'Ask the questions your buyers ask.',
    body: `${SITE_AND_SEARCH_CHECK} ${LIVE_ANSWER_CHECKS}`,
    focus: { lat: -14, lon: 126 },
  },
  {
    id: 'prove',
    step: '03',
    stage: 'Evidence labels',
    title: 'Know what is proven, and what is not.',
    body: 'Every result carries a label. No blended visibility score, no guesswork dressed up as data.',
    focus: { lat: -6, lon: 118 },
  },
  {
    id: 'fix',
    step: '04',
    stage: 'Next fix',
    title: 'Ship one fix, then check again.',
    body: 'You get the single change most likely to win the call, from direct suburb answers and review schema to a clearer appraisal path, ready to paste. Publish it, re-check in one click, and see what moved.',
    focus: { lat: -24, lon: 132 },
  },
];

/** Methodology semantics: Measured = live evidence, Estimated = directional, Not measured = missing. */
export const EVIDENCE_LEGEND: ReadonlyArray<{ state: EvidenceState; meaning: string }> = [
  { state: 'Measured', meaning: 'Observed in a live check.' },
  { state: 'Estimated', meaning: 'Directional, not directly observed.' },
  { state: 'Not measured', meaning: 'No data yet. Shown as missing, never as a poor result.' },
];

export const ENGINES = ['Web search', 'AI answers'] as const;

export const GLOBE_NOTICE = 'Illustrative globe. Your results come from a live audit.';

/**
 * The example business the story arcs point at: Melbourne, where Luminara is based.
 * Illustrative, not a customer.
 */
export const EXAMPLE_BUSINESS: GlobePlace = { id: 'business', lat: -37.81, lon: 144.96 };

/**
 * Example audience locations for the story chapters, with an illustrative evidence state each.
 * Oceania and Southeast Asia first: the markets closest to a Melbourne business.
 */
export const AUDIENCE_PLACES: ReadonlyArray<GlobePlace & { state: EvidenceState }> = [
  { id: 'sydney', lat: -33.87, lon: 151.21, state: 'Measured' },
  { id: 'brisbane', lat: -27.47, lon: 153.03, state: 'Estimated' },
  { id: 'adelaide', lat: -34.93, lon: 138.6, state: 'Not measured' },
  { id: 'perth', lat: -31.95, lon: 115.86, state: 'Measured' },
  { id: 'auckland', lat: -36.85, lon: 174.76, state: 'Estimated' },
  { id: 'singapore', lat: 1.35, lon: 103.82, state: 'Measured' },
  { id: 'jakarta', lat: -6.21, lon: 106.85, state: 'Not measured' },
  { id: 'kuala-lumpur', lat: 3.14, lon: 101.69, state: 'Estimated' },
  { id: 'bangkok', lat: 13.76, lon: 100.5, state: 'Measured' },
  { id: 'manila', lat: 14.6, lon: 120.98, state: 'Not measured' },
  { id: 'ho-chi-minh-city', lat: 10.82, lon: 106.63, state: 'Estimated' },
  { id: 'hong-kong', lat: 22.32, lon: 114.17, state: 'Measured' },
];

/** The one arc the "fix" chapter lights up. */
export const FIX_PLACE_ID = 'singapore';

/**
 * Ambient network for the hero and the statement: illustrative links across Oceania,
 * Southeast and East Asia, with a few long-haul routes out to the wider world.
 */
export const NETWORK_PLACES: readonly GlobePlace[] = [
  { id: 'melbourne', lat: -37.81, lon: 144.96 },
  { id: 'sydney', lat: -33.87, lon: 151.21 },
  { id: 'brisbane', lat: -27.47, lon: 153.03 },
  { id: 'perth', lat: -31.95, lon: 115.86 },
  { id: 'darwin', lat: -12.46, lon: 130.84 },
  { id: 'auckland', lat: -36.85, lon: 174.76 },
  { id: 'suva', lat: -18.14, lon: 178.44 },
  { id: 'port-moresby', lat: -9.44, lon: 147.18 },
  { id: 'singapore', lat: 1.35, lon: 103.82 },
  { id: 'jakarta', lat: -6.21, lon: 106.85 },
  { id: 'kuala-lumpur', lat: 3.14, lon: 101.69 },
  { id: 'bangkok', lat: 13.76, lon: 100.5 },
  { id: 'ho-chi-minh-city', lat: 10.82, lon: 106.63 },
  { id: 'manila', lat: 14.6, lon: 120.98 },
  { id: 'hong-kong', lat: 22.32, lon: 114.17 },
  { id: 'taipei', lat: 25.03, lon: 121.57 },
  { id: 'shanghai', lat: 31.23, lon: 121.47 },
  { id: 'seoul', lat: 37.57, lon: 126.98 },
  { id: 'tokyo', lat: 35.68, lon: 139.69 },
  { id: 'mumbai', lat: 19.08, lon: 72.88 },
  { id: 'dubai', lat: 25.2, lon: 55.27 },
  { id: 'los-angeles', lat: 34.05, lon: -118.24 },
];

export const NETWORK_LINKS: ReadonlyArray<readonly [string, string]> = [
  ['melbourne', 'sydney'],
  ['melbourne', 'perth'],
  ['melbourne', 'singapore'],
  ['sydney', 'auckland'],
  ['sydney', 'tokyo'],
  ['sydney', 'los-angeles'],
  ['brisbane', 'port-moresby'],
  ['auckland', 'suva'],
  ['perth', 'singapore'],
  ['darwin', 'jakarta'],
  ['singapore', 'kuala-lumpur'],
  ['singapore', 'bangkok'],
  ['singapore', 'mumbai'],
  ['bangkok', 'ho-chi-minh-city'],
  ['ho-chi-minh-city', 'manila'],
  ['manila', 'hong-kong'],
  ['hong-kong', 'taipei'],
  ['taipei', 'tokyo'],
  ['tokyo', 'seoul'],
  ['seoul', 'shanghai'],
  ['shanghai', 'hong-kong'],
  ['mumbai', 'dubai'],
];

/** Literal RGB triplets mirroring tokens.css gold scale (canvas needs literal colors). */
export const GLOBE_RGB = {
  gold: '191,149,63',
  goldLight: '252,246,186',
  goldWarm: '232,190,110',
} as const;
