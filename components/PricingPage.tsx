/**
 * Pricing page: entitlement-true tiers. Hero sells Growth (IDE access + share).
 * Prices are the Stars / TON amounts the Worker charges (worker/telegramBot.ts,
 * worker/tonPayment.ts), mirrored in ./paywall/planPrices. The USD label is a list price only:
 * card checkout is unavailable.
 */
import { isInTelegram } from '../services/telegram/tma';
import { TelegramAccountPanel } from './telegram/TelegramAccountPanel';
import React, { useEffect } from 'react';
import { getServerHealthSync, openPaywallModal } from '../services/apiClient';
import { MarketingPageShell } from './marketing/MarketingPageShell';
import { PLAN_ENTITLEMENTS } from '../services/plans/planEntitlements';
import { TELEGRAM_MINI_APP_URL, isTonAvailable } from './paywall/paymentOptions';
import { PLAN_CARD_BADGE, planBullets, planTitle, pricingTiers } from './paywall/planCopy';

export { pricingTiers };

interface PricingPageProps {
  onTerminal: () => void;
}

/** The line the paywall opens with when a plan is chosen here. TON is named only while its checkout is open. */
export function planChoiceLine(title: string, tier: { stars: string; ton: string }, tonOpen: boolean): string {
  return tonOpen
    ? `Choose ${title}: ${tier.stars} inside the Mini App, or ${tier.ton} on the web.`
    : `Choose ${title}: ${tier.stars} inside the Mini App.`;
}

/** One-off runs sold by the Worker alongside the plans. */
const ONE_OFFS = [
  { title: 'Single audit run', price: '25 Stars', body: 'One on-demand audit. Self-reported, not independently checked.' },
  { title: 'Deep multi-agent crawl', price: '75 Stars', body: 'One deep crawl with competitor gap findings.' },
] as const;

