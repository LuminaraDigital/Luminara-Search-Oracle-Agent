import React, { useEffect } from 'react';
import { EvidenceGlyph, MarketingPageHeader, MarketingPageShell } from './marketing/MarketingPageShell';
import { MarketingCompareTable } from './marketing/MarketingCompareTable';
import { LIVE_ANSWER_CHECKS } from '../services/marketing/engineCoverage';
import { HUB_PAGES, HUB_REVIEWED } from '../services/marketing/seoHubPages';
import { cardTermLabel } from './paywall/planPrices';
import { COMPANY_SERVICES_URL } from '../services/legal/consumerTerms';

interface WhyLuminaraPageProps {
  onTerminal: () => void;
  onNavigatePricing: () => void;
  onNavigateAudit?: () => void;
  onNavigateSampleReport?: () => void;
  onNavigateEnquiryDesk?: () => void;
  onNavigateHowItWorks?: () => void;
}

const contrasts = [
  { label: 'Outcome focus', them: '40-page technical audit PDFs', us: 'Why AI skipped you and what wins the appraisal call' },
  { label: 'Delivery', them: 'Weeks of back-and-forth', us: 'Audit in the app when you need it' },
  { label: 'Evidence', them: 'Slide decks and opinion', us: 'Search-grounded where keys allow' },
  { label: 'Priority', them: 'Long unordered lists', us: 'One ready-to-paste page, review, or schema fix first' },
  { label: 'Enquiry follow-up', them: 'Stops at traffic reports', us: 'Enquiry Desk qualifies leads for agent-approved bookings' },
  { label: 'Cost model', them: 'Retainer or project fees', us: '30-day passes or your own AI keys' },
] as const;

const threeWayRows = [
  {
    dimension: 'Primary output',
    retainer: 'Monthly PDF deck and keyword rank spreadsheet',
    trackers: 'Read-only charts of prompt mentions and sentiment',
    luminara: 'Ranked page leaks + ready-to-paste Fix Pack + Enquiry Desk brief',
  },
  {
    dimension: 'Suburb page & schema fixes',
    retainer: 'Quoted as extra dev hours or manual copywriting',
    trackers: 'Not included (monitoring only)',
    luminara: 'Drafts LocalBusiness & FAQPage JSON-LD, /llms.txt, and 50-word suburb answers',
  },
  {
    dimension: 'CMS deployment verification',
    retainer: 'Manual spot check weeks later',
    trackers: 'Not included',
    luminara: '3-Tier CMS Fixer (WordPress, Wix, Squarespace) + live /api/deploy/readback',
  },
  {
    dimension: 'Lead qualification & booking',
    retainer: 'Stops at traffic or form-fill count',
    trackers: 'Stops at citation count',
    luminara: 'Enquiry Desk qualifies seller/landlord leads and holds slots for agent sign-off',
  },
  {
    dimension: 'Australian compliance & honesty',
    retainer: 'Varies by consultant',
    trackers: 'Often blends unverified scores into a single percentage',
    luminara: 'Every row labeled Measured, Estimated, or Not measured; statutory queries escalate to agent',
  },
  {
    dimension: 'Commercial model',
    retainer: 'Multi-month retainer lock-in',
    trackers: 'Recurring seat or prompt-tier subscription',
    luminara: 'Free account (3 checks/day), 30-day passes, or bring your own keys',
  },
] as const;

const agencyRoles = [
  {
    badge: 'Role 01 · Selling Principals',
    title: 'Win the suburb appraisal call',
    problem: 'Vendors ask AI and Google who sells homes like theirs in their suburb, then call the one or two agents named with clear proof.',
    solution: 'Spots why a rival page was cited instead of yours, drafts the missing suburb answer and review schema, and routes new seller enquiries to your phone for 1-click booking approval.',
    ctaLabel: 'Run a suburb audit',
    action: 'audit' as const,
  },
  {
    badge: 'Role 02 · Property Management BDMs',
    title: 'Turn landlord searches into managements',
    problem: 'Landlord pages often bury management structure, arrears process, and suburb vacancy context behind generic brochure copy.',
    solution: 'Flags missing landlord FAQ blocks, ships ready-to-paste structured data, and qualifies inbound landlord enquiries while escalating statutory or fee-guarantee questions to your BDM.',
    ctaLabel: 'Open Enquiry Desk',
    action: 'enquiry' as const,
  },
  {
    badge: 'Role 03 · Multi-Office & Marketing Teams',
    title: 'Ship across offices without tool sprawl',
    problem: 'Juggling separate rank trackers, schema generators, AI prompt monitors, and lead spreadsheets slows down every campaign.',
    solution: 'Run repeatable audits across up to 10 client workspaces on Agency, export white-label PDFs on Starter+, share public links on every plan, and connect Cursor or Claude via /api/mcp.',
    ctaLabel: 'See 30-day passes',
    action: 'pricing' as const,
  },
] as const;

