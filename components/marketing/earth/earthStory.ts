/**
 * Landing Earth story: chapter copy, illustrative scene data, palette.
 * ILLUSTRATIVE ONLY. Nothing here is customer, traffic, coverage or audit data.
 * Keep real audit data (demoFixtures, liveSampleSnapshot) out of this module.
 */

export type ChapterId = 'business' | 'discovery' | 'gaps' | 'action';

export type EvidenceState = 'Measured' | 'Estimated' | 'Not measured';

export type EvidenceExample = { state: EvidenceState; channels: readonly string[]; definition: string };

export interface EarthChapter {
  id: ChapterId;
  label: string;
  body: string;
  /** Accessible description of what the canvas shows for this chapter. */
  scene: string;
  /** Globe orientation: this point faces the viewer. */
  focus: { lat: number; lon: number };
  /** Scene layer targets, 0..1. */
  layers: { audiences: number; arcs: number; priority: number; scan: number };
}

export const EARTH_COPY = {
  eyebrow: 'From local business to global discovery',
  heading: 'Make your business easier to find, in search and AI answers.',
  support:
    'See where you stand across Google, AI Overviews, ChatGPT and Perplexity. Turn visibility gaps into a clear next action.',
  cta: 'Open Instant Audit',
  notice: 'Illustrative experience. Actual visibility requires a live audit.',
} as const;

/** Product channels (same four surfaces as the landing coverage strip). Not geographic. */
export const DISCOVERY_CHANNELS = ['Google Search', 'AI Overviews', 'ChatGPT', 'Perplexity'] as const;

/**
 * Illustrative evidence states. Definitions mirror the methodology copy:
 * Measured = live evidence, Estimated = directional, Not measured = missing, never a poor result.
 */
export const EVIDENCE_EXAMPLES: readonly EvidenceExample[] = [
  { state: 'Measured', channels: ['Google Search'], definition: 'Observed in a live check.' },
  { state: 'Estimated', channels: ['AI Overviews'], definition: 'Directional only, not directly observed.' },
  {
    state: 'Not measured',
    channels: ['ChatGPT', 'Perplexity'],
    definition: 'No data yet. Labeled as missing, not a poor result.',
  },
];

export const EXAMPLE_ACTION = {
  label: 'Example next action',
  title: 'Answer your most-asked customer question on your homepage.',
  detail: 'You make the change. Re-run the audit to see what moved.',
  caveat: 'Example only. Your audit produces your own next action.',
} as const;

export const EARTH_CHAPTERS: readonly EarthChapter[] = [
  {
    id: 'business',
    label: 'Your business',
    body: 'Your business has something valuable to offer. Start with your website and the audiences you want to reach.',
    scene: 'Earth turned to Australia with one gold marker for an example business.',
    focus: { lat: -22, lon: 136 },
    layers: { audiences: 0, arcs: 0, priority: 0, scan: 0 },
  },
  {
    id: 'discovery',
    label: 'Where discovery happens',
    body: 'Customers discover businesses through search results and AI answers. Understand which channels have evidence, and which remain unmeasured.',
    scene: 'Example audience markers appear across the region, linked to the business by faint paths.',
    focus: { lat: -6, lon: 128 },
    layers: { audiences: 1, arcs: 0.6, priority: 0, scan: 0 },
  },
  {
    id: 'gaps',
    label: 'Find the gaps',
    body: 'Separate what has been measured from what is estimated or still unknown. Find the gaps worth investigating.',
    scene: 'A slow scan line passes across the globe, brightening the land it checks.',
    focus: { lat: -10, lon: 120 },
    layers: { audiences: 1, arcs: 0.35, priority: 0, scan: 1 },
  },
  {
    id: 'action',
    label: 'Take the next action',
    body: 'Leave with a prioritised next step, not another dashboard to interpret.',
    scene: 'Two example paths from the business light up while the others stay faint.',
    focus: { lat: -2, lon: 140 },
    layers: { audiences: 1, arcs: 1, priority: 1, scan: 0 },
  },
];

/** Illustrative places. Not customers, offices or traffic sources. */
export const EARTH_BUSINESS = { name: 'an example business in Sydney', lat: -33.87, lon: 151.21 } as const;

export const EARTH_AUDIENCES = [
  { name: 'Singapore', lat: 1.35, lon: 103.82, priority: true },
  { name: 'Tokyo', lat: 35.68, lon: 139.69, priority: false },
  { name: 'Auckland', lat: -36.85, lon: 174.76, priority: false },
  { name: 'Los Angeles', lat: 34.05, lon: -118.24, priority: true },
  { name: 'London', lat: 51.51, lon: -0.13, priority: false },
] as const;

/** RGB triplets mirroring tokens.css (--gold, --gold-light). Canvas needs literal colors. */
export const EARTH_PALETTE = {
  gold: '191,149,63',
  goldLight: '252,246,186',
} as const;

export function chapterIndex(id: ChapterId): number {
  return EARTH_CHAPTERS.findIndex((c) => c.id === id);
}

/** Horizontal tablist keys: Left/Right wrap, Home/End jump. Returns null for unhandled keys. */
export function chapterForKey(key: string, current: ChapterId): ChapterId | null {
  const n = EARTH_CHAPTERS.length;
  const i = chapterIndex(current);
  const next =
    key === 'ArrowRight' ? (i + 1) % n
    : key === 'ArrowLeft' ? (i - 1 + n) % n
    : key === 'Home' ? 0
    : key === 'End' ? n - 1
    : -1;
  return next < 0 ? null : EARTH_CHAPTERS[next].id;
}
