import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TELEGRAM_MINI_APP_URL } from '../components/paywall/paymentOptions';
import { PAID_PLAN_PRICES } from '../components/paywall/planPrices';
import { TelegramAccountPanel } from '../components/telegram/TelegramAccountPanel';
import PricingPage from '../components/PricingPage';
import { PLANS } from '../worker/telegramBot';
import { TON_PRICING } from '../worker/tonPayment';

const state = vi.hoisted(() => ({
  inTelegram: false,
  health: { ok: true, ton: false, jettonCheckout: false, stripeCheckout: false, plans: {} } as Record<string, unknown>,
}));

vi.mock('@tonconnect/ui-react', () => ({
  TonConnectButton: () => null,
  useTonWallet: () => null,
}));

vi.mock('../services/telegram/tma', async (importActual) => ({
  ...(await importActual<typeof import('../services/telegram/tma')>()),
  isInTelegram: () => state.inTelegram,
}));

vi.mock('../services/apiClient', async (importActual) => ({
  ...(await importActual<typeof import('../services/apiClient')>()),
  getServerHealthSync: () => state.health,
}));

const noop = () => {};

describe('paid plan price mirror', () => {
  it('locks Stars and TON to the worker checkout catalogs', () => {
    for (const id of ['starter', 'growth', 'agency'] as const) {
      expect(PAID_PLAN_PRICES[id].stars).toBe(PLANS[id].stars);
      expect(PAID_PLAN_PRICES[id].ton).toBe(TON_PRICING[id].ton);
    }
    expect(PAID_PLAN_PRICES.starter).toMatchObject({ stars: 2500, ton: 15 });
    expect(PAID_PLAN_PRICES.growth).toMatchObject({ stars: 7500, ton: 45 });
    expect(PAID_PLAN_PRICES.agency).toMatchObject({ stars: 18000, ton: 120 });
  });
});

describe('pricing page discoverability', () => {
  const renderPricing = () =>
    renderToStaticMarkup(
      createElement(PricingPage, {
        onBack: noop,
        onTerminal: noop,
        onNavigateInfrastructure: noop,
        onNavigateIntelligence: noop,
        onNavigateWhy: noop,
      }),
    );

  beforeEach(() => {
    state.inTelegram = false;
    state.health = { ok: true, ton: false, jettonCheckout: false, stripeCheckout: false, plans: {} };
  });

  it('names Stars alone, with no TON price, while TON checkout is closed', () => {
    const html = renderPricing();
    expect(html).toContain('Pay with Telegram Stars inside the Mini App.');
    expect(html).toContain('2,500 Stars');
    expect(html).not.toContain('15 TON');
    expect(html).not.toContain('45 TON');
    expect(html).not.toContain('120 TON');
    expect(html).not.toMatch(/Stars (or|and) TON/);
    expect(html).not.toContain('on TON');
  });

  it('never shows a TON price inside Telegram, whatever the server reports', () => {
    state.inTelegram = true;
    state.health = { ok: true, ton: true, jettonCheckout: true, stripeCheckout: true, plans: {} };
    const html = renderPricing();
    expect(html).not.toMatch(/\d+ TON/);
    expect(html).not.toMatch(/Stars (or|and) TON/);
    expect(html).not.toContain('with TON on the web');
  });

  it('shows the Mini App link, Stars and TON amounts, and unavailable card checkout once TON checkout is open', () => {
    state.health = { ok: true, ton: true, jettonCheckout: false, stripeCheckout: false, plans: {} };
    const html = renderPricing();
    expect(html).toContain('Pay with Telegram Stars inside the Mini App, or with TON on the web.');
    expect(html).toContain(`href="${TELEGRAM_MINI_APP_URL}"`);
    expect(html).toContain('https://t.me/LuminaraSuiteBot/app');
    expect(html).toContain('Open Mini App in Telegram');
    expect(html).toContain('Card checkout is available on request');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('2,500 Stars');
    expect(html).toContain('7,500 Stars');
    expect(html).toContain('18,000 Stars');
    expect(html).toContain('15 TON');
    expect(html).toContain('45 TON');
    expect(html).toContain('120 TON');
    expect(html).not.toContain('Instant self-serve card checkout');
    expect(html).not.toContain('Pay with Card (Stripe)');
    expect(html).not.toContain('instant Stripe checkout');
    expect(html).not.toContain('Card checkout is coming');
    expect(html).not.toContain('Card checkout coming');
  });
});

describe('Settings Telegram and TON section', () => {
  it('links the web panel to the published Mini App', () => {
    const html = renderToStaticMarkup(createElement(TelegramAccountPanel, { compact: true }));
    expect(html).toContain('Telegram');
    expect(html).toContain(`href="${TELEGRAM_MINI_APP_URL}"`);
    expect(html).toContain('Open Mini App in Telegram');
    expect(html).toContain('Card checkout is available on request');
    expect(html).toContain('Link Telegram and web account - shares subscription');
  });
});

describe('copy outside the paywall while TON and card checkout are closed', () => {
  // Static text cannot ask the server which rails are open, so it names Stars alone.
  it.each([
    'public/llms.txt',
    'worker/crawlDocuments.ts',
    'services/marketing/pageMeta.ts',
    'components/settings/tabs/ApiKeyScrapingTab.tsx',
    'services/scraping/siteEvidencePack.ts',
    'components/auth/AuthPanel.tsx',
  ])('%s does not tell a reader they can pay with TON or by card plan', (file) => {
    const text = readFileSync(resolve(__dirname, '..', file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(text).not.toMatch(/Stars\s*(or|and|,|\/)\s*TON/i);
    expect(text).not.toMatch(/TON (billing|can pay)/i);
    expect(text).not.toMatch(/Stripe plan/i);
  });
});