const fitReasons = [
  'You want one workflow that connects search and AI visibility directly to page fixes and qualified appraisal bookings.',
  'You prefer every metric labeled Measured, Estimated, or Not measured instead of an invented composite score.',
  'You operate in Australian real estate or local services and need Section 32, cooling-off, and price-quote questions escalated to a licensed human.',
  `You want flexible access: start free with 3 hosted checks per UTC day, bring your own keys, or buy a 30-day pass (Starter ${cardTermLabel('starter')}, Growth ${cardTermLabel('growth')}, Agency ${cardTermLabel('agency')}).`,
] as const;

const notFitReasons = [
  {
    label: 'You need a custom Next.js rebuild or bespoke CRM engineering',
    detail: 'Luminara Suite diagnoses leaks and ships Tier 1 and Tier 2 CMS Fix Packs. For Tier 3 full-stack rebuilds, SSR hydration refactors, or custom webhook engineering, delegate to our engineering practice at Luminara Digital.',
    href: COMPANY_SERVICES_URL,
    linkLabel: 'Visit Luminara Digital',
  },
  {
    label: 'You only want a multi-billion URL backlink index',
    detail: 'Luminara is not a backlink crawler. If your daily workflow is link prospecting and historical anchor-text mining, pair Luminara with a dedicated backlink index such as Ahrefs.',
    href: '/compare/ahrefs',
    linkLabel: 'Read Luminara vs Ahrefs',
  },
  {
    label: 'You want an autonomous bot to quote property prices without human sign-off',
    detail: 'By design, Luminara never invents property valuations, legal answers, or unapproved calendar bookings. Every appraisal slot and statutory question requires licensed agent sign-off.',
    href: '/how-it-works',
    linkLabel: 'See how guardrails work',
  },
] as const;

