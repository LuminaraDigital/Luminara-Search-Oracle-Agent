/* Canvas 2D orthographic 3D globe + equirectangular 2D world map renderer.
 * Renders a photorealistic satellite + bathymetric Earth (public/brand/earth-daymap.webp)
 * with Natural Earth / topojson/world-atlas 110m coastlines, highlighted market country
 * polygons, directional solar shading, lifted great-circle geodesic arcs, HUD labels,
 * and click-to-focus hub hit-testing in both 3D globe and 2D map views.
 * Framework-free; loaded lazily by EarthStorySection.tsx.
 */
import {
  EARTH_AUDIENCES,
  EARTH_BUSINESS,
  EARTH_CHAPTERS,
  EARTH_HUBS,
  EARTH_PALETTE,
  chapterIndex,
  type ChapterId,
  type EarthHubId,
  type EarthViewMode,
} from './earthStory';
import {
  COAST_RINGS_B64,
  LAND_BITSET_B64,
  LAND_SAMPLE_COUNT,
  MARKET_RINGS_B64,
} from './landDots.generated';

export type Vec3 = readonly [number, number, number];

const DEG = Math.PI / 180;
const INV_PI = 1 / Math.PI;
const INV_TWO_PI = 1 / (Math.PI * 2);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const BUCKETS = 6;
const ARC_SAMPLES = 44;
const MAX_LAT = 65 * DEG;
const HIT_RADIUS = 22;
const GOLD = EARTH_PALETTE.gold;
const LIGHT = EARTH_PALETTE.goldLight;
const LAYER_KEYS = ['audiences', 'arcs', 'priority', 'scan'] as const;
const LAT_BANDS: ReadonlyArray<{ deg: number; label: string; isEq?: boolean }> = [
  { deg: 60, label: '60°N' },
  { deg: 30, label: '30°N' },
  { deg: 0, label: 'EQUATOR', isEq: true },
  { deg: -30, label: '30°S' },
  { deg: -60, label: '60°S' },
];

interface DaymapTexture {
  img: HTMLImageElement;
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

let cachedDaymap: DaymapTexture | null = null;
let daymapWaiters: Array<() => void> | null = null;

function requestDaymap(onReady: () => void): void {
  if (cachedDaymap) {
    onReady();
    return;
  }
  if (
    typeof Image === 'undefined' ||
    typeof document === 'undefined' ||
    typeof document.createElement !== 'function'
  ) {
    return;
  }
  if (daymapWaiters) {
    daymapWaiters.push(onReady);
    return;
  }
  daymapWaiters = [onReady];
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    try {
      const width = img.naturalWidth || 1024;
      const height = img.naturalHeight || 512;
      const off = document.createElement('canvas');
      off.width = width;
      off.height = height;
      const octx = off.getContext('2d');
      if (octx) {
        octx.drawImage(img, 0, 0, width, height);
        const data = octx.getImageData(0, 0, width, height).data;
        cachedDaymap = { img, data, width, height };
      }
    } catch {
      // Ignore pixel extraction failure in restricted/stubbed environments.
    }
    const list = daymapWaiters ?? [];
    daymapWaiters = null;
    for (const fn of list) fn();
  };
  img.onerror = () => {
    daymapWaiters = null;
  };
  img.src = '/brand/earth-daymap.webp';
}

/** Point i of n on a unit Fibonacci sphere. Must match scripts/earth/bake-land-dots.mjs. */
export function fibPoint(i: number, n: number): Vec3 {
  const y = 1 - ((i + 0.5) / n) * 2;
  const r = Math.sqrt(1 - y * y);
  const theta = GOLDEN_ANGLE * i;
  return [Math.cos(theta) * r, y, Math.sin(theta) * r];
}

export function fromLatLon(latDeg: number, lonDeg: number): Vec3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const c = Math.cos(lat);
  return [c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon)];
}

/** Rotate so the point at (lat0, lon0) radians faces the viewer. */
export function viewRotate([x, y, z]: Vec3, lat0: number, lon0: number): Vec3 {
  const ca = Math.cos(lon0);
  const sa = Math.sin(lon0);
  const cb = Math.cos(lat0);
  const sb = Math.sin(lat0);
  const x1 = x * ca - z * sa;
  const z1 = x * sa + z * ca;
  return [x1, y * cb - z1 * sb, y * sb + z1 * cb];
}

/** Land samples as packed xyz. stride 2 keeps every other land dot (low-power devices). */
export function decodeLand(b64: string, n: number, stride = 1): Float32Array {
  const bin = atob(b64);
  const out: number[] = [];
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    if (!((bin.charCodeAt(i >> 3) >> (i & 7)) & 1)) continue;
    if (k++ % stride) continue;
    out.push(...fibPoint(i, n));
  }
  return Float32Array.from(out);
}

/** Decode quantized Uint16LE rings [len, uLon, uLat, ...] into packed xyz Float32Arrays. */
export function decodeRings(b64: string): Float32Array[] {
  const bin = atob(b64);
  const readU16 = (off: number) => bin.charCodeAt(off) | (bin.charCodeAt(off + 1) << 8);
  const rings: Float32Array[] = [];
  let off = 0;
  while (off + 2 <= bin.length) {
    const len = readU16(off);
    off += 2;
    const pts = new Float32Array(len * 3);
    for (let i = 0; i < len; i += 1) {
      const lon = (readU16(off) / 65535) * 360 - 180;
      const lat = (readU16(off + 2) / 65535) * 180 - 90;
      off += 4;
      const [x, y, z] = fromLatLon(lat, lon);
      pts[i * 3] = x;
      pts[i * 3 + 1] = y;
      pts[i * 3 + 2] = z;
    }
    rings.push(pts);
  }
  return rings;
}

