/**
 * Per-account daily cap kept in this isolate.
 * shortcut: isolate memory, upgrade when Exa or Jev spend needs a durable meter.
 */
import { RateLimiter } from './security';

export const EXA_FREE_DAILY_CAP = 15;
export const JEV_FREE_DAILY_CAP = 6;
const DAY_MS = 86_400_000;

let limiter = new RateLimiter();

export function readDailyCap(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function allowDailyCap(bucket: string, account: string, limit: number, now = Date.now()): boolean {
  if (limit <= 0) return false;
  const day = new Date(now).toISOString().slice(0, 10);
  return limiter.check(`${bucket}:${account}:${day}`, limit, DAY_MS).allowed;
}

export function resetDailyCapForTests(): void {
  limiter = new RateLimiter();
}
