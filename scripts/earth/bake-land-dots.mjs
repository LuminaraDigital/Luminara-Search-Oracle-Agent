#!/usr/bin/env node
// Bakes the landing-page Earth assets from Natural Earth 110m land (public domain)
// and topojson/world-atlas 2.0.2 countries-110m.json (ISC license, Natural Earth 1:110m PD).
//   npm run earth:bake [-- path-or-url-to-ne_110m_land.geojson [path-or-url-to-countries-110m.json]]
// Outputs:
//   components/marketing/earth/landDots.generated.ts  land bitset + coastline & market country rings
//   public/brand/earth-fallback.webp                  static globe for no-canvas fallback
// Sampling and projection must match components/marketing/earth/earthScene.ts
// (tests/earthStory.test.ts asserts known land/ocean points and ring decoding).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { EARTH_BUSINESS, EARTH_CHAPTERS, EARTH_HUBS, EARTH_PALETTE } from '../../components/marketing/earth/earthStory.ts';

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson';
const TOPO_URL =
  'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
const SAMPLE_COUNT = 20000;
const FOCUS = EARTH_CHAPTERS[0].focus;
const MARKER = EARTH_BUSINESS;
const GOLD = EARTH_PALETTE.gold;
const GOLD_LIGHT = EARTH_PALETTE.goldLight;

const root = process.cwd();
const src = process.argv[2] ?? SOURCE_URL;
const topoSrc = process.argv[3] ?? TOPO_URL;

async function loadJson(input) {
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

/** Decode TopoJSON arcs and rings from world-atlas 2.0.2 countries-110m.json. */
function extractTopoRings(topo, stepDeg = 1.4) {
  const [sx, sy] = topo.transform.scale;
  const [tx, ty] = topo.transform.translate;
  const decodeArc = (idx) => {
    const rev = idx < 0;
    const raw = topo.arcs[rev ? ~idx : idx];
    let x = 0, y = 0;
    const pts = raw.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * sx + tx, y * sy + ty];
    });
    return rev ? pts.reverse() : pts;
  };
  const decodeRing = (indices, step) => {
    const raw = [];
    for (const i of indices) {
      const a = decodeArc(i);
      for (let k = raw.length ? 1 : 0; k < a.length; k += 1) raw.push(a[k]);
    }
    if (raw.length < 4) return [];
    const out = [raw[0]];
    for (let i = 1; i < raw.length - 1; i += 1) {
      const prev = out[out.length - 1];
      let dlon = raw[i][0] - prev[0];
      if (dlon > 180) dlon -= 360;
      else if (dlon < -180) dlon += 360;
      const dlat = raw[i][1] - prev[1];
      if (Math.hypot(dlon, dlat) >= step) out.push(raw[i]);
    }
    out.push(raw[0]);
    return out;
  };

  const landGeom = topo.objects.land.geometries ? topo.objects.land.geometries[0] : topo.objects.land;
  const coastRings = landGeom.arcs.map((p) => decodeRing(p[0], stepDeg)).filter((r) => r.length >= 5);

  const marketIsos = Array.from(new Set(EARTH_HUBS.map((h) => h.iso)));
  const marketRings = {};
  for (const iso of marketIsos) {
    const geom = topo.objects.countries.geometries.find((c) => String(c.id) === iso);
    if (!geom) continue;
    const polys = geom.type === 'Polygon' ? [geom.arcs] : geom.arcs;
    const rings = polys.map((p) => decodeRing(p[0], 1.1)).filter((r) => r.length >= 5);
    if (rings.length > 0) marketRings[iso] = rings;
  }
  return { coastRings, marketRings };
}

