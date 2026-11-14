import { describe, expect, it } from 'vitest';
import { addPoint, createTrail, MAX_SPARKS, POINT_LIFE_MS, prune } from '../components/marketing/cursorTrailModel';

const half = () => 0.5;

describe('cursor trail model', () => {
  it('sheds one spark per stretch of travel, drifting back along the stroke', () => {
    const trail = createTrail();
    addPoint(trail, 0, 0, 0, half);
    addPoint(trail, 48, 0, 10, half);

    expect(trail.points).toHaveLength(2);
    expect(trail.sparks).toHaveLength(3);
    expect(trail.sparks[0]).toMatchObject({ x: 24, y: 0, vx: -24, vy: 0, born: 10 });
  });

  it('starts a new ribbon when the pointer jumps instead of streaking across the page', () => {
    const trail = createTrail();
    addPoint(trail, 0, 0, 0, half);
    addPoint(trail, 900, 500, 10, half);

    expect(trail.points).toEqual([{ x: 900, y: 500, born: 10 }]);
    expect(trail.sparks).toHaveLength(0);
  });

  it('caps the sparks however far the pointer travels', () => {
    const trail = createTrail();
    for (let i = 0; i < 400; i++) addPoint(trail, i * 100, 0, i, half);

    expect(trail.sparks).toHaveLength(MAX_SPARKS);
  });

  it('reports nothing left to draw once the ribbon and sparks have faded', () => {
    const trail = createTrail();
    addPoint(trail, 0, 0, 0, half);
    addPoint(trail, 48, 0, 10, half);

    expect(prune(trail, POINT_LIFE_MS)).toBe(true);
    expect(trail.points).toHaveLength(1);
    expect(prune(trail, 5000)).toBe(false);
    expect(trail).toMatchObject({ points: [], sparks: [] });
  });
});
