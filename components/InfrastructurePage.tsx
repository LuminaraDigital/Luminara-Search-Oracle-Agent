import React, { useEffect } from 'react';
import { LIVE_ANSWER_CHECKS } from '../services/marketing/engineCoverage';
import { cardTermLabel } from './paywall/planPrices';
import { EvidenceGlyph, MarketingPageHeader, MarketingPageShell } from './marketing/MarketingPageShell';

interface InfrastructurePageProps {
  onTerminal: () => void;
  onNavigateMethodology: () => void;
  onNavigatePricing?: () => void;
  onNavigateSampleReport?: () => void;
  onSignUpClick?: () => void;
  onNavigateEnquiryDesk?: () => void;
}

const workflowStages = [
  {
    step: '01',
    timing: 'About 60 seconds',
    title: 'Crawl and diagnose the leak',
    desc: 'Reads /robots.txt, /llms.txt, /ai.txt, page titles, headings, and JSON-LD schema on your suburb and service pages, then grounds findings in live search where credentials allow.',
    deliverable: 'Output: Measured vs. Not measured evidence table + top 3 page leaks.',
  },
  {
    step: '02',
    timing: 'Ready to paste',
    title: 'Ship the page and schema Fix Pack',
    desc: 'Generates direct 40-to-60-word suburb answers, LocalBusiness and FAQPage JSON-LD blocks, and /llms.txt drafts. Routes safe fixes via WordPress, Wix, or Squarespace Code Injection.',
    deliverable: 'Output: Copyable schema + llms.txt pack + live /api/deploy/readback check.',
  },
  {
    step: '03',
    timing: 'Instant qualification',
    title: 'Qualify leads in the Enquiry Desk',
    desc: 'Captures seller appraisal, buyer, and landlord enquiries across web forms and missed calls. Steps through approved agency questions and pauses automation on statutory questions.',
    deliverable: 'Output: Structured Opportunity Brief with Section 32 and price-quote guardrails.',
  },
  {
    step: '04',
    timing: 'Human sign-off',
    title: 'Approve bookings and log outcomes',
    desc: 'Your licensed agent approves or declines proposed appraisal slots in one click. Every step is recorded in the 6-stage Evidence-Bound Outcomes Ledger.',
    deliverable: 'Output: Agent-approved appointment + verified funnel count (no invented revenue).',
  },
] as const;

const pillars = [
  {
    title: 'Site crawl',
    badge: 'Every run',
    state: 'Measured' as const,
    desc: 'Checks titles, meta, mobile readiness and obvious technical blockers that keep suburb and service pages from ranking.',
  },
  {
    title: 'AI visibility',
    badge: 'Plan or BYOK',
    state: 'Measured' as const,
    desc: 'On every plan, checks whether your pages and live web search cover the questions buyers and vendors ask before they call.',
  },
  {
    title: 'Citation and page leaks',
    badge: 'Signed-in or BYOK',
    state: 'Measured' as const,
    desc: 'Finds slogan-first openings, buried proof, and missing entity facts that stop AI tools from quoting you and visitors from enquiring.',
  },
  {
    title: 'Content and review proof',
    badge: 'Signed-in or BYOK',
    state: 'Measured' as const,
    desc: 'Checks readability, direct answer blocks, and review visibility so you know which page to tighten first.',
  },
  {
    title: 'Schema mapping',
    badge: 'Signed-in or BYOK',
    state: 'Measured' as const,
    desc: 'Finds structured-data gaps and generates ready-to-paste Organization, LocalBusiness, and FAQ schema blocks.',
  },
  {
    title: 'Impact ranking',
    badge: 'Requires sign-in',
    state: 'Estimated' as const,
    desc: 'A signed-in audit can order fixes by likely leverage on visibility and enquiries. A guest run leaves this Not measured.',
  },
  {
    title: 'Competitor scan',
    badge: 'Requires sign-in',
    state: 'Measured' as const,
    desc: 'A signed-in audit can compare rivals you name in your business profile. A guest run leaves this Not measured.',
  },
  {
    title: 'Progress and enquiry desk',
    badge: 'Requires sign-in',
    state: 'Measured' as const,
    desc: 'A signed-in account keeps earlier audits and opens the Enquiry Desk for qualifying leads into agent-approved bookings. Guests do not get saved history.',
  },
] as const;

