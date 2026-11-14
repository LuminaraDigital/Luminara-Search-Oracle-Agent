/**
 * State for the gold cursor trail: a short ribbon of recent pointer positions plus the
 * square sparks it sheds. Pure, so CursorTrail only has to listen and draw.
 */

export interface TrailPoint {
  x: number;
  y: number;
  born: number;
}

export interface Spark {
  x: number;
  y: number;
  /** Drift in px per second. */
  vx: number;
  vy: number;
  size: number;
  born: number;
  life: number;
}

export interface TrailState {
  points: TrailPoint[];
  sparks: Spark[];
  /** Distance travelled since the last spark. */
  carry: number;
}

export const POINT_LIFE_MS = 420;
export const MAX_SPARKS = 70;
const SPARK_SPACING_PX = 16;
/** A longer hop is the pointer re-entering the window, not a stroke to draw. */
const JUMP_PX = 320;

export function createTrail(): TrailState {
  return { points: [], sparks: [], carry: 0 };
}

export function addPoint(
  state: TrailState,
  x: number,
  y: number,
  now: number,
  random: () => number = Math.random,
): void {
  const last = state.points[state.points.length - 1];
  const point = { x, y, born: now };
  if (!last) {
    state.points.push(point);
    return;
  }
  const dx = x - last.x;
  const dy = y - last.y;
  const dist = Math.hypot(dx, dy);
  if (dist > JUMP_PX) {
    state.points = [point];
    return;
  }
  state.points.push(point);
  if (dist === 0) return;

  state.carry += dist;
  while (state.carry >= SPARK_SPACING_PX && state.sparks.length < MAX_SPARKS) {
    state.carry -= SPARK_SPACING_PX;
    const along = random();
    state.sparks.push({
      x: last.x + dx * along + (random() - 0.5) * 14,
      y: last.y + dy * along + (random() - 0.5) * 14,
      // Sparks fall behind the stroke and scatter a little.
      vx: (-dx / dist) * 24 + (random() - 0.5) * 36,
      vy: (-dy / dist) * 24 + (random() - 0.5) * 36,
      size: 2 + random() * 2.5,
      born: now,
      life: 450 + random() * 450,
    });
  }
  state.carry = Math.min(state.carry, SPARK_SPACING_PX);
}

/** Drops what has faded. Returns whether anything is left to draw. */
export function prune(state: TrailState, now: number): boolean {
  state.points = state.points.filter((p) => now - p.born < POINT_LIFE_MS);
  state.sparks = state.sparks.filter((s) => now - s.born < s.life);
  return state.points.length > 0 || state.sparks.length > 0;
}
