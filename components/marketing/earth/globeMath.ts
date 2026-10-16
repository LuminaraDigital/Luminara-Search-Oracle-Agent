/**
 * Pure math for the landing globe: sphere rotation, orthographic projection,
 * lifted great-circle arcs, camera poses and dot-grid level selection.
 * No DOM. Shared by globeRenderer.ts (WebGL + overlay) and tests.
 */

export type Vec3 = [number, number, number];

export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeInOut(t: number): number {
  const c = clamp(t, 0, 1);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Signed shortest difference b - a in degrees, in (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Unit vector for a latitude/longitude in degrees. y is north, z faces lon 0. */
export function fromLatLon(latDeg: number, lonDeg: number): Vec3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const c = Math.cos(lat);
  return [c * Math.sin(lon), Math.sin(lat), c * Math.cos(lon)];
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Row-major world-to-view matrix that turns (lat0, lon0) toward the viewer (+z).
 * Uploaded as-is to a GLSL mat3 (column-major), the shader receives the transpose,
 * which is the view-to-world rotation it needs for texture lookups.
 */
export function viewMatrix(lat0Deg: number, lon0Deg: number): Float32Array {
  const L = lon0Deg * DEG;
  const B = lat0Deg * DEG;
  const cl = Math.cos(L);
  const sl = Math.sin(L);
  const cb = Math.cos(B);
  const sb = Math.sin(B);
  return Float32Array.of(
    cl, 0, -sl,
    -sb * sl, cb, -sb * cl,
    cb * sl, sb, cb * cl,
  );
}

export function applyMatrix(m: ArrayLike<number>, v: ArrayLike<number>, o = 0): Vec3 {
  const x = v[o];
  const y = v[o + 1];
  const z = v[o + 2];
  return [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];
}

/** Great-circle arc from a to b, lifted off the surface by `height` at mid-span. Packed xyz. */
export function liftedArc(a: Vec3, b: Vec3, height: number, samples = 48): Float32Array {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  const omega = Math.acos(dot);
  const s = Math.sin(omega) || 1;
  const out = new Float32Array(samples * 3);
  for (let i = 0; i < samples; i += 1) {
    const t = i / (samples - 1);
    const wa = Math.sin((1 - t) * omega) / s;
    const wb = Math.sin(t * omega) / s;
    const lift = 1 + height * (0.35 + omega / Math.PI) * Math.sin(Math.PI * t);
    for (let c = 0; c < 3; c += 1) out[i * 3 + c] = (a[c] * wa + b[c] * wb) * lift;
  }
  return out;
}

/** Where the globe sits on the stage, in CSS pixels, plus its lighting. */
export interface GlobePose {
  cx: number;
  cy: number;
  r: number;
  /** View-space sun direction. z < 0 puts the sun behind the planet (sunrise rim). */
  sun: Vec3;
  /** Sunrise flare strength, 0..1. */
  flare: number;
  /** Overall globe brightness, 0..1 (dimmed behind large copy). */
  dim: number;
  /** Night-side dot brightness, 0..1. */
  dots: number;
}

export function lerpPose(a: GlobePose, b: GlobePose, t: number): GlobePose {
  const k = clamp(t, 0, 1);
  return {
    cx: lerp(a.cx, b.cx, k),
    cy: lerp(a.cy, b.cy, k),
    // Zoom in log space so the pull-back reads as constant camera speed.
    r: Math.exp(lerp(Math.log(a.r), Math.log(b.r), k)),
    sun: normalize([lerp(a.sun[0], b.sun[0], k), lerp(a.sun[1], b.sun[1], k), lerp(a.sun[2], b.sun[2], k)]),
    flare: lerp(a.flare, b.flare, k),
    dim: lerp(a.dim, b.dim, k),
    dots: lerp(a.dots, b.dots, k),
  };
}

const HERO_SUN = normalize([0.16, 0.42, -0.9]);
const CENTER_SUN = normalize([-0.72, 0.38, -0.3]);
const STORY_SUN = normalize([-0.86, 0.32, 0.38]);

/** Hero: a huge planet whose limb rises from the lower third, sun just behind it. */
export function horizonPose(w: number, h: number): GlobePose {
  const narrow = w < 640;
  const r = Math.max(w * 0.78, h * (narrow ? 0.95 : 1.1));
  const limbTop = h * (narrow ? 0.8 : 0.79);
  return { cx: w / 2, cy: limbTop + r, r, sun: HERO_SUN, flare: 1, dim: 1, dots: 0.62 };
}

/** The whole planet, centred and dimmed behind a large statement. */
export function centerPose(w: number, h: number): GlobePose {
  const r = Math.min(w, h) * (w < 640 ? 0.4 : 0.34);
  return { cx: w / 2, cy: h * 0.5, r, sun: CENTER_SUN, flare: 0.2, dim: 0.5, dots: 0.9 };
}

/** Story chapters: globe to the right on wide screens, above the copy on narrow ones. */
export function storyPose(w: number, h: number): GlobePose {
  if (w >= 1024) {
    return { cx: w * 0.72, cy: h * 0.5, r: Math.min(w * 0.24, h * 0.37), sun: STORY_SUN, flare: 0, dim: 1, dots: 1 };
  }
  return { cx: w / 2, cy: h * 0.25, r: Math.min(w * 0.38, h * 0.18), sun: STORY_SUN, flare: 0, dim: 1, dots: 1 };
}

/**
 * Dot-grid pitch for a globe radius in device pixels. Levels halve from 4 degrees;
 * `mix` blends toward the next finer level so zooming never pops.
 */
export function dotLevel(radiusDevicePx: number, spacingDevicePx: number): { pitch: number; mix: number } {
  const ideal = (spacingDevicePx / Math.max(radiusDevicePx, 1)) / DEG;
  const level = clamp(Math.log2(4 / ideal), 0, 5.999);
  const a = Math.floor(level);
  return { pitch: 4 / Math.pow(2, a), mix: level - a };
}

/**
 * Scroll position through the story, in anchor units. Each anchor offset is the
 * distance in px from the viewport line to the anchor (positive = not reached yet).
 * Returns 0 before the first anchor, i at anchor i, fractional in between.
 */
export function storyProgress(offsets: readonly number[]): number {
  if (offsets.length === 0 || offsets[0] >= 0) return 0;
  for (let i = 0; i < offsets.length - 1; i += 1) {
    const a = offsets[i];
    const b = offsets[i + 1];
    if (a <= 0 && b > 0) return i + -a / (b - a);
  }
  return offsets.length - 1;
}
