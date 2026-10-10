import { describe, expect, it } from 'vitest';
import {
  effectiveTab,
  formatEngineList,
  isFreeEngineConfigured,
  isStripeCheckoutAvailable,
  isTonAvailable,
  paidEngineLabels,
  PREMIUM_ENGINES_FALLBACK,
  railsOffered,
  resolvePaymentOptions,
  TELEGRAM_MINI_APP_URL,
} from '../components/paywall/paymentOptions';

const EMPTY = { ok: false, providers: {} };
const tonOn = { ok: true, ton: true, providers: {} };
const tonOff = { ok: true, ton: false, providers: {} };
const stripeOn = { ok: true, ton: true, stripeCheckout: true, providers: {} };

describe('Stars is the only rail inside Telegram', () => {
  it('offers exactly Stars on a Telegram surface, whatever the server reports', () => {
    for (const health of [tonOn, tonOff, stripeOn, { ok: true, ton: true, jettonCheckout: true, stripeCheckout: true }, null]) {
      const opts = resolvePaymentOptions({ inTelegram: true, health });
      expect(railsOffered(opts)).toEqual(['stars']);
      expect(opts.showTonTab).toBe(false);
      expect(opts.showCardGuidance).toBe(false);
      expect(effectiveTab('ton', opts)).toBe('stars');
      expect(effectiveTab('card', opts)).toBe('stars');
    }
  });

  it('on the web, TON and Card appear only when the server reports them', () => {
    expect(railsOffered(resolvePaymentOptions({ inTelegram: false, health: tonOn }))).toEqual(['stars', 'ton']);
    expect(railsOffered(resolvePaymentOptions({ inTelegram: false, health: stripeOn }))).toEqual(['card', 'stars', 'ton']);
    expect(railsOffered(resolvePaymentOptions({ inTelegram: false, health: tonOff }))).toEqual(['stars']);
    expect(resolvePaymentOptions({ inTelegram: false, health: stripeOn }).showCardGuidance).toBe(false);
  });
});

describe('resolvePaymentOptions', () => {
  it('defaults to Stars inside Telegram regardless of TON or Stripe', () => {
    expect(resolvePaymentOptions({ inTelegram: true, health: tonOn })).toEqual({
      tonAvailable: false,
      starsInline: true,
      cardAvailable: false,
      showTonTab: false,
      showCardGuidance: false,
      defaultTab: 'stars',
    });
    expect(resolvePaymentOptions({ inTelegram: true, health: stripeOn }).cardAvailable).toBe(false);
    expect(resolvePaymentOptions({ inTelegram: true, health: tonOff }).defaultTab).toBe('stars');
  });

  it('defaults to TON on the web when TON is configured and Stripe is not live', () => {
    expect(resolvePaymentOptions({ inTelegram: false, health: tonOn }).defaultTab).toBe('ton');
    const off = resolvePaymentOptions({ inTelegram: false, health: tonOff });
    expect(off).toEqual({
      tonAvailable: false,
      starsInline: false,
      cardAvailable: false,
      showTonTab: true,
      showCardGuidance: true,
      defaultTab: 'stars',
    });
  });

  it('defaults to Card on the web only when stripeCheckout is live', () => {
    const opts = resolvePaymentOptions({ inTelegram: false, health: stripeOn });
    expect(opts.cardAvailable).toBe(true);
    expect(opts.defaultTab).toBe('card');
    expect(isStripeCheckoutAvailable(stripeOn, false)).toBe(true);
    expect(isStripeCheckoutAvailable(stripeOn, true)).toBe(false);
    expect(isStripeCheckoutAvailable(tonOn, false)).toBe(false);
  });

  it('treats unloaded, failed, or legacy health as TON unavailable', () => {
    for (const health of [null, undefined, EMPTY, { ok: true, providers: {} }, { ok: false, ton: true }]) {
      const opts = resolvePaymentOptions({ inTelegram: false, health });
      expect(opts.tonAvailable).toBe(false);
      expect(opts.cardAvailable).toBe(false);
      expect(opts.defaultTab).toBe('stars');
    }
  });

  it('never lets a stale TON or Card selection through when unavailable', () => {
    const off = resolvePaymentOptions({ inTelegram: false, health: tonOff });
    expect(effectiveTab('ton', off)).toBe('stars');
    expect(effectiveTab('card', off)).toBe('stars');
    const on = resolvePaymentOptions({ inTelegram: false, health: tonOn });
    expect(effectiveTab('ton', on)).toBe('ton');
    expect(effectiveTab('card', on)).toBe('ton');
    expect(effectiveTab('stars', on)).toBe('stars');
    const card = resolvePaymentOptions({ inTelegram: false, health: stripeOn });
    expect(effectiveTab('card', card)).toBe('card');
  });

  it('points the web hand-off at the published Mini App link', () => {
    expect(TELEGRAM_MINI_APP_URL).toBe('https://t.me/LuminaraSuiteBot/app');
  });
});

describe('paidEngineLabels', () => {
  it('only promises paid-tier engines whose provider flag is true', () => {
    const health = {
      ok: true,
      providers: { groq: true, nim: true, ollama: true, openrouter: false, gemini: true },
      tiers: { free: ['groq'], paid: ['nim', 'ollama', 'openrouter'] },
    };
    expect(paidEngineLabels(health)).toEqual(['NVIDIA NIM', 'Ollama']);
  });

  it('uses the default paid tier when the server omits tiers', () => {
    expect(paidEngineLabels({ ok: true, providers: { openrouter: true, groq: true } })).toEqual(['OpenRouter']);
  });

  it('returns nothing when health is not loaded', () => {
    expect(paidEngineLabels(null)).toEqual([]);
    expect(paidEngineLabels({ ok: false, providers: { nim: true } })).toEqual([]);
  });

  it('skips paid-tier ids without a friendly label', () => {
    expect(paidEngineLabels({ ok: true, providers: { mystery: true }, tiers: { paid: ['mystery'] } })).toEqual([]);
  });
});

describe('formatEngineList', () => {
  it('falls back to provider-neutral wording', () => {
    expect(formatEngineList([])).toBe(PREMIUM_ENGINES_FALLBACK);
    expect(PREMIUM_ENGINES_FALLBACK).not.toMatch(/openrouter/i);
  });

  it('joins labels naturally', () => {
    expect(formatEngineList(['NVIDIA NIM'])).toBe('NVIDIA NIM');
    expect(formatEngineList(['NVIDIA NIM', 'Ollama'])).toBe('NVIDIA NIM & Ollama');
    expect(formatEngineList(['NVIDIA NIM', 'Ollama', 'OpenRouter'])).toBe('NVIDIA NIM, Ollama & OpenRouter');
  });
});

describe('isFreeEngineConfigured', () => {
  it('reflects the groq flag only when health loaded', () => {
    expect(isFreeEngineConfigured({ ok: true, providers: { groq: true } })).toBe(true);
    expect(isFreeEngineConfigured({ ok: true, providers: { groq: false } })).toBe(false);
    expect(isFreeEngineConfigured({ ok: false, providers: { groq: true } })).toBe(false);
  });
});
