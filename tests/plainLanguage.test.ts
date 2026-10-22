import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRIVACY_HTML } from '../worker/privacyPolicy';
import PricingPage from '../components/PricingPage';
import { cardPayLabel, cardTermLabel, PAID_PLAN_PRICES } from '../components/paywall/planPrices';
import { freePlanLines, listPriceSummary, planBullets } from '../components/paywall/planCopy';
import { DashboardView } from '../components/suite/DashboardView';
import { auditHistoryService } from '../services/audit/auditHistoryService';

const state = vi.hoisted(() => ({
  inTelegram: false,
  health: { ok: true, ton: false, jettonCheckout: false, stripeCheckout: false, plans: {} } as Record<string, unknown>,
}));

vi.mock('../services/telegram/tma', async (importActual) => ({
  ...(await importActual<typeof import('../services/telegram/tma')>()),
  isInTelegram: () => state.inTelegram,
}));

vi.mock('../services/apiClient', async (importActual) => ({
  ...(await importActual<typeof import('../services/apiClient')>()),
  getServerHealthSync: () => state.health,
}));

const storage: Record<string, string> = {};
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = String(value); },
    removeItem: (key: string) => { delete storage[key]; },
    clear: () => { Object.keys(storage).forEach((key) => delete storage[key]); },
  },
});

describe('plain language pricing', () => {
  beforeEach(() => {
    state.inTelegram = false;
    state.health = { ok: true, ton: false, jettonCheckout: false, stripeCheckout: false, plans: {} };
  });

  it('shows the AUD card prices, a free card, and one 24-hour pass', () => {
    expect(cardTermLabel('starter')).toBe('A$79 · 30 days');
    expect(cardTermLabel('growth')).toBe('A$229 · 30 days');
    expect(cardTermLabel('agency')).toBe('A$549 · 30 days');
    expect(cardPayLabel('starter')).toBe('Pay A$79 by card');
    expect(listPriceSummary()).toContain('Starter A$79, Growth A$229, Agency A$549');
    expect(listPriceSummary()).toContain('Pay by card');
    expect(listPriceSummary()).not.toMatch(/Approximate|About A\$|US\$/i);
    expect(listPriceSummary()).toContain('Telegram Stars');
    expect(freePlanLines().map((line) => line.text).join(' ')).toContain('3 hosted Instant Audit checks a day');
    expect(planBullets('agency').map((line) => line.text).join(' ')).not.toContain('saved in this browser');

    const html = renderToStaticMarkup(createElement(PricingPage, { onTerminal: () => {} }));
    expect(html).toContain('A$0');
    expect(html).toContain('A$79');
    expect(html).toContain('A$229');
    expect(html).toContain('A$549');
    expect(html).toContain('info@luminara.digital');
    expect(html).not.toMatch(/US\$|GST|0402|0422/i);
    expect(html).toContain('Start free');
    expect(html).toContain('24-hour pass');
    expect(html).toContain('25 Stars');
    expect(html).not.toContain('75 Stars');
    expect(planBullets('starter').map((line) => line.text)).toContain('White-label PDF exports');
    expect(html.split('24-hour pass').length - 1).toBe(1);
    expect(html).not.toContain('saved in this browser');
    expect(html.split('Not included: </span>No IDE access (web app only)').length - 1).toBe(2);
    expect(html.split('Not included: </span>No public share links').length - 1).toBe(2);
    expect(html).toContain('Pay by card on the website and the desktop app.');
    expect(html).toContain('Pay with Telegram Stars in the Mini App.');
    expect(html).not.toContain('Payment happens in Telegram with Stars');
  });
});

describe('plain language privacy page', () => {
  it('serves the same policy as the in-app copy', () => {
    expect(readFileSync('public/privacy.html', 'utf8')).toBe(PRIVACY_HTML);
    expect(PRIVACY_HTML).toContain('We do not sell personal information');
    expect(PRIVACY_HTML).toContain('personal-data breach');
    expect(PRIVACY_HTML).toContain('Australian Privacy Act 1988');
    expect(PRIVACY_HTML).toContain('Stripe');
    expect(PRIVACY_HTML).toContain('We do not store card numbers');
    expect(PRIVACY_HTML).toContain('info@luminara.digital');
    expect(PRIVACY_HTML).toContain('Office of the Australian Information Commissioner');
    expect(PRIVACY_HTML).not.toContain('not finished yet');
    expect(PRIVACY_HTML).not.toContain('California (CCPA');
    expect(PRIVACY_HTML).toContain('class="site-nav"');
    expect(PRIVACY_HTML).toContain('We are LUMINARA DIGITAL PTY LTD');
    expect(PRIVACY_HTML).not.toContain('controller');
  });
});

describe('plain language dashboard', () => {
  beforeEach(() => {
    storage.luminara_advanced_ui = '0';
    auditHistoryService.clear();
  });

  it('hides the command deck unless advanced tools are on', () => {
    const plain = renderToStaticMarkup(createElement(DashboardView, {
      onNavigate: () => {},
      dna: null,
      advancedUi: false,
      signedIn: false,
    }));
    expect(plain).toContain('Your AI visibility');
    expect(plain).toContain('Next fix');
    expect(plain).not.toContain('OBSERVATORY');
    expect(plain).not.toContain('Scout after');
    expect(plain).not.toContain('Fog clearing');

    const advanced = renderToStaticMarkup(createElement(DashboardView, {
      onNavigate: () => {},
      dna: null,
      advancedUi: true,
      signedIn: false,
    }));
    expect(advanced).toContain('OBSERVATORY COMMAND DECK');
  });
});