/** Build 3D spherical graticule lines (30 deg parallels/meridians + 0 deg equator). */
export function buildGraticule(): { lines: Float32Array[]; equator: Float32Array } {
  const lines: Float32Array[] = [];
  const sampleLine = (count: number, fn: (t: number) => Vec3): Float32Array => {
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const [x, y, z] = fn(i / (count - 1));
      out[i * 3] = x;
      out[i * 3 + 1] = y;
      out[i * 3 + 2] = z;
    }
    return out;
  };
  for (const lat of [-60, -30, 30, 60]) {
    lines.push(sampleLine(61, (t) => fromLatLon(lat, -180 + t * 360)));
  }
  for (let lon = -150; lon <= 180; lon += 30) {
    lines.push(sampleLine(41, (t) => fromLatLon(-80 + t * 160, lon)));
  }
  const equator = sampleLine(73, (t) => fromLatLon(0, -180 + t * 360));
  return { lines, equator };
}

/** Great-circle arc lifted off the surface, packed xyz. Endpoints must not be equal or antipodal. */
export function arcPoints(a: Vec3, b: Vec3, samples = ARC_SAMPLES): Float32Array {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  const s = Math.sin(omega) || 1;
  const out = new Float32Array(samples * 3);
  for (let i = 0; i < samples; i += 1) {
    const t = i / (samples - 1);
    const wa = Math.sin((1 - t) * omega) / s;
    const wb = Math.sin(t * omega) / s;
    const lift = 1 + (0.06 + (0.22 * omega) / Math.PI) * Math.sin(Math.PI * t);
    for (let c = 0; c < 3; c += 1) out[i * 3 + c] = (a[c] * wa + b[c] * wb) * lift;
  }
  return out;
}

export interface EarthSceneOptions {
  chapter: ChapterId;
  selectedHub?: EarthHubId | null;
  viewMode?: EarthViewMode;
  paused: boolean;
  reducedMotion: boolean;
  lowPower: boolean;
  onSelectHub?: (id: EarthHubId | null) => void;
}

export interface EarthScene {
  setChapter(id: ChapterId): void;
  setHub(id: EarthHubId | null): void;
  setViewMode(mode: EarthViewMode): void;
  resetView(): void;
  setPaused(paused: boolean): void;
  destroy(): void;
}

