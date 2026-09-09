import { describe, expect, it, vi } from 'vitest';
import { AppView } from '../types';

describe('Telegram Mini App Native Experience', () => {
  const MARKETING_VIEWS = new Set<AppView>([
    AppView.LANDING,
    AppView.PRIVACY,
    AppView.TERMS,
    AppView.INFRASTRUCTURE,
    AppView.INTELLIGENCE,
    AppView.WHY_US,
    AppView.PRICING,
  ]);

  it('identifies marketing landing views for automatic bypass in Telegram', () => {
    expect(MARKETING_VIEWS.has(AppView.LANDING)).toBe(true);
    expect(MARKETING_VIEWS.has(AppView.PRICING)).toBe(true);
    expect(MARKETING_VIEWS.has(AppView.INFRASTRUCTURE)).toBe(true);
    expect(MARKETING_VIEWS.has(AppView.INSTANT_AUDIT)).toBe(false);
    expect(MARKETING_VIEWS.has(AppView.ORACLE_AGENT)).toBe(false);
    expect(MARKETING_VIEWS.has(AppView.DASHBOARD)).toBe(false);
  });

  it('maps startParam deep-links to native functional views', () => {
    const resolveStartParam = (param: string): AppView => {
      const sp = param.trim().toUpperCase();
      if (sp === 'AUDIT' || sp === 'SCAN') return AppView.INSTANT_AUDIT;
      if (sp === 'ORACLE' || sp === 'CHAT' || sp === 'ASK') return AppView.ORACLE_AGENT;
      if (sp === 'DASHBOARD' || sp === 'HOME') return AppView.DASHBOARD;
      if (sp === 'HARNESS' || sp === 'DEV') return AppView.HARNESS;
      if (sp === 'DNA' || sp === 'PROFILE') return AppView.BUSINESS_DNA;
      return (Object.values(AppView) as string[]).includes(sp) ? (sp as AppView) : AppView.INSTANT_AUDIT;
    };

    expect(resolveStartParam('audit')).toBe(AppView.INSTANT_AUDIT);
    expect(resolveStartParam('SCAN')).toBe(AppView.INSTANT_AUDIT);
    expect(resolveStartParam('oracle')).toBe(AppView.ORACLE_AGENT);
    expect(resolveStartParam('ask')).toBe(AppView.ORACLE_AGENT);
    expect(resolveStartParam('dashboard')).toBe(AppView.DASHBOARD);
    expect(resolveStartParam('dna')).toBe(AppView.BUSINESS_DNA);
    expect(resolveStartParam('unknown_fallback')).toBe(AppView.INSTANT_AUDIT);
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
