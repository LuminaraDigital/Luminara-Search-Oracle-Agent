/**
 * One signed-in boot request. Workspace pull and quota read the same promise
 * instead of each calling the Worker.
 */
import { readCachedFirebaseIdToken } from './firebaseIdToken';

export type AccountBoot = {
  ok: true;
  accountId: string;
  workspace: { updatedAt: number; payload: { storage?: Record<string, string>; keys?: Record<string, string> } };
  quota: {
    limit: number;
    used: number;
    remaining: number;
    resetSec: number;
    isUnlimited: boolean;
    plan?: string;
    expiresAt?: number;
    bonusRemaining?: number;
  };
};

const BOOT_REUSE_MS = 2000;
let pending: Promise<AccountBoot | null> | null = null;
let pendingToken: string | null = null;
let last: { token: string; at: number; body: AccountBoot } | null = null;

export function resetAccountBoot(): void {
  pending = null;
  pendingToken = null;
  last = null;
}

function isBoot(value: unknown): value is AccountBoot {
  if (!value || typeof value !== 'object') return false;
  const body = value as { ok?: unknown; accountId?: unknown; workspace?: { updatedAt?: unknown }; quota?: { limit?: unknown } };
  return body.ok === true
    && typeof body.accountId === 'string'
    && !!body.workspace
    && typeof body.workspace.updatedAt === 'number'
    && !!body.quota
    && typeof body.quota.limit === 'number';
}

async function fetchBoot(token: string): Promise<AccountBoot | null> {
  if (typeof window === 'undefined' || !window.location?.origin) return null;
  try {
    const res = await fetch(`${window.location.origin}/api/boot`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isBoot(data) ? data : null;
  } catch {
    return null;
  }
}

/** Starts GET /api/boot. A second call for the same token shares the first request. */
export function startAccountBoot(token: string): Promise<AccountBoot | null> {
  if (!token) return Promise.resolve(null);
  if (pending && pendingToken === token) return pending;
  pendingToken = token;
  const run = fetchBoot(token).then((body) => {
    if (body) last = { token, at: Date.now(), body };
    return body;
  });
  pending = run;
  void run.finally(() => {
    if (pending === run) {
      pending = null;
      pendingToken = null;
    }
  });
  return run;
}

/** In-flight boot, or the one that finished in the last two seconds. */
export function takeAccountBoot(): Promise<AccountBoot | null> {
  if (pending) return pending;
  const token = readCachedFirebaseIdToken();
  if (last && token && last.token === token && Date.now() - last.at < BOOT_REUSE_MS) {
    return Promise.resolve(last.body);
  }
  return Promise.resolve(null);
}
