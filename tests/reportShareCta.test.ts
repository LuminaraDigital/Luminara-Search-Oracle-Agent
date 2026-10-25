import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportDisplay } from '../components/audit/ReportDisplay';
import { setAccountSignedIn, updateQuotaFromHeaders } from '../services/apiClient';
import { resetAccountBoot } from '../services/auth/accountBoot';
import { writeCachedFirebaseIdToken } from '../services/auth/firebaseIdToken';
import { canCreateShareLinks } from '../services/share/shareReportClient';
import { paidBootQuota, signInWithBootQuota } from './helpers/quotaBoot';

const FREE_WIN = 'A measured win can be shared on the free plan.';
const UNLIMITED = new Headers({ 'x-quota-limit': 'unlimited', 'x-quota-remaining': 'unlimited' });
const EXPIRES = Date.now() + 30 * 86_400_000;

function reportHtml(): string {
  return renderToStaticMarkup(createElement(ReportDisplay, {
    markdownText: '# Report\n\nA page.',
    targetDomain: 'luminara.digital',
  }));
}

afterEach(() => {
  setAccountSignedIn(null);
  resetAccountBoot();
  writeCachedFirebaseIdToken(null);
  vi.unstubAllGlobals();
});

describe('free share call to action', () => {
  it('keeps the free-win sentence and hides the paywalled copy-share button', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    await signInWithBootQuota({ limit: 3, used: 1, remaining: 2, resetSec: 600, isUnlimited: false, plan: 'free' });
    const free = reportHtml();
    expect(free).toContain(FREE_WIN);
    expect(free).not.toContain('Copy share link');
    expect(canCreateShareLinks()).toBe(false);

    await signInWithBootQuota(paidBootQuota('starter', EXPIRES));
    updateQuotaFromHeaders(UNLIMITED);
    const starter = reportHtml();
    expect(starter).toContain(FREE_WIN);
    expect(starter).not.toContain('Copy share link');
    expect(canCreateShareLinks()).toBe(false);

    // A free account can still receive an unlimited daily-cap header. That is not Growth.
    await signInWithBootQuota({ limit: 3, used: 0, remaining: 3, resetSec: 600, isUnlimited: false, plan: 'free' });
    updateQuotaFromHeaders(UNLIMITED);
    const unlimitedCap = reportHtml();
    expect(unlimitedCap).toContain(FREE_WIN);
    expect(unlimitedCap).not.toContain('Copy share link');
    expect(canCreateShareLinks()).toBe(false);

    await signInWithBootQuota(paidBootQuota('growth', EXPIRES));
    updateQuotaFromHeaders(UNLIMITED);
    const growth = reportHtml();
    expect(growth).toContain(FREE_WIN);
    expect(growth).toContain('Copy share link');
    expect(canCreateShareLinks()).toBe(true);

    await signInWithBootQuota(paidBootQuota('agency', EXPIRES));
    updateQuotaFromHeaders(UNLIMITED);
    expect(reportHtml()).toContain('Copy share link');
    expect(canCreateShareLinks()).toBe(true);
  });
});
