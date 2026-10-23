import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TELEGRAM_MINI_APP_URL } from '../components/paywall/paymentOptions';
import { PAID_PLAN_PRICES } from '../components/paywall/planPrices';
import { TelegramAccountPanel } from '../components/telegram/TelegramAccountPanel';
import { TelegramAccountTon } from '../components/telegram/TelegramAccountTon';
import PricingPage, { planChoiceLine } from '../components/PricingPage';
import { BYOK_CHECKOUT_LINE, CHECKOUT_TERM_LINE, PLAN_CARD_BADGE, TELEGRAM_STARS_HANDOFF, listPriceSummary, planBullets, planTitle } from '../components/paywall/planCopy';
import { PLANS } from '../worker/telegramBot';
import { TON_PRICING } from '../worker/tonPayment';

const state = vi.hoisted(() => ({
  inTelegram: false,
  health: { ok: true, ton: false, jettonCheckout: false, stripeCheckout: false, plans: {} } as Record<string, unknown>,
}));

vi.mock('@tonconnect/ui-react', () => ({
  TonConnectUIProvider: ({ children }) => children,
  TonConnectButton: () => createElement('button', { type: 'button' }, 'Connect Wallet'),
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

  it('names Stars checkout and the shared USD list prices while TON checkout is closed', () => {
    const html = renderPricing();
    expect(html.split(CHECKOUT_TERM_LINE).length - 1).toBe(1);
    expect(html.split(listPriceSummary()).length - 1).toBe(1);
    expect(html).toContain(TELEGRAM_STARS_HANDOFF);
    expect(html.split(TELEGRAM_STARS_HANDOFF).length - 1).toBe(1);
    expect(html).not.toContain('Pay with Telegram Stars inside the Mini App.');
    expect(html).toContain('Pay 2,500 Stars in Telegram');
    expect(html).not.toContain('Connect Wallet');
    expect(html).toContain(PAID_PLAN_PRICES.starter.audLabel);
    expect(html).toContain(PAID_PLAN_PRICES.growth.audLabel);
    expect(html).toContain(PAID_PLAN_PRICES.agency.audLabel);
    expect(html).not.toContain('Subscribe');
    expect(html).not.toMatch(/card checkout/i);
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
    expect(html.split(CHECKOUT_TERM_LINE).length - 1).toBe(1);
    expect(html).not.toMatch(/\d+ TON/);
    expect(html).not.toMatch(/Stars (or|and) TON/);
    expect(html).not.toContain('with TON on the web');
  });

  it('shows the Mini App link, Stars and TON amounts, and unavailable card checkout once TON checkout is open', () => {
    state.health = { ok: true, ton: true, jettonCheckout: false, stripeCheckout: false, plans: {} };
    const html = renderPricing();
    expect(html.split(CHECKOUT_TERM_LINE).length - 1).toBe(1);
    expect(html).toContain(TELEGRAM_STARS_HANDOFF);
    expect(html).toContain('Or with TON on the web.');
    expect(html).not.toContain('Pay with Telegram Stars inside the Mini App');
    expect(html).toContain(`href="${TELEGRAM_MINI_APP_URL}"`);
    expect(html).toContain('https://t.me/LuminaraSuiteBot/app');
    expect(html).toContain('Open Mini App in Telegram');
    expect(html).toContain(TELEGRAM_STARS_HANDOFF);
    expect(html).not.toMatch(/card checkout/i);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('2,500 Stars');
    expect(html).toContain('7,500 Stars');
    expect(html).toContain('18,000 Stars');
    expect(html).toContain('15 TON');
    expect(html).toContain('45 TON');
    expect(html).toContain('120 TON');
    expect(renderToStaticMarkup(createElement(TelegramAccountTon, { compact: true, showTermLine: false }))).toContain('Connect Wallet');
    expect(html).not.toMatch(/card checkout/i);
    expect(html).not.toContain('Instant self-serve card checkout');
    expect(html).not.toContain('Pay with Card (Stripe)');
    expect(html).not.toContain('instant Stripe checkout');
    expect(html).not.toContain('Card checkout is coming');
    expect(html).not.toContain('Card checkout coming');
  });
});

describe('Settings Telegram and TON section', () => {
  it('links the web panel to the published Mini App and hides the wallet while TON is closed', () => {
    state.inTelegram = false;
    state.health = { ok: true, ton: false, jettonCheckout: false, stripeCheckout: false, plans: {} };
    const html = renderToStaticMarkup(createElement(TelegramAccountPanel, { compact: true }));
    expect(html).toContain('Telegram');
    expect(html).toContain(`href="${TELEGRAM_MINI_APP_URL}"`);
    expect(html).toContain('Open Mini App in Telegram');
    expect(html).toContain(TELEGRAM_STARS_HANDOFF);
    expect(html).toContain(CHECKOUT_TERM_LINE);
    expect(html).not.toMatch(/card checkout/i);
    expect(html).not.toContain('Connect Wallet');
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
    // Any sentence that names Stars and then TON within a few words, such as "Stars and website TON".
    expect(text).not.toMatch(/Stars\b[^.\n]{0,24}\bTON\b/i);
    expect(text).not.toMatch(/TON (billing|can pay)/i);
    expect(text).not.toMatch(/Stripe plan/i);
  });

  it('the line the paywall opens with from a pricing card names TON only while TON checkout is open', () => {
    const tier = { stars: '2,500 Stars', ton: '15 TON' };
    expect(planChoiceLine('Starter', tier, false)).toBe('Choose Starter: 2,500 Stars inside the Mini App.');
    expect(planChoiceLine('Starter', tier, true)).toBe('Choose Starter: 2,500 Stars inside the Mini App, or 15 TON on the web.');
    // The page builds that line through the helper, with the same switch as the rest of its copy.
    const source = readFileSync(resolve(__dirname, '..', 'components', 'PricingPage.tsx'), 'utf8');
    expect(source).toContain('openPaywallModal(planChoiceLine(title, tier, tonOpen))');
    expect(source).toContain('void startPricedCard(tier.id)');
    expect(source).toContain('beginCardCheckout(planId)');
    expect(source).not.toMatch(/\$\{tier\.ton\} inside the Mini App/);
  });

  it('checkout and pricing share badge, names, and bullets, with no 3-day code hint', () => {
    expect(PLAN_CARD_BADGE).toBe('Recommended');
    expect(planTitle('starter')).toBe('Starter');
    expect(planTitle('growth')).toBe('Growth');
    expect(planTitle('agency')).toBe('Agency');
    expect(planBullets('agency').map((line) => line.text)).toContain('Paid research API (Agency plan or your own DataForSEO login)');
    expect(planBullets('growth').map((line) => line.text).join('\n')).not.toMatch(/Sentinel|Unlimited AI|Hosted API/);
    const settings = readFileSync(resolve(__dirname, '..', 'components/settings/tabs/ApiKeyOverviewTab.tsx'), 'utf8');
    expect(settings).toContain(BYOK_CHECKOUT_LINE);
    const modal = readFileSync(resolve(__dirname, '..', 'components/paywall/PaywallModal.tsx'), 'utf8');
    const page = readFileSync(resolve(__dirname, '..', 'components/PricingPage.tsx'), 'utf8');
    expect(page).toContain('planBullets(tier.id)');
    expect(page).toContain('{PLAN_CARD_BADGE}');
    expect(modal).toContain('planBullets(tier.id)');
    expect(modal).toContain('planTitle(tier.id)');
    expect(modal).toContain('{PLAN_CARD_BADGE}');
    expect(modal).toContain('BYOK_CHECKOUT_LINE');
    expect(modal).not.toContain('LUM-GROWTH-3DAY');
    expect(modal).not.toContain('Most popular');
    expect(modal).not.toContain('Agency Plan');
    expect(modal).not.toContain('after sign-in');
  });
});
