import { vi } from 'vitest';
import { fetchQuotaStatus, setAccountSignedIn } from '../../services/apiClient';
import { startAccountBoot, type AccountBoot } from '../../services/auth/accountBoot';
import { writeCachedFirebaseIdToken } from '../../services/auth/firebaseIdToken';

/** An active paid plan as GET /api/boot reports it. */
export function paidBootQuota(plan: string, expiresAt: number): AccountBoot['quota'] {
  return { limit: -1, used: 0, remaining: -1, resetSec: 3600, isUnlimited: true, plan, expiresAt };
}

/** Signs in the way the app does: the boot request answers, then the quota read takes it. */
export async function signInWithBootQuota(quota: AccountBoot['quota']): Promise<void> {
  const token = `boot-token-${quota.plan}`;
  vi.stubGlobal('window', { location: { origin: 'https://luminarasuite.com' } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    ok: true,
    accountId: 'fb:boot',
    workspace: { updatedAt: 1, payload: {} },
    quota,
  }), { status: 200, headers: { 'content-type': 'application/json' } })));
  writeCachedFirebaseIdToken(token);
  setAccountSignedIn(true);
  startAccountBoot(token);
  await fetchQuotaStatus();
}
