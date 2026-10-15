import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HERO_ENGINE_ANCHORS,
  HERO_MOON_SCALE,
  fibSphere,
  heroCap,
  heroSphereFrame,
  projectSpherePoint,
  starField,
} from '../components/marketing/sphereField';

describe('fibSphere', () => {
  it('returns the requested count', () => {
    expect(fibSphere(12)).toHaveLength(12);
    expect(fibSphere(1100)).toHaveLength(1100);
    expect(fibSphere(0)).toHaveLength(0);
  });

  it('is deterministic', () => {
    expect(fibSphere(64)).toEqual(fibSphere(64));
  });

  it('keeps points on the unit sphere', () => {
    for (const point of fibSphere(48)) {
      const len = Math.hypot(point.x, point.y, point.z);
      expect(len).toBeGreaterThan(0.98);
      expect(len).toBeLessThan(1.02);
    }
  });
});

describe('heroCap', () => {
  it('stays on the upper cap and is deterministic', () => {
    const cap = heroCap(400);
    expect(cap).toHaveLength(400);
    expect(cap.every((point) => point.y > 0.08)).toBe(true);
    expect(cap).toEqual(heroCap(400));
  });
});

describe('projectSpherePoint', () => {
  const camera = { yaw: 0, pitch: 0, radius: 200, originX: 400, originY: 300 };

  it('puts a near-side point in front of the camera', () => {
    const projected = projectSpherePoint({ x: 0, y: 0, z: 1 }, camera);
    expect(projected.front).toBe(true);
    expect(projected.z).toBeGreaterThan(0);
    expect(projected.sx).toBeCloseTo(camera.originX);
    expect(projected.sy).toBeCloseTo(camera.originY);
    expect(projected.scale).toBeGreaterThan(1);
  });

  it('puts a far-side point behind the camera', () => {
    const projected = projectSpherePoint({ x: 0, y: 0, z: -1 }, camera);
    expect(projected.front).toBe(false);
    expect(projected.z).toBeLessThan(0);
  });
});

describe('heroSphereFrame', () => {
  it('fills the lower frame with a cropped sphere face', () => {
    const frame = heroSphereFrame(1440, 900);
    expect(frame.radius).toBeGreaterThan(1440 * 0.55);
    expect(frame.originY - frame.radius).toBeCloseTo(900 * 0.62);
    expect(frame.originY).toBeGreaterThan(900);
  });

  it('lowers the horizon on a phone', () => {
    const frame = heroSphereFrame(375, 812);
    expect(frame.originY - frame.radius).toBeCloseTo(812 * 0.78);
  });

  it('places side engines left and right, and the upper pair higher', () => {
    const frame = heroSphereFrame(1440, 900);
    const moon = { ...frame, radius: frame.radius * HERO_MOON_SCALE };
    const left = projectSpherePoint(HERO_ENGINE_ANCHORS.chatgpt, moon);
    const right = projectSpherePoint(HERO_ENGINE_ANCHORS.perplexity, moon);
    const google = projectSpherePoint(HERO_ENGINE_ANCHORS.web_serp, moon);
    const overviews = projectSpherePoint(HERO_ENGINE_ANCHORS.google_aio, moon);

    expect(left.front).toBe(true);
    expect(right.front).toBe(true);
    expect(google.front).toBe(true);
    expect(overviews.front).toBe(true);
    expect(left.sx).toBeLessThan(1440 * 0.28);
    expect(right.sx).toBeGreaterThan(1440 * 0.72);
    expect(google.sy).toBeLessThan(left.sy);
    expect(overviews.sy).toBeLessThan(right.sy);
    expect(left.sy).toBeGreaterThan(900 * 0.45);
    expect(left.sy).toBeLessThan(900);
    expect(right.sy).toBeLessThan(900);
  });
});

describe('landing scene contract', () => {
  const landing = readFileSync(new URL('../components/LandingPage.tsx', import.meta.url), 'utf8');
  const sphere = readFileSync(new URL('../components/marketing/VisibilitySphere.tsx', import.meta.url), 'utf8');

  it('puts the claim on a sphere and keeps the Probe in the next section', () => {
    expect(landing).toContain('Where answers happen.');
    expect(landing).toContain('Run a labeled sample.');
    expect(landing).toContain('tone="overlay"');
    expect(landing).not.toContain('MarketingAtmosphere');
    expect(landing).not.toContain("from 'three'");
    expect(sphere).not.toContain("from 'three'");
    expect(sphere).toContain('prefers-reduced-motion');
  });
});

describe('starField', () => {
  it('is a fixed two-size field', () => {
    const stars = starField(90);
    expect(stars).toHaveLength(90);
    expect(stars).toEqual(starField(90));
    expect(stars.filter((star) => star.size > 1).length).toBeGreaterThan(10);
  });
});
