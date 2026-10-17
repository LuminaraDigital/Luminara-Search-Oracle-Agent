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
import { MarketingPageHeader, MarketingPageShell } from './marketing/MarketingPageShell';
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
    <MarketingPageShell
      brandSub="Pricing"
      wide
      closing={{
        eyebrow: 'Start free',
        title: (
          <>
            Try it <span className="italic lx-gold-text pr-[0.08em]">before you pay.</span>
          </>
        ),
        body: 'Open Instant Audit on the site that matters most, then choose a plan when you need more.',
        cta: { label: 'Open Instant Audit', onClick: onTerminal },
      }}
    >
      <MarketingPageHeader
        eyebrow="Pricing"
        title={
          <>
            Plans for audits, share links, <span className="italic lx-gold-text pr-[0.08em]">and team seats.</span>
          </>
        }
        lede="Free covers Sample scouts and a daily hosted Instant Audit allowance after you create an account. Starter is web audits only. Growth adds IDE access and shareable reports. Agency adds API access and client workspaces."
      />
      <p className="lx-enter-rise lx-d4 mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-[var(--color-ink-2)]">
        Every paid plan runs 30 days. {payLine} USD amounts are list prices; card checkout is available on request
        during closed beta.
      </p>

      <section aria-labelledby="plans-heading" className="lx-enter-rise lx-d5 mt-16 sm:mt-20">
        <h2 id="plans-heading" className="sr-only">
          Paid plans
        </h2>
        <div className="lx-glass grid overflow-hidden rounded-3xl lg:grid-cols-3">
          {pricingTiers.map((tier) => {
            const lines = planBullets(tier.id);
            const title = planTitle(tier.id);
            return (
              <article
                key={tier.id}
                className={`relative flex min-w-0 flex-col border-t p-7 lx-hairline first:border-t-0 sm:p-9 lg:border-l lg:border-t-0 lg:first:border-l-0 ${
                  tier.highlight ? 'bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--gold)_18%,transparent),transparent_70%)]' : ''
                }`}
              >
                {tier.highlight && (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--gold-light)] to-transparent"
                  />
                )}
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-serif text-3xl leading-tight text-[var(--color-ink)]">{title}</h3>
                  {tier.highlight && <p className="lx-eyebrow shrink-0 !text-[11px]">{PLAN_CARD_BADGE}</p>}
                </div>
                <p
                  className={`mt-7 font-serif text-6xl leading-none ${
                    tier.highlight ? 'lx-gold-text' : 'text-[var(--color-ink)]'
                  }`}
                >
                  {inTelegram ? tier.stars : tier.priceLabel}
                </p>
                <p className="mt-3 text-[13px] text-[var(--color-ink-2)]">
                  {inTelegram
                    ? `30 days · list ${tier.priceLabel}`
                    : tonOpen
                      ? `or ${tier.stars} in Telegram · ${tier.ton} on TON`
                      : `or ${tier.stars} in Telegram`}
                </p>
                <p className="mt-6 leading-relaxed text-[var(--color-ink-2)]">{tier.blurb}</p>
                <ul className="m-0 mt-7 flex-1 list-none space-y-3 border-t p-0 pt-6 lx-hairline">
                  {lines.map((line) => (
                    <li
                      key={line.text}
                      className={`flex gap-3 text-[15px] leading-snug ${
                        line.included ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-2)]'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`mt-[0.4em] h-2 w-2 shrink-0 rounded-full ${
                          line.included ? 'bg-[var(--color-accent)]' : 'border border-dashed border-[var(--color-ink-2)]'
                        }`}
                      />
                      {line.included ? line.text : <><span className="sr-only">Not included: </span>{line.text}</>}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() =>
                    openPaywallModal(planChoiceLine(title, tier, tonOpen))
                  }
                  className={`lx-btn mt-9 w-full ${tier.highlight ? 'lx-btn-gold' : 'lx-btn-ghost'}`}
                >
                  Subscribe to {title}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="free-heading" className="mt-20 sm:mt-24">
        <h2 id="free-heading" className="lx-eyebrow" data-reveal>
          Free and one-off runs
        </h2>
        <div className="mt-8 grid gap-10 lg:grid-cols-3">
          <div className="min-w-0 border-t pt-6 lx-hairline" data-reveal>
            <h3 className="font-serif text-2xl text-[var(--color-ink)]">{free.title}</h3>
            <p className="mt-3 leading-relaxed text-[var(--color-ink-2)]">
              {free.domainLimit} domain, on-demand audits, Sample scouts with no card. Free accounts get a
              daily hosted Instant Audit allowance. No IDE access, no public share links. Guests may still
              bring their own AI keys.
            </p>
          </div>
          {ONE_OFFS.map((item, i) => (
            <div
              key={item.title}
              className="min-w-0 border-t pt-6 lx-hairline"
              data-reveal
              style={{ transitionDelay: `${(i + 1) * 90}ms` }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-serif text-2xl text-[var(--color-ink)]">{item.title}</h3>
                <p className="shrink-0 text-sm text-[var(--gold-light)]">{item.price}</p>
              </div>
              <p className="mt-3 leading-relaxed text-[var(--color-ink-2)]">{item.body} One-off, paid in Telegram.</p>
            </div>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="payment-heading"
        className="mt-24 grid gap-12 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24 lg:grid-cols-12 lg:gap-16"
      >
        <div className="min-w-0 lg:col-span-5" data-reveal>
          <p className="lx-eyebrow">How to pay</p>
          <h2 id="payment-heading" className="lx-display lx-h3 mt-5">
            How payment <span className="italic lx-gold-text pr-[0.08em]">works.</span>
          </h2>
          <p className="lx-lede mt-6">
            Stars checkout runs inside the Luminara Mini App in Telegram.{tonOpen ? ' TON checkout runs here on the web, with a connected wallet.' : ''} On the web, the payment panel
            opens Telegram for you, or takes a license key.
          </p>
          <p className="mt-5 leading-relaxed text-[var(--color-ink-2)]">
            Card checkout is available on request during closed beta: for card payments or corporate invoicing,
            email support@luminarasuite.com.
          </p>
        </div>
        <div className="min-w-0 lg:col-span-7" data-reveal>
          <p className="text-[15px] leading-relaxed text-[var(--color-ink)]">
            Open the Mini App to pay with Telegram Stars.{tonOpen ? ' TON is paid here on the web, from the payment panel.' : ''}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a href={TELEGRAM_MINI_APP_URL} {...miniAppLinkProps} className="lx-btn lx-btn-ghost">
              Open in Telegram
            </a>
            <button type="button" onClick={() => openPaywallModal(payLine)} className="lx-btn lx-btn-ghost">
              See payment options
            </button>
          </div>
          <div className="mt-8">{inTelegram ? <TelegramAccountPanel /> : <TelegramAccountPanel compact />}</div>
          <p className="mt-6 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
            {payLine} Plans run for 30 days. Plan limits apply per account. Credit card checkout is available on request during closed beta.
          </p>
        </div>
      </section>
    </MarketingPageShell>
  );
};

export default PricingPage;
