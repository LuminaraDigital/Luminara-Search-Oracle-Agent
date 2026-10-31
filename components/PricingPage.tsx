/**
 * Pricing page: entitlement-true tiers. Hero sells Growth (no daily cap on IDE access + share).
 * Prices are the AUD card prices and the Stars / TON amounts the Worker charges
 * (worker/telegramBot.ts, worker/tonPayment.ts, worker/stripePayment.ts), mirrored in ./paywall/planPrices.
 */
import { isInTelegram } from '../services/telegram/tma';
import { TelegramAccountPanel } from './telegram/TelegramAccountPanel';
import React, { useEffect, useState } from 'react';
import { accountCallsAllowed, getServerHealthSync, openPaywallModal } from '../services/apiClient';
import { beginCardCheckout, CARD_CHECKOUT_ERROR_EVENT, readCardCheckoutError } from './paywall/pendingCardCheckout';
import { EvidenceGlyph, MarketingPageHeader, MarketingPageShell } from './marketing/MarketingPageShell';
import { PLAN_ENTITLEMENTS } from '../services/plans/planEntitlements';
import { TELEGRAM_MINI_APP_URL, isStripeCheckoutAvailable, isTonAvailable } from './paywall/paymentOptions';
import {
  BYOK_CHECKOUT_LINE,
  CHECKOUT_TERM_LINE,
  NO_TAX_LINE,
  NOTHING_TO_CANCEL,
  PLAN_CARD_BADGE,
  TELEGRAM_STARS_HANDOFF,
  WAITLIST_LINE,
  freePlanLines,
  listPriceSummary,
  planBullets,
  planSeatLine,
  planTitle,
  pricingTiers,
  starsPayLabel,
  type PlanBullet,
} from './paywall/planCopy';
import { cardPayLabel, cardTermLabel, type PaidPlanId } from './paywall/planPrices';
import { PRICING_HERO } from '../services/marketing/marketingHeroCopy';
import { LIVE_ANSWER_CHECKS } from '../services/marketing/engineCoverage';
import { COMPANY_SERVICES_URL } from '../services/legal/consumerTerms';

export { pricingTiers };

interface PricingPageProps {
  onTerminal: () => void;
  onBack?: () => void;
  onNavigateInfrastructure?: () => void;
  onNavigateIntelligence?: () => void;
  onNavigateWhy?: () => void;
  onNavigateSampleReport?: () => void;
  onSignUpClick?: () => void;
  isAuthenticated?: boolean;
}

/** The line the paywall opens with when a plan is chosen here. TON is named only while its checkout is open. */
export function planChoiceLine(title: string, tier: { stars: string; ton: string }, tonOpen: boolean): string {
  return tonOpen
    ? `Choose ${title}: ${tier.stars} inside the Mini App, or ${tier.ton} on the web.`
    : `Choose ${title}: ${tier.stars} inside the Mini App.`;
}

/** One public pass, at 25 Stars. A legacy 75-Star invoice can still be credited. It is not offered here. */
const DAY_PASS = {
  title: '24-hour pass',
  price: '25 Stars',
  body: 'Premium hosted AI engines and hosted calls past the free daily cap, for one site, for 24 hours. Live answers from specific AI products stay Not measured unless you are on Agency or you connect your own search login.',
} as const;

const buyerFitCards = [
  {
    badge: 'Profile 01 · Starter Pass',
    title: 'Single-office principal or local business',
    term: cardTermLabel('starter'),
    summary: 'Built for an owner-operator fixing 1 or 2 core domains who wants ranked page leaks, ready-to-paste LocalBusiness and FAQPage JSON-LD, white-label PDF exports, and monthly re-audit reminders in Telegram.',
  },
  {
    badge: 'Profile 02 · Growth Pass (Recommended)',
    title: 'In-house marketer or multi-suburb team',
    term: cardTermLabel('growth'),
    summary: 'Built for teams monitoring up to 5 domains who share read-only audit links with vendors or executives, connect Claude or Cursor via /api/mcp, and run weekly re-audit reminders in Telegram.',
  },
  {
    badge: 'Profile 03 · Agency Pass',
    title: 'Multi-office group or digital agency',
    term: cardTermLabel('agency'),
    summary: `Built for groups managing up to 25 domains across 10 client workspaces with daily re-audit reminders in Telegram and Twenty CRM sync. ${LIVE_ANSWER_CHECKS}`,
  },
] as const;

