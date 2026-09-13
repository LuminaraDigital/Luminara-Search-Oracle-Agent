import { describe, expect, it } from 'vitest';
import {
  effectiveTab,
  formatEngineList,
  isFreeEngineConfigured,
  isTonAvailable,
  paidEngineLabels,
  PREMIUM_ENGINES_FALLBACK,
  resolvePaymentOptions,
  TELEGRAM_MINI_APP_URL,
} from '../components/paywall/paymentOptions';

const EMPTY = { ok: false, providers: {} };
const tonOn = { ok: true, ton: true, providers: {} };
const tonOff = { ok: true, ton: false, providers: {} };

describe('resolvePaymentOptions', () => {
  it('defaults to Stars inside Telegram regardless of TON', () => {
    expect(resolvePaymentOptions({ inTelegram: true, health: tonOn })).toEqual({
      tonAvailable: true,
      starsInline: true,
      defaultTab: 'stars',
    });
    expect(resolvePaymentOptions({ inTelegram: true, health: tonOff }).defaultTab).toBe('stars');
  });

  it('defaults to TON on the web only when the server reports TON configured', () => {
    expect(resolvePaymentOptions({ inTelegram: false, health: tonOn }).defaultTab).toBe('ton');
    const off = resolvePaymentOptions({ inTelegram: false, health: tonOff });
    expect(off).toEqual({ tonAvailable: false, starsInline: false, defaultTab: 'stars' });
  });

  it('treats unloaded, failed, or legacy health as TON unavailable', () => {
    for (const health of [null, undefined, EMPTY, { ok: true, providers: {} }, { ok: false, ton: true }]) {
      const opts = resolvePaymentOptions({ inTelegram: false, health });
      expect(opts.tonAvailable).toBe(false);
      expect(opts.defaultTab).toBe('stars');
    }
  });

  it('never lets a stale TON selection through when TON is unavailable', () => {
    const off = resolvePaymentOptions({ inTelegram: false, health: tonOff });
    expect(effectiveTab('ton', off)).toBe('stars');
    const on = resolvePaymentOptions({ inTelegram: false, health: tonOn });
    expect(effectiveTab('ton', on)).toBe('ton');
    expect(effectiveTab('stars', on)).toBe('stars');
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
