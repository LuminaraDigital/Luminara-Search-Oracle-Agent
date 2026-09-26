/**
 * Pricing page: entitlement-true tiers. Hero sells Growth (MCP + share).
 * Free is a footnote; Starter is web-audit only (no MCP / share).
 * Payment rails remain Stars / TON inside the app.
 */
import { isInTelegram } from '../services/telegram/tma';
import { TelegramAccountPanel } from './telegram/TelegramAccountPanel';
import React, { useEffect } from 'react';
import { ICONS } from '../constants';
import { openPaywallModal } from '../services/apiClient';
import { MarketingNav } from './MarketingNav';
import { PremiumAtmosphere } from './ui/PremiumAtmosphere';
import { PLAN_ENTITLEMENTS } from '../services/plans/planEntitlements';

interface PricingPageProps {
  onBack: () => void;
  onTerminal: () => void;
  onNavigateInfrastructure: () => void;
  onNavigateIntelligence: () => void;
  onNavigateWhy: () => void;
}

export const pricingTiers = [
  {
    id: 'starter' as const,
    priceLabel: 'US$49',
    stars: '2,500 Stars',
    blurb: 'Web audits for up to 2 sites. No MCP or public share links.',
    highlight: false,
  },
  {
    id: 'growth' as const,
    priceLabel: 'US$149',
    stars: '7,500 Stars',
    blurb: 'MCP tools, shareable reports, 3 seats, weekly re-audits.',
    highlight: true,
  },
  {
    id: 'agency' as const,
    priceLabel: 'US$349',
    stars: '18,000 Stars',
    blurb: 'API access, 10 client seats, daily Sentinel, white-label PDF.',
    highlight: false,
  },
];

function bulletsFor(id: 'starter' | 'growth' | 'agency'): string[] {
  const e = PLAN_ENTITLEMENTS[id];
  const lines = [
    `${e.domainLimit} monitored domains`,
    e.scheduledReaudit === 'none' ? 'On-demand audits' : `${e.scheduledReaudit} re-audits`,
    e.whiteLabelPdf ? 'Branded PDF exports' : 'Standard exports',
    e.mcpAccess ? 'MCP access (Cursor / Claude / Codex)' : 'No MCP (web app only)',
    e.shareLinks ? 'Public share links' : 'No public share links',
    `${e.teamSeats} team seat${e.teamSeats === 1 ? '' : 's'}`,
  ];
  if (e.apiAccess) lines.push('Hosted API / research access');
  if (e.agencyClientLimit > 0) lines.push(`${e.agencyClientLimit} client workspaces`);
  return lines;
}

