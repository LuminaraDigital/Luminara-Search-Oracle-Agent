import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EarthStorySection } from '../components/marketing/EarthStorySection';
import {
  arcPoints,
  buildGraticule,
  decodeLand,
  decodeRings,
  fromLatLon,
  viewRotate,
  type Vec3,
} from '../components/marketing/earth/earthScene';
import {
  DISCOVERY_CHANNELS,
  EARTH_AUDIENCES,
  EARTH_BUSINESS,
  EARTH_CHAPTERS,
  EARTH_COPY,
  EARTH_HUBS,
  EVIDENCE_EXAMPLES,
  EXAMPLE_ACTION,
  chapterForKey,
  formatLatLon,
  greatCircleKm,
} from '../components/marketing/earth/earthStory';
import {
  COAST_RINGS_B64,
  LAND_BITSET_B64,
  LAND_SAMPLE_COUNT,
  MARKET_RINGS_B64,
} from '../components/marketing/earth/landDots.generated';

const DEG = Math.PI / 180;
const land = decodeLand(LAND_BITSET_B64, LAND_SAMPLE_COUNT);

function nearestLandDeg(lat: number, lon: number): number {
  const [x, y, z] = fromLatLon(lat, lon);
  let best = -1;
  for (let i = 0; i < land.length; i += 3) best = Math.max(best, x * land[i] + y * land[i + 1] + z * land[i + 2]);
  return Math.acos(Math.min(1, best)) / DEG;
}

function facing(p: Vec3, focus: { lat: number; lon: number }): number {
  return viewRotate(p, focus.lat * DEG, focus.lon * DEG)[2];
}

describe('earth land & vector coastline data (Natural Earth + world-atlas bake)', () => {
  it('has an Earth-like land share', () => {
    const share = land.length / 3 / LAND_SAMPLE_COUNT;
    expect(share).toBeGreaterThan(0.27);
    expect(share).toBeLessThan(0.31);
  });

  it('puts continents on land and oceans in water', () => {
    for (const [lat, lon] of [[-25, 134], [23, 13], [-5, -60], [60, 100], [40, -100], [-80, 0]]) {
      expect(nearestLandDeg(lat, lon)).toBeLessThan(2);
    }
    for (const [lat, lon] of [[0, -150], [0, -30], [-30, 80], [-50, -120]]) {
      expect(nearestLandDeg(lat, lon)).toBeGreaterThan(3);
    }
  });

  it('low-power stride keeps half the dots', () => {
    const half = decodeLand(LAND_BITSET_B64, LAND_SAMPLE_COUNT, 2).length;
    expect(Math.abs(half - land.length / 2)).toBeLessThanOrEqual(3);
  });

  it('decodes unit-sphere coastline rings and market country polygons from world-atlas TopoJSON', () => {
    const coast = decodeRings(COAST_RINGS_B64);
    expect(coast.length).toBeGreaterThan(50);
    for (const ring of coast) {
      expect(ring.length % 3).toBe(0);
      expect(ring.length).toBeGreaterThanOrEqual(15);
      expect(Math.hypot(ring[0], ring[1], ring[2])).toBeCloseTo(1, 3);
    }
    for (const iso of ['036', '392', '554', '826', '840']) {
      const mRings = decodeRings(MARKET_RINGS_B64[iso]);
      expect(mRings.length).toBeGreaterThan(0);
    }
  });

  it('builds a 3D spherical graticule with parallels, meridians, and equator', () => {
    const g = buildGraticule();
    expect(g.lines.length).toBe(16);
    expect(g.equator.length).toBe(73 * 3);
    // Equator points all have y = sin(lat=0) = 0.
    for (let i = 1; i < g.equator.length; i += 3) {
      expect(Math.abs(g.equator[i])).toBeLessThan(1e-6);
    }
  });
});

describe('earth projection & spherical math', () => {
  it('brings the focus to the viewer', () => {
    const v = viewRotate(fromLatLon(-22, 136), -22 * DEG, 136 * DEG);
    expect(v[0]).toBeCloseTo(0, 9);
    expect(v[1]).toBeCloseTo(0, 9);
    expect(v[2]).toBeCloseTo(1, 9);
  });

  it('lifts arcs off the surface and lands on both endpoints', () => {
    const a = fromLatLon(-33.87, 151.21);
    const b = fromLatLon(1.35, 103.82);
    const arc = arcPoints(a, b, 21);
    expect([arc[0], arc[1], arc[2]].map((n, i) => n - a[i]).every((d) => Math.abs(d) < 1e-6)).toBe(true);
    expect([arc[60], arc[61], arc[62]].map((n, i) => n - b[i]).every((d) => Math.abs(d) < 1e-6)).toBe(true);
    expect(Math.hypot(arc[30], arc[31], arc[32])).toBeGreaterThan(1.05);
  });

  it('computes accurate great-circle distances and coordinate labels', () => {
    expect(formatLatLon(-33.87, 151.21)).toBe('33.9°S · 151.2°E');
    expect(formatLatLon(51.51, -0.13)).toBe('51.5°N · 0.1°W');
    const sydSinKm = greatCircleKm(EARTH_BUSINESS, EARTH_AUDIENCES[0]);
    expect(sydSinKm).toBeGreaterThan(6200);
    expect(sydSinKm).toBeLessThan(6400);
  });
});

