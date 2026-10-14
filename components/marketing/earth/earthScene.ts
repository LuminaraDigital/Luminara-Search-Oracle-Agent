/**
 * Landing Earth: Canvas2D orthographic globe (lazy chunk, no Three, per landing-moat policy).
 * Imperative API so React never re-renders per frame. Pure helpers are exported for tests.
 * Sampling/rotation must match scripts/earth/bake-land-dots.mjs.
 */
import { LAND_BITSET_B64, LAND_SAMPLE_COUNT } from './landDots.generated';
import {
  EARTH_AUDIENCES,
  EARTH_BUSINESS,
  EARTH_CHAPTERS,
  EARTH_PALETTE,
  chapterIndex,
  type ChapterId,
} from './earthStory';

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;
const ARC_SAMPLES = 56;
const BUCKETS = 6;
const MAX_LAT = 70 * DEG;
const GOLD = EARTH_PALETTE.gold;
const LIGHT = EARTH_PALETTE.goldLight;
const LAYER_KEYS = ['audiences', 'arcs', 'priority', 'scan'] as const;

/** Deterministic Fibonacci sphere sample i of n. */
export function fibPoint(i: number, n: number): Vec3 {
  const y = 1 - ((i + 0.5) / n) * 2;
  const r = Math.sqrt(1 - y * y);
  const theta = Math.PI * (3 - Math.sqrt(5)) * i;
  return [Math.cos(theta) * r, y, Math.sin(theta) * r];
}

/** Unit vector; lon 0 / lat 0 faces the viewer (+z), north is +y. */
export function fromLatLon(lat: number, lon: number): Vec3 {
  const p = lat * DEG;
  const l = lon * DEG;
  return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
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
  paused: boolean;
  reducedMotion: boolean;
  lowPower: boolean;
}

export interface EarthScene {
  setChapter(id: ChapterId): void;
  setPaused(paused: boolean): void;
  destroy(): void;
}