const PricingPage: React.FC<PricingPageProps> = ({
  onBack,
  onTerminal,
  onNavigateInfrastructure,
  onNavigateIntelligence,
  onNavigateWhy,
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] text-white selection:bg-gold selection:text-black font-sans antialiased overflow-x-clip">
      <PremiumAtmosphere intensity="subtle" />
      <MarketingNav
        brandLabel="Luminara Suite"
        brandSub="Pricing"
        onBrandClick={onBack}
        links={[
          { label: 'Home', onClick: onBack },
          { label: 'Why Us', onClick: onNavigateWhy },
          { label: 'How It Works', onClick: onNavigateInfrastructure },
          { label: 'Our AI', onClick: onNavigateIntelligence },
        ]}
        primaryCta={{ label: 'Open app', onClick: onTerminal }}
      />

      <main className="relative z-10 pt-28 sm:pt-36 pb-20 sm:pb-32 max-w-7xl mx-auto px-4 sm:px-6">
        <section className="mb-16 sm:mb-24 max-w-3xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold mb-6">Growth plan</p>
          <h1 className="font-display text-[clamp(2rem,7vw,4.5rem)] tracking-tight leading-[1.05] mb-8 [overflow-wrap:anywhere]">
            MCP, share links, and weekly audits in one workspace.
          </h1>
          <p className="text-base sm:text-xl text-gray-400 font-light leading-relaxed mb-10">
            Free covers a single scout. Starter is web audits only. Growth unlocks MCP for Cursor and shareable
            reports. Pay with Telegram Stars or TON inside the app. Card checkout is coming.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onTerminal}
              className="mkt-cta-primary w-full sm:w-auto"
            >
              Open the app
            </button>
            <button
              type="button"
              onClick={() =>
                openPaywallModal(
                  'Upgrade to Growth for MCP + share links, or Agency for API access. Stars or TON inside the app.',
                )
              }
              className="mkt-cta-secondary w-full sm:w-auto"
            >
              See plans
            </button>
          </div>
          <p className="mt-6 text-xs text-gray-500 font-light leading-relaxed">
            Free: 1 domain, Instant Audit scout, no MCP and no share links. Promo license keys (when issued) remain
            the only trial path.
          </p>
        </section>

        <section className="mb-20 sm:mb-28 grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">
          {pricingTiers.map((tier) => {
            const lines = bulletsFor(tier.id);
            return (
              <div
                key={tier.id}
                className={`p-6 sm:p-8 rounded-2xl border relative flex flex-col ${
                  tier.highlight
                    ? 'border-gold/40 bg-gold/5'
                    : 'border-white/10 bg-black/40'
                }`}
              >
                {tier.highlight ? (
                  <div className="absolute -top-2.5 right-4 px-2.5 py-0.5 rounded-full bg-gold text-black font-black text-[9px] uppercase tracking-widest">
                    Recommended
                  </div>
                ) : null}
                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-gray-400 mb-3">
                  {PLAN_ENTITLEMENTS[tier.id].title}
                </div>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-3xl sm:text-4xl font-light">{tier.priceLabel}</span>
                  <span className="text-gray-500 text-xs uppercase tracking-widest">/ 30 days</span>
                </div>
                <p className="text-sm text-gray-400 font-light leading-relaxed mb-2">{tier.blurb}</p>
                <p className="text-[11px] text-gold/80 font-mono mb-6">{tier.stars} or TON</p>
                <ul className="space-y-3 flex-1 mb-8">
                  {lines.map((line) => (
                    <li key={line} className="flex gap-3 items-start text-sm text-gray-300">
                      <span className="shrink-0 w-6 h-6 rounded-md bg-gold/10 border border-gold/20 flex items-center justify-center text-gold mt-0.5">
                        <ICONS.Check className="w-3.5 h-3.5" />
                      </span>
                      <span className="font-light leading-relaxed">{line}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() =>
                    openPaywallModal(
                      `Choose ${PLAN_ENTITLEMENTS[tier.id].title} with Stars or TON inside the app.`,
                    )
                  }
                  className={`w-full ${tier.highlight ? 'mkt-cta-primary' : 'mkt-cta-secondary'}`}
                >
                  Subscribe in app
                </button>
              </div>
            );
          })}
        </section>

        <section className="mb-16 sm:mb-24 border-t border-white/5 pt-14 sm:pt-20 max-w-2xl">
          {isInTelegram() ? (
            <TelegramAccountPanel />
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() =>
                  openPaywallModal(
                    'Pay with Telegram Stars or TON inside the app. Card checkout is coming; until then subscriptions activate with Stars or TON.',
                  )
                }
                className="mkt-cta-primary w-full"
              >
                Subscribe: Stars or TON
              </button>
              <TelegramAccountPanel compact />
            </div>
          )}
          <p className="text-center text-gray-500 text-[10px] uppercase tracking-widest mt-6">
            Stars or TON inside the app. Card checkout coming. Cancel anytime. Plan limits apply per account.
          </p>
        </section>
      </main>

      <footer
        className="py-12 px-4 sm:px-6 md:px-20 flex flex-col sm:flex-row items-center justify-between gap-6 border-t border-white/[0.06]"
        style={{ paddingBottom: 'max(3rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <p className="text-[10px] text-gray-500 tracking-wide">&copy; {new Date().getFullYear()} Luminara Suite</p>
        <div className="flex flex-wrap justify-center gap-6">
          <a href="/privacy" className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-gold">
            Privacy
          </a>
          <a href="/terms" className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-gold">
            Terms
          </a>
          <a href="/docs/mcp.html" className="text-[10px] uppercase tracking-widest text-gray-500 hover:text-gold">
            MCP
          </a>
        </div>
      </footer>
    </div>
  );
};

export default PricingPage;
