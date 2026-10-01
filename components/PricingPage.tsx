/**
 * Pricing page: entitlement-true tiers. Hero sells Growth (MCP + share).
 * Prices are the Stars / TON amounts the Worker charges (worker/telegramBot.ts,
 * worker/tonPayment.ts). There is no USD price: card checkout does not exist yet.
 */
import { isInTelegram } from '../services/telegram/tma';
import { TelegramAccountPanel } from './telegram/TelegramAccountPanel';
import React, { useEffect } from 'react';
import { openPaywallModal } from '../services/apiClient';
import { MarketingPageShell } from './marketing/MarketingPageShell';
import { PLAN_ENTITLEMENTS } from '../services/plans/planEntitlements';

interface PricingPageProps {
  onTerminal: () => void;
}

type PaidTierId = 'starter' | 'growth' | 'agency';

const tiers: { id: PaidTierId; stars: string; ton: string; blurb: string; highlight: boolean }[] = [
  {
    id: 'starter',
    stars: '2,500 Stars',
    ton: '15 TON',
    blurb: 'Web audits for a couple of sites. No MCP or public share links.',
    highlight: false,
  },
  {
    id: 'growth',
    stars: '7,500 Stars',
    ton: '45 TON',
    blurb: 'The operator plan: MCP tools, shareable reports, weekly re-audits.',
    highlight: true,
  },
  {
    id: 'agency',
    stars: '18,000 Stars',
    ton: '120 TON',
    blurb: 'API access for paid research, client workspaces, daily re-audits.',
    highlight: false,
  },
];

/** One-off runs sold by the Worker alongside the plans. */
const ONE_OFFS = [
  { title: 'Single audit run', price: '25 Stars', body: 'One on-demand audit with a Proof-of-Audit attestation.' },
  { title: 'Deep multi-agent crawl', price: '75 Stars', body: 'One deep crawl with competitor gap findings.' },
] as const;

function bulletsFor(id: PaidTierId): string[] {
  const e = PLAN_ENTITLEMENTS[id];
  const lines = [
    `${e.domainLimit} monitored domains`,
    e.scheduledReaudit === 'none' ? 'On-demand audits' : `${e.scheduledReaudit} re-audits`,
    e.whiteLabelPdf ? 'Branded PDF exports' : 'Standard exports',
    e.mcpAccess ? 'MCP access (Cursor / Claude / Codex)' : 'No MCP (web app only)',
    e.shareLinks ? 'Public share links' : 'No public share links',
    `${e.teamSeats} team seat${e.teamSeats === 1 ? '' : 's'}`,
  ];
  if (e.apiAccess) lines.push('MCP paid research (Agency API or BYOK DataForSEO)');
  if (e.agencyClientLimit > 0) lines.push(`${e.agencyClientLimit} client workspaces`);
  return lines;
}

const PricingPage: React.FC<PricingPageProps> = ({ onTerminal }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const inTelegram = isInTelegram();
  const free = PLAN_ENTITLEMENTS.free;

  return (
    <MarketingPageShell brandSub="Pricing" wide>
      <section className="mb-14 sm:mb-20 max-w-3xl">
        <p className="mkt-eyebrow mb-4">Pricing</p>
        <h1 className="font-display text-[length:var(--text-display)] tracking-tight leading-[1.05] mb-6 [overflow-wrap:anywhere]">
          Plans for audits, MCP, and share links
        </h1>
        <p className="text-lg text-[var(--color-ink-2)] leading-relaxed mb-4">
          Free covers a Sample scout. Starter is web audits only. Growth is the operator plan: MCP for
          Cursor and shareable reports. Agency adds API access and client workspaces.
        </p>
        <p className="mkt-body mb-8">
          Every paid plan runs 30 days and is paid with Telegram Stars or TON. Card checkout is not
          available yet.
        </p>
        <button type="button" onClick={onTerminal} className="mkt-cta-primary">
          Open Instant Audit
        </button>
      </section>

      <section className="mb-10 grid grid-cols-1 lg:grid-cols-3 gap-px bg-[var(--color-rule)] border border-[var(--color-rule)]">
        {tiers.map((tier) => {
          const lines = bulletsFor(tier.id);
          const title = PLAN_ENTITLEMENTS[tier.id].title;
          return (
            <div
              key={tier.id}
              className={`p-6 sm:p-8 bg-[var(--color-paper)] flex flex-col ${
                tier.highlight ? 'ring-1 ring-inset ring-[var(--color-accent)]' : ''
              }`}
            >
              <div className="flex items-baseline justify-between gap-3 mb-4">
                <h2 className="text-xl font-medium text-[var(--color-ink)]">{title}</h2>
                {tier.highlight && <p className="mkt-eyebrow">Recommended</p>}
              </div>
              <p className="font-display text-4xl sm:text-5xl leading-none text-[var(--color-ink)] mb-2">
                {tier.stars}
              </p>
              <p className="text-[13px] font-mono text-[var(--color-ink-2)] mb-5">or {tier.ton} / 30 days</p>
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
                onClick={() => openPaywallModal(`Choose ${title}. Pay with Telegram Stars or TON.`)}
                className={`w-full ${tier.highlight ? 'mkt-cta-primary' : 'mkt-cta-secondary'}`}
              >
                {inTelegram ? `Subscribe to ${title}` : 'See payment options'}
              </button>
            </div>
          );
        })}
      </section>

      <section className="mb-20 sm:mb-28 grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="min-w-0 border-t border-[var(--color-rule)] pt-5">
          <h2 className="text-xl font-medium text-[var(--color-ink)] mb-2">{free.title}</h2>
          <p className="mkt-body">
            {free.domainLimit} domain, on-demand audits, Sample scouts with no card. No MCP, no public
            share links. Guests run Live audits with their own AI keys.
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
          Stars checkout runs inside the Luminara Mini App in Telegram. On the web, the payment panel
          opens Telegram for you, or takes a license key if you have one.
        </p>
        {inTelegram ? (
          <TelegramAccountPanel />
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => openPaywallModal('Pay with Telegram Stars or TON. Card checkout is not available yet.')}
              className="mkt-cta-primary w-full sm:w-auto"
            >
              See payment options
            </button>
            <TelegramAccountPanel compact />
          </div>
        )}
        <p className="text-[var(--color-ink-2)] text-[13px] mt-6">
          Plans run for 30 days. Plan limits apply per account.
        </p>
      </section>
    </MarketingPageShell>
  );
};

export default PricingPage;
