import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRIVACY_HTML } from '../worker/privacyPolicy';
import PricingPage from '../components/PricingPage';
import { approximateAudLabel } from '../components/paywall/planPrices';
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

  it('shows approximate AUD, a free card, and one 24-hour pass', () => {
    expect(approximateAudLabel('US$49')).toBe('A$76');
    expect(approximateAudLabel('US$149')).toBe('A$231');
    expect(approximateAudLabel('US$349')).toBe('A$541');
    expect(listPriceSummary()).toContain('About A$1.55 per US$1');
    expect(listPriceSummary()).toContain('You pay in Telegram Stars');
    expect(freePlanLines().join(' ')).toContain('3 hosted Instant Audit checks a day');
    expect(planBullets('agency').map((line) => line.text).join(' ')).not.toContain('saved in this browser');

    const html = renderToStaticMarkup(createElement(PricingPage, { onTerminal: () => {} }));
    expect(html).toContain('A$0');
    expect(html).toContain('A$76');
    expect(html).toContain('Start free');
    expect(html).toContain('24-hour pass');
    expect(html).toContain('75 Stars');
    expect(html.split('24-hour pass').length - 1).toBe(1);
    expect(html).not.toContain('saved in this browser');
  });
});

describe('plain language privacy page', () => {
  it('serves the same policy as the in-app copy', () => {
    expect(readFileSync('public/privacy.html', 'utf8')).toBe(PRIVACY_HTML);
    expect(PRIVACY_HTML).toContain('We do not sell personal information');
    expect(PRIVACY_HTML).toContain('personal-data breach');
    expect(PRIVACY_HTML).toContain('class="site-nav"');
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