/** Pack rings into Uint16LE [len, uLon0, uLat0, ...] base64 string. */
function packRings(rings) {
  const totalPts = rings.reduce((s, r) => s + r.length, 0);
  const buf = Buffer.alloc(rings.length * 2 + totalPts * 4);
  let off = 0;
  for (const r of rings) {
    buf.writeUInt16LE(r.length, off);
    off += 2;
    for (const [lon, lat] of r) {
      const nlon = ((lon + 540) % 360) - 180;
      const clat = Math.max(-90, Math.min(90, lat));
      buf.writeUInt16LE(Math.round(((nlon + 180) / 360) * 65535), off);
      buf.writeUInt16LE(Math.round(((clat + 90) / 180) * 65535), off + 2);
      off += 4;
    }
  }
  return buf.toString('base64');
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

async function buildDaymapWebp(daymapOut) {
  const scratchSolar = path.resolve(
    root,
    '../../.gemini/antigravity/brain/654561e0-2560-4a22-ada7-75ac6aed86cd/scratch/world-map-reality/public/solar/2k_earth_daymap.jpg',
  );
  const scratchTilesDir = path.resolve(
    root,
    '../../.gemini/antigravity/brain/654561e0-2560-4a22-ada7-75ac6aed86cd/scratch/world-map-reality/public/maps/sea-level-overview/imagery/2',
  );
  const W = 1024;
  const H = 512;

  if (fs.existsSync(scratchSolar)) {
    const baseRaw = await sharp(scratchSolar).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const out = Buffer.from(baseRaw);

    // Blend NASA Blue Marble ocean bathymetry from zoom-2 Web Mercator tiles if available.
    if (fs.existsSync(scratchTilesDir)) {
      const mercSize = 1024;
      const mercBuf = Buffer.alloc(mercSize * mercSize * 3);
      for (let ty = 0; ty < 4; ty += 1) {
        for (let tx = 0; tx < 4; tx += 1) {
          const tilePath = path.join(scratchTilesDir, String(tx), `${ty}.jpg`);
          if (!fs.existsSync(tilePath)) continue;
          const tileRaw = await sharp(tilePath).resize(256, 256).removeAlpha().raw().toBuffer();
          for (let py = 0; py < 256; py += 1) {
            const srcOff = py * 256 * 3;
            const dstOff = ((ty * 256 + py) * mercSize + tx * 256) * 3;
            tileRaw.copy(mercBuf, dstOff, srcOff, srcOff + 256 * 3);
          }
        }
      }

      for (let y = 0; y < H; y += 1) {
        const lat = 90 - ((y + 0.5) / H) * 180;
        const absLat = Math.abs(lat);
        if (absLat > 82) continue;
        const latRad = (lat * Math.PI) / 180;
        const mercY = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) * 0.5;
        const my = Math.max(0, Math.min(mercSize - 1, Math.floor(mercY * mercSize)));
        const polarWeight = absLat > 70 ? (82 - absLat) / 12 : 1;

        for (let x = 0; x < W; x += 1) {
          const idx = (y * W + x) * 3;
          const r = out[idx];
          const g = out[idx + 1];
          const b = out[idx + 2];
          const mx = Math.min(mercSize - 1, Math.floor(((x + 0.5) / W) * mercSize));
          const mIdx = (my * mercSize + mx) * 3;
          const mr = mercBuf[mIdx];
          const mg = mercBuf[mIdx + 1];
          const mb = mercBuf[mIdx + 2];

          // Ocean pixels in 2k_earth_daymap have strong blue dominance; blend rich bathymetry + vibrant land.
          const isOcean = b > r * 1.35 && b > g * 1.15 && b > 70;
          const wBlend = (isOcean ? 0.68 : 0.28) * polarWeight;
          out[idx] = Math.round(r * (1 - wBlend) + mr * wBlend);
          out[idx + 1] = Math.round(g * (1 - wBlend) + mg * wBlend);
          out[idx + 2] = Math.round(b * (1 - wBlend) + mb * wBlend);
        }
      }
    }

    await sharp(out, { raw: { width: W, height: H, channels: 3 } })
      .webp({ quality: 82, effort: 6 })
      .toFile(daymapOut);
    return { data: out, width: W, height: H };
  }

  if (fs.existsSync(daymapOut)) {
    const { data, info } = await sharp(daymapOut).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }

  throw new Error(`Missing source daymap texture at ${daymapOut}`);
}

