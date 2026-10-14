#!/usr/bin/env node
// Bakes the landing-page Earth assets from Natural Earth 110m land (public domain).
//   npm run earth:bake [-- path-or-url-to-ne_110m_land.geojson]
// Outputs:
//   components/marketing/earth/landDots.generated.ts  land bitset over a Fibonacci sphere
//   public/brand/earth-fallback.webp                    static globe for no-canvas fallback
// Sampling and projection must match components/marketing/earth/earthScene.ts
// (tests/earthStory.test.ts asserts known land/ocean points).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { EARTH_BUSINESS, EARTH_CHAPTERS, EARTH_PALETTE } from '../../components/marketing/earth/earthStory.ts';

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson';
const SAMPLE_COUNT = 20000;
const FOCUS = EARTH_CHAPTERS[0].focus;
const MARKER = EARTH_BUSINESS;
const GOLD = EARTH_PALETTE.gold;
const GOLD_LIGHT = EARTH_PALETTE.goldLight;

const root = process.cwd();
const src = process.argv[2] ?? SOURCE_URL;

async function loadGeoJson(input) {
  if (/^https?:\/\//.test(input)) {
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Fetch ${input} failed: ${res.status}`);
    return res.json();
  }
  return JSON.parse(fs.readFileSync(input, 'utf8'));
}

/** Same formula as fibPoint() in earthScene.ts. */
function fibPoint(i, n) {
  const y = 1 - ((i + 0.5) / n) * 2;
  const r = Math.sqrt(1 - y * y);
  const theta = Math.PI * (3 - Math.sqrt(5)) * i;
  return [Math.cos(theta) * r, y, Math.sin(theta) * r];
}

function toLatLon([x, y, z]) {
  return [(Math.asin(y) * 180) / Math.PI, (Math.atan2(x, z) * 180) / Math.PI];
}

function ringContains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function buildPolygons(geo) {
  const polys = [];
  for (const f of geo.features) {
    const g = f.geometry;
    const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings of list) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of rings[0]) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      polys.push({ rings, minX, minY, maxX, maxY });
    }
  }
  return polys;
}

function isLand(polys, lat, lon) {
  for (const p of polys) {
    if (lon < p.minX || lon > p.maxX || lat < p.minY || lat > p.maxY) continue;
    if (!ringContains(p.rings[0], lon, lat)) continue;
    if (p.rings.slice(1).some((hole) => ringContains(hole, lon, lat))) continue;
    return true;
  }
  return false;
}

/** Same rotation as viewRotate() in earthScene.ts: bring (lat0, lon0) to the viewer (+z). */
function view([x, y, z], lat0, lon0) {
  const a = (lon0 * Math.PI) / 180;
  const b = (lat0 * Math.PI) / 180;
  const x1 = x * Math.cos(a) - z * Math.sin(a);
  const z1 = x * Math.sin(a) + z * Math.cos(a);
  return [x1, y * Math.cos(b) - z1 * Math.sin(b), y * Math.sin(b) + z1 * Math.cos(b)];
}

function fromLatLon(lat, lon) {
  const p = (lat * Math.PI) / 180;
  const l = (lon * Math.PI) / 180;
  return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
}

function fallbackSvg(landPoints) {
  const S = 720;
  const R = S * 0.4;
  const c = S / 2;
  const dots = [];
  for (const pt of landPoints) {
    const [x, y, z] = view(pt, FOCUS.lat, FOCUS.lon);
    if (z <= 0) continue;
    const a = (0.25 + 0.75 * z).toFixed(2);
    const s = (1.1 + 0.9 * z).toFixed(2);
    dots.push(`<circle cx="${(c + x * R).toFixed(1)}" cy="${(c - y * R).toFixed(1)}" r="${s}" fill="rgba(${GOLD},${a})"/>`);
  }
  const [mx, my] = view(fromLatLon(MARKER.lat, MARKER.lon), FOCUS.lat, FOCUS.lon);
  const px = (c + mx * R).toFixed(1);
  const py = (c - my * R).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs>
<radialGradient id="body" cx="38%" cy="32%" r="75%"><stop offset="0%" stop-color="rgb(24,20,12)"/><stop offset="60%" stop-color="rgb(8,7,5)"/><stop offset="100%" stop-color="rgb(0,0,0)"/></radialGradient>
</defs>
<circle cx="${c}" cy="${c}" r="${R}" fill="url(#body)" stroke="rgba(${GOLD},0.35)" stroke-width="1"/>
${dots.join('')}
<circle cx="${px}" cy="${py}" r="11" fill="none" stroke="rgba(${GOLD_LIGHT},0.6)" stroke-width="1.2"/>
<circle cx="${px}" cy="${py}" r="4.5" fill="rgb(${GOLD_LIGHT})"/>
</svg>`;
}

const geo = await loadGeoJson(src);
const polys = buildPolygons(geo);
const bits = new Uint8Array(Math.ceil(SAMPLE_COUNT / 8));
const landPoints = [];
for (let i = 0; i < SAMPLE_COUNT; i += 1) {
  const pt = fibPoint(i, SAMPLE_COUNT);
  const [lat, lon] = toLatLon(pt);
  if (isLand(polys, lat, lon)) {
    bits[i >> 3] |= 1 << (i & 7);
    landPoints.push(pt);
  }
}

const tsOut = path.join(root, 'components/marketing/earth/landDots.generated.ts');
fs.writeFileSync(
  tsOut,
  `// GENERATED by scripts/earth/bake-land-dots.mjs from Natural Earth ne_110m_land (public domain).
// Do not edit. Bit i set = Fibonacci sample i (of LAND_SAMPLE_COUNT) is land.
export const LAND_SAMPLE_COUNT = ${SAMPLE_COUNT};
export const LAND_BITSET_B64 =
  '${Buffer.from(bits).toString('base64')}';
`,
  'utf8',
);

const webpOut = path.join(root, 'public/brand/earth-fallback.webp');
await sharp(Buffer.from(fallbackSvg(landPoints))).webp({ quality: 70, alphaQuality: 60, effort: 6 }).toFile(webpOut);

const share = ((landPoints.length / SAMPLE_COUNT) * 100).toFixed(1);
console.log(`land dots: ${landPoints.length}/${SAMPLE_COUNT} (${share}%)`);
console.log(`wrote ${path.relative(root, tsOut)} and ${path.relative(root, webpOut)} (${fs.statSync(webpOut).size} bytes)`);
