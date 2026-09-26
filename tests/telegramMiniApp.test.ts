import { describe, expect, it, vi } from 'vitest';
import { AppView } from '../types';
import { resolveTelegramStart } from '../services/telegram/startParam';

describe('Telegram Mini App Native Experience', () => {
  const MARKETING_VIEWS = new Set<AppView>([
    AppView.LANDING,
    AppView.INFRASTRUCTURE,
    AppView.INTELLIGENCE,
    AppView.WHY_US,
    AppView.PRICING,
  ]);

  it('identifies marketing landing views for automatic bypass in Telegram, preserving legal pages', () => {
    expect(MARKETING_VIEWS.has(AppView.LANDING)).toBe(true);
    expect(MARKETING_VIEWS.has(AppView.PRICING)).toBe(true);
    expect(MARKETING_VIEWS.has(AppView.INFRASTRUCTURE)).toBe(true);
    expect(MARKETING_VIEWS.has(AppView.PRIVACY)).toBe(false);
    expect(MARKETING_VIEWS.has(AppView.TERMS)).toBe(false);
    expect(MARKETING_VIEWS.has(AppView.INSTANT_AUDIT)).toBe(false);
    expect(MARKETING_VIEWS.has(AppView.ORACLE_AGENT)).toBe(false);
    expect(MARKETING_VIEWS.has(AppView.DASHBOARD)).toBe(false);
  });

  it('maps startParam deep-links to native functional and legal views', () => {
    const resolveStartParam = (param: string): AppView => resolveTelegramStart(param).view;

    expect(resolveStartParam('audit')).toBe(AppView.INSTANT_AUDIT);
    expect(resolveStartParam('SCAN')).toBe(AppView.INSTANT_AUDIT);
    expect(resolveStartParam('oracle')).toBe(AppView.ORACLE_AGENT);
    expect(resolveStartParam('ask')).toBe(AppView.ORACLE_AGENT);
    expect(resolveStartParam('dashboard')).toBe(AppView.DASHBOARD);
    expect(resolveStartParam('dna')).toBe(AppView.BUSINESS_DNA);
    expect(resolveStartParam('privacy')).toBe(AppView.PRIVACY);
    expect(resolveStartParam('PRIVACY_POLICY')).toBe(AppView.PRIVACY);
    expect(resolveStartParam('legal')).toBe(AppView.PRIVACY);
    expect(resolveStartParam('terms')).toBe(AppView.TERMS);
    expect(resolveStartParam('tos')).toBe(AppView.TERMS);
    expect(resolveStartParam('unknown_fallback')).toBe(AppView.INSTANT_AUDIT);
  });

  it('prefills Instant Audit from audit_<domain> without uppercasing the host', () => {
    expect(resolveTelegramStart('audit_stripe.com')).toEqual({
      view: AppView.INSTANT_AUDIT,
      auditUrl: 'stripe.com',
    });
    expect(resolveTelegramStart('audit_https://Stripe.COM/pricing?x=1')).toEqual({
      view: AppView.INSTANT_AUDIT,
      auditUrl: 'stripe.com',
    });
    expect(resolveTelegramStart('scan_shop.example.org')).toEqual({
      view: AppView.INSTANT_AUDIT,
      auditUrl: 'shop.example.org',
    });
    expect(resolveTelegramStart('AUDIT').auditUrl).toBeUndefined();
    expect(resolveTelegramStart('audit_').auditUrl).toBeUndefined();
    expect(resolveTelegramStart('audit_not a domain').auditUrl).toBeUndefined();
  });

  it('recognizes subscription and paywall deep-links to trigger paywall modal', () => {
    const isPaywallTrigger = (param: string): boolean => {
      const sp = param.toLowerCase();
      return ['plan', 'paywall', 'subscribe', 'pro', 'stars'].includes(sp);
    };

    expect(isPaywallTrigger('plan')).toBe(true);
    expect(isPaywallTrigger('stars')).toBe(true);
    expect(isPaywallTrigger('paywall')).toBe(true);
    expect(isPaywallTrigger('pro')).toBe(true);
    expect(isPaywallTrigger('audit')).toBe(false);
  });
});
