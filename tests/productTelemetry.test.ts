import { describe, it, expect, beforeEach } from 'vitest';
import { productTelemetry } from '../services/analytics/productTelemetry';

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
});
