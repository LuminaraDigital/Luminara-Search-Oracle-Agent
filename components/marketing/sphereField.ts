/**
 * Shared visibility-sphere math for the landing hero and the field map.
 * Deterministic. No Math.random. No Three.js.
 */

export interface SpherePoint {
  x: number;
  y: number;
  z: number;
  bright: number;
}

export interface SphereProjector {
  yaw: number;
  pitch: number;
  radius: number;
  originX: number;
  originY: number;
}

export interface ProjectedSpherePoint {
  x: number;
  y: number;
  z: number;
  /** Perspective scale. 1 when the point sits on the camera plane. */
  scale: number;
  /** True when the rotated point faces the camera (z > 0). */
  front: boolean;
  sx: number;
  sy: number;
}

export interface StarPoint {
  /** 0-1 across the canvas. */
  u: number;
  /** 0-1 down the canvas. */
  v: number;
  size: number;
  alpha: number;
}

const CAMERA_DISTANCE = 3.2;

/** Fibonacci sphere. Same input always returns the same points. */
export function fibSphere(count: number): SpherePoint[] {
  const out: SpherePoint[] = [];
  const safe = Math.max(0, Math.floor(count));
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < safe; i += 1) {
    const y = 1 - (i / Math.max(safe - 1, 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push({
      x: Math.cos(theta) * r,
      y,
      z: Math.sin(theta) * r,
      bright: 0.18 + (i % 7) * 0.04,
    });
  }
  return out;
}

/** Map a 0-100 layout percent into a point on a mild shell. */
export function pctToSphere(x: number, y: number): { x: number; y: number; z: number } {
  const lon = ((x - 50) / 50) * 0.95;
  const lat = ((50 - y) / 50) * 0.85;
  const cl = Math.cos(lat);
  return {
    x: Math.sin(lon) * cl,
    y: Math.sin(lat),
    z: Math.cos(lon) * cl,
  };
}

export function projectSpherePoint(
  point: { x: number; y: number; z: number },
  camera: SphereProjector,
): ProjectedSpherePoint {
  const cy = Math.cos(camera.yaw);
  const sy = Math.sin(camera.yaw);
  const cx = Math.cos(camera.pitch);
  const sx = Math.sin(camera.pitch);
  const x1 = point.x * cy + point.z * sy;
  const z1 = -point.x * sy + point.z * cy;
  const y2 = point.y * cx - z1 * sx;
  const z2 = point.y * sx + z1 * cx;
  const perspective = CAMERA_DISTANCE / (CAMERA_DISTANCE - z2);
  return {
    x: x1,
    y: y2,
    z: z2,
    scale: perspective,
    front: z2 > 0,
    sx: camera.originX + x1 * camera.radius * perspective,
    sy: camera.originY - y2 * camera.radius * perspective,
  };
}

/**
 * Hero crop: horizon near the middle, center below the fold, so the face of the
 * sphere fills the lower half the way a planet fills the frame.
 */
export function heroSphereFrame(width: number, height: number): SphereProjector {
  const radius = Math.max(width * 0.62, height * 0.9);
  // Stacked mobile actions need the horizon lower so the second button stays in the sky.
  const limbY = height * (width < 768 ? 0.78 : 0.62);
  return {
    yaw: 0,
    pitch: 0.1,
    radius,
    originX: width * 0.5,
    originY: limbY + radius,
  };
}

/** Engines sit on the hero sphere. Scale stays 1 so labels stay inside the frame. */
export const HERO_MOON_SCALE = 1;

/**
 * Unit vectors at the composed hero pitch on a 1440x900 frame:
 * Google and AI Overviews higher, ChatGPT and Perplexity toward the side edges.
 */
export const HERO_ENGINE_ANCHORS = {
  web_serp: { x: -0.333, y: 0.917, z: 0.22 },
  google_aio: { x: 0.333, y: 0.917, z: 0.22 },
  chatgpt: { x: -0.583, y: 0.75, z: 0.312 },
  perplexity: { x: 0.583, y: 0.75, z: 0.312 },
} as const;

/** Bright hub on the near face, below the claim. */
export const HERO_HUB_ANCHOR = { x: 0, y: 0.667, z: 0.745 };

/**
 * Points on the upper cap. A full Fibonacci sphere wastes most points below
 * the fold at hero scale, so the face is sampled densely enough to read as a body.
 */
export function heroCap(count: number): SpherePoint[] {
  const safe = Math.max(0, Math.floor(count));
  const cap = fibSphere(Math.max(safe * 4, safe)).filter((point) => point.y > 0.08);
  return cap.slice(0, safe);
}

/** Deterministic starfield. Two sizes. No Math.random. */
export function starField(count: number): StarPoint[] {
  const out: StarPoint[] = [];
  const safe = Math.max(0, Math.floor(count));
  for (let i = 0; i < safe; i += 1) {
    out.push({
      u: (i * 0.61803398875) % 1,
      v: ((i * 0.38196601125) % 1) * 0.78,
      size: i % 5 === 0 ? 1.7 : 0.85,
      alpha: 0.28 + (i % 7) * 0.08,
    });
  }
  return out;
}
