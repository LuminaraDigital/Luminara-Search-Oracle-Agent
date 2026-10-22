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
import { TELEGRAM_MINI_APP_URL, isStripeCheckoutAvailable, isTonAvailable } from './paywall/paymentOptions';
import { CHECKOUT_TERM_LINE, NO_TAX_LINE, NOTHING_TO_CANCEL, PLAN_CARD_BADGE, TELEGRAM_STARS_HANDOFF, WAITLIST_LINE, freePlanLines, listPriceSummary, planAudience, planBullets, planSeatLine, planTitle, pricingTiers, starsPayLabel } from './paywall/planCopy';
import { approximateAudLabel } from './paywall/planPrices';
import { PRICING_HERO } from '../services/marketing/marketingHeroCopy';

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

/** One public pass. The Worker still accepts the 75 Star SKU, which grants the same access. */
const DAY_PASS = {
  title: '24-hour pass',
  price: '25 Stars',
  body: 'Premium hosted AI engines and hosted calls past the free daily cap, for one site, for 24 hours. ChatGPT, Perplexity and AI Overviews stay Not measured unless you are on Agency or use your own DataForSEO login. Telegram also lists this same pass at 75 Stars.',
} as const;

const PricingPage: React.FC<PricingPageProps> = ({ onTerminal }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const inTelegram = isInTelegram();
  // TON is paid on the web with a connected wallet, never inside Telegram, and only while the
  // Worker reports that checkout open. Until then this page names Stars alone.
  const tonOpen = !inTelegram && isTonAvailable(getServerHealthSync());
  const cardOpen = !inTelegram && isStripeCheckoutAvailable(getServerHealthSync(), false);
  const tonClause = tonOpen ? ' Or with TON on the web.' : '';
  const miniAppLinkProps = inTelegram
    ? { rel: 'noopener noreferrer' as const }
    : { target: '_blank' as const, rel: 'noopener noreferrer' as const };

  return (
    <MarketingPageShell
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
        eyebrow={PRICING_HERO.eyebrow}
        title={
          <>
            {PRICING_HERO.titleLead} <span className="italic lx-gold-text pr-[0.08em]">{PRICING_HERO.titleEm}</span>
          </>
        }
        lede={PRICING_HERO.lede}
      />
      <p className="lx-enter-rise lx-d4 mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-[var(--color-ink-2)]">
        {CHECKOUT_TERM_LINE}{tonClause}
      </p>
      <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-[var(--color-ink-2)]">
        {listPriceSummary()}
      </p>
      <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-[var(--color-ink-2)]">
        {NO_TAX_LINE} {NOTHING_TO_CANCEL} For a refund, email info@luminara.digital.
      </p>
      {!cardOpen && !tonOpen && (
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-[var(--color-ink-2)]">
          {WAITLIST_LINE}
        </p>
      )}

      <section aria-labelledby="plans-heading" className="lx-enter-rise lx-d5 mt-16 sm:mt-20">
        <h2 id="plans-heading" className="sr-only">
          Plans
        </h2>
        <p className="mx-auto mb-8 max-w-2xl text-center text-sm leading-relaxed text-[var(--color-ink-2)]">
          Solo Agent is {planTitle('starter')} ({planSeatLine('starter')}) and {planTitle('growth')} ({planSeatLine('growth')}). Agency is {planTitle('agency')} ({planSeatLine('agency')}) and includes white-label PDF.
        </p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="lx-glass relative flex min-w-0 flex-col rounded-3xl p-6 sm:p-8">
            <h3 className="font-serif text-3xl leading-tight text-[var(--color-ink)]">{PLAN_ENTITLEMENTS.free.title}</h3>
            <p className="mt-7 font-serif text-5xl leading-none text-[var(--color-ink)]">A$0</p>
            <p className="mt-3 text-[13px] text-[var(--color-ink-2)]">No card</p>
            <p className="mt-6 leading-relaxed text-[var(--color-ink-2)]">
              One domain, on-demand audits, and a daily hosted allowance after you create an account.
            </p>
            <ul className="m-0 mt-7 flex-1 list-none space-y-3 border-t p-0 pt-6 lx-hairline">
              {freePlanLines().map((text) => (
                <li key={text} className="flex gap-3 text-[15px] leading-snug text-[var(--color-ink)]">
                  <span aria-hidden className="mt-[0.4em] h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" />
                  {text}
                </li>
              ))}
            </ul>
            <button type="button" onClick={onTerminal} className="lx-btn lx-btn-ghost mt-9 w-full">
              Start free
            </button>
          </article>
          {pricingTiers.map((tier) => {
            const lines = planBullets(tier.id);
            const title = planTitle(tier.id);
            return (
              <article
                key={tier.id}
                className={`lx-glass relative flex min-w-0 flex-col rounded-3xl p-6 sm:p-8 ${
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
                <p className="mt-2 text-[13px] text-[var(--color-ink-2)]">{planAudience(tier.id)} · {planSeatLine(tier.id)}</p>
                  {tier.highlight && <p className="lx-eyebrow shrink-0 !text-[11px]">{PLAN_CARD_BADGE}</p>}
                </div>
                <p
                  className={`mt-7 font-serif text-6xl leading-none ${
                    tier.highlight ? 'lx-gold-text' : 'text-[var(--color-ink)]'
                  }`}
                >
                  {cardOpen ? tier.priceLabel : approximateAudLabel(tier.priceLabel)}
                </p>
                <p className="mt-3 text-[13px] text-[var(--color-ink-2)]">
                  {cardOpen
                    ? `or ${tier.stars} in Telegram · 30 days`
                    : tonOpen
                      ? `${tier.stars} · 30 days · or ${tier.ton} on the web`
                      : `${tier.stars} · 30 days`}
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
                  {cardOpen ? `Pay ${tier.priceLabel} by card` : starsPayLabel(tier.stars, inTelegram)}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="day-pass-heading" className="mt-20 max-w-2xl sm:mt-24">
        <h2 id="day-pass-heading" className="lx-eyebrow" data-reveal>
          One day, one site
        </h2>
        <div className="mt-8 border-t pt-6 lx-hairline" data-reveal>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-serif text-2xl text-[var(--color-ink)]">{DAY_PASS.title}</h3>
            <p className="shrink-0 text-sm text-[var(--gold-light)]">{DAY_PASS.price}</p>
          </div>
          <p className="mt-3 leading-relaxed text-[var(--color-ink-2)]">{DAY_PASS.body} Paid in Telegram.</p>
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
            {tonOpen ? 'TON checkout runs on this page with a connected wallet. ' : ''}A license key, if you have one, is entered in the payment panel.
          </p>
        </div>
        <div className="min-w-0 lg:col-span-7" data-reveal>
          {tonOpen && (
            <p className="text-[15px] leading-relaxed text-[var(--color-ink)]">
              TON is paid on this page, from the payment panel.
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a href={TELEGRAM_MINI_APP_URL} {...miniAppLinkProps} className="lx-btn lx-btn-ghost">
              Open in Telegram
            </a>
            <button type="button" onClick={() => openPaywallModal(`${TELEGRAM_STARS_HANDOFF}${tonClause}`)} className="lx-btn lx-btn-ghost">
              See payment options
            </button>
          </div>
          <div className="mt-8">{inTelegram ? <TelegramAccountPanel showTermLine={false} /> : <TelegramAccountPanel compact showTermLine={false} />}</div>
          <p className="mt-6 text-[13px] leading-relaxed text-[var(--color-ink-2)]">
            Plan limits apply per account.
          </p>
        </div>
      </section>
    </MarketingPageShell>
  );
};

export default PricingPage;
