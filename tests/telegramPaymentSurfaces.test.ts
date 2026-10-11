import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS, publicPlanCatalogue } from '../worker/telegramBot';

/**
 * What a buyer actually sees. Telegram requires digital goods inside a bot or Mini App to be sold
 * for Stars, so these tests render the paywall and the account panel as the Mini App does and
 * read the markup. The helper-level tests in paywallPaymentOptions.test.ts cannot catch a tab
 * that is drawn without consulting the helper; these can.
 */

const state = vi.hoisted(() => ({
  inTelegram: true,
  wallet: null as { account: { address: string } } | null,
  health: { ok: true, providers: {}, telegram: true, requireAuth: false, plans: {} } as Record<string, unknown>,
}));

vi.mock('@tonconnect/ui-react', () => ({
  TonConnectButton: () => createElement('span', null, 'TON-CONNECT-BUTTON'),
  useTonWallet: () => state.wallet,
  useTonConnectUI: () => [{}, () => {}],
}));

vi.mock('../services/telegram/tma', async (importActual) => ({
  ...(await importActual<typeof import('../services/telegram/tma')>()),
  isInTelegram: () => state.inTelegram,
  getTelegramUserUnsafe: () => (state.inTelegram ? { id: 42, first_name: 'Buyer' } : null),
}));

vi.mock('../services/apiClient', async (importActual) => ({
  ...(await importActual<typeof import('../services/apiClient')>()),
  getServerHealthSync: () => state.health,
}));

import { PaywallModal } from '../components/paywall/PaywallModal';
import { TelegramAccountPanel } from '../components/telegram/TelegramAccountPanel';

const everythingOn = () => ({
  ok: true,
  providers: {},
  telegram: true,
  requireAuth: false,
  ton: true,
  jettonCheckout: true,
  stripeCheckout: true,
  plans: publicPlanCatalogue(),
});

const paywall = () => renderToStaticMarkup(createElement(PaywallModal, { isOpen: true, onClose: () => {} }));
const panel = () => renderToStaticMarkup(createElement(TelegramAccountPanel, {}));

describe('the paywall inside Telegram', () => {
  beforeEach(() => {
    state.inTelegram = true;
    state.health = everythingOn();
  });

  it('offers Stars and nothing else, even when the server reports every rail live', () => {
    const html = paywall();
    expect(html).toContain('Stars');
    expect(html).not.toMatch(/>TON</);
    // Not as a tab, not as a badge such as "Stars + TON", not in a sentence.
    expect(html).not.toMatch(/\bTON\b/);
    expect(html).not.toContain('Soon');
    expect(html).not.toContain('USDT');
    expect(html).not.toContain('LORA');
    expect(html).not.toMatch(/>Card</);
    expect(html).not.toContain('support@luminarasuite.com');
    expect(html).not.toMatch(/credit card|invoic/i);
  });

  it('draws no disabled TON tab when TON is closed either', () => {
    state.health = { ...everythingOn(), ton: false, jettonCheckout: false, stripeCheckout: false };
    const html = paywall();
    expect(html).not.toMatch(/>TON</);
    expect(html).not.toContain('Soon');
    expect(html).not.toContain('support@luminarasuite.com');
  });
});

describe('the paywall on the web', () => {
  beforeEach(() => {
    state.inTelegram = false;
  });

  it('shows the TON tab when the server reports TON open', () => {
    state.health = { ...everythingOn(), jettonCheckout: false, stripeCheckout: false };
    expect(paywall()).toMatch(/>TON</);
  });

  it('shows TON as not available yet, and no USDT, when the server reports it closed', () => {
    state.health = { ...everythingOn(), ton: false, jettonCheckout: false, stripeCheckout: false };
    const html = paywall();
    expect(html).toContain('Soon');
    expect(html).not.toContain('USDT');
  });
});

describe('the account panel inside Telegram', () => {
  beforeEach(() => {
    state.inTelegram = true;
  });

  it('renders when public health carries no plan list at all (it used to throw)', () => {
    state.health = { ok: true, ton: false, jettonCheckout: false, stripeCheckout: false };
    expect(() => panel()).not.toThrow();
  });

  it('lists the 30-day plans with their Stars price from the public catalogue', () => {
    state.health = everythingOn();
    const html = panel();
    for (const id of ['starter', 'growth', 'agency'] as const) {
      expect(html).toContain(PLANS[id].title.replace(/&/g, '&amp;'));
      expect(html).toContain(`${PLANS[id].stars.toLocaleString()} Stars`);
    }
  });

  it('offers no TON wallet connect', () => {
    state.health = everythingOn();
    const html = panel();
    expect(html).not.toContain('TON-CONNECT-BUTTON');
    expect(html).not.toContain('TON wallet');
  });
});

describe('the account panel on the web with a wallet connected', () => {
  beforeEach(() => {
    state.inTelegram = false;
    state.wallet = { account: { address: '0:' + 'a'.repeat(64) } };
    state.health = everythingOn();
  });

  it('draws no Stars plan button, because a Stars invoice cannot open outside Telegram', () => {
    const html = panel();
    expect(html).toContain('Open Mini App in Telegram');
    expect(html).not.toContain('Subscribe');
    expect(html).not.toContain(`${PLANS.starter.stars.toLocaleString()} Stars`);
  });

  it('still draws them inside Telegram', () => {
    state.inTelegram = true;
    state.wallet = null;
    expect(panel()).toContain('Subscribe');
  });
});
