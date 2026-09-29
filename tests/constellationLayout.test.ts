import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONSTELLATION_ASSET,
  CONSTELLATION_HUB,
  CONSTELLATION_NODE_POS,
  CONSTELLATION_PLATE_OPACITY,
  constellationNodePos,
} from '../components/marketing/constellationLayout';

const ROOT = process.cwd();

describe('constellationLayout', () => {
  it('keeps hub at viewBox center', () => {
    expect(CONSTELLATION_HUB).toEqual({ x: 50, y: 50 });
  });

  it('exposes four answer-engine nodes', () => {
    expect(Object.keys(CONSTELLATION_NODE_POS).sort()).toEqual(
      ['chatgpt', 'google_aio', 'perplexity', 'web_serp'].sort()
    );
    expect(CONSTELLATION_NODE_POS.web_serp).toEqual({ x: 50, y: 12 });
    expect(CONSTELLATION_NODE_POS.google_aio).toEqual({ x: 88, y: 42 });
    expect(CONSTELLATION_NODE_POS.chatgpt).toEqual({ x: 50, y: 88 });
    expect(CONSTELLATION_NODE_POS.perplexity).toEqual({ x: 12, y: 42 });
  });

  it('falls back unknown ids to hub', () => {
    expect(constellationNodePos('unknown')).toEqual(CONSTELLATION_HUB);
  });

  it('keeps plate opacity subtle so interactive nodes stay primary', () => {
    expect(CONSTELLATION_PLATE_OPACITY).toBeGreaterThan(0);
    expect(CONSTELLATION_PLATE_OPACITY).toBeLessThanOrEqual(0.5);
  });

  it('points public plates at committed brand assets', () => {
    expect(CONSTELLATION_ASSET.idlePlate).toBe('/brand/constellation/field-idle.webp');
    expect(CONSTELLATION_ASSET.samplePlate).toBe('/brand/constellation/field-sample.webp');
    expect(CONSTELLATION_ASSET.heroPlate).toBe('/brand/constellation/field-hero.webp');
    expect(CONSTELLATION_ASSET.heroNodesPlate).toBe('/brand/constellation/field-hero-nodes.webp');
    expect(CONSTELLATION_ASSET.ogStill).toBe('/brand/constellation/og-visibility-field.png');
  });
});

describe('committed constellation bake outputs', () => {
  const out = join(ROOT, 'public/brand/constellation');
  const archive = join(ROOT, 'design/constellation/visibility-field.glb');

  it('ships deployable plates under budget', () => {
    const idle = join(out, 'field-idle.webp');
    const sample = join(out, 'field-sample.webp');
    const hero = join(out, 'field-hero.webp');
    const og = join(out, 'og-visibility-field.png');
    const manifest = join(out, 'manifest.json');
    for (const p of [idle, sample, hero, og, manifest, archive]) {
      expect(existsSync(p), `missing ${p}`).toBe(true);
    }
    expect(statSync(idle).size).toBeLessThanOrEqual(100_000);
    expect(statSync(sample).size).toBeLessThanOrEqual(100_000);
    expect(statSync(hero).size).toBeLessThanOrEqual(140_000);
    expect(statSync(og).size).toBeLessThanOrEqual(220_000);
    expect(statSync(archive).size).toBeLessThanOrEqual(700_000);
    const combined = statSync(hero).size + statSync(idle).size;
    expect(combined).toBeLessThanOrEqual(72_000);
    const nodes = join(out, 'field-hero-nodes.webp');
    if (existsSync(nodes)) {
      expect(statSync(nodes).size).toBeLessThanOrEqual(60_000);
    }
  });

  it('manifest documents authoring-only GLB and honesty lock', () => {
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(manifest.runtime).toMatch(/SVG \+ Canvas2D/i);
    expect(String(manifest.honesty)).toMatch(/never invent/i);
    expect(manifest.layout_source).toBe('components/marketing/constellationLayout.ts');
    expect(manifest.archive_glb).toContain('visibility-field.glb');
  });
});
