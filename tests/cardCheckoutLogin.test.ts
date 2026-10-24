import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccountSignedIn } from '../services/apiClient';
import type { AppAuthState } from '../services/auth/useAppAuth';

const { redirectToCardCheckout } = vi.hoisted(() => ({
  redirectToCardCheckout: vi.fn(),
}));

vi.mock('../components/paywall/cardCheckout', () => ({
  redirectToCardCheckout,
}));

import {
  CARD_CHECKOUT_ACCOUNT_LINE,
  applyLoginDetail,
  beginCardCheckout,
  openCardCheckoutLogin,
  readPendingCardCheckout,
  resumePendingCardCheckout,
} from '../components/paywall/pendingCardCheckout';

const events: Array<{ type: string; detail: unknown }> = [];

function memoryStore(): Storage {
  const bag = new Map<string, string>();
  return {
    getItem: (key) => bag.get(key) ?? null,
    setItem: (key, value) => { bag.set(key, value); },
    removeItem: (key) => { bag.delete(key); },
    clear: () => { bag.clear(); },
    key: () => null,
    get length() { return bag.size; },
  };
}

afterEach(() => {
  events.length = 0;
  redirectToCardCheckout.mockReset();
  setAccountSignedIn(null);
  vi.unstubAllGlobals();
});

function installBrowser(): void {
  vi.stubGlobal('sessionStorage', memoryStore());
  vi.stubGlobal('window', {
    dispatchEvent: (event: CustomEvent) => {
      events.push({ type: event.type, detail: event.detail });
      return true;
    },
  });
}

describe('card checkout from a signed-out buyer', () => {
  it('opens the signup wall with the plan, and does not call Stripe', async () => {
    installBrowser();
    setAccountSignedIn(false);
    const result = await beginCardCheckout('starter');
    expect(result).toEqual({ ok: false, needsAccount: true });
    expect(events).toEqual([{
      type: 'luminara-open-login',
      detail: { mode: 'signup', resumeCheckoutPlanId: 'starter' },
    }]);
    expect(readPendingCardCheckout()).toBe('starter');
    expect(redirectToCardCheckout.mock.calls).toEqual([]);
  });

  it('opens signup again when Stripe says the buyer must sign in', async () => {
    installBrowser();
    setAccountSignedIn(true);
    redirectToCardCheckout.mockResolvedValue({ ok: false, error: 'Sign in to pay by card.' });
    const result = await beginCardCheckout('growth');
    expect(result).toEqual({ ok: false, needsAccount: true });
    expect(events[0]?.detail).toEqual({ mode: 'signup', resumeCheckoutPlanId: 'growth' });
    expect(redirectToCardCheckout.mock.calls).toEqual([['growth']]);
  });

  it('resumes the saved plan once after auth, then drops it', async () => {
    installBrowser();
    redirectToCardCheckout.mockResolvedValue({ ok: true });
    openCardCheckoutLogin('growth');
    const [first, second] = await Promise.all([
      resumePendingCardCheckout(),
      resumePendingCardCheckout(),
    ]);
    expect(first).toEqual({ ran: true, ok: true });
    expect(second).toEqual({ ran: true, ok: true });
    expect(redirectToCardCheckout.mock.calls).toEqual([['growth']]);
    expect(readPendingCardCheckout()).toBeNull();
    expect(await resumePendingCardCheckout()).toEqual({ ran: false });
    expect(redirectToCardCheckout.mock.calls).toEqual([['growth']]);
  });

  it('drops the plan when checkout fails, and does not try again', async () => {
    installBrowser();
    redirectToCardCheckout.mockResolvedValue({ ok: false, error: 'Stripe is down.' });
    openCardCheckoutLogin('agency');
    expect(await resumePendingCardCheckout()).toEqual({ ran: true, ok: false, error: 'Stripe is down.' });
    expect(readPendingCardCheckout()).toBeNull();
    expect(await resumePendingCardCheckout()).toEqual({ ran: false });
    expect(redirectToCardCheckout.mock.calls).toEqual([['agency']]);
  });

  it('clears a pending plan when the wall opens for anything other than checkout', () => {
    installBrowser();
    openCardCheckoutLogin('starter');
    expect(applyLoginDetail({ mode: 'signin' })).toBe('signin');
    expect(readPendingCardCheckout()).toBeNull();
    expect(applyLoginDetail({ mode: 'signup', resumeCheckoutPlanId: 'agency' })).toBe('signup');
    expect(readPendingCardCheckout()).toBe('agency');
  });
});

describe('checkout login copy', () => {
  const auth: AppAuthState = {
    loading: false,
    authenticated: false,
    source: null,
    label: null,
    reason: null,
  };

  async function html(props: { initialMode?: 'signin' | 'signup'; forCardCheckout?: boolean }): Promise<string> {
    const { AuthRequiredScreen } = await import('../components/auth/AuthRequiredScreen');
    return renderToStaticMarkup(createElement(AuthRequiredScreen, { auth, isModal: true, ...props }));
  }

  it('asks a first-time card buyer to create a free account', async () => {
    const markup = await html({ initialMode: 'signup', forCardCheckout: true });
    expect(markup).toContain('Create your free account');
    expect(markup).toContain(CARD_CHECKOUT_ACCOUNT_LINE);
    expect(markup).not.toContain('Welcome back');
    expect(markup).not.toContain('No card needed');
  });

  it('keeps Welcome back off the card path when the buyer switches to sign in', async () => {
    const markup = await html({ initialMode: 'signin', forCardCheckout: true });
    expect(markup).toContain('Sign in to pay by card');
    expect(markup).toContain(CARD_CHECKOUT_ACCOUNT_LINE);
    expect(markup).not.toContain('Welcome back');
  });

  it('still welcomes a returning visitor who did not come from Pay by card', async () => {
    const markup = await html({ initialMode: 'signin' });
    expect(markup).toContain('Welcome back');
    expect(markup).not.toContain(CARD_CHECKOUT_ACCOUNT_LINE);
    expect(markup).toContain('Live answers from specific AI products stay Not measured');
    expect(markup).not.toMatch(/ChatGPT|Perplexity|DataForSEO/);
    expect(markup).not.toMatch(/ \./);
  });
});

describe('pricing and the paywall share the signup checkout', () => {
  it('starts Pay by card through beginCardCheckout', () => {
    const pricing = readFileSync(resolve(__dirname, '../components/PricingPage.tsx'), 'utf8');
    const paywall = readFileSync(resolve(__dirname, '../components/paywall/PaywallModal.tsx'), 'utf8');
    const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
    expect(pricing).toContain('beginCardCheckout(planId)');
    expect(pricing).not.toContain("mode: 'signin'");
    expect(paywall).toContain('beginCardCheckout(planId)');
    expect(paywall).not.toContain('redirectToCardCheckout');
    expect(app).toContain('resumePendingCardCheckout()');
    expect(app).toContain('forCardCheckout={readPendingCardCheckout() !== null}');
  });
});