describe('earth story contract', () => {
  it('tells four chapters in order with the brief copy', () => {
    expect(EARTH_CHAPTERS.map((c) => c.id)).toEqual(['business', 'discovery', 'gaps', 'action']);
    expect(EARTH_COPY.cta).toBe('Open Instant Audit');
    expect(EARTH_COPY.notice).toBe('Illustrative experience. Actual visibility requires a live audit.');
    expect(DISCOVERY_CHANNELS).toEqual(['Google Search', 'AI Overviews', 'ChatGPT', 'Perplexity']);
  });

  it('keeps the business visible in every chapter and starts on Australia', () => {
    const business = fromLatLon(EARTH_BUSINESS.lat, EARTH_BUSINESS.lon);
    for (const c of EARTH_CHAPTERS) expect(facing(business, c.focus)).toBeGreaterThan(0.5);
    const australia = fromLatLon(-25, 134);
    expect(facing(australia, EARTH_CHAPTERS[0].focus)).toBeGreaterThan(0.95);
  });

  it('reveals layers progressively and lights a visible priority path at the end', () => {
    const [business, discovery, gaps, action] = EARTH_CHAPTERS.map((c) => c.layers);
    expect(business).toEqual({ audiences: 0, arcs: 0, priority: 0, scan: 0 });
    expect(discovery.audiences).toBe(1);
    expect(gaps.scan).toBe(1);
    expect(action.priority).toBe(1);
    const visiblePriority = EARTH_AUDIENCES.filter(
      (a) => a.priority && facing(fromLatLon(a.lat, a.lon), EARTH_CHAPTERS[3].focus) > 0.2,
    );
    expect(visiblePriority.length).toBeGreaterThan(0);
  });

  it('stays honest: no em dashes, no metrics, Not measured is never a poor result', () => {
    const copy = [
      ...Object.values(EARTH_COPY),
      ...EARTH_CHAPTERS.flatMap((c) => [c.label, c.body, c.scene]),
      ...EVIDENCE_EXAMPLES.map((e) => e.definition),
      ...Object.values(EXAMPLE_ACTION),
      ...EARTH_HUBS.flatMap((h) => [h.label, h.country, h.role]),
    ].join(' ');
    expect(copy).not.toMatch(/\u2014/);
    expect(copy).not.toMatch(/\d+\s*%|\$\s*\d|\bscore\b|\brank(ing)? (up|improv)/i);
    for (const h of EARTH_HUBS) expect(h.role).toMatch(/^Example /);
    const notMeasured = EVIDENCE_EXAMPLES.find((e) => e.state === 'Not measured');
    expect(notMeasured?.definition).toMatch(/not a poor result/);
    expect(EXAMPLE_ACTION.label).toMatch(/^Example/);
    expect(EXAMPLE_ACTION.caveat).toMatch(/Example only/);
  });

  it('moves chapter focus with Left/Right, Home and End (wrapping)', () => {
    expect(chapterForKey('ArrowRight', 'business')).toBe('discovery');
    expect(chapterForKey('ArrowLeft', 'business')).toBe('action');
    expect(chapterForKey('ArrowRight', 'action')).toBe('business');
    expect(chapterForKey('ArrowDown', 'business')).toBeNull();
    expect(chapterForKey('Home', 'gaps')).toBe('business');
    expect(chapterForKey('End', 'business')).toBe('action');
    expect(chapterForKey('Enter', 'business')).toBeNull();
  });
});

describe('EarthStorySection markup', () => {
  const render = (signUp: boolean) =>
    renderToStaticMarkup(
      createElement(EarthStorySection, {
        headingClassName: 'h2',
        onOpenAudit: () => {},
        onSignUp: signUp ? () => {} : undefined,
      }),
    );

  it('renders the narrative, tabs, observatory HUD, 3D/2D toggle, market pills, CTA and notice as HTML', () => {
    const html = render(false);
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toContain('id="earth-tab-business" aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain(EARTH_CHAPTERS[0].body);
    expect(html).toContain('>Open Instant Audit<');
    expect(html).toContain(EARTH_COPY.notice);
    expect(html).toContain(`aria-label="Illustrative globe. ${EARTH_CHAPTERS[0].scene}"`);
    expect(html).toContain('aria-label="Projection mode"');
    expect(html).toContain('>3D globe<');
    expect(html).toContain('>2D map<');
    expect(html).toMatch(/<canvas aria-hidden="true"/);
    expect(html).toContain('aria-label="Illustrative market locations"');
    for (const h of EARTH_HUBS) expect(html).toContain(`>${h.label}<`);
    expect(html).not.toContain('Create free account');
  });

  it('keeps the guest sign-up path when provided', () => {
    expect(render(true)).toContain('Create free account');
  });

  it('ships baked satellite daymap and fallback WebP assets under public/brand', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const daymapStat = fs.statSync(path.resolve(process.cwd(), 'public/brand/earth-daymap.webp'));
    const fallbackStat = fs.statSync(path.resolve(process.cwd(), 'public/brand/earth-fallback.webp'));
    expect(daymapStat.size).toBeGreaterThan(20_000);
    expect(daymapStat.size).toBeLessThan(120_000);
    expect(fallbackStat.size).toBeGreaterThan(10_000);
    expect(fallbackStat.size).toBeLessThan(80_000);
  });
});


