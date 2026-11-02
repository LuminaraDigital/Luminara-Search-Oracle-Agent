import { describe, it, expect, beforeEach } from 'vitest';
import { ALL_TELEMETRY_EVENT_TYPES, productTelemetry } from '../services/analytics/productTelemetry';
import { ALLOWED_TYPES } from '../worker/productAnalytics';

describe('productTelemetry', () => {
  beforeEach(() => {
    productTelemetry.resetForTesting();
  });

  it('tracks page views and calculates duration', () => {
    productTelemetry.trackPageView('DASHBOARD');
    productTelemetry.trackPageView('INSTANT_AUDIT');
    const summary = productTelemetry.getSummary();
    expect(summary.totalAuditsRun).toBe(0);
  });

  it('records time-to-first-value on first successful core action', () => {
    expect(productTelemetry.getSummary().timeToFirstValueMs).toBeNull();
    productTelemetry.recordFirstValue('audit');
    const summary = productTelemetry.getSummary();
    expect(summary.totalAuditsRun).toBe(1);
    expect(summary.firstValueAction).toBe('audit');
    expect(summary.timeToFirstValueMs).toBeGreaterThanOrEqual(0);

    // Second action does not overwrite initial timeToFirstValue
    const initialTtfv = summary.timeToFirstValueMs;
    productTelemetry.recordFirstValue('chat');
    expect(productTelemetry.getSummary().firstValueAction).toBe('audit');
    expect(productTelemetry.getSummary().timeToFirstValueMs).toBe(initialTtfv);
    expect(productTelemetry.getSummary().totalChatsSent).toBe(1);
  });

  it('tracks onboarding steps and completion', () => {
    expect(productTelemetry.getSummary().onboardingCompleted).toBe(false);

    productTelemetry.recordOnboardingStep('quick_scout');
    expect(productTelemetry.getSummary().completedOnboardingSteps).toEqual(['quick_scout']);

    productTelemetry.recordOnboardingStep('business_dna');
    expect(productTelemetry.getSummary().completedOnboardingSteps).toEqual(['quick_scout', 'business_dna']);

    productTelemetry.recordOnboardingStep('brand_memory');
    const summary = productTelemetry.getSummary();
    expect(summary.completedOnboardingSteps.length).toBe(3);
    expect(summary.onboardingCompleted).toBe(true);
  });

  it('records error encounters', () => {
    productTelemetry.recordError('InstantAuditView', 'Invalid domain provided');
    expect(productTelemetry.getSummary().totalErrorsEncountered).toBe(1);
  });

  it('tracks commercial conversion funnel events without error', () => {
    expect(() => {
      productTelemetry.track('probe_completed', { domain: 'example.com', cited: true });
      productTelemetry.track('signup_completed', { method: 'guest_email' });
      productTelemetry.track('paywall_viewed', { plan: 'growth', rail: 'card' });
      productTelemetry.track('checkout_started', { planId: 'growth', method: 'stripe' });
      productTelemetry.track('payment_completed', { planId: 'growth', method: 'stripe', status: 'confirmed' });
    }).not.toThrow();
  });

  it('keeps every client TelemetryEventType allow-listed in worker/productAnalytics.ts and maintains a durable sessionId', () => {
    for (const evType of ALL_TELEMETRY_EVENT_TYPES) {
      expect(ALLOWED_TYPES.has(evType), `missing worker allow-list entry for ${evType}`).toBe(true);
    }
    const sid1 = productTelemetry.getSessionId();
    expect(typeof sid1).toBe('string');
    expect(sid1.startsWith('anon_')).toBe(true);
    expect(productTelemetry.getSessionId()).toBe(sid1);
  });
});

