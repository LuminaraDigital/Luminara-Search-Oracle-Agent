import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  applyMatrix,
  centerPose,
  dotLevel,
  fromLatLon,
  horizonPose,
  lerpPose,
  liftedArc,
  storyPose,
  storyProgress,
  viewMatrix,
} from '../components/marketing/earth/globeMath';
import {
  AUDIENCE_PLACES,
  ENGINES,
  EVIDENCE_LEGEND,
  FIX_PLACE_ID,
  GLOBE_NOTICE,
  NETWORK_LINKS,
  NETWORK_PLACES,
  STORY_CHAPTERS,
} from '../components/marketing/earth/globeStory';
import { landMaskFromPixels } from '../components/marketing/earth/globeRenderer';
import { chapterForProgress, targetForProgress } from '../components/marketing/SpaceStage';

describe('globe math', () => {
  it('turns the focus point toward the viewer', () => {
    for (const [lat, lon] of [[0, 0], [36, 8], [-33.9, 151.2], [64, -21]]) {
      const v = applyMatrix(viewMatrix(lat, lon), fromLatLon(lat, lon));
      expect(v[0]).toBeCloseTo(0, 6);
      expect(v[1]).toBeCloseTo(0, 6);
      expect(v[2]).toBeCloseTo(1, 6);
    }
  });

  it('keeps north up after rotation', () => {
    const v = applyMatrix(viewMatrix(20, 40), fromLatLon(60, 40));
    expect(v[1]).toBeGreaterThan(0);
    expect(v[0]).toBeCloseTo(0, 6);
  });

  it('takes the short way round for longitude', () => {
    expect(angleDelta(170, -170)).toBeCloseTo(20);
    expect(angleDelta(-170, 170)).toBeCloseTo(-20);
    expect(angleDelta(10, 10)).toBe(0);
  });

  it('lifts arcs off the surface but lands on both endpoints', () => {
    const a = fromLatLon(51.5, 0);
    const b = fromLatLon(40.7, -74);
    const pts = liftedArc(a, b, 0.14, 32);
    const first = [pts[0], pts[1], pts[2]];
    const last = [pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]];
    first.forEach((c, i) => expect(c).toBeCloseTo(a[i], 5));
    last.forEach((c, i) => expect(c).toBeCloseTo(b[i], 5));
    const mid = Math.hypot(pts[45], pts[46], pts[47]);
    expect(mid).toBeGreaterThan(1.02);
  });

  it('picks a dot level that refines smoothly as the globe grows', () => {
    const small = dotLevel(300, 8.5);
    const large = dotLevel(3000, 8.5);
    expect(large.pitch).toBeLessThan(small.pitch);
    for (const r of [200, 600, 1800, 5000]) {
      const l = dotLevel(r, 8.5);
      expect(l.mix).toBeGreaterThanOrEqual(0);
      expect(l.mix).toBeLessThan(1);
      expect([4, 2, 1, 0.5, 0.25, 0.125]).toContain(l.pitch);
    }
  });

  it('maps scroll anchors to a continuous story scalar', () => {
    expect(storyProgress([0, 900, 1800])).toBe(0);
    expect(storyProgress([120, 900, 1800])).toBe(0);
    expect(storyProgress([-450, 450, 1350])).toBeCloseTo(0.5);
    expect(storyProgress([-900, 0, 900])).toBeCloseTo(1);
    expect(storyProgress([-3000, -2000, -1000])).toBe(2);
  });

  it('puts the hero horizon low, the statement globe centred, and the story globe clear of the copy', () => {
    const hero = horizonPose(1440, 900);
    expect(hero.cy - hero.r).toBeGreaterThan(900 * 0.6);
    expect(hero.sun[2]).toBeLessThan(0);
    const center = centerPose(1440, 900);
    expect(center.cx).toBe(720);
    const story = storyPose(1440, 900);
    expect(story.cx - story.r).toBeGreaterThan(1440 * 0.45);
    const mobile = storyPose(375, 812);
    expect(mobile.cy + mobile.r).toBeLessThan(812 * 0.5);
    const halfway = lerpPose(hero, center, 0.5);
    expect(halfway.r).toBeLessThan(hero.r);
    expect(halfway.r).toBeGreaterThan(center.r);
  });
});