const accessRows = [
  {
    capability: 'Public crawl-file check (/robots.txt, /llms.txt, /ai.txt)',
    guest: 'Included free',
    freeAccount: 'Included free',
    paidPass: 'Included on all passes',
  },
  {
    capability: 'Hosted Instant Audit checks',
    guest: 'Not measured (or use own keys)',
    freeAccount: '3 checks per UTC day',
    paidPass: 'Higher daily allowance by tier',
  },
  {
    capability: 'Ready-to-paste JSON-LD schema & /llms.txt Fix Pack',
    guest: 'With own keys in Settings',
    freeAccount: 'Included on audited URLs',
    paidPass: 'Included + 3-Tier CMS Fixer relay',
  },
  {
    capability: 'Saved audit history, impact ranking & competitor scan',
    guest: 'Not measured',
    freeAccount: 'Saved to your account',
    paidPass: 'Saved across client workspaces',
  },
  {
    capability: 'Enquiry Desk, statutory guardrails & booking sign-off',
    guest: 'Preview only',
    freeAccount: 'Included in workspace',
    paidPass: 'Included + Twenty CRM sync & MCP tools',
  },
  {
    capability: 'White-label PDF exports, share links & IDE MCP server',
    guest: 'Not included',
    freeAccount: 'Not included',
    paidPass: 'PDF on Starter+; share links & MCP on Growth+',
  },
  {
    capability: 'Live ChatGPT, Perplexity & Google AI Overviews checks',
    guest: 'With own DataForSEO login',
    freeAccount: 'With own DataForSEO login',
    paidPass: 'Included on Agency (or own DataForSEO login)',
  },
] as const;

const SAMPLE_SCHEMA_SNIPPET = `{
  "@context": "https://schema.org",
  "@type": "RealEstateAgent",
  "name": "Example Independent Agency",
  "areaServed": "Suburb & Surrounding Postcodes",
  "knowsAbout": ["Residential Sales", "Property Appraisals", "Property Management"]
}`;

