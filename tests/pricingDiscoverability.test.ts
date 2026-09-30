import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TELEGRAM_MINI_APP_URL } from '../components/paywall/paymentOptions';
import { PAID_PLAN_PRICES } from '../components/paywall/planPrices';
import { TelegramAccountPanel } from '../components/telegram/TelegramAccountPanel';
import PricingPage from '../components/PricingPage';
import { PLANS } from '../worker/telegramBot';
import { TON_PRICING } from '../worker/tonPayment';

vi.mock('@tonconnect/ui-react', () => ({
  TonConnectButton: () => null,
  useTonWallet: () => null,
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
  it('shows the Mini App link, Stars and TON amounts, and unavailable card checkout', () => {
    const html = renderToStaticMarkup(
      createElement(PricingPage, {
        onBack: noop,
        onTerminal: noop,
        onNavigateInfrastructure: noop,
        onNavigateIntelligence: noop,
        onNavigateWhy: noop,
      }),
    );
    expect(html).toContain(`href="${TELEGRAM_MINI_APP_URL}"`);
    expect(html).toContain('https://t.me/LuminaraSuiteBot/app');
    expect(html).toContain('Open Mini App in Telegram');
    expect(html).toContain('Card checkout is unavailable');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('2,500 Stars');
    expect(html).toContain('7,500 Stars');
    expect(html).toContain('18,000 Stars');
    expect(html).toContain('15 TON');
    expect(html).toContain('45 TON');
    expect(html).toContain('120 TON');
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
    expect(html).toContain('Card checkout is unavailable');
    expect(html).toContain('Link Telegram and web account - shares subscription');
  });
});
