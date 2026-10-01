import { describe, expect, it } from 'vitest';
import { viewAfterSignIn } from '../services/activation/postSignInView';
import { AppView } from '../types';

describe('viewAfterSignIn', () => {
  it('returns to Instant Audit when the Probe handed off a domain', () => {
    expect(viewAfterSignIn('examplebakery.com', AppView.LANDING)).toBe(AppView.INSTANT_AUDIT);
    expect(viewAfterSignIn('examplebakery.com', AppView.PRICING)).toBe(AppView.INSTANT_AUDIT);
  });

  it('stays on Instant Audit when a guest signs in from inside it', () => {
    expect(viewAfterSignIn(null, AppView.INSTANT_AUDIT)).toBe(AppView.INSTANT_AUDIT);
  });

  it('goes to the dashboard for a plain sign-in from a marketing page', () => {
    expect(viewAfterSignIn(null, AppView.LANDING)).toBe(AppView.DASHBOARD);
    expect(viewAfterSignIn(undefined, AppView.PRICING)).toBe(AppView.DASHBOARD);
    expect(viewAfterSignIn('', AppView.WHY_US)).toBe(AppView.DASHBOARD);
  });
});
