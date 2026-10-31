import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { productTelemetry } from '../services/analytics/productTelemetry';
import { pickFirstTouch, readTouch } from '../services/analytics/firstTouch';
import { ingestProductAnalytics } from '../worker/productAnalytics';
import { billingId } from '../worker/workerUtils';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';

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
});

describe('first touch attribution', () => {
  const SITE = 'https://www.luminarasuite.com';

  it('takes utm tags over the referrer', () => {
    const touch = readTouch(`${SITE}/?utm_source=linkedin&utm_medium=paid&utm_campaign=nov-teardown`, 'https://www.google.com/', 5);
    expect(touch).toEqual({ source: 'linkedin', medium: 'paid', campaign: 'nov-teardown', landingPath: '/', at: 5 });
  });

  it('falls back to the referring host, and treats its own site as direct', () => {
    expect(readTouch(`${SITE}/pricing`, 'https://www.eliteagent.com/some/article?id=9').source).toBe('eliteagent.com');
    expect(readTouch(`${SITE}/pricing`, 'https://luminarasuite.com/').source).toBe('direct');
    expect(readTouch(`${SITE}/pricing`, '').source).toBe('direct');
  });

  it('ignores sign-in, checkout, and staging redirects', () => {
    for (const ref of [
      'https://checkout.stripe.com/c/pay/cs_test_1',
      'https://luminara-suite.firebaseapp.com/__/auth/handler',
      'https://accounts.google.com/',
      'https://staging.luminarasuite.com/',
    ]) {
      expect(readTouch(`${SITE}/`, ref).source).toBe('direct');
    }
  });

  it('keeps share tokens out of the landing path', () => {
    expect(readTouch(`${SITE}/share/abc123secret`, '').landingPath).toBe('/share');
    expect(readTouch(`${SITE}/check/example.com.au`, '').landingPath).toBe('/check/example.com.au');
    expect(readTouch(`${SITE}/free-tools/llms-txt`, '').landingPath).toBe('/free-tools/llms-txt');
  });

  it('caps tag length', () => {
    expect(readTouch(`${SITE}/?utm_source=${'x'.repeat(300)}`, '').source).toHaveLength(100);
  });

  it('keeps the first non-direct touch', () => {
    const direct = readTouch(`${SITE}/`, '', 1);
    const partner = readTouch(`${SITE}/?utm_source=partner-a`, '', 2);
    const ads = readTouch(`${SITE}/?utm_source=meta`, '', 3);
    expect(pickFirstTouch(null, direct)).toBe(direct);
    expect(pickFirstTouch(direct, partner)).toBe(partner);
    expect(pickFirstTouch(partner, ads)).toBe(partner);
    expect(pickFirstTouch(partner, direct)).toBe(partner);
  });

  describe('on tracked events', () => {
    const store = new Map<string, string>();
    const localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const stored = () => JSON.parse(store.get('luminara_telemetry_events') ?? '[]');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal('window', { localStorage });
      store.clear();
      store.set('luminara_first_touch', JSON.stringify(readTouch(`${SITE}/?utm_source=partner-a`, '', 7)));
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('attaches the first touch to signups and free checks only', () => {
      productTelemetry.track('signup_completed', { method: 'email' });
      productTelemetry.track('probe_completed', { surface: 'landing_inline' });
      productTelemetry.track('page_view', { view: 'PRICING' });
      const [signup, probe, view] = stored();
      expect(signup.data).toEqual({ method: 'email', firstTouch: expect.objectContaining({ source: 'partner-a' }) });
      expect(probe.data.firstTouch.source).toBe('partner-a');
      expect(view.data.firstTouch).toBeUndefined();
    });

    it('drops a malformed stored touch instead of attaching it', () => {
      store.set('luminara_first_touch', JSON.stringify({ campaign: 'old-shape' }));
      productTelemetry.track('signup_completed', { method: 'google' });
      expect(stored()[0].data).toEqual({ method: 'google' });
    });

    it('sends a signup straight away but leaves other events on the timer', async () => {
      const flush = vi.spyOn(productTelemetry, 'flushToServer').mockResolvedValue();
      productTelemetry.track('probe_completed', { surface: 'landing_inline' });
      expect(flush).not.toHaveBeenCalled();
      productTelemetry.track('signup_completed', { method: 'email' });
      expect(flush).toHaveBeenCalledTimes(1);
      flush.mockRestore();
    });
  });

  describe('on the Worker ingest', () => {
    function fakeDb() {
      const rows: unknown[][] = [];
      const prepare = () => ({
        bind: (...values: unknown[]) => ({
          run: async () => {
            rows.push(values);
            return { success: true };
          },
        }),
      });
      return { rows, env: { DB: { prepare } } as unknown as Env };
    }
    const post = (data: unknown) =>
      new Request('https://api.test/api/analytics/events', {
        method: 'POST',
        body: JSON.stringify({ sessionId: 's1', events: [{ type: 'signup_completed', data }] }),
      });
    const firstTouch = readTouch(`${SITE}/share/abc123?utm_source=partner-a`, '', 7);

    it('stores the first touch under the signed-in account', async () => {
      const { rows, env } = fakeDb();
      const user = { uid: 'u1', source: 'firebase' } as unknown as HostedIdentity;
      const res = await ingestProductAnalytics(post({ method: 'email', firstTouch }), env, user);
      expect(await res.json()).toEqual({ ok: true, inserted: 1 });
      const [, accountId, sessionId, type, , payload] = rows[0];
      expect(accountId).toBe(billingId(user));
      expect([sessionId, type]).toEqual(['s1', 'signup_completed']);
      expect(JSON.parse(payload as string).firstTouch).toMatchObject({ source: 'partner-a', landingPath: '/share' });
    });

    it('keeps an anonymous free check with no account', async () => {
      const { rows, env } = fakeDb();
      await ingestProductAnalytics(post({ firstTouch }), env, null);
      expect(rows[0][1]).toBeNull();
    });
  });
});