const capabilityMatrixRows = [
  {
    feature: 'Monitored domains',
    free: '1 domain',
    starter: '2 domains',
    growth: '5 domains',
    agency: '25 domains',
  },
  {
    feature: 'Client workspaces',
    free: 'Personal workspace',
    starter: 'Personal workspace',
    growth: 'Personal workspace',
    agency: '10 client workspaces',
  },
  {
    feature: 'Hosted Instant Audit checks',
    free: '3 checks per UTC day',
    starter: 'Higher daily allowance',
    growth: 'Higher daily allowance',
    agency: 'Highest daily allowance',
  },
  {
    feature: 'Ready-to-paste JSON-LD schema & /llms.txt Fix Pack',
    free: 'Included',
    starter: 'Included',
    growth: 'Included',
    agency: 'Included',
  },
  {
    feature: '3-Tier CMS Fixer & live /api/deploy/readback',
    free: 'Included in web app',
    starter: 'Included in web app',
    growth: 'Included + MCP relay',
    agency: 'Included + MCP relay',
  },
  {
    feature: 'Enquiry Desk, statutory guardrails & booking sign-off',
    free: 'Included in workspace',
    starter: 'Included in workspace',
    growth: 'Included + MCP tools',
    agency: 'Included + Twenty CRM sync',
  },
  {
    feature: 'White-label PDF exports',
    free: 'Not included',
    starter: 'Included',
    growth: 'Included',
    agency: 'Included',
  },
  {
    feature: 'Public share links & IDE MCP access (Cursor / Claude)',
    free: '3 links + 100 MCP calls a day',
    starter: '10 links + 300 MCP calls a day',
    growth: 'No daily cap',
    agency: 'No daily cap',
  },
  {
    feature: 'Re-audit reminders in Telegram',
    free: 'On-demand only',
    starter: 'Monthly reminders',
    growth: 'Weekly reminders',
    agency: 'Daily reminders',
  },
  {
    feature: 'Live ChatGPT, Perplexity & Google AI Overviews checks',
    free: 'With own DataForSEO login',
    starter: 'With own DataForSEO login',
    growth: 'With own DataForSEO login',
    agency: 'Included on Agency (or own DataForSEO login)',
  },
] as const;

const pricingFaqItems = [
  {
    question: 'Does a 30-day pass renew automatically or bill my card again?',
    answer: 'No. Every paid plan is a one-time 30-day grant that starts as soon as payment is confirmed. It never renews on its own, so there is nothing to cancel.',
  },
  {
    question: 'What happens to my saved reports and Enquiry Desk leads after 30 days?',
    answer: 'Your account, saved audit history, and Enquiry Desk records stay in your workspace. When a 30-day pass ends, your account simply returns to the Free allowance (3 hosted checks per UTC day, or your own keys in Settings) until you activate another pass.',
  },
  {
    question: 'Can I bring my own API keys (BYOK) instead of buying a pass?',
    answer: `${BYOK_CHECKOUT_LINE} You can paste your own Gemini, Groq, OpenRouter, or DataForSEO credentials in Settings at any time.`,
  },
  {
    question: 'Which pass includes live ChatGPT, Perplexity, and Google AI Overviews checks?',
    answer: `${LIVE_ANSWER_CHECKS} Every other check is labeled Measured, Estimated, or Not measured so you never act on invented scores.`,
  },
  {
    question: 'When should we engage Luminara Digital instead of a self-serve pass?',
    answer: `Self-serve passes cover Instant Audit, Tier 1 and Tier 2 CMS Fix Packs, and the Enquiry Desk. If your agency needs a custom Next.js rebuild, SSR hydration refactoring, or bespoke CRM webhook engineering, our team at ${COMPANY_SERVICES_URL} scopes and delivers that engineering work directly.`,
  },
] as const;

function PlanFeature({ line }: { line: PlanBullet }) {
  return (
    <li
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
  );
}