const WhyLuminaraPage: React.FC<WhyLuminaraPageProps> = ({
  onTerminal,
  onNavigatePricing,
  onNavigateAudit,
  onNavigateSampleReport,
  onNavigateEnquiryDesk,
  onNavigateHowItWorks,
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleAudit = onNavigateAudit ?? onTerminal;
  const handleSample = onNavigateSampleReport ?? onTerminal;
  const handleEnquiry = onNavigateEnquiryDesk ?? onTerminal;
  const handleHowItWorks = onNavigateHowItWorks ?? onTerminal;

  const comparePages = HUB_PAGES.filter((page) => page.kind === 'compare');
  const bestPages = HUB_PAGES.filter((page) => page.kind === 'best');

  return (
    <MarketingPageShell
      footerStatement="Measure when we can. Label when we cannot."
      wide
      closing={{
        eyebrow: 'Start free',
        title: (
          <>
            Start with one <span className="italic lx-gold-text pr-[0.08em]">site audit.</span>
          </>
        ),
        body: 'Run Instant Audit on the URL that matters most. Create a free account to save results and use the hosted daily allowance, or bring your own AI keys as a guest.',
        cta: { label: 'Create free account', onClick: onTerminal },
        links: [
          { label: 'Open Instant Audit', onClick: handleAudit },
          { label: 'See sample report', onClick: handleSample },
          { label: 'View pricing', onClick: onNavigatePricing },
        ],
      }}
    >
      <MarketingPageHeader
        eyebrow="Why Luminara"
        title={
          <>
            Replace tool sprawl with <span className="italic lx-gold-text pr-[0.08em]">one clear plan.</span>
          </>
        }
        lede={`Luminara Suite is for real estate agencies that want to be the agent AI names when vendors ask who to call, fix the page leaks costing them appraisal enquiries, and skip expensive consultancy retainers. ${LIVE_ANSWER_CHECKS}`}
      >
        <button type="button" onClick={onTerminal} className="lx-btn lx-btn-gold">
          Create free account
        </button>
        <button type="button" onClick={handleAudit} className="lx-btn lx-btn-ghost">
          Open Instant Audit
        </button>
        <button type="button" onClick={handleSample} className="lx-link text-sm">
          See sample report
        </button>
        <button type="button" onClick={onNavigatePricing} className="lx-link text-sm">
          View pricing
        </button>
      </MarketingPageHeader>

      {/* Section 1: The 3-Way Buyer Decision (Retainers vs. Read-Only AI Trackers vs. Luminara) */}
      <section
        aria-labelledby="market-gap-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">The 3-way buyer decision</p>
          <h2 id="market-gap-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
            Dashboards don&apos;t fix pages. <span className="italic lx-gold-text pr-[0.08em]">PDFs don&apos;t book appraisals.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            Agencies usually get stuck between two half-solutions: paying a monthly retainer for slow PDF audits, or subscribing to a read-only AI tracker that graphs prompt mentions without fixing a single suburb page or qualifying a single lead.
          </p>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-label="Comparison across Retainer SEO Agencies, Read-Only AI Trackers, and Luminara Suite"
          className="mt-12 overflow-x-auto rounded-[20px] border lx-glass lx-hairline"
          data-reveal
        >
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wider text-[var(--color-ink-2)] lx-hairline">
                <th scope="col" className="py-4 pl-6 pr-4 font-medium">Dimension</th>
                <th scope="col" className="px-4 py-4 font-medium">Retainer SEO Agency</th>
                <th scope="col" className="px-4 py-4 font-medium">Read-Only AI Trackers</th>
                <th scope="col" className="py-4 pl-4 pr-6 font-medium text-[var(--gold-light)]">Luminara Suite</th>
              </tr>
            </thead>
            <tbody className="divide-y lx-hairline">
              {threeWayRows.map((row) => (
                <tr key={row.dimension}>
                  <th scope="row" className="py-4 pl-6 pr-4 font-medium text-[var(--color-ink)]">
                    {row.dimension}
                  </th>
                  <td className="px-4 py-4 text-[var(--color-ink-2)]">{row.retainer}</td>
                  <td className="px-4 py-4 text-[var(--color-ink-2)]">{row.trackers}</td>
                  <td className="py-4 pl-4 pr-6 text-[var(--color-ink)]">
                    <span className="flex items-start gap-2.5">
                      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" />
                      <span>{row.luminara}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: Built for How Real Estate Agencies Operate (3 Role Cards) */}
      <section
        aria-labelledby="roles-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">Built for every seat in the agency</p>
          <h2 id="roles-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
            How Principals, BDMs, and Marketers <span className="italic lx-gold-text pr-[0.08em]">use the suite.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            Whether you run a single-office boutique or manage ten client domains, every workflow ends in a concrete action you can ship or approve today.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-12">
          {agencyRoles.map((role, idx) => {
            const onCardClick =
              role.action === 'audit'
                ? handleAudit
                : role.action === 'enquiry'
                  ? handleEnquiry
                  : onNavigatePricing;
            return (
              <article
                key={role.title}
                data-reveal
                style={{ transitionDelay: `${idx * 80}ms` }}
                className="lx-glass flex flex-col justify-between rounded-[20px] p-6 sm:p-8 lg:col-span-4"
              >
                <div>
                  <p className="lx-eyebrow">{role.badge}</p>
                  <h3 className="mt-4 text-xl font-medium text-[var(--color-ink)]">{role.title}</h3>
                  <div aria-hidden className="mt-4 h-px w-full bg-gradient-to-r from-gold/60 to-transparent" />
                  <p className="mt-4 text-xs font-mono uppercase tracking-wider text-[var(--color-ink-2)]">
                    The bottleneck
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-2)]">{role.problem}</p>
                  <p className="mt-4 text-xs font-mono uppercase tracking-wider text-[var(--gold-light)]">
                    How Luminara solves it
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink)]">{role.solution}</p>
                </div>
                <div className="mt-6 border-t pt-4 lx-hairline">
                  <button type="button" onClick={onCardClick} className="lx-link text-sm font-medium">
                    {role.ctaLabel}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Section 3: Compared to a Manual SEO Project */}
      <section aria-labelledby="compare-heading" className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24">
        <div className="flex flex-wrap items-end justify-between gap-6" data-reveal>
          <div className="max-w-3xl">
            <p className="lx-eyebrow">The difference</p>
            <h2 id="compare-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
              Compared to a <span className="italic lx-gold-text pr-[0.08em]">manual SEO project</span>
            </h2>
            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-[var(--color-ink-2)]">
              Qualitative differences only. We do not invent conversion rates or customer counts.
            </p>
          </div>
          <button type="button" onClick={handleHowItWorks} className="lx-link text-sm">
            See all 4 workflow stages
          </button>
        </div>

        <MarketingCompareTable themLabel="Manual project" usLabel="Luminara Suite" rows={contrasts} />
      </section>

      {/* Section 4: Radical Honesty: Right Fit vs. When to Choose Something Else */}
      <section
        aria-labelledby="honesty-fit-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">Honest buyer guide</p>
          <h2 id="honesty-fit-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
            When Luminara fits, and <span className="italic lx-gold-text pr-[0.08em]">when to use something else.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            We would rather tell you upfront what Luminara does and does not do than oversell a subscription.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-12">
          <article
            data-reveal
            className="lx-glass flex flex-col justify-between rounded-[20px] p-6 sm:p-8 lg:col-span-7"
          >
            <div>
              <p className="lx-eyebrow">Strong fit</p>
              <h3 className="mt-4 text-xl font-medium text-[var(--color-ink)]">
                Choose Luminara Suite when
              </h3>
              <ul className="m-0 mt-6 list-none space-y-4 p-0">
                {fitReasons.map((reason) => (
                  <li key={reason} className="flex items-start gap-3 text-sm leading-relaxed text-[var(--color-ink)]">
                    <span className="mt-1.5 shrink-0">
                      <EvidenceGlyph state="Measured" />
                    </span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-4 border-t pt-5 lx-hairline">
              <button type="button" onClick={onTerminal} className="lx-btn lx-btn-gold">
                Create free account
              </button>
              <button type="button" onClick={onNavigatePricing} className="lx-btn lx-btn-ghost">
                Compare 30-day passes
              </button>
            </div>
          </article>

          <article
            data-reveal
            className="lx-glass flex flex-col justify-between rounded-[20px] p-6 sm:p-8 lg:col-span-5"
          >
            <div>
              <p className="lx-eyebrow">When to pair or delegate</p>
              <h3 className="mt-4 text-xl font-medium text-[var(--color-ink)]">
                When another tool or team is better
              </h3>
              <ul className="m-0 mt-6 list-none space-y-5 p-0">
                {notFitReasons.map((item) => (
                  <li key={item.label} className="border-t pt-4 first:border-t-0 first:pt-0 lx-hairline">
                    <p className="text-sm font-medium text-[var(--color-ink)]">{item.label}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink-2)]">{item.detail}</p>
                    <a
                      href={item.href}
                      target={item.href.startsWith('http') ? '_blank' : undefined}
                      rel={item.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                      className="mt-2 inline-block lx-link text-xs font-medium"
                    >
                      {item.linkLabel}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        </div>
      </section>

      {/* Section 5: Structured Competitor & Buyer-Guide Hub Grid */}
      <section aria-labelledby="hub-heading" className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24">
        <div className="flex flex-wrap items-end justify-between gap-4" data-reveal>
          <div className="max-w-2xl">
            <p className="lx-eyebrow">Independent comparisons</p>
            <h2 id="hub-heading" className="lx-display lx-h3 mt-5">
              Compared to <span className="italic lx-gold-text pr-[0.08em]">other tools</span>
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-ink-2)]">
              Sourced from each vendor&apos;s public product and documentation pages (reviewed {HUB_REVIEWED}). Every comparison includes when to choose them instead of us.
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {comparePages.map((page) => (
            <article
              key={page.path}
              data-reveal
              className="lx-glass flex flex-col justify-between rounded-[20px] p-5"
            >
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--gold-light)]">
                  Head-to-head
                </p>
                <h3 className="mt-2 text-base font-medium text-[var(--color-ink)]">
                  <a href={page.path} className="lx-link">
                    {page.label}
                  </a>
                </h3>
                <p className="mt-2.5 text-xs leading-relaxed text-[var(--color-ink-2)]">
                  {page.verdict}
                </p>
              </div>
              <div className="mt-4 border-t pt-3 lx-hairline">
                <a
                  href={page.path}
                  aria-label={`Read full comparison: ${page.label}`}
                  className="lx-link text-xs font-medium"
                >
                  Read full comparison
                </a>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {bestPages.map((page) => (
            <article
              key={page.path}
              data-reveal
              className="lx-glass flex flex-col justify-between rounded-[20px] p-5"
            >
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-2)]">
                  Buyer guide
                </p>
                <h3 className="mt-2 text-base font-medium text-[var(--color-ink)]">
                  <a href={page.path} className="lx-link">
                    {page.label}
                  </a>
                </h3>
                <p className="mt-2.5 text-xs leading-relaxed text-[var(--color-ink-2)]">
                  {page.verdict}
                </p>
              </div>
              <div className="mt-4 border-t pt-3 lx-hairline">
                <a
                  href={page.path}
                  aria-label={`Read buyer guide: ${page.label}`}
                  className="lx-link text-xs font-medium"
                >
                  Read buyer guide
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>
    </MarketingPageShell>
  );
};

export default WhyLuminaraPage;