async function renderFallbackGlobeBuffer(daymap, coastRings, ausRings) {
  const S = 720;
  const R = S * 0.4;
  const c = S / 2;
  const rgba = Buffer.alloc(S * S * 4, 0);
  const { data: tex, width: texW, height: texH } = daymap;

  const a = (FOCUS.lon * Math.PI) / 180;
  const b = (FOCUS.lat * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cb = Math.cos(b), sb = Math.sin(b);

  for (let py = 0; py < S; py += 1) {
    const ny = (c - (py + 0.5)) / R;
    for (let px = 0; px < S; px += 1) {
      const nx = (px + 0.5 - c) / R;
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) continue;
      const nz = Math.sqrt(1 - r2);

      // Inverse view rotation to world unit vector (wx, wy, wz).
      const wy = ny * cb + nz * sb;
      const z1 = -ny * sb + nz * cb;
      const wx = nx * ca + z1 * sa;
      const wz = -nx * sa + z1 * ca;

      const lat = Math.asin(Math.max(-1, Math.min(1, wy)));
      const lon = Math.atan2(wx, wz);
      const u = Math.min(texW - 1, Math.max(0, Math.floor((lon / (Math.PI * 2) + 0.5) * texW)));
      const v = Math.min(texH - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * texH)));
      const tIdx = (v * texW + u) * 3;

      const tr = tex[tIdx];
      const tg = tex[tIdx + 1];
      const tb = tex[tIdx + 2];

      const sun = Math.max(0, -0.34 * nx + 0.38 * ny + 0.86 * nz);
      const limb = Math.pow(nz, 0.32);
      const shade = limb * (0.42 + 0.68 * sun);
      const isOcean = tb > tr * 1.2 && tb > tg * 1.08;
      const spec = isOcean ? Math.pow(Math.max(0, -0.18 * nx + 0.2 * ny + 0.96 * nz), 28) * 36 : 0;
      const atmo = Math.pow(1 - nz, 2.6) * 42;

      const edgeAlpha = Math.min(1, (1 - Math.sqrt(r2)) * (R * 0.5));
      const dst = (py * S + px) * 4;
      rgba[dst] = Math.min(255, Math.round(tr * shade + spec + atmo * 0.95));
      rgba[dst + 1] = Math.min(255, Math.round(tg * shade + spec * 0.95 + atmo * 0.78));
      rgba[dst + 2] = Math.min(255, Math.round(tb * shade + spec * 0.8 + atmo * 0.45));
      rgba[dst + 3] = Math.round(edgeAlpha * 255);
    }
  }

  const projectRingPath = (rings) => {
    const cmds = [];
    for (const ring of rings) {
      let pen = false;
      for (const [lon, lat] of ring) {
        const [x, y, z] = view(fromLatLon(lat, lon), FOCUS.lat, FOCUS.lon);
        if (z <= 0.01) {
          pen = false;
          continue;
        }
        cmds.push(`${pen ? 'L' : 'M'}${(c + x * R).toFixed(1)} ${(c - y * R).toFixed(1)}`);
        pen = true;
      }
    }
    return cmds.join(' ');
  };

  const coastPath = projectRingPath(coastRings);
  const ausPath = projectRingPath(ausRings ?? []);
  const [mx, my] = view(fromLatLon(MARKER.lat, MARKER.lon), FOCUS.lat, FOCUS.lon);
  const px = (c + mx * R).toFixed(1);
  const py = (c - my * R).toFixed(1);

  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="rgba(${GOLD},0.48)" stroke-width="1.3"/>
<path d="${coastPath}" fill="none" stroke="rgba(${GOLD},0.32)" stroke-width="0.85"/>
<path d="${ausPath}" fill="rgba(${GOLD},0.16)" stroke="rgba(${GOLD_LIGHT},0.72)" stroke-width="1.3"/>
<circle cx="${px}" cy="${py}" r="12" fill="none" stroke="rgba(${GOLD_LIGHT},0.8)" stroke-width="1.4"/>
<circle cx="${px}" cy="${py}" r="4.5" fill="rgb(${GOLD_LIGHT})"/>
</svg>`;

  return sharp(rgba, { raw: { width: S, height: S, channels: 4 } })
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .webp({ quality: 78, alphaQuality: 70, effort: 6 })
    .toBuffer();
}

const geo = await loadJson(src);
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

const topo = await loadJson(topoSrc);
const { coastRings, marketRings } = extractTopoRings(topo, 1.4);
const coastB64 = packRings(coastRings);
const marketEntries = Object.entries(marketRings)
  .map(([iso, rings]) => `  '${iso}': '${packRings(rings)}',`)
  .join('\n');

const tsOut = path.join(root, 'components/marketing/earth/landDots.generated.ts');
fs.writeFileSync(
  tsOut,
  `// GENERATED by scripts/earth/bake-land-dots.mjs from Natural Earth ne_110m_land (public domain)
// and topojson/world-atlas 2.0.2 countries-110m.json (ISC license, Natural Earth 1:110m PD).
// Do not edit. Bit i set = Fibonacci sample i (of LAND_SAMPLE_COUNT) is land.
export const LAND_SAMPLE_COUNT = ${SAMPLE_COUNT};
export const LAND_BITSET_B64 =
  '${Buffer.from(bits).toString('base64')}';

/** Quantized Uint16LE coastline rings [len, uLon, uLat, ...] from world-atlas 110m land. */
export const COAST_RINGS_B64 =
  '${coastB64}';

/** Quantized Uint16LE country rings keyed by ISO numeric code for market highlights. */
export const MARKET_RINGS_B64: Readonly<Record<string, string>> = {
${marketEntries}
};
`,
  'utf8',
);

const daymapOut = path.join(root, 'public/brand/earth-daymap.webp');
const daymap = await buildDaymapWebp(daymapOut);

const webpOut = path.join(root, 'public/brand/earth-fallback.webp');
const fallbackBuf = await renderFallbackGlobeBuffer(daymap, coastRings, marketRings['036']);
fs.writeFileSync(webpOut, fallbackBuf);

const share = ((landPoints.length / SAMPLE_COUNT) * 100).toFixed(1);
console.log(`land dots: ${landPoints.length}/${SAMPLE_COUNT} (${share}%), coast rings: ${coastRings.length}, market ISOs: ${Object.keys(marketRings).join(',')}`);
console.log(`wrote ${path.relative(root, tsOut)}, ${path.relative(root, daymapOut)} (${fs.statSync(daymapOut).size} bytes), and ${path.relative(root, webpOut)} (${fs.statSync(webpOut).size} bytes)`);