const InfrastructurePage: React.FC<InfrastructurePageProps> = ({
  onTerminal,
  onNavigateMethodology,
  onNavigatePricing,
  onNavigateSampleReport,
  onSignUpClick,
  onNavigateEnquiryDesk,
}) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handlePricing = onNavigatePricing ?? onTerminal;
  const handleSample = onNavigateSampleReport ?? onTerminal;
  const handleSignUp = onSignUpClick ?? onTerminal;
  const handleEnquiryDesk = onNavigateEnquiryDesk ?? handleSignUp;

  return (
    <MarketingPageShell
      footerStatement="From crawl to a prioritized plan."
      wide
      closing={{
        eyebrow: 'From crawl to plan',
        title: (
          <>
            Run it on <span className="italic lx-gold-text pr-[0.08em]">your own site.</span>
          </>
        ),
        body: 'Enter a URL, choose SEO, AEO, or GEO focus, and the app grounds findings in live search where credentials allow. You get a short action list, not a 40-page PDF.',
        cta: { label: 'Open Instant Audit', onClick: onTerminal },
        links: [
          { label: 'See sample report', onClick: handleSample },
          { label: 'View pricing', onClick: handlePricing },
          { label: 'How we measure', onClick: onNavigateMethodology },
        ],
      }}
    >
      <MarketingPageHeader
        eyebrow="How it works"
        title={
          <>
            What runs when <span className="italic lx-gold-text pr-[0.08em]">you audit a site.</span>
          </>
        }
        lede={`A site crawl and a live web search, then a short list of fixes in plain English that help your pages get cited and win the appraisal call. ${LIVE_ANSWER_CHECKS} Guest runs leave competitor scan, impact ranking, and saved progress as Not measured until you sign in.`}
      >
        <button type="button" onClick={onTerminal} className="lx-btn lx-btn-gold">
          Open Instant Audit
        </button>
        <button type="button" onClick={handleSample} className="lx-btn lx-btn-ghost">
          See sample report
        </button>
        <button type="button" onClick={handlePricing} className="lx-link text-sm">
          View pricing
        </button>
      </MarketingPageHeader>

      {/* Section 1: 4-Stage Operational Pipeline */}
      <section
        aria-labelledby="pipeline-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">The 4-stage loop</p>
          <h2 id="pipeline-heading" className="lx-display lx-h3 mt-5">
            From page leak to <span className="italic lx-gold-text pr-[0.08em]">agent-approved booking.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            Most SEO tools stop at a spreadsheet of broken tags. Luminara connects the technical audit directly to ready-to-paste fixes and the Enquiry Desk so new traffic turns into qualified appraisal calls.
          </p>
        </div>

        <ol className="m-0 mt-14 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {workflowStages.map((stage, idx) => (
            <li
              key={stage.step}
              data-reveal
              style={{ transitionDelay: `${idx * 70}ms` }}
              className="lx-glass flex flex-col justify-between rounded-[20px] p-6"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-serif text-3xl leading-none lx-gold-text tabular-nums">
                    {stage.step}
                  </span>
                  <span className="rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide text-[var(--gold-light)] lx-hairline">
                    {stage.timing}
                  </span>
                </div>
                <div aria-hidden className="mt-4 h-px w-full bg-gradient-to-r from-gold/60 to-transparent" />
                <h3 className="mt-4 text-lg font-medium text-[var(--color-ink)]">{stage.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-[var(--color-ink-2)]">{stage.desc}</p>
              </div>
              <p className="mt-5 border-t pt-3.5 font-mono text-xs leading-relaxed text-[var(--gold-light)] lx-hairline">
                {stage.deliverable}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Section 2: Concrete Deliverables Bento Preview */}
      <section
        aria-labelledby="deliverables-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="flex flex-wrap items-end justify-between gap-6" data-reveal>
          <div className="max-w-2xl">
            <p className="lx-eyebrow">What you get out of a run</p>
            <h2 id="deliverables-heading" className="lx-display lx-h3 mt-5">
              Ready-to-paste fixes, <span className="italic lx-gold-text pr-[0.08em]">not a 40-page PDF.</span>
            </h2>
          </div>
          <p className="rounded-full border px-3.5 py-1.5 text-xs text-[var(--color-ink-2)] lx-hairline">
            Illustrative example, not a live measurement
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-12">
          {/* Deliverable Card 1 (7 cols): Fix Pack + Schema Preview */}
          <article
            data-reveal
            className="lx-glass flex flex-col justify-between rounded-[20px] p-6 sm:p-8 lg:col-span-7"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="lx-eyebrow">Deliverable 01 · Fix Pack</span>
                <span className="inline-flex items-center gap-2 text-xs text-[var(--color-ink-2)]">
                  <EvidenceGlyph state="Measured" />
                  Verified via /api/deploy/readback
                </span>
              </div>
              <h3 className="mt-4 text-xl font-medium text-[var(--color-ink)]">
                Suburb answer block + JSON-LD schema snippet
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">
                Instead of telling you &ldquo;improve structured data&rdquo;, the audit drafts the exact Organization, LocalBusiness, and FAQPage JSON-LD block plus a 50-word direct suburb answer ready for WordPress, Wix, or Squarespace.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border p-3.5 lx-hairline">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-2)]">
                    Before (Leaky suburb page)
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink-2)]">
                    Slogan-first hero, zero RealEstateAgent or FAQ schema, and the appraisal form buried four scrolls down.
                  </p>
                </div>
                <div className="rounded-xl border p-3.5 lx-hairline">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--gold-light)]">
                    After (Ship move applied)
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink)]">
                    Direct suburb commission/timeline answer in the first 60 words, valid JSON-LD, and a clear appraisal request path.
                  </p>
                </div>
              </div>

              <pre
                tabIndex={0}
                role="region"
                aria-label="Sample RealEstateAgent JSON-LD schema snippet"
                className="mt-5 overflow-x-auto rounded-xl border p-4 font-mono text-xs leading-relaxed text-[var(--color-ink)] lx-hairline"
              >
                <code>{SAMPLE_SCHEMA_SNIPPET}</code>
              </pre>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t pt-4 text-xs text-[var(--color-ink-2)] lx-hairline">
              <span>Supports Tier 1 MCP Auto-Fix, Tier 2 Builder Patch, and Tier 3 Engineering Handoff.</span>
              <button type="button" onClick={onTerminal} className="lx-link font-medium">
                Generate for your domain
              </button>
            </div>
          </article>

          {/* Deliverable Card 2 (5 cols): Enquiry Desk Qualification Brief */}
          <article
            data-reveal
            className="lx-glass flex flex-col justify-between rounded-[20px] p-6 sm:p-8 lg:col-span-5"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="lx-eyebrow">Deliverable 02 · Enquiry Desk</span>
                <span className="rounded-full border px-2.5 py-0.5 font-mono text-[11px] text-[var(--gold-light)] lx-hairline">
                  Human sign-off required
                </span>
              </div>
              <h3 className="mt-4 text-xl font-medium text-[var(--color-ink)]">
                Evidence-Bound Opportunity Brief
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">
                When an audit fix brings in a vendor or landlord enquiry, the Enquiry Desk qualifies the lead using approved playbooks and holds proposed appraisal slots for your agent&apos;s approval.
              </p>

              <dl className="mt-5 space-y-2.5 rounded-xl border p-4 text-xs lx-hairline">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <dt className="text-[var(--color-ink-2)]">Playbook intent</dt>
                  <dd className="font-mono text-[var(--color-ink)]">Seller appraisal (Residential)</dd>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 lx-hairline">
                  <dt className="text-[var(--color-ink-2)]">Captured fields</dt>
                  <dd className="inline-flex items-center gap-1.5 font-mono text-[var(--color-ink)]">
                    <EvidenceGlyph state="Measured" />
                    Address, timeframe, property type
                  </dd>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 lx-hairline">
                  <dt className="text-[var(--color-ink-2)]">Statutory guard</dt>
                  <dd className="font-mono text-[var(--gold-light)]">
                    Section 32 / price quote -&gt; Agent takeover
                  </dd>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 lx-hairline">
                  <dt className="text-[var(--color-ink-2)]">Revenue attribution</dt>
                  <dd className="inline-flex items-center gap-1.5 font-mono text-[var(--color-ink-2)]">
                    <EvidenceGlyph state="Not measured" />
                    Not measured (stage counts only)
                  </dd>
                </div>
              </dl>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t pt-4 text-xs text-[var(--color-ink-2)] lx-hairline">
              <span>Australian Spam Act 2003 and state calling-window compliant.</span>
              <button type="button" onClick={handleEnquiryDesk} className="lx-link font-medium">
                Open Enquiry Desk
              </button>
            </div>
          </article>
        </div>
      </section>

      {/* Section 3: What a Run Includes (8 Diagnostic Pillars) */}
      <section
        aria-labelledby="checks-heading"
        className="mt-24 grid gap-14 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24 lg:grid-cols-12 lg:gap-16"
      >
        <div className="lg:col-span-4" data-reveal>
          <div className="lg:sticky lg:top-32">
            <p className="lx-eyebrow">What it checks</p>
            <h2 id="checks-heading" className="lx-display lx-h3 mt-5">
              What a run <span className="italic lx-gold-text pr-[0.08em]">includes.</span>
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-ink-2)]">
              Every check is labeled Measured, Estimated, or Not measured so you never pitch or act on invented numbers.
            </p>
          </div>
        </div>
        <ol className="m-0 grid list-none gap-x-10 gap-y-14 p-0 sm:grid-cols-2 lg:col-span-8">
          {pillars.map((p, idx) => (
            <li key={p.title} className="min-w-0" data-reveal style={{ transitionDelay: `${(idx % 2) * 90}ms` }}>
              <div className="flex items-center justify-between gap-3">
                <span aria-hidden className="font-serif text-4xl leading-none lx-gold-text tabular-nums">
                  {(idx + 1).toString().padStart(2, '0')}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-[var(--color-ink-2)] lx-hairline">
                  <EvidenceGlyph state={p.state} />
                  {p.badge}
                </span>
              </div>
              <div aria-hidden className="mt-5 h-px w-full bg-gradient-to-r from-gold/60 to-transparent" />
              <h3 className="mt-5 text-xl font-medium text-[var(--color-ink)]">{p.title}</h3>
              <p className="mt-3 leading-relaxed text-[var(--color-ink-2)]">{p.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Section 4: Guest vs. Signed-In Free vs. Paid Passes Conversion Matrix */}
      <section
        aria-labelledby="access-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">What unlocks when you sign in</p>
          <h2 id="access-heading" className="lx-display lx-h3 mt-5">
            Start as a guest, <span className="italic lx-gold-text pr-[0.08em]">scale when ready.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            Test any public domain&apos;s crawler files immediately. Create a free account for 3 hosted Instant Audit checks a day and saved history, or unlock a 30-day pass (Starter {cardTermLabel('starter')}, Growth {cardTermLabel('growth')}, Agency {cardTermLabel('agency')}) when you manage multiple client sites.
          </p>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-label="Capability comparison by access tier"
          className="mt-10 overflow-x-auto rounded-[20px] border lx-glass lx-hairline"
          data-reveal
        >
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wider text-[var(--color-ink-2)] lx-hairline">
                <th scope="col" className="py-4 pl-6 pr-4 font-medium">Capability</th>
                <th scope="col" className="px-4 py-4 font-medium">Guest (no login)</th>
                <th scope="col" className="px-4 py-4 font-medium text-[var(--gold-light)]">Signed-in Free (A$0)</th>
                <th scope="col" className="py-4 pl-4 pr-6 font-medium text-[var(--color-ink)]">30-Day Passes (Starter / Growth / Agency)</th>
              </tr>
            </thead>
            <tbody className="divide-y lx-hairline">
              {accessRows.map((row) => (
                <tr key={row.capability}>
                  <th scope="row" className="py-4 pl-6 pr-4 font-medium text-[var(--color-ink)]">
                    {row.capability}
                  </th>
                  <td className="px-4 py-4 text-[var(--color-ink-2)] tabular-nums">{row.guest}</td>
                  <td className="px-4 py-4 text-[var(--color-ink)] tabular-nums">{row.freeAccount}</td>
                  <td className="py-4 pl-4 pr-6 text-[var(--color-ink)] tabular-nums">{row.paidPass}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          data-reveal
          className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-[20px] border p-6 lx-glass lx-hairline"
        >
          <div>
            <p className="text-base font-medium text-[var(--color-ink)]">
              Ready to run your first full audit?
            </p>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              Create a free account for 3 hosted checks a day, or bring your own AI keys in Settings at any time.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={handleSignUp} className="lx-btn lx-btn-gold">
              Create free account
            </button>
            <button type="button" onClick={handlePricing} className="lx-btn lx-btn-ghost">
              Compare 30-day passes
            </button>
          </div>
        </div>
      </section>
    </MarketingPageShell>
  );
};

export default InfrastructurePage;
