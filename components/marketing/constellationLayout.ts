/**
 * Single source of truth for the Visibility Field layout.
 * Matches marketing SVG/Canvas and the Blender bake script
 * (`scripts/constellation/bake_visibility_field.py`).
 *
 * Coordinates are percent of a 0-100 square viewBox (top-left origin).
 * Lit vs dim is driven only by measurement status at runtime - never invent scores.
 */

export const CONSTELLATION_VIEWBOX = 100 as const;

export const CONSTELLATION_HUB = { x: 50, y: 50 } as const;

/** Engine node ids matching demo fixtures / Instant Audit vocabulary. */
export type ConstellationEngineId =
  | 'web_serp'
  | 'google_aio'
  | 'chatgpt'
  | 'perplexity';

export interface ConstellationNodePos {
  x: number;
  y: number;
}

export const CONSTELLATION_NODE_POS: Record<ConstellationEngineId, ConstellationNodePos> = {
  web_serp: { x: 50, y: 12 },
  google_aio: { x: 88, y: 42 },
  chatgpt: { x: 50, y: 88 },
  perplexity: { x: 12, y: 42 },
};

export const CONSTELLATION_ENGINE_LABELS: Record<ConstellationEngineId, string> = {
  web_serp: 'Google + SERP',
  google_aio: 'AI Overviews',
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
};

/** Public baked plates (committed; Blender optional for regen). */
export const CONSTELLATION_ASSET = {
  idlePlate: '/brand/constellation/field-idle.webp',
  samplePlate: '/brand/constellation/field-sample.webp',
  heroPlate: '/brand/constellation/field-hero.webp',
  /** Transparent near-layer depth matte (optional until bake lands). */
  heroNodesPlate: '/brand/constellation/field-hero-nodes.webp',
  ogStill: '/brand/constellation/og-visibility-field.png',
  manifest: '/brand/constellation/manifest.json',
} as const;

/** Soft underlay inside the interactive field; keep nodes primary. */
export const CONSTELLATION_PLATE_OPACITY = 0.4;

/** Hero stage backdrop behind Visibility Probe (desktop gated). */
export const CONSTELLATION_HERO_OPACITY = 0.72;

export function constellationNodePos(id: string): ConstellationNodePos {
  const known = CONSTELLATION_NODE_POS[id as ConstellationEngineId];
  return known ?? { ...CONSTELLATION_HUB };
}