const PricingPage: React.FC<PricingPageProps> = ({
  onTerminal,
  onNavigateInfrastructure,
  onNavigateSampleReport,
  onSignUpClick,
  isAuthenticated = false,
}) => {
  const [busyPlan, setBusyPlan] = useState<PaidPlanId | null>(null);
  const [cardNote, setCardNote] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onError = (event: Event) => {
      const error = readCardCheckoutError(event);
      if (error) setCardNote(error);
      setBusyPlan(null);
    };
    window.addEventListener(CARD_CHECKOUT_ERROR_EVENT, onError);
    return () => window.removeEventListener(CARD_CHECKOUT_ERROR_EVENT, onError);
  }, []);

  const startPricedCard = async (planId: PaidPlanId) => {
    setCardNote(null);
    if (accountCallsAllowed()) setBusyPlan(planId);
    const result = await beginCardCheckout(planId);
    if (result.ok) return;
    if (!('needsAccount' in result)) setCardNote(result.error);
    setBusyPlan(null);
  };

  const handleHowItWorks = onNavigateInfrastructure ?? onTerminal;
  const handleSample = onNavigateSampleReport ?? onTerminal;
  const handleSignUp = onSignUpClick ?? onTerminal;

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
        links: [
          { label: 'See sample report', onClick: handleSample },
          { label: 'How it works', onClick: handleHowItWorks },
        ],
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
      >
        {!isAuthenticated && (
          <button type="button" onClick={handleSignUp} className="lx-btn lx-btn-gold">
            Create free account
          </button>
        )}
        <button type="button" onClick={onTerminal} className={isAuthenticated ? 'lx-btn lx-btn-gold' : 'lx-btn lx-btn-ghost'}>
          Open Instant Audit
        </button>
        <button type="button" onClick={handleSample} className="lx-link text-sm">
          See sample report
        </button>
      </MarketingPageHeader>
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article className="lx-glass relative flex min-w-0 flex-col rounded-3xl p-6 sm:p-8">
            <h3 className="font-serif text-3xl leading-tight text-[var(--color-ink)]">{PLAN_ENTITLEMENTS.free.title}</h3>
            <p className="mt-7 font-serif text-5xl leading-none text-[var(--color-ink)] tabular-nums">A$0</p>
            <p className="mt-3 text-[13px] text-[var(--color-ink-2)]">No card</p>
            <p className="mt-6 leading-relaxed text-[var(--color-ink-2)]">
              One domain, on-demand audits, and a daily hosted allowance after you create an account.
            </p>
            <ul className="m-0 mt-7 flex-1 list-none space-y-3 border-t p-0 pt-6 lx-hairline">
              {freePlanLines().map((line) => (
                <PlanFeature key={line.text} line={line} />
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
                <div>
                  {/* Same height on every card so the price lines up. */}
                  <div className="mb-3 h-4">
                    {tier.highlight ? (
                      <p className="lx-eyebrow whitespace-nowrap !text-[11px] !leading-none">{PLAN_CARD_BADGE}</p>
                    ) : null}
                  </div>
                  <h3 className="font-serif text-3xl leading-tight text-[var(--color-ink)]">{title}</h3>
                  <p className="mt-1 whitespace-nowrap text-[13px] text-[var(--color-ink-2)]">{planSeatLine(tier.id)}</p>
                </div>
                <p
                  className={`mt-7 font-serif text-6xl leading-none tabular-nums ${
                    tier.highlight ? 'lx-gold-text' : 'text-[var(--color-ink)]'
                  }`}
                >
                  {tier.priceLabel}
                </p>
                <p className="mt-3 text-[13px] text-[var(--color-ink-2)] tabular-nums">
                  {cardTermLabel(tier.id)}
                </p>
                <p className="mt-1 text-[13px] text-[var(--color-ink-2)] tabular-nums">
                  {tonOpen ? `${tier.stars} · or ${tier.ton} on the web` : `${tier.stars} in Telegram`}
                </p>
                <p className="mt-6 leading-relaxed text-[var(--color-ink-2)]">{tier.blurb}</p>
                <ul className="m-0 mt-7 flex-1 list-none space-y-3 border-t p-0 pt-6 lx-hairline">
                  {lines.map((line) => (
                    <PlanFeature key={line.text} line={line} />
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busyPlan === tier.id}
                  onClick={() => {
                    if (cardOpen) {
                      void startPricedCard(tier.id);
                      return;
                    }
                    openPaywallModal(planChoiceLine(title, tier, tonOpen));
                  }}
                  className={`lx-btn mt-9 w-full disabled:opacity-60 ${tier.highlight ? 'lx-btn-gold' : 'lx-btn-ghost'}`}
                >
                  {busyPlan === tier.id ? 'Opening checkout…' : cardOpen ? cardPayLabel(tier.id) : starsPayLabel(tier.stars, inTelegram)}
                </button>
              </article>
            );
          })}
        </div>
        {cardNote ? (
          <p role="alert" className="mx-auto mt-6 max-w-2xl text-center text-sm leading-relaxed text-[var(--color-ink)]">
            {cardNote}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="day-pass-heading" className="mt-20 max-w-2xl sm:mt-24">
        <h2 id="day-pass-heading" className="lx-eyebrow" data-reveal>
          One day, one site
        </h2>
        <div className="mt-8 border-t pt-6 lx-hairline" data-reveal>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-serif text-2xl text-[var(--color-ink)]">{DAY_PASS.title}</h3>
            <p className="shrink-0 text-sm text-[var(--gold-light)] tabular-nums">{DAY_PASS.price}</p>
          </div>
          <p className="mt-3 leading-relaxed text-[var(--color-ink-2)]">{DAY_PASS.body} Paid in Telegram.</p>
        </div>
      </section>

      {/* Section: Which Pass Fits Your Agency */}
      <section
        aria-labelledby="fit-guide-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">Which pass fits your agency</p>
          <h2 id="fit-guide-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
            Match the pass to <span className="italic lx-gold-text pr-[0.08em]">your domain footprint.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            Every pass is a 30-day grant with no recurring lock-in. Start free on a single domain, or pick the pass that matches how many suburb and client sites you manage.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-12">
          {buyerFitCards.map((item, idx) => (
            <article
              key={item.title}
              data-reveal
              style={{ transitionDelay: `${idx * 80}ms` }}
              className="lx-glass flex flex-col justify-between rounded-[20px] p-6 sm:p-8 lg:col-span-4"
            >
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="lx-eyebrow">{item.badge}</span>
                  <span className="rounded-full border px-2.5 py-0.5 font-mono text-[11px] text-[var(--gold-light)] tabular-nums lx-hairline">
                    {item.term}
                  </span>
                </div>
                <h3 className="mt-4 text-xl font-medium text-[var(--color-ink)]">{item.title}</h3>
                <div aria-hidden className="mt-4 h-px w-full bg-gradient-to-r from-gold/60 to-transparent" />
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-ink-2)]">{item.summary}</p>
              </div>
              <div className="mt-6 flex items-center justify-between gap-2 border-t pt-4 text-xs text-[var(--color-ink-2)] lx-hairline">
                <span className="inline-flex items-center gap-1.5">
                  <EvidenceGlyph state="Measured" />
                  30-day pass, non-renewing
                </span>
                <button type="button" onClick={onTerminal} className="lx-link font-medium">
                  Audit a domain
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Section: Full 4-Tier Capability Matrix */}
      <section
        aria-labelledby="matrix-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">Side-by-side comparison</p>
          <h2 id="matrix-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
            What is included <span className="italic lx-gold-text pr-[0.08em]">on every tier.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            Every tier includes the core page and schema Fix Pack and the Enquiry Desk workspace. Every tier also gets share links and MCP. Higher tiers lift domain and daily caps and add white-label PDFs and hosted live answer checks.
          </p>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-label="Full capability comparison across Free, Starter, Growth, and Agency"
          className="mt-10 overflow-x-auto rounded-[20px] border lx-glass lx-hairline"
          data-reveal
        >
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wider text-[var(--color-ink-2)] lx-hairline">
                <th scope="col" className="py-4 pl-6 pr-4 font-medium">Capability</th>
                <th scope="col" className="px-4 py-4 font-medium">Free (A$0)</th>
                <th scope="col" className="px-4 py-4 font-medium">Starter ({cardTermLabel('starter')})</th>
                <th scope="col" className="px-4 py-4 font-medium text-[var(--gold-light)]">Growth ({cardTermLabel('growth')})</th>
                <th scope="col" className="py-4 pl-4 pr-6 font-medium text-[var(--color-ink)]">Agency ({cardTermLabel('agency')})</th>
              </tr>
            </thead>
            <tbody className="divide-y lx-hairline">
              {capabilityMatrixRows.map((row) => (
                <tr key={row.feature}>
                  <th scope="row" className="py-4 pl-6 pr-4 font-medium text-[var(--color-ink)]">
                    {row.feature}
                  </th>
                  <td className="px-4 py-4 text-[var(--color-ink-2)] tabular-nums">{row.free}</td>
                  <td className="px-4 py-4 text-[var(--color-ink)] tabular-nums">{row.starter}</td>
                  <td className="px-4 py-4 text-[var(--color-ink)] tabular-nums">{row.growth}</td>
                  <td className="py-4 pl-4 pr-6 text-[var(--color-ink)] tabular-nums">{row.agency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section: Pricing & Pass FAQ */}
      <section
        aria-labelledby="pricing-faq-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">Common questions</p>
          <h2 id="pricing-faq-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
            Pass terms, keys, <span className="italic lx-gold-text pr-[0.08em]">and data retention.</span>
          </h2>
        </div>

        <div className="lx-faq mt-10 divide-y rounded-[20px] border px-6 lx-glass lx-hairline sm:px-8" data-reveal>
          {pricingFaqItems.map((item) => (
            <details key={item.question} className="group py-5">
              <summary className="flex items-center justify-between gap-4 text-left text-base font-medium text-[var(--color-ink)]">
                <span>{item.question}</span>
                <span aria-hidden className="font-mono text-sm text-[var(--gold-light)] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-2)]">
                {item.answer}
              </p>
            </details>
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