/** Throws when Canvas 2D is unavailable; the caller shows the static fallback. */
export function createEarthScene(canvas: HTMLCanvasElement, opts: EarthSceneOptions): EarthScene {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  const land = decodeLand(LAND_BITSET_B64, LAND_SAMPLE_COUNT, opts.lowPower ? 2 : 1);
  const coastRings = decodeRings(COAST_RINGS_B64);
  const marketRings: Record<string, Float32Array[]> = {};
  for (const [iso, b64] of Object.entries(MARKET_RINGS_B64)) {
    marketRings[iso] = decodeRings(b64);
  }
  const graticule = buildGraticule();
  const business = fromLatLon(EARTH_BUSINESS.lat, EARTH_BUSINESS.lon);
  const audiences = EARTH_AUDIENCES.map((a, i) => {
    const p = fromLatLon(a.lat, a.lon);
    return { ...a, p, arc: arcPoints(business, p), phase: i * 0.37 };
  });
  const hubs = EARTH_HUBS.map((h) => ({ ...h, p: fromLatLon(h.lat, h.lon) }));
  const hitTargets: Array<{ id: EarthHubId; x: number; y: number }> = [];
  const labelWidths = new Map<string, number>();
  const dots = Array.from({ length: BUCKETS + 1 }, () => new Float32Array(land.length));
  const counts = new Int32Array(BUCKETS + 1);

  let chapter = EARTH_CHAPTERS[chapterIndex(opts.chapter)];
  let selectedHub: EarthHubId | null = opts.selectedHub ?? null;
  let viewMode: EarthViewMode = opts.viewMode ?? '3d';
  let paused = opts.paused;
  const reduced = opts.reducedMotion;

  // Offscreen 3D globe raster buffer + precomputed unit-sphere lighting LUT.
  let globeCanvas: HTMLCanvasElement | null = null;
  let globeCtx: CanvasRenderingContext2D | null = null;
  let globeImgData: ImageData | null = null;
  let globeDim = 0;
  let lutCount = 0;
  let lutOff = new Int32Array(0);
  let lutNx = new Float32Array(0);
  let lutNy = new Float32Array(0);
  let lutNz = new Float32Array(0);
  let lutShade = new Float32Array(0);
  let lutSpec = new Float32Array(0);
  let lutAtmo = new Float32Array(0);
  let lutAlpha = new Uint8Array(0);
  let renderedLat = NaN;
  let renderedLon = NaN;

  const ensureGlobeLut = (dim: number) => {
    if (globeDim === dim && globeCanvas && globeCtx && globeImgData) return;
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    if (!globeCanvas) {
      globeCanvas = document.createElement('canvas');
      globeCtx = globeCanvas.getContext('2d');
    }
    if (!globeCtx || typeof globeCtx.createImageData !== 'function') return;
    globeDim = dim;
    globeCanvas.width = dim;
    globeCanvas.height = dim;
    globeImgData = globeCtx.createImageData(dim, dim);
    const maxPts = dim * dim;
    lutOff = new Int32Array(maxPts);
    lutNx = new Float32Array(maxPts);
    lutNy = new Float32Array(maxPts);
    lutNz = new Float32Array(maxPts);
    lutShade = new Float32Array(maxPts);
    lutSpec = new Float32Array(maxPts);
    lutAtmo = new Float32Array(maxPts);
    lutAlpha = new Uint8Array(maxPts);
    const rad = dim * 0.5;
    let k = 0;
    for (let py = 0; py < dim; py += 1) {
      const ny = (rad - (py + 0.5)) / rad;
      for (let px = 0; px < dim; px += 1) {
        const nx = (px + 0.5 - rad) / rad;
        const r2 = nx * nx + ny * ny;
        if (r2 > 1) continue;
        const nz = Math.sqrt(1 - r2);
        const sun = Math.max(0, -0.34 * nx + 0.38 * ny + 0.86 * nz);
        const limb = Math.pow(nz, 0.32);
        lutOff[k] = (py * dim + px) * 4;
        lutNx[k] = nx;
        lutNy[k] = ny;
        lutNz[k] = nz;
        lutShade[k] = limb * (0.44 + 0.66 * sun);
        lutSpec[k] = Math.pow(Math.max(0, -0.18 * nx + 0.2 * ny + 0.96 * nz), 28) * 34;
        lutAtmo[k] = Math.pow(1 - nz, 2.5) * 38;
        lutAlpha[k] = Math.round(Math.min(1, (1 - Math.sqrt(r2)) * (rad * 0.5)) * 255);
        k += 1;
      }
    }
    lutCount = k;
    renderedLat = NaN;
    renderedLon = NaN;
  };

  const targetFocus = () => {
    if (selectedHub) {
      const h = EARTH_HUBS.find((item) => item.id === selectedHub);
      if (h) return { lat: h.lat, lon: h.lon };
    }
    return chapter.focus;
  };

  const initFocus = targetFocus();
  const cur = { lat: initFocus.lat * DEG, lon: initFocus.lon * DEG, ...chapter.layers };
  const drag = { lat: 0, lon: 0 };
  let grab: { x: number; y: number; downX: number; downY: number; moved: boolean } | null = null;
  let w = 0, h = 0, R = 0, cx = 0, cy = 0, dpr = 1, fontSpec = '';
  let mapX = 0, mapY = 0, mapW = 0, mapH = 0;
  let raf = 0, last = 0, clock = 0;
  let onScreen = true, alive = true, lost = false;

  const isVisible = () => onScreen && !document.hidden;

  // Rotation state for the current frame; project() writes px/py/pz, project2D() writes x2d/y2d/dLon2d.
  let ca = 1, sa = 0, cb = 1, sb = 0, px = 0, py = 0, pz = 0;
  let x2d = 0, y2d = 0, dLon2d = 0;

  const project = (x: number, y: number, z: number) => {
    const x1 = x * ca - z * sa;
    const z1 = x * sa + z * ca;
    px = x1;
    py = y * cb - z1 * sb;
    pz = y * sb + z1 * cb;
  };

  const project2D = (x: number, y: number, z: number) => {
    const r = Math.hypot(x, y, z) || 1;
    const x1 = x * ca - z * sa;
    const z1 = x * sa + z * ca;
    dLon2d = Math.atan2(x1, z1);
    const lat = Math.asin(Math.max(-1, Math.min(1, y / r)));
    x2d = mapX + (dLon2d * INV_TWO_PI + 0.5) * mapW;
    y2d = mapY + (0.5 - lat * INV_PI) * mapH;
  };

  const moving = () => !paused && !reduced;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, opts.lowPower ? 1.5 : 2);
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    cx = w / 2;
    cy = h / 2;
    R = Math.min(w, h) * 0.4;
    mapW = Math.max(40, w * 0.96);
    mapH = Math.max(24, Math.min(h * 0.8, mapW * 0.54));
    mapX = (w - mapW) / 2;
    mapY = (h - mapH) / 2;
    const nextFont = `500 ${Math.max(10, Math.min(11.5, R * 0.044)).toFixed(1)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    if (nextFont !== fontSpec) {
      fontSpec = nextFont;
      labelWidths.clear();
    }
  };

  /** Ease toward chapter/hub targets; returns true while still settling. */
  const step = (dt: number): boolean => {
    const focus = targetFocus();
    const sway = selectedHub ? 0 : Math.sin((clock * 2 * Math.PI) / 48) * 8 * DEG;
    const tLon = focus.lon * DEG + sway + drag.lon;
    const tLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, focus.lat * DEG + drag.lat));
    const kView = reduced || grab ? 1 : 1 - Math.exp(-dt / 0.42);
    const kLayer = reduced ? 1 : 1 - Math.exp(-dt / 0.28);
    let delta = Math.abs(tLon - cur.lon) + Math.abs(tLat - cur.lat);
    for (const key of LAYER_KEYS) delta += Math.abs(chapter.layers[key] - cur[key]);
    if (delta < 4e-3) {
      cur.lon = tLon;
      cur.lat = tLat;
      Object.assign(cur, chapter.layers);
      return false;
    }
    cur.lon += (tLon - cur.lon) * kView;
    cur.lat += (tLat - cur.lat) * kView;
    for (const key of LAYER_KEYS) cur[key] += (chapter.layers[key] - cur[key]) * kLayer;
    return true;
  };

  const traceFrontPolyline = (pts: Float32Array) => {
    let pen = false;
    let prevX = 0, prevY = 0, prevZ = -1;
    for (let i = 0; i < pts.length; i += 3) {
      project(pts[i], pts[i + 1], pts[i + 2]);
      if (pz > 0.005) {
        if (!pen && i > 0 && prevZ <= 0.005) {
          const t = (0.005 - prevZ) / (pz - prevZ || 1);
          const hx = prevX + (px - prevX) * t;
          const hy = prevY + (py - prevY) * t;
          ctx.moveTo(cx + hx * R, cy - hy * R);
          ctx.lineTo(cx + px * R, cy - py * R);
        } else if (pen) {
          ctx.lineTo(cx + px * R, cy - py * R);
        } else {
          ctx.moveTo(cx + px * R, cy - py * R);
        }
        pen = true;
      } else {
        if (pen && prevZ > 0.005) {
          const t = (prevZ - 0.005) / (prevZ - pz || 1);
          const hx = prevX + (px - prevX) * t;
          const hy = prevY + (py - prevY) * t;
          ctx.lineTo(cx + hx * R, cy - hy * R);
        }
        pen = false;
      }
      prevX = px; prevY = py; prevZ = pz;
    }
  };

  const trace2DPolyline = (pts: Float32Array) => {
    let pen = false;
    let prevX = 0;
    const maxJump = mapW * 0.42;
    for (let i = 0; i < pts.length; i += 3) {
      project2D(pts[i], pts[i + 1], pts[i + 2]);
      if (!pen || Math.abs(x2d - prevX) > maxJump) {
        ctx.moveTo(x2d, y2d);
        pen = true;
      } else {
        ctx.lineTo(x2d, y2d);
      }
      prevX = x2d;
    }
  };

  const drawGlobeSurface = (): boolean => {
    if (!cachedDaymap) return false;
    const targetDim = Math.min(opts.lowPower ? 210 : 300, Math.max(140, Math.round(R * 1.05)));
    ensureGlobeLut(targetDim);
    if (!globeCanvas || !globeCtx || !globeImgData || lutCount === 0) return false;

    if (!(Math.abs(cur.lat - renderedLat) + Math.abs(cur.lon - renderedLon) <= 2e-4)) {
      const { data: tex, width: texW, height: texH } = cachedDaymap;
      const dst = globeImgData.data;
      const maxU = texW - 1;
      const maxV = texH - 1;
      for (let i = 0; i < lutCount; i += 1) {
        const nx = lutNx[i];
        const ny = lutNy[i];
        const nz = lutNz[i];
        const wy = ny * cb + nz * sb;
        const z1 = -ny * sb + nz * cb;
        const wx = nx * ca + z1 * sa;
        const wz = -nx * sa + z1 * ca;
        const clampedWy = wy < -1 ? -1 : wy > 1 ? 1 : wy;
        const u = Math.min(maxU, Math.max(0, ((Math.atan2(wx, wz) * INV_TWO_PI + 0.5) * texW) | 0));
        const v = Math.min(maxV, Math.max(0, ((0.5 - Math.asin(clampedWy) * INV_PI) * texH) | 0));
        const tIdx = (v * texW + u) * 4;
        const tr = tex[tIdx];
        const tg = tex[tIdx + 1];
        const tb = tex[tIdx + 2];
        const shade = lutShade[i];
        const atmo = lutAtmo[i];
        const spec = tb > tr * 1.2 && tb > tg * 1.08 ? lutSpec[i] : 0;
        const off = lutOff[i];
        dst[off] = Math.min(255, (tr * shade + spec + atmo * 0.95) | 0);
        dst[off + 1] = Math.min(255, (tg * shade + spec * 0.95 + atmo * 0.78) | 0);
        dst[off + 2] = Math.min(255, (tb * shade + spec * 0.8 + atmo * 0.45) | 0);
        dst[off + 3] = lutAlpha[i];
      }
      globeCtx.putImageData(globeImgData, 0, 0);
      renderedLat = cur.lat;
      renderedLon = cur.lon;
    }

    ctx.drawImage(globeCanvas, cx - R, cy - R, R * 2, R * 2);
    return true;
  };

  const traceClosedRings3D = (rings: Float32Array[]): boolean => {
    let any = false;
    for (const ring of rings) {
      let minPz = 1;
      for (let i = 0; i < ring.length; i += 3) {
        project(ring[i], ring[i + 1], ring[i + 2]);
        if (pz < minPz) minPz = pz;
      }
      if (minPz <= 0.005) continue;
      any = true;
      for (let i = 0; i < ring.length; i += 3) {
        project(ring[i], ring[i + 1], ring[i + 2]);
        if (i === 0) ctx.moveTo(cx + px * R, cy - py * R);
        else ctx.lineTo(cx + px * R, cy - py * R);
      }
      ctx.closePath();
    }
    return any;
  };

  const traceClosedRings2D = (rings: Float32Array[]): boolean => {
    let any = false;
    const maxJump = mapW * 0.42;
    for (const ring of rings) {
      let wraps = false;
      let prev = 0;
      for (let i = 0; i < ring.length; i += 3) {
        project2D(ring[i], ring[i + 1], ring[i + 2]);
        if (i > 0 && Math.abs(x2d - prev) > maxJump) { wraps = true; break; }
        prev = x2d;
      }
      if (wraps) continue;
      any = true;
      for (let i = 0; i < ring.length; i += 3) {
        project2D(ring[i], ring[i + 1], ring[i + 2]);
        if (i === 0) ctx.moveTo(x2d, y2d);
        else ctx.lineTo(x2d, y2d);
      }
      ctx.closePath();
    }
    return any;
  };

  const drawGraticule = () => {
    ctx.save();
    ctx.beginPath();
    for (const line of graticule.lines) traceFrontPolyline(line);
    ctx.strokeStyle = `rgba(${GOLD},0.09)`;
    ctx.lineWidth = 0.7;
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    traceFrontPolyline(graticule.equator);
    ctx.strokeStyle = `rgba(${GOLD},0.18)`;
    ctx.lineWidth = 0.85;
    ctx.stroke();
    ctx.restore();
  };

  const drawCoastAndMarkets = (hasTexture: boolean) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    ctx.clip();

    if (!hasTexture) {
      ctx.beginPath();
      if (traceClosedRings3D(coastRings)) {
        ctx.fillStyle = 'rgba(76, 86, 52, 0.38)';
        ctx.fill();
      }
    }

    for (const h of hubs) {
      const rings = marketRings[h.iso];
      if (!rings) continue;
      const isSelected = selectedHub === h.id;
      const weight = h.isBusiness ? 1 : isSelected ? 1 : cur.audiences;
      if (weight < 0.04) continue;
      const emph = isSelected || h.isBusiness || (h.priority && cur.priority > 0.4);
      ctx.beginPath();
      if (traceClosedRings3D(rings)) {
        ctx.fillStyle = `rgba(${emph ? LIGHT : GOLD},${(emph ? 0.22 : 0.12) * weight})`;
        ctx.fill();
      }
      ctx.beginPath();
      for (const ring of rings) traceFrontPolyline(ring);
      ctx.strokeStyle = `rgba(${emph ? LIGHT : GOLD},${(emph ? 0.78 : 0.48) * weight})`;
      ctx.lineWidth = emph ? 1.45 : 1.0;
      ctx.stroke();
    }

    ctx.beginPath();
    for (const ring of coastRings) traceFrontPolyline(ring);
    ctx.strokeStyle = `rgba(${GOLD},${hasTexture ? 0.34 : 0.28})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  };

  const drawLand = (scanAng: number, scanOnly: boolean) => {
    if (scanOnly && cur.scan <= 0.01) return;
    counts.fill(0);
    const size = Math.max(0.7, Math.min(1.28, R / 260));
    for (let i = 0; i < land.length; i += 3) {
      project(land[i], land[i + 1], land[i + 2]);
      if (pz <= 0) continue;
      const inScan = cur.scan > 0.01 && Math.abs(Math.atan2(px, pz) - scanAng) < 0.14;
      if (scanOnly && !inScan) continue;
      let bucket = BUCKETS;
      if (!inScan) {
        const sun = Math.max(0, -0.32 * px + 0.36 * py + 0.87 * pz);
        const shade = 0.18 + 0.52 * pz + 0.3 * sun;
        bucket = Math.min(BUCKETS - 1, Math.floor(shade * BUCKETS));
      }
      const buf = dots[bucket];
      const n = counts[bucket];
      buf[n] = cx + px * R;
      buf[n + 1] = cy - py * R;
      buf[n + 2] = (1.02 + 0.82 * pz) * size;
      counts[bucket] = n + 3;
    }
    for (let b = scanOnly ? BUCKETS : 0; b <= BUCKETS; b += 1) {
      const buf = dots[b];
      if (counts[b] === 0) continue;
      ctx.beginPath();
      for (let j = 0; j < counts[b]; j += 3) {
        ctx.moveTo(buf[j] + buf[j + 2], buf[j + 1]);
        ctx.arc(buf[j], buf[j + 1], buf[j + 2], 0, Math.PI * 2);
      }
      ctx.fillStyle = b === BUCKETS ? `rgba(${LIGHT},${0.38 + 0.62 * cur.scan})` : `rgba(${GOLD},${(b + 0.55) / BUCKETS})`;
      ctx.fill();
    }
  };

  const drawScanLine = (scanAng: number) => {
    const s = Math.sin(scanAng);
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(s) * R, R, 0, s >= 0 ? -Math.PI / 2 : Math.PI / 2, s >= 0 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.strokeStyle = `rgba(${LIGHT},${0.58 * cur.scan})`;
    ctx.lineWidth = 1.15;
    ctx.stroke();
  };

  const drawArcs = () => {
    for (const a of audiences) {
      const isSelected = selectedHub === a.id;
      const alpha = cur.arcs * 0.36 + (a.priority ? cur.priority * 0.68 : 0) + (isSelected ? 0.58 : 0);
      if (alpha < 0.01) continue;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < a.arc.length; i += 3) {
        project(a.arc[i], a.arc[i + 1], a.arc[i + 2]);
        const seen = pz > 0 || px * px + py * py > 1;
        if (!seen) { pen = false; continue; }
        if (pen) ctx.lineTo(cx + px * R, cy - py * R);
        else ctx.moveTo(cx + px * R, cy - py * R);
        pen = true;
      }
      const lit = isSelected || (a.priority && cur.priority > 0.5);
      ctx.strokeStyle = `rgba(${lit ? LIGHT : GOLD},${Math.min(1, alpha)})`;
      ctx.lineWidth = lit ? 1.85 : 1.25;
      ctx.stroke();
      if (!moving() || alpha < 0.28) continue;
      const k = Math.floor((((clock * 0.24 + a.phase) % 1) * a.arc.length) / 3) * 3;
      project(a.arc[k], a.arc[k + 1], a.arc[k + 2]);
      if (pz <= 0 && px * px + py * py <= 1) continue;
      ctx.beginPath();
      ctx.arc(cx + px * R, cy - py * R, lit ? 2.5 : 2.0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${LIGHT},${Math.min(1, alpha)})`;
      ctx.fill();
    }
  };

  const measureTag = (tag: string): number => {
    const cached = labelWidths.get(tag);
    if (cached !== undefined) return cached;
    const width = ctx.measureText(tag).width;
    labelWidths.set(tag, width);
    return width;
  };

  const drawHubBadge = (
    h: (typeof hubs)[number], x: number, y: number, a: number, pulse: number,
    showLabels: boolean, clampMinX: number, clampMaxX: number,
  ) => {
    const isSelected = selectedHub === h.id;
    const emph = h.isBusiness || isSelected || (h.priority && cur.priority > 0.5);
    const core = h.isBusiness ? 4.4 : emph ? 3.8 : 3.0;
    const ring = h.isBusiness ? 10 + pulse * 3 : isSelected ? 11 + pulse * 2.5 : emph ? 8.5 : 6.5;

    ctx.beginPath();
    ctx.arc(x, y, ring, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${emph ? LIGHT : GOLD},${0.75 * a})`;
    ctx.lineWidth = emph ? 1.35 : 1.05;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, core, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${emph ? LIGHT : GOLD},${a})`;
    ctx.fill();

    if (!showLabels) return;
    let tag = h.isBusiness ? `${h.label} · Example` : h.label;
    if (!h.isBusiness && cur.priority > 0.5 && h.priority) tag = `${h.label} · Priority (example)`;

    const padX = 6, boxH = 19;
    const boxW = measureTag(tag) + padX * 2;
    const placeLeft = h.isBusiness || x > cx + (clampMaxX - clampMinX) * 0.14;
    const rawBx = placeLeft ? x - ring - 6 - boxW : x + ring + 6;
    const bx = Math.max(clampMinX + 4, Math.min(clampMaxX - boxW - 4, rawBx));
    const by = y - boxH / 2;

    ctx.fillStyle = `rgba(6,8,12,${0.86 * a})`;
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = `rgba(${emph ? LIGHT : GOLD},${(emph ? 0.68 : 0.38) * a})`;
    ctx.lineWidth = 0.9;
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.fillStyle = `rgba(${emph ? LIGHT : GOLD},${0.96 * a})`;
    ctx.fillText(tag, bx + padX, y + 0.5);
  };

  const drawHubsAndLabels3D = (pulse: number) => {
    hitTargets.length = 0;
    const showLabels = R >= 120;
    ctx.font = fontSpec;
    ctx.textBaseline = 'middle';
    for (const h of hubs) {
      const isSelected = selectedHub === h.id;
      const baseAlpha = h.isBusiness || isSelected ? 1 : cur.audiences * (0.65 + (h.priority ? 0.35 * cur.priority : 0));
      if (baseAlpha < 0.02) continue;
      project(h.p[0], h.p[1], h.p[2]);
      const a = baseAlpha * Math.min(1, Math.max(0, (pz - 0.04) / 0.18));
      if (a < 0.02) continue;
      const x = cx + px * R, y = cy - py * R;
      hitTargets.push({ id: h.id, x, y });
      drawHubBadge(h, x, y, a, pulse, showLabels && pz >= 0.16, 0, w);
    }
  };

  const draw3D = () => {
    const atmosphere = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.24);
    atmosphere.addColorStop(0, 'rgba(96, 155, 235, 0.22)');
    atmosphere.addColorStop(0.45, `rgba(${GOLD},0.09)`);
    atmosphere.addColorStop(1, `rgba(${GOLD},0)`);
    ctx.fillStyle = atmosphere;
    ctx.fillRect(0, 0, w, h);

    const hasTexture = drawGlobeSurface();
    if (!hasTexture) {
      const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.38, 0, cx, cy, R * 1.04);
      body.addColorStop(0, 'rgb(18, 42, 86)');
      body.addColorStop(0.6, 'rgb(7, 19, 44)');
      body.addColorStop(1, 'rgb(2, 6, 16)');
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = body;
      ctx.fill();
    }

    drawGraticule();
    drawCoastAndMarkets(hasTexture);
    const scanAng = (((clock * 0.28) % 1) - 0.5) * Math.PI * 0.9;
    drawLand(scanAng, hasTexture);
    if (cur.scan > 0.01) drawScanLine(scanAng);

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${GOLD},0.46)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, R - 1.2, -Math.PI * 0.88, -Math.PI * 0.18);
    ctx.strokeStyle = `rgba(${LIGHT},0.26)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    drawArcs();
    drawHubsAndLabels3D(moving() ? 0.5 + 0.5 * Math.sin(clock * 2.2) : 0.3);
  };

  const draw2D = () => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX, mapY, mapW, mapH);
    ctx.clip();
    ctx.fillStyle = 'rgb(7, 21, 48)';
    ctx.fillRect(mapX, mapY, mapW, mapH);

    if (cachedDaymap && typeof ctx.drawImage === 'function') {
      const { img, width: texW, height: texH } = cachedDaymap;
      const uStart = ((((cur.lon / DEG) % 360) + 360) % 360) / 360;
      const firstFrac = 1 - uStart;
      const splitW = firstFrac * mapW;
      const srcX = uStart * texW, srcW1 = firstFrac * texW;
      if (srcW1 > 0.5) ctx.drawImage(img, srcX, 0, srcW1, texH, mapX, mapY, splitW, mapH);
      if (uStart * texW > 0.5) ctx.drawImage(img, 0, 0, uStart * texW, texH, mapX + splitW, mapY, mapW - splitW, mapH);
      ctx.fillStyle = 'rgba(4, 9, 20, 0.18)';
      ctx.fillRect(mapX, mapY, mapW, mapH);
    } else {
      ctx.beginPath();
      if (traceClosedRings2D(coastRings)) {
        ctx.fillStyle = 'rgba(76, 94, 54, 0.52)';
        ctx.fill();
      }
    }

    ctx.font = fontSpec;
    ctx.textBaseline = 'middle';
    for (let m = -120; m <= 120; m += 60) {
      const mx = mapX + ((m + 180) / 360) * mapW;
      ctx.beginPath();
      ctx.moveTo(mx, mapY);
      ctx.lineTo(mx, mapY + mapH);
      ctx.strokeStyle = `rgba(${GOLD},0.08)`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    for (const band of LAT_BANDS) {
      const y = mapY + (0.5 - band.deg / 180) * mapH;
      ctx.beginPath();
      ctx.moveTo(mapX, y);
      ctx.lineTo(mapX + mapW, y);
      if (band.isEq) {
        ctx.strokeStyle = `rgba(${GOLD},0.22)`;
        ctx.lineWidth = 0.9;
      } else {
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = `rgba(${GOLD},0.12)`;
        ctx.lineWidth = 0.75;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (mapW >= 240) {
        ctx.fillStyle = `rgba(${LIGHT},${band.isEq ? 0.62 : 0.44})`;
        ctx.fillText(band.label, mapX + 8, y - 8);
      }
    }

    for (const h of hubs) {
      const rings = marketRings[h.iso];
      if (!rings) continue;
      const isSelected = selectedHub === h.id;
      const weight = h.isBusiness || isSelected ? 1 : cur.audiences;
      if (weight < 0.04) continue;
      const emph = isSelected || h.isBusiness || (h.priority && cur.priority > 0.4);
      ctx.beginPath();
      if (traceClosedRings2D(rings)) {
        ctx.fillStyle = `rgba(${emph ? LIGHT : GOLD},${(emph ? 0.24 : 0.13) * weight})`;
        ctx.fill();
      }
      ctx.beginPath();
      for (const ring of rings) trace2DPolyline(ring);
      ctx.strokeStyle = `rgba(${emph ? LIGHT : GOLD},${(emph ? 0.82 : 0.52) * weight})`;
      ctx.lineWidth = emph ? 1.45 : 1.0;
      ctx.stroke();
    }

    ctx.beginPath();
    for (const ring of coastRings) trace2DPolyline(ring);
    ctx.strokeStyle = `rgba(${GOLD},0.34)`;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    if (cur.scan > 0.01) {
      const sx = mapX + ((clock * 0.22) % 1) * mapW;
      const bandW = mapW * 0.08;
      const grad = ctx.createLinearGradient(sx - bandW, 0, sx + bandW, 0);
      grad.addColorStop(0, `rgba(${LIGHT},0)`);
      grad.addColorStop(0.5, `rgba(${LIGHT},${0.22 * cur.scan})`);
      grad.addColorStop(1, `rgba(${LIGHT},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(sx - bandW, mapY, bandW * 2, mapH);
      ctx.beginPath();
      ctx.moveTo(sx, mapY);
      ctx.lineTo(sx, mapY + mapH);
      ctx.strokeStyle = `rgba(${LIGHT},${0.62 * cur.scan})`;
      ctx.lineWidth = 1.15;
      ctx.stroke();
    }

    for (const a of audiences) {
      const isSelected = selectedHub === a.id;
      const alpha = cur.arcs * 0.38 + (a.priority ? cur.priority * 0.68 : 0) + (isSelected ? 0.58 : 0);
      if (alpha < 0.01) continue;
      ctx.beginPath();
      trace2DPolyline(a.arc);
      const lit = isSelected || (a.priority && cur.priority > 0.5);
      ctx.strokeStyle = `rgba(${lit ? LIGHT : GOLD},${Math.min(1, alpha)})`;
      ctx.lineWidth = lit ? 1.85 : 1.25;
      ctx.stroke();
      if (!moving() || alpha < 0.28) continue;
      const k = Math.floor((((clock * 0.24 + a.phase) % 1) * a.arc.length) / 3) * 3;
      project2D(a.arc[k], a.arc[k + 1], a.arc[k + 2]);
      ctx.beginPath();
      ctx.arc(x2d, y2d, lit ? 2.5 : 2.0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${LIGHT},${Math.min(1, alpha)})`;
      ctx.fill();
    }

    hitTargets.length = 0;
    const pulse = moving() ? 0.5 + 0.5 * Math.sin(clock * 2.2) : 0.3;
    const showLabels = mapW >= 260;
    for (const h of hubs) {
      const isSelected = selectedHub === h.id;
      const a = h.isBusiness || isSelected ? 1 : cur.audiences * (0.68 + (h.priority ? 0.32 * cur.priority : 0));
      if (a < 0.02) continue;
      project2D(h.p[0], h.p[1], h.p[2]);
      hitTargets.push({ id: h.id, x: x2d, y: y2d });
      drawHubBadge(h, x2d, y2d, a, pulse, showLabels, mapX, mapX + mapW);
    }

    ctx.restore();
    ctx.strokeStyle = `rgba(${GOLD},0.46)`;
    ctx.lineWidth = 1.15;
    ctx.strokeRect(mapX, mapY, mapW, mapH);
  };

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ca = Math.cos(cur.lon); sa = Math.sin(cur.lon);
    cb = Math.cos(cur.lat); sb = Math.sin(cur.lat);
    if (viewMode === '2d') draw2D();
    else draw3D();
  };

  const tick = (now: number) => {
    raf = 0;
    if (!alive || !isVisible() || lost) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    if (moving() && !grab) clock += dt;
    const settling = step(dt);
    draw();
    if (moving() || settling) raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (!raf && alive && isVisible() && !lost) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  const refit = () => {
    resize();
    if (!lost) draw();
    wake();
  };

  requestDaymap(() => {
    if (!alive || lost) return;
    renderedLat = NaN;
    draw();
    wake();
  });

  const hitHubAt = (clientX: number, clientY: number): EarthHubId | null => {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    let best: { id: EarthHubId; d: number } | null = null;
    for (const t of hitTargets) {
      const d = Math.hypot(mx - t.x, my - t.y);
      if (d <= HIT_RADIUS && (!best || d < best.d)) best = { id: t.id, d };
    }
    return best ? best.id : null;
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    grab = { x: e.clientX, y: e.clientY, downX: e.clientX, downY: e.clientY, moved: false };
    canvas.style.cursor = 'grabbing';
  };
  const onMove = (e: PointerEvent) => {
    if (!grab) {
      canvas.style.cursor = hitHubAt(e.clientX, e.clientY) ? 'pointer' : 'grab';
      return;
    }
    if (Math.hypot(e.clientX - grab.downX, e.clientY - grab.downY) > 5) grab.moved = true;
    const focusLat = targetFocus().lat * DEG;
    const lonScale = viewMode === '2d' ? (Math.PI * 2) / Math.max(1, mapW) : 1 / R;
    drag.lon -= (e.clientX - grab.x) * lonScale;
    if (viewMode === '3d') {
      drag.lat = Math.max(-MAX_LAT - focusLat, Math.min(MAX_LAT - focusLat, drag.lat + (e.clientY - grab.y) / R));
    }
    grab.x = e.clientX;
    grab.y = e.clientY;
    wake();
  };
  const onUp = (e: PointerEvent) => {
    if (!grab || grab.moved || !opts.onSelectHub) return;
    const hit = hitHubAt(e.clientX, e.clientY);
    if (hit) opts.onSelectHub(selectedHub === hit ? null : hit);
  };
  const onRelease = () => { grab = null; canvas.style.cursor = 'grab'; };
  const onLost = () => { lost = true; };
  const onRestored = () => { lost = false; renderedLat = NaN; refit(); };
  const onVis = () => { if (isVisible()) wake(); };

  const ro = new ResizeObserver(refit);
  ro.observe(canvas);
  const io = new IntersectionObserver(([entry]) => {
    onScreen = Boolean(entry?.isIntersecting);
    if (isVisible()) wake();
  });
  io.observe(canvas);

  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('lostpointercapture', onRelease);
  canvas.addEventListener('contextlost', onLost);
  canvas.addEventListener('contextrestored', onRestored);
  document.addEventListener('visibilitychange', onVis);

  refit();

  const unwindAndWake = () => {
    const focus = targetFocus();
    cur.lon = focus.lon * DEG + ((((cur.lon - focus.lon * DEG) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    drag.lat = 0;
    drag.lon = 0;
    if (reduced && !lost) {
      step(1);
      draw();
    } else {
      wake();
    }
  };

  return {
    setChapter(id) { chapter = EARTH_CHAPTERS[chapterIndex(id)]; unwindAndWake(); },
    setHub(id) { selectedHub = id; unwindAndWake(); },
    setViewMode(mode) {
      if (viewMode === mode) return;
      viewMode = mode;
      if (!lost) draw();
      wake();
    },
    resetView() { selectedHub = null; unwindAndWake(); },
    setPaused(next) { paused = next; wake(); },
    destroy() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('lostpointercapture', onRelease);
      canvas.removeEventListener('contextlost', onLost);
      canvas.removeEventListener('contextrestored', onRestored);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
}

