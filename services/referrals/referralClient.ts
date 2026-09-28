/**
 * Signed-in referral and mission calls. Payloads never include SEO percentages.
 */

import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import type { HonestMeasurementStatus, MissionKey, VisibilityLevel } from './rules';
import { clearPendingReferral, readPendingReferral } from './pendingReferral';

export interface ReferralMission {
  key: string;
  title: string;
  detail: string;
  status: 'open' | 'completed';
  clientCompletable: boolean;
}

export interface ReferralProfile {
  ok: true;
  code: string;
  startParam: string;
  inviteUrl: string;
  bonusRemaining: number;
  creditsPerSide: number;
  progression: {
    visibilityLevel: VisibilityLevel;
    label: string;
    streakWeeks: number;
    honestScoutCount: number;
  };
  missions: ReferralMission[];
}

const CLEAR_PENDING_STATUSES = new Set(['attributed', 'already', 'self', 'invalid', 'already_other']);

/**
 * Drop the stored invite only after a final claim result.
 * 401/403 means auth is not ready. 429, 503, and 5xx can be retried.
 * Any other body without a known status stays pending.
 */
export function shouldClearPendingClaim(httpStatus: number, bodyStatus: unknown): boolean {
  if (httpStatus === 401 || httpStatus === 403) return false;
  if (httpStatus === 429 || httpStatus === 503 || httpStatus >= 500) return false;
  return typeof bodyStatus === 'string' && CLEAR_PENDING_STATUSES.has(bodyStatus);
}

export async function claimStoredReferral(): Promise<void> {
  const code = readPendingReferral();
  if (!code) return;
  const base = apiBase();
  if (!base) return;
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/referrals/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = (await res.json().catch(() => null)) as { status?: unknown } | null;
    if (!data) return;
    if (shouldClearPendingClaim(res.status, data.status)) clearPendingReferral();
  } catch {
    /* keep the code for the next signed-in load */
  }
}

export async function fetchReferralProfile(): Promise<{ ok: true; profile: ReferralProfile } | { ok: false; error: string }> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable' };
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/referrals/me`);
    const data = (await res.json().catch(() => ({}))) as ReferralProfile & { error?: string };
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, profile: data };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function qualifyHonestScout(input: {
  domain: string;
  measurementStatus: HonestMeasurementStatus;
  completed: true;
  evidencePresent: boolean;
}): Promise<{ rewardsGranted: boolean }> {
  const base = apiBase();
  if (!base) return { rewardsGranted: false };
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/referrals/qualify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        domain: input.domain,
        measurementStatus: input.measurementStatus,
        completed: true,
        evidencePresent: input.evidencePresent,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { rewardsGranted?: boolean };
    return { rewardsGranted: Boolean(data.rewardsGranted) };
  } catch {
    return { rewardsGranted: false };
  }
}

export async function completeWeeklyMission(missionKey: MissionKey): Promise<{ ok: boolean; error?: string }> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable' };
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/missions/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ missionKey }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