/** Throws when Canvas 2D is unavailable; the caller shows the static fallback. */
export function createEarthScene(canvas: HTMLCanvasElement, opts: EarthSceneOptions): EarthScene {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  const land = decodeLand(LAND_BITSET_B64, LAND_SAMPLE_COUNT, opts.lowPower ? 2 : 1);
  const business = fromLatLon(EARTH_BUSINESS.lat, EARTH_BUSINESS.lon);
  const audiences = EARTH_AUDIENCES.map((a, i) => {
    const p = fromLatLon(a.lat, a.lon);
    return { p, priority: a.priority, arc: arcPoints(business, p), phase: i * 0.37 };
  });
  const dots = Array.from({ length: BUCKETS + 1 }, () => new Float32Array(land.length));
  const counts = new Int32Array(BUCKETS + 1);

  let chapter = EARTH_CHAPTERS[chapterIndex(opts.chapter)];
  let paused = opts.paused;
  const reduced = opts.reducedMotion;
  const cur = { lat: chapter.focus.lat * DEG, lon: chapter.focus.lon * DEG, ...chapter.layers };
  const drag = { lat: 0, lon: 0 };
  let grab: { x: number; y: number } | null = null;
  let w = 0, h = 0, R = 0, cx = 0, cy = 0, dpr = 1;
  let raf = 0, last = 0, clock = 0;
  let visible = true, alive = true, lost = false;

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
  };

  /** Ease toward chapter targets; returns true while still settling. */
  const step = (dt: number): boolean => {
    const sway = Math.sin((clock * 2 * Math.PI) / 48) * 10 * DEG;
    const tLon = chapter.focus.lon * DEG + sway + drag.lon;
    const tLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, chapter.focus.lat * DEG + drag.lat));
    const kView = reduced || grab ? 1 : 1 - Math.exp(-dt / 0.45);
    const kLayer = reduced ? 1 : 1 - Math.exp(-dt / 0.3);
    let delta = Math.abs(tLon - cur.lon) + Math.abs(tLat - cur.lat);
    for (const key of LAYER_KEYS) delta += Math.abs(chapter.layers[key] - cur[key]);
    // Snap once visually converged so a paused scene stops rendering promptly.
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

  const drawLand = (scanAng: number) => {
    counts.fill(0);
    const size = Math.max(0.7, Math.min(1.3, R / 260));
    for (let i = 0; i < land.length; i += 3) {
      project(land[i], land[i + 1], land[i + 2]);
      if (pz <= 0) continue;
      let bucket = Math.min(BUCKETS - 1, Math.floor((0.22 + 0.78 * pz) * BUCKETS));
      if (cur.scan > 0.01 && Math.abs(Math.atan2(px, pz) - scanAng) < 0.14) bucket = BUCKETS;
      const buf = dots[bucket];
      const n = counts[bucket];
      buf[n] = cx + px * R;
      buf[n + 1] = cy - py * R;
      buf[n + 2] = (1.05 + 0.85 * pz) * size;
      counts[bucket] = n + 3;
    }
    for (let b = 0; b <= BUCKETS; b += 1) {
      const buf = dots[b];
      ctx.beginPath();
      for (let j = 0; j < counts[b]; j += 3) {
        ctx.moveTo(buf[j] + buf[j + 2], buf[j + 1]);
        ctx.arc(buf[j], buf[j + 1], buf[j + 2], 0, Math.PI * 2);
      }
      ctx.fillStyle = b === BUCKETS ? `rgba(${LIGHT},${0.35 + 0.65 * cur.scan})` : `rgba(${GOLD},${(b + 0.5) / BUCKETS})`;
      ctx.fill();
    }
  };

  const drawScanLine = (scanAng: number) => {
    const s = Math.sin(scanAng);
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(s) * R, R, 0, s >= 0 ? -Math.PI / 2 : Math.PI / 2, s >= 0 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.strokeStyle = `rgba(${LIGHT},${0.5 * cur.scan})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  const drawArcs = () => {
    for (const a of audiences) {
      const alpha = cur.arcs * 0.3 + (a.priority ? cur.priority * 0.7 : 0);
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
      const lit = a.priority && cur.priority > 0.5;
      ctx.strokeStyle = `rgba(${lit ? LIGHT : GOLD},${alpha})`;
      ctx.lineWidth = lit ? 1.6 : 1.1;
      ctx.stroke();
      if (!moving() || alpha < 0.3) continue;
      const k = Math.floor((((clock * 0.22 + a.phase) % 1) * a.arc.length) / 3) * 3;
      project(a.arc[k], a.arc[k + 1], a.arc[k + 2]);
      if (pz <= 0 && px * px + py * py <= 1) continue;
      ctx.beginPath();
      ctx.arc(cx + px * R, cy - py * R, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${LIGHT},${alpha})`;
      ctx.fill();
    }
  };

  const drawMarker = (p: Vec3, alpha: number, core: number, ring: number) => {
    project(p[0], p[1], p[2]);
    const a = alpha * Math.min(1, pz / 0.15);
    if (a < 0.01) return;
    const x = cx + px * R;
    const y = cy - py * R;
    ctx.beginPath();
    ctx.arc(x, y, ring, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${LIGHT},${0.6 * a})`;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, core, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${LIGHT},${a})`;
    ctx.fill();
  };

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ca = Math.cos(cur.lon); sa = Math.sin(cur.lon);
    cb = Math.cos(cur.lat); sb = Math.sin(cur.lat);
    const atmosphere = ctx.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.2);
    atmosphere.addColorStop(0, `rgba(${GOLD},0.16)`);
    atmosphere.addColorStop(1, `rgba(${GOLD},0)`);
    ctx.fillStyle = atmosphere;
    ctx.fillRect(0, 0, w, h);
    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, 0, cx, cy, R * 1.05);
    body.addColorStop(0, 'rgb(26,21,12)');
    body.addColorStop(0.55, 'rgb(9,8,5)');
    body.addColorStop(1, 'rgb(0,0,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = `rgba(${GOLD},0.3)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    const scanAng = reduced ? 0.35 : Math.sin((clock * 2 * Math.PI) / 7) * 1.25;
    drawLand(scanAng);
    if (cur.scan > 0.01) drawScanLine(scanAng);
    drawArcs();
    for (const a of audiences) drawMarker(a.p, cur.audiences, 2.2, 5);
    drawMarker(business, 1, 3.6, 9);
    if (moving()) {
      const t = (clock % 2.4) / 2.4;
      project(business[0], business[1], business[2]);
      if (pz > 0.15) {
        ctx.beginPath();
        ctx.arc(cx + px * R, cy - py * R, 9 + t * 16, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${LIGHT},${0.5 * (1 - t)})`;
        ctx.stroke();
      }
    }
  };

  const frame = (t: number) => {
    raf = 0;
    if (!alive || lost || !visible || document.hidden) { last = 0; return; }
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    last = t;
    if (moving()) clock += dt;
    const settling = step(dt);
    draw();
    if (moving() || settling) raf = requestAnimationFrame(frame);
    else last = 0;
  };

  const wake = () => {
    if (alive && !raf) raf = requestAnimationFrame(frame);
  };

  /** Resizing clears the bitmap, so repaint immediately instead of waiting a frame. */
  const refit = () => {
    resize();
    if (!lost) draw();
    wake();
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    grab = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  };
  const onMove = (e: PointerEvent) => {
    if (!grab) return;
    const focusLat = chapter.focus.lat * DEG;
    drag.lon -= (e.clientX - grab.x) / R;
    drag.lat = Math.max(-MAX_LAT - focusLat, Math.min(MAX_LAT - focusLat, drag.lat + (e.clientY - grab.y) / R));
    grab = { x: e.clientX, y: e.clientY };
    wake();
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

  resize();
  canvas.style.cursor = window.matchMedia?.('(pointer: fine)').matches ? 'grab' : '';
  const ro = new ResizeObserver(refit);
  ro.observe(canvas);
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    wake();
  });
  io.observe(canvas);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('lostpointercapture', onRelease);
  canvas.addEventListener('contextlost', onLost);
  canvas.addEventListener('contextrestored', onRestored);
  document.addEventListener('visibilitychange', wake);
  wake();

  return {
    setChapter(id) {
      chapter = EARTH_CHAPTERS[chapterIndex(id)];
      drag.lat = 0;
      drag.lon = 0;
      // Unwind full turns from dragging so the camera takes the short way back.
      const turn = 2 * Math.PI;
      cur.lon -= turn * Math.round((cur.lon - chapter.focus.lon * DEG) / turn);
      wake();
    },
    setPaused(next) {
      paused = next;
      wake();
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('lostpointercapture', onRelease);
      canvas.removeEventListener('contextlost', onLost);
      canvas.removeEventListener('contextrestored', onRestored);
      document.removeEventListener('visibilitychange', wake);
    },
  };
}
