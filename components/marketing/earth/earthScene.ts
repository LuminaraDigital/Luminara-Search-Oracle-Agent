/* Canvas 2D orthographic Earth renderer for the landing-page story.
 * Hybrid vector + Fibonacci dot globe: 3D spherical graticule, Natural Earth /
 * topojson/world-atlas 110m coastlines, highlighted market country polygons,
 * directional terminator shading, lifted great-circle arcs, on-globe HUD labels,
 * and click-to-focus hub hit-testing.
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
} from './earthStory';
import {
  COAST_RINGS_B64,
  LAND_BITSET_B64,
  LAND_SAMPLE_COUNT,
  MARKET_RINGS_B64,
} from './landDots.generated';

export type Vec3 = readonly [number, number, number];

const DEG = Math.PI / 180;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const BUCKETS = 6;
const ARC_SAMPLES = 44;
const MAX_LAT = 65 * DEG;
const HIT_RADIUS = 22;
const GOLD = EARTH_PALETTE.gold;
const LIGHT = EARTH_PALETTE.goldLight;
const LAYER_KEYS = ['audiences', 'arcs', 'priority', 'scan'] as const;

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
  paused: boolean;
  reducedMotion: boolean;
  lowPower: boolean;
  onSelectHub?: (id: EarthHubId | null) => void;
}

export interface EarthScene {
  setChapter(id: ChapterId): void;
  setHub(id: EarthHubId | null): void;
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
  let paused = opts.paused;
  const reduced = opts.reducedMotion;

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
  let raf = 0, last = 0, clock = 0;
  let onScreen = true, alive = true, lost = false;

  const isVisible = () => onScreen && !document.hidden;

  // Rotation state for the current frame; project() writes px/py/pz.
  let ca = 1, sa = 0, cb = 1, sb = 0, px = 0, py = 0, pz = 0;
  const project = (x: number, y: number, z: number) => {
    const x1 = x * ca - z * sa;
    const z1 = x * sa + z * ca;
    px = x1;
    py = y * cb - z1 * sb;
    pz = y * sb + z1 * cb;
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

  const drawGraticule = () => {
    ctx.save();
    ctx.beginPath();
    for (const line of graticule.lines) traceFrontPolyline(line);
    ctx.strokeStyle = `rgba(${GOLD},0.075)`;
    ctx.lineWidth = 0.7;
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    traceFrontPolyline(graticule.equator);
    ctx.strokeStyle = `rgba(${GOLD},0.16)`;
    ctx.lineWidth = 0.85;
    ctx.stroke();
    ctx.restore();
  };

  const drawCoastAndMarkets = () => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    ctx.clip();

    // Highlighted market country polygons (Singapore 702 has no 110m polygon and renders marker-only).
    for (const h of hubs) {
      const rings = marketRings[h.iso];
      if (!rings) continue;
      const isSelected = selectedHub === h.id;
      const weight = h.isBusiness ? 1 : isSelected ? 1 : cur.audiences;
      if (weight < 0.04) continue;

      const emph = isSelected || h.isBusiness || (h.priority && cur.priority > 0.4);
      ctx.beginPath();
      let anyFill = false;
      for (const ring of rings) {
        let minPz = 1;
        for (let i = 0; i < ring.length; i += 3) {
          project(ring[i], ring[i + 1], ring[i + 2]);
          if (pz < minPz) minPz = pz;
        }
        // Fill rings that sit cleanly on the visible hemisphere; horizon-straddling rings still get stroked below.
        if (minPz <= 0.005) continue;
        anyFill = true;
        for (let i = 0; i < ring.length; i += 3) {
          project(ring[i], ring[i + 1], ring[i + 2]);
          if (i === 0) ctx.moveTo(cx + px * R, cy - py * R);
          else ctx.lineTo(cx + px * R, cy - py * R);
        }
        ctx.closePath();
      }
      if (anyFill) {
        ctx.fillStyle = `rgba(${emph ? LIGHT : GOLD},${(emph ? 0.14 : 0.075) * weight})`;
        ctx.fill();
      }

      ctx.beginPath();
      for (const ring of rings) traceFrontPolyline(ring);
      ctx.strokeStyle = `rgba(${emph ? LIGHT : GOLD},${(emph ? 0.58 : 0.34) * weight})`;
      ctx.lineWidth = emph ? 1.25 : 0.9;
      ctx.stroke();
    }

    // Global coastline vector paths from world-atlas 110m land.
    ctx.beginPath();
    for (const ring of coastRings) traceFrontPolyline(ring);
    ctx.strokeStyle = `rgba(${GOLD},0.28)`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  };

  const drawLand = (scanAng: number) => {
    counts.fill(0);
    const size = Math.max(0.7, Math.min(1.28, R / 260));
    for (let i = 0; i < land.length; i += 3) {
      project(land[i], land[i + 1], land[i + 2]);
      if (pz <= 0) continue;
      const sun = Math.max(0, -0.32 * px + 0.36 * py + 0.87 * pz);
      const shade = 0.18 + 0.52 * pz + 0.3 * sun;
      let bucket = Math.min(BUCKETS - 1, Math.floor(shade * BUCKETS));
      if (cur.scan > 0.01 && Math.abs(Math.atan2(px, pz) - scanAng) < 0.14) bucket = BUCKETS;
      const buf = dots[bucket];
      const n = counts[bucket];
      buf[n] = cx + px * R;
      buf[n + 1] = cy - py * R;
      buf[n + 2] = (1.02 + 0.82 * pz) * size;
      counts[bucket] = n + 3;
    }
    for (let b = 0; b <= BUCKETS; b += 1) {
      const buf = dots[b];
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
    ctx.strokeStyle = `rgba(${LIGHT},${0.52 * cur.scan})`;
    ctx.lineWidth = 1.1;
    ctx.stroke();
  };

  const drawArcs = () => {
    for (const a of audiences) {
      const isSelected = selectedHub === a.id;
      const alpha = cur.arcs * 0.32 + (a.priority ? cur.priority * 0.68 : 0) + (isSelected ? 0.55 : 0);
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
      ctx.lineWidth = lit ? 1.75 : 1.15;
      ctx.stroke();
      if (!moving() || alpha < 0.28) continue;
      const k = Math.floor((((clock * 0.24 + a.phase) % 1) * a.arc.length) / 3) * 3;
      project(a.arc[k], a.arc[k + 1], a.arc[k + 2]);
      if (pz <= 0 && px * px + py * py <= 1) continue;
      ctx.beginPath();
      ctx.arc(cx + px * R, cy - py * R, lit ? 2.4 : 1.9, 0, Math.PI * 2);
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

  const drawHubsAndLabels = (pulse: number) => {
    hitTargets.length = 0;
    const showLabels = R >= 120;
    ctx.font = fontSpec;
    ctx.textBaseline = 'middle';

    for (const h of hubs) {
      const isSelected = selectedHub === h.id;
      const baseAlpha = h.isBusiness
        ? 1
        : isSelected
          ? 1
          : cur.audiences * (0.65 + (h.priority ? 0.35 * cur.priority : 0));
      if (baseAlpha < 0.02) continue;

      project(h.p[0], h.p[1], h.p[2]);
      const limbFade = Math.min(1, Math.max(0, (pz - 0.04) / 0.18));
      const a = baseAlpha * limbFade;
      if (a < 0.02) continue;

      const x = cx + px * R;
      const y = cy - py * R;
      hitTargets.push({ id: h.id, x, y });

      const emph = h.isBusiness || isSelected || (h.priority && cur.priority > 0.5);
      const core = h.isBusiness ? 4.4 : emph ? 3.8 : 3.0;
      const ring = h.isBusiness ? 10 + pulse * 3 : isSelected ? 11 + pulse * 2.5 : emph ? 8.5 : 6.5;

      ctx.beginPath();
      ctx.arc(x, y, ring, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${emph ? LIGHT : GOLD},${0.68 * a})`;
      ctx.lineWidth = emph ? 1.3 : 1.05;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, core, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${emph ? LIGHT : GOLD},${a})`;
      ctx.fill();

      if (!showLabels || pz < 0.16) continue;
      let tag = h.isBusiness ? `${h.label} · Example` : h.label;
      if (!h.isBusiness && cur.priority > 0.5 && h.priority) {
        tag = `${h.label} · Priority (example)`;
      }

      const padX = 6;
      const boxH = 19;
      const textW = measureTag(tag);
      const boxW = textW + padX * 2;
      const placeLeft = px > 0.28;
      const bx = placeLeft ? x - ring - 6 - boxW : x + ring + 6;
      const by = y - boxH / 2;

      ctx.fillStyle = `rgba(8,7,5,${0.82 * a})`;
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = `rgba(${emph ? LIGHT : GOLD},${(emph ? 0.65 : 0.35) * a})`;
      ctx.lineWidth = 0.9;
      ctx.strokeRect(bx, by, boxW, boxH);

      ctx.fillStyle = `rgba(${emph ? LIGHT : GOLD},${0.95 * a})`;
      ctx.fillText(tag, bx + padX, y + 0.5);
    }
  };

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ca = Math.cos(cur.lon); sa = Math.sin(cur.lon);
    cb = Math.cos(cur.lat); sb = Math.sin(cur.lat);

    const atmosphere = ctx.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.22);
    atmosphere.addColorStop(0, `rgba(${GOLD},0.18)`);
    atmosphere.addColorStop(0.55, `rgba(${GOLD},0.06)`);
    atmosphere.addColorStop(1, `rgba(${GOLD},0)`);
    ctx.fillStyle = atmosphere;
    ctx.fillRect(0, 0, w, h);

    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.38, 0, cx, cy, R * 1.04);
    body.addColorStop(0, 'rgb(28,23,13)');
    body.addColorStop(0.55, 'rgb(10,9,6)');
    body.addColorStop(1, 'rgb(2,2,1)');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    drawGraticule();
    drawCoastAndMarkets();

    const scanAng = (((clock * 0.28) % 1) - 0.5) * Math.PI * 0.9;
    drawLand(scanAng);
    if (cur.scan > 0.01) drawScanLine(scanAng);

    // Outer sphere rim + subtle upper-left specular crescent.
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${GOLD},0.42)`;
    ctx.lineWidth = 1.15;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, R - 1.2, -Math.PI * 0.88, -Math.PI * 0.18);
    ctx.strokeStyle = `rgba(${LIGHT},0.22)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    drawArcs();
    const pulse = moving() ? 0.5 + 0.5 * Math.sin(clock * 2.2) : 0.3;
    drawHubsAndLabels(pulse);
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

  const hitHubAt = (clientX: number, clientY: number): EarthHubId | null => {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
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
    const focus = targetFocus();
    const focusLat = focus.lat * DEG;
    drag.lon -= (e.clientX - grab.x) / R;
    drag.lat = Math.max(-MAX_LAT - focusLat, Math.min(MAX_LAT - focusLat, drag.lat + (e.clientY - grab.y) / R));
    grab.x = e.clientX;
    grab.y = e.clientY;
    wake();
  };
  const onUp = (e: PointerEvent) => {
    if (!grab || grab.moved || !opts.onSelectHub) return;
    const hit = hitHubAt(e.clientX, e.clientY);
    if (hit) opts.onSelectHub(selectedHub === hit ? null : hit);
  };
  // Fires after pointerup, pointercancel, or any other capture loss.
  const onRelease = () => {
    grab = null;
    canvas.style.cursor = 'grab';
  };
  // 2D canvas: do NOT preventDefault, or the browser never restores the context.
  const onLost = () => {
    lost = true;
  };
  const onRestored = () => {
    lost = false;
    refit();
  };
  const onVis = () => {
    if (isVisible()) wake();
  };

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
    setChapter(id) {
      chapter = EARTH_CHAPTERS[chapterIndex(id)];
      unwindAndWake();
    },
    setHub(id) {
      selectedHub = id;
      unwindAndWake();
    },
    resetView() {
      selectedHub = null;
      unwindAndWake();
    },
    setPaused(next) {
      paused = next;
      wake();
    },
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