const PricingPage: React.FC<PricingPageProps> = ({ onTerminal }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const inTelegram = isInTelegram();
  // TON is paid on the web with a connected wallet, never inside Telegram, and only while the
  // Worker reports that checkout open. Until then this page names Stars alone.
  const tonOpen = !inTelegram && isTonAvailable(getServerHealthSync());
  const payLine = tonOpen
    ? 'Pay with Telegram Stars inside the Mini App, or with TON on the web.'
    : 'Pay with Telegram Stars inside the Mini App.';
  const free = PLAN_ENTITLEMENTS.free;
  const miniAppLinkProps = inTelegram
    ? { rel: 'noopener noreferrer' as const }
    : { target: '_blank' as const, rel: 'noopener noreferrer' as const };

  return (
    <MarketingPageShell brandSub="Pricing" wide>
      <section className="mb-14 sm:mb-20 max-w-3xl">
        <p className="mkt-eyebrow mb-4">Pricing</p>
        <h1 className="font-display text-[length:var(--text-display)] tracking-tight leading-[1.05] mb-6 [overflow-wrap:anywhere]">
          Plans for audits, share links, and team seats
        </h1>
        <p className="text-lg text-[var(--color-ink-2)] leading-relaxed mb-4">
          Free covers Sample scouts and a daily hosted Instant Audit allowance after you create an account.
          Starter is web audits only. Growth adds IDE access and shareable reports. Agency adds API access
          and client workspaces.
        </p>
        <p className="mkt-body mb-8">
          Every paid plan runs 30 days. {payLine} USD amounts are
          list prices; card checkout is available on request during closed beta.
        </p>
        <div className="mb-8 border border-[var(--color-rule)] bg-[var(--color-paper)]/70 p-5 sm:p-6">
          <p className="mkt-eyebrow mb-3">How to pay</p>
          <p className="mkt-body mb-4">
            Open the Mini App to pay with Telegram Stars.{tonOpen ? ' TON is paid here on the web, from the payment panel.' : ''} For card payments or corporate invoicing,
            email support@luminarasuite.com.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href={TELEGRAM_MINI_APP_URL} {...miniAppLinkProps} className="mkt-cta-primary">
              Open in Telegram
            </a>
            <button
              type="button"
              onClick={() => openPaywallModal(payLine)}
              className="mkt-cta-secondary"
            >
              See payment options
            </button>
          </div>
          <p className="mt-3 text-[13px] text-[var(--color-ink-2)] font-mono break-all">{TELEGRAM_MINI_APP_URL}</p>
        </div>
        <button type="button" onClick={onTerminal} className="mkt-cta-secondary">
          Open Instant Audit
        </button>
      </section>

      <section className="mb-10 grid grid-cols-1 lg:grid-cols-3 gap-px bg-[var(--color-rule)] border border-[var(--color-rule)]">
        {pricingTiers.map((tier) => {
          const lines = planBullets(tier.id);
          const title = planTitle(tier.id);
          return (
            <div
              key={tier.id}
              className={`p-6 sm:p-8 bg-[var(--color-paper)] flex flex-col ${
                tier.highlight ? 'ring-1 ring-inset ring-[var(--color-accent)]' : ''
              }`}
            >
              <div className="flex items-baseline justify-between gap-3 mb-4">
                <h2 className="text-xl font-medium text-[var(--color-ink)]">{title}</h2>
                {tier.highlight && <p className="mkt-eyebrow">{PLAN_CARD_BADGE}</p>}
              </div>
              <p className="font-display text-4xl sm:text-5xl leading-none text-[var(--color-ink)] mb-2">
                {inTelegram ? tier.stars : tier.priceLabel}
              </p>
              <p className="text-[13px] font-mono text-[var(--color-ink-2)] mb-5">
                {inTelegram
                  ? `30 days · list ${tier.priceLabel}`
                  : tonOpen
                    ? `or ${tier.stars} in Telegram · ${tier.ton} on TON`
                    : `or ${tier.stars} in Telegram`}
              </p>
              <p className="mkt-body mb-6">{tier.blurb}</p>
              <ul className="space-y-2.5 flex-1 mb-8">
                {lines.map((line) => (
                  <li
                    key={line}
                    className="text-[15px] text-[var(--color-ink-2)] leading-relaxed border-t border-[var(--color-rule)] pt-2.5"
                  >
                    {line}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() =>
                  openPaywallModal(planChoiceLine(title, tier, tonOpen))
                }
                className={`w-full ${tier.highlight ? 'mkt-cta-primary' : 'mkt-cta-secondary'}`}
              >
                Subscribe to {title}
              </button>
            </div>
          );
        })}
      </section>

      <section className="mb-20 sm:mb-28 grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="min-w-0 border-t border-[var(--color-rule)] pt-5">
          <h2 className="text-xl font-medium text-[var(--color-ink)] mb-2">{free.title}</h2>
          <p className="mkt-body">
            {free.domainLimit} domain, on-demand audits, Sample scouts with no card. Free accounts get a
            daily hosted Instant Audit allowance. No IDE access, no public share links. Guests may still
            bring their own AI keys.
          </p>
        </div>
        {ONE_OFFS.map((item) => (
          <div key={item.title} className="min-w-0 border-t border-[var(--color-rule)] pt-5">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <h2 className="text-xl font-medium text-[var(--color-ink)]">{item.title}</h2>
              <p className="text-[13px] font-mono text-[var(--color-ink-2)] shrink-0">{item.price}</p>
            </div>
            <p className="mkt-body">{item.body} One-off, paid in Telegram.</p>
          </div>
        ))}
      </section>

      <section className="border-t border-[var(--color-rule)] pt-14 sm:pt-20 max-w-2xl">
        <h2 className="font-display text-[length:var(--text-display-s)] tracking-tight leading-[1.08] mb-4 [overflow-wrap:anywhere]">
          How payment works
        </h2>
        <p className="mkt-body mb-8">
          Stars checkout runs inside the Luminara Mini App in Telegram.{tonOpen ? ' TON checkout runs here on the web, with a connected wallet.' : ''} On the web, the payment panel
          opens Telegram for you, or takes a license key. Card checkout is available on request during closed
          beta: for card payments or corporate invoicing, email support@luminarasuite.com.
        </p>
        {inTelegram ? (
          <TelegramAccountPanel />
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => openPaywallModal(payLine)}
              className="mkt-cta-primary w-full sm:w-auto"
            >
              See payment options
            </button>
            <TelegramAccountPanel compact />
          </div>
        )}
        <p className="text-[var(--color-ink-2)] text-[13px] mt-6">
          {payLine} Plans run for 30 days. Plan limits apply per account. Credit card checkout is available on request during closed beta.
        </p>
      </section>
    </MarketingPageShell>
  );
};

export default PricingPage;
