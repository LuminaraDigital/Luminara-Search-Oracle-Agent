import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipPlain } from '../utils/clipPlain';
import { initTelegramAnalytics, readTelegramAnalyticsConfig } from '../services/telegram/analytics';
import {
  STARS_INVOICE_WAIT_MS,
  openStarsInvoice,
  prefersInvoiceLink,
  type TelegramInvoiceHost,
} from '../services/telegram/starsInvoice';
import { dailyCapPaywallLine, dailyCapStudioNote } from '../components/paywall/planCopy';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Stars invoice open', () => {
  it('opens the invoice link on Telegram Desktop and does not wait on openInvoice', async () => {
    const host: TelegramInvoiceHost = {
      platform: 'tdesktop',
      openInvoice: vi.fn(),
      openTelegramLink: vi.fn(),
    };
    const external = vi.fn();
    await expect(openStarsInvoice(' https://t.me/$invoice ', host, external)).resolves.toBe('pending');
    expect(host.openTelegramLink).toHaveBeenCalledWith('https://t.me/$invoice');
    expect(host.openInvoice).not.toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
    expect(prefersInvoiceLink('macos')).toBe(true);
    expect(prefersInvoiceLink('web')).toBe(true);
    expect(prefersInvoiceLink('ios')).toBe(false);
  });

  it('uses openInvoice on iOS and returns the callback status', async () => {
    let callback: ((status: string) => void) | null = null;
    const host: TelegramInvoiceHost = {
      platform: 'ios',
      openInvoice: (_url, cb) => { callback = cb; },
      openTelegramLink: vi.fn(),
    };
    const pending = openStarsInvoice('https://t.me/$invoice', host, vi.fn());
    callback?.('paid');
    await expect(pending).resolves.toBe('paid');
    expect(host.openTelegramLink).not.toHaveBeenCalled();
  });

  it('does not leave Desktop waiting when the invoice callback never arrives', async () => {
    vi.useFakeTimers();
    const host: TelegramInvoiceHost = {
      platform: 'android',
      openInvoice: vi.fn(),
    };
    const pending = openStarsInvoice('https://t.me/$invoice', host, vi.fn());
    await vi.advanceTimersByTimeAsync(STARS_INVOICE_WAIT_MS);
    await expect(pending).resolves.toBe('pending');
  });

  it('opens an external tab outside Telegram and refuses an empty link', async () => {
    const external = vi.fn();
    await expect(openStarsInvoice('https://t.me/$invoice', null, external)).resolves.toBe('pending');
    expect(external).toHaveBeenCalledWith('https://t.me/$invoice');
    await expect(openStarsInvoice('  ', null, external)).resolves.toBe('failed');
  });
});

describe('optional Telegram analytics', () => {
  it('stays off unless both public build vars are set', () => {
    expect(readTelegramAnalyticsConfig(undefined)).toBeNull();
    expect(readTelegramAnalyticsConfig({ VITE_TG_ANALYTICS_TOKEN: ' catalog-token ' })).toBeNull();
    expect(readTelegramAnalyticsConfig({ VITE_TG_ANALYTICS_APP_NAME: ' luminara ' })).toBeNull();
    expect(readTelegramAnalyticsConfig({
      VITE_TG_ANALYTICS_TOKEN: ' catalog-token ',
      VITE_TG_ANALYTICS_APP_NAME: ' luminara ',
    })).toEqual({ token: 'catalog-token', appName: 'luminara' });
  });

  it('does not inject the script when the vars are empty', () => {
    const scripts: Array<{ src: string }> = [];
    vi.stubGlobal('document', {
      querySelector: () => null,
      createElement: () => {
        throw new Error('script should stay off');
      },
      head: { appendChild: (node: { src: string }) => scripts.push(node) },
    });
    initTelegramAnalytics({});
    expect(scripts).toEqual([]);
  });
});

describe('store copy', () => {
  it('does not call a paid plan unlimited', () => {
    expect(dailyCapPaywallLine()).toBe('Daily limit reached. A paid plan lifts the free daily cap.');
    expect(dailyCapPaywallLine(3)).not.toMatch(/unlimited/i);
    expect(dailyCapStudioNote(3)).toContain('own API key');
  });

  it('marks a cut memory line instead of ending mid-word', () => {
    expect(clipPlain('fast answers', 240)).toBe('fast answers');
    expect(clipPlain('Saved what the audit found about citations today', 24)).toBe('Saved what the audit…');
  });

  it('reads Thorough back after a fresh load', async () => {
    const store = new Map<string, string>([['luminara_answer_depth', 'thorough']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    });
    vi.resetModules();
    const depth = await import('../services/audit/answerDepth');
    expect(depth.getAnswerDepth()).toBe('thorough');
    depth.setAnswerDepth('quick');
    expect(store.get('luminara_answer_depth')).toBe('quick');
  });
});