describe('stage choreography', () => {
  it('reports no chapter before the story and each chapter in turn after it', () => {
    expect(chapterForProgress(0)).toBe(-1);
    expect(chapterForProgress(1.2)).toBe(-1);
    expect(chapterForProgress(2)).toBe(0);
    expect(chapterForProgress(3.1)).toBe(1);
    expect(chapterForProgress(4)).toBe(2);
    expect(chapterForProgress(9)).toBe(STORY_CHAPTERS.length - 1);
  });

  it('spins freely in the hero and locks to each chapter focus in the story', () => {
    const hero = targetForProgress(0, 1440, 900);
    expect(hero.lon).toBeNull();
    expect(hero.layers.network).toBeGreaterThan(0);
    expect(hero.layers.marker).toBe(0);
    STORY_CHAPTERS.forEach((c, i) => {
      const t = targetForProgress(2 + i, 1440, 900);
      expect(t.lat).toBe(c.focus.lat);
      expect(t.lon).toBe(c.focus.lon);
      expect(t.layers.network).toBe(0);
      expect(t.layers.marker).toBe(1);
    });
    expect(targetForProgress(2, 1440, 900).layers.scan).toBe(1);
    expect(targetForProgress(4, 1440, 900).layers.proof).toBe(1);
    expect(targetForProgress(5, 1440, 900).layers.fix).toBe(1);
  });
});

describe('land mask from the daymap', () => {
  it('classifies blue ocean, shelves, land and ice', () => {
    const px = Uint8ClampedArray.from([
      10, 30, 90, 255, // deep ocean
      60, 140, 190, 255, // shelf
      60, 90, 40, 255, // forest
      200, 170, 130, 255, // desert
      235, 240, 245, 255, // ice
      120, 130, 150, 255, // grey tundra
    ]);
    const m = landMaskFromPixels(px);
    const land = [0, 1, 2, 3, 4, 5].map((i) => m[i * 4]);
    const ice = [0, 1, 2, 3, 4, 5].map((i) => m[i * 4 + 1]);
    expect(land).toEqual([0, 0, 255, 255, 255, 255]);
    expect(ice).toEqual([0, 0, 0, 0, 255, 0]);
  });
});

describe('landing story copy stays honest', () => {
  const copy = [
    ...STORY_CHAPTERS.flatMap((c) => [c.stage, c.title, c.body]),
    ...EVIDENCE_LEGEND.map((e) => e.meaning),
    GLOBE_NOTICE,
  ].join(' ');

  it('makes no numeric outcome claims', () => {
    expect(copy).not.toMatch(/\d+\s?%/);
    expect(copy).not.toMatch(/\b\d+x\b/i);
    expect(copy).not.toMatch(/guarantee/i);
    expect(copy).not.toContain('—');
  });

  it('keeps the evidence semantics and the illustrative notice', () => {
    expect(EVIDENCE_LEGEND.map((e) => e.state)).toEqual(['Measured', 'Estimated', 'Not measured']);
    expect(EVIDENCE_LEGEND[2].meaning.toLowerCase()).toContain('never as a poor result');
    expect(GLOBE_NOTICE.toLowerCase()).toContain('illustrative');
    expect(ENGINES).toEqual(['Google Search', 'AI Overviews', 'ChatGPT', 'Perplexity']);
  });

  it('only links places that exist', () => {
    const ids = new Set(NETWORK_PLACES.map((p) => p.id));
    for (const [a, b] of NETWORK_LINKS) {
      expect(ids.has(a)).toBe(true);
      expect(ids.has(b)).toBe(true);
    }
    expect(AUDIENCE_PLACES.some((p) => p.id === FIX_PLACE_ID)).toBe(true);
  });
});
