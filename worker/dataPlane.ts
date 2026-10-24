/**
 * DATA_PLANE flag and the best-effort Firestore mirror.
 * `d1` skips Firestore. `dual` reads and writes D1, then mirrors the write.
 * `firestore` exists behind the flag and is not set in wrangler.
 */
import { scheduleWaitUntil } from './welcomeEmail';
import type { DataPlane, DataPlaneEnv } from './dataPlaneDocs';
import { MIRROR_TIMEOUT_MS } from './dataPlaneDocs';

export type { DataPlane, DataPlaneEnv };
export { MIRROR_TIMEOUT_MS };

export type DataPlaneLog = (line: string) => void;

export type MirrorMeta = {
  op: 'upsert';
  entity: 'user' | 'audit';
  id: string;
};

export type DataPlaneDeps = {
  fetch?: typeof fetch;
  tokenProvider?: { getAccessToken(now?: number): Promise<string> };
  timeoutMs?: number;
  log?: DataPlaneLog;
  /** Firestore query page size for an account erase or link move. Default 100. */
  erasePageSize?: number;
};

const SAFE_VALUE = /^[A-Za-z0-9_.:-]{1,32}$/;

export function readPlane(env: { DATA_PLANE?: string }, log: DataPlaneLog = (line) => console.warn(line)): DataPlane {
  const value = (env.DATA_PLANE ?? '').trim();
  if (value === '' || value === 'd1') return 'd1';
  if (value === 'dual' || value === 'firestore') return value;
  const shown = SAFE_VALUE.test(value) ? { value } : {};
  log(JSON.stringify({ event: 'data_plane_config', outcome: 'fallback', fallback: 'd1', ...shown }));
  return 'd1';
}

export function logMirror(meta: MirrorMeta, outcome: 'ok' | 'error' | 'timeout' | 'unconfigured', latencyMs: number, log: DataPlaneLog): void {
  log(JSON.stringify({
    event: 'data_plane_mirror',
    op: meta.op,
    entity: meta.entity,
    id: meta.id,
    outcome,
    latency_ms: latencyMs,
  }));
}

export async function runBestEffort(
  meta: MirrorMeta,
  timeoutMs: number,
  log: DataPlaneLog,
  run: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let outcome: 'ok' | 'error' | 'timeout' = 'ok';
  try {
    await run(ac.signal);
  } catch {
    outcome = ac.signal.aborted ? 'timeout' : 'error';
  } finally {
    clearTimeout(timer);
  }
  logMirror(meta, outcome, Date.now() - started, log);
}

/** Schedules the mirror on the request `waitUntil` scope. The promise does not reject. */
export function scheduleMirror(
  meta: MirrorMeta,
  timeoutMs: number,
  log: DataPlaneLog,
  run: (signal: AbortSignal) => Promise<void>,
): void {
  scheduleWaitUntil(runBestEffort(meta, timeoutMs, log, run));
}

export function mirrorTimeout(deps?: DataPlaneDeps): number {
  return deps?.timeoutMs ?? MIRROR_TIMEOUT_MS;
}

export function mirrorLog(deps?: DataPlaneDeps): DataPlaneLog {
  return deps?.log ?? ((line) => console.warn(line));
}

export class DataPlaneConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataPlaneConfigError';
  }
}
