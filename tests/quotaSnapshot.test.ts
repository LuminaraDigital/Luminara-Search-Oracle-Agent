import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentQuotaSync, hostedAllowanceSpent, setAccountSignedIn, updateQuotaFromHeaders } from '../services/apiClient';
import { resetAccountBoot } from '../services/auth/accountBoot';
import { writeCachedFirebaseIdToken } from '../services/auth/firebaseIdToken';
import { canMintMcpKeys } from '../services/audit/instantAuditHelpers';
import { canCreateShareLinks } from '../services/share/shareReportClient';
import { paidBootQuota, signInWithBootQuota } from './helpers/quotaBoot';

const EXPIRES = Date.now() + 30 * 86_400_000;
const UNLIMITED = new Headers({ 'x-quota-limit': 'unlimited', 'x-quota-remaining': 'unlimited' });

afterEach(() => {
  vi.useRealTimers();
  setAccountSignedIn(null);
  resetAccountBoot();
  writeCachedFirebaseIdToken(null);
  vi.unstubAllGlobals();
});

describe('quota snapshot after an audit call', () => {
  it('keeps an Agency plan and its expiry when the call answers with unlimited headers', async () => {
    await signInWithBootQuota(paidBootQuota('agency', EXPIRES));
    updateQuotaFromHeaders(UNLIMITED);
    expect(getCurrentQuotaSync()).toMatchObject({ plan: 'agency', expiresAt: EXPIRES, isUnlimited: true });
    expect(canCreateShareLinks()).toBe(true);
    expect(canMintMcpKeys()).toBe(true);
  });

  it('keeps a Starter plan, so MCP keys stay closed', async () => {
    await signInWithBootQuota(paidBootQuota('starter', EXPIRES));
    updateQuotaFromHeaders(UNLIMITED);
    expect(getCurrentQuotaSync()).toMatchObject({ plan: 'starter', expiresAt: EXPIRES });
    expect(canMintMcpKeys()).toBe(false);
  });

  it('turns a Growth plan into free once the headers are limited', async () => {
    await signInWithBootQuota(paidBootQuota('growth', EXPIRES));
    updateQuotaFromHeaders(UNLIMITED);
    expect(getCurrentQuotaSync()?.plan).toBe('growth');

    updateQuotaFromHeaders(new Headers({ 'x-quota-limit': '3', 'x-quota-remaining': '3', 'x-quota-reset': '600' }));
    expect(getCurrentQuotaSync()).toMatchObject({ plan: 'free', expiresAt: undefined, isUnlimited: false, remaining: 3 });
    expect(canCreateShareLinks()).toBe(false);
  });
});

describe('hosted allowance gate', () => {
  const SPENT = new Headers({ 'x-quota-limit': '3', 'x-quota-remaining': '0', 'x-quota-reset': '600' });

  function signedInBrowser(stored: Record<string, string> = {}) {
    vi.stubGlobal('window', { location: { origin: 'https://luminarasuite.com' } });
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored[key] ?? null });
  }

  function spentNow(): boolean {
    const quota = getCurrentQuotaSync();
    if (!quota) throw new Error('no quota snapshot');
    return hostedAllowanceSpent(quota);
  }

  it('is spent at 3 of 3 with no bonus, and not while one is left', () => {
    signedInBrowser();
    updateQuotaFromHeaders(SPENT);
    expect(spentNow()).toBe(true);
    updateQuotaFromHeaders(new Headers({ 'x-quota-limit': '3', 'x-quota-remaining': '1', 'x-quota-reset': '600' }));
    expect(spentNow()).toBe(false);
  });

  it('does not block a user who has their own Groq key', () => {
    signedInBrowser({ luminara_groq_key: 'gsk_own_key' });
    updateQuotaFromHeaders(SPENT);
    expect(spentNow()).toBe(false);
  });

  it('opens again once the daily reset has passed', () => {
    vi.useFakeTimers({ now: new Date('2026-10-25T23:50:00Z'), toFake: ['Date'] });
    signedInBrowser();
    updateQuotaFromHeaders(SPENT);
    expect(spentNow()).toBe(true);
    vi.setSystemTime(new Date('2026-10-26T00:00:01Z'));
    expect(spentNow()).toBe(false);
  });
});
