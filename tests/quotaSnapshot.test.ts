import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentQuotaSync, setAccountSignedIn, updateQuotaFromHeaders } from '../services/apiClient';
import { resetAccountBoot } from '../services/auth/accountBoot';
import { writeCachedFirebaseIdToken } from '../services/auth/firebaseIdToken';
import { canMintMcpKeys } from '../services/audit/instantAuditHelpers';
import { canCreateShareLinks } from '../services/share/shareReportClient';
import { paidBootQuota, signInWithBootQuota } from './helpers/quotaBoot';

const EXPIRES = Date.now() + 30 * 86_400_000;
const UNLIMITED = new Headers({ 'x-quota-limit': 'unlimited', 'x-quota-remaining': 'unlimited' });

afterEach(() => {
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
