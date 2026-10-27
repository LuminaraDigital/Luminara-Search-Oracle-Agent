import React, { useEffect } from 'react';
import { LIVE_ANSWER_CHECKS } from '../services/marketing/engineCoverage';
import { cardTermLabel } from './paywall/planPrices';
import { EvidenceGlyph, MarketingPageHeader, MarketingPageShell } from './marketing/MarketingPageShell';

interface IntelligencePageProps {
  onTerminal: () => void;
  onNavigateInfrastructure: () => void;
  onNavigatePricing?: () => void;
  onNavigateSampleReport?: () => void;
  onSignUpClick?: () => void;
  onNavigateEnquiryDesk?: () => void;
}

const groundingSteps = [
  {
    step: '01',
    tag: 'Deterministic fetch',
    title: 'Read the live page and crawl files first',
    desc: 'Before any model is called, the Worker fetches /robots.txt, /llms.txt, /ai.txt, page titles, H1-H3 headings, and existing JSON-LD blocks from your public URL.',
    output: 'Evidence lock: Models can only cite tags and text actually present in the crawl pack.',
  },
  {
    step: '02',
    tag: 'Search grounding',
    title: 'Check live search and answer engines',
    desc: 'Runs live search queries for your suburb and service topics where credentials allow, recording which rivals get named and which sources are cited.',
    output: 'Honesty gate: Uncollected engines stay labeled Not measured, never guessed.',
  },
  {
    step: '03',
    tag: 'Structured synthesis',
    title: 'Draft ready-to-paste page and schema fixes',
    desc: 'Generates 40-to-60-word direct suburb answers, LocalBusiness and FAQPage JSON-LD snippets, and routes them through the 3-Tier CMS Fixer.',
    output: 'Readback proof: /api/deploy/readback verifies the live JSON-LD script tag on your URL.',
  },
  {
    step: '04',
    tag: '0 LLM tokens',
    title: 'Enforce statutory and booking guardrails',
    desc: 'In the Enquiry Desk and recovery sweeps, rule-based gates handle STOP opt-outs, Australian state calling windows, and Section 32 or price-quote escalations.',
    output: 'Human sign-off: Licensed agents approve every appraisal slot before booking.',
  },
] as const;

const disciplines = [
  {
    code: 'Discipline 01 · SEO',
    title: 'Search Engine Optimization',
    question: 'Can crawlers index and rank your suburb and service pages?',
    evidence: 'HTTP status, titles, meta descriptions, canonical URLs, heading hierarchy, and internal link structure.',
    deliverable: 'Prioritized technical blocker list and page-level title/meta rewrites.',
    state: 'Measured' as const,
  },
  {
    code: 'Discipline 02 · AEO',
    title: 'Answer Engine Optimization',
    question: 'Can answer engines extract a direct 40-to-60-word suburb answer?',
    evidence: 'Question-form H2/H3 headings, concise opening answer paragraphs, and valid FAQPage JSON-LD blocks.',
    deliverable: 'Ready-to-paste suburb Q&A blocks and validated FAQPage schema.',
    state: 'Measured' as const,
  },
  {
    code: 'Discipline 03 · GEO',
    title: 'Generative Engine Optimization',
    question: 'Do AI models have verifiable entity facts and citations to name your agency?',
    evidence: '/llms.txt, /ai.txt, RealEstateAgent and Organization JSON-LD, review proof, and third-party directory citations.',
    deliverable: 'Public /llms.txt draft, Organization JSON-LD, and off-site mention pack.',
    state: 'Measured' as const,
  },
] as const;

const aiAccessRows = [
  {
    capability: 'Public crawler-file probe (/robots.txt, /llms.txt, /ai.txt)',
    guestByok: 'Included free',
    freeAccount: 'Included free',
    starterGrowth: 'Included on all passes',
    agencyPass: 'Included on Agency',
  },
  {
    capability: 'Hosted LLM & search audit allowance',
    guestByok: 'Use your own keys in Settings',
    freeAccount: '3 hosted checks per UTC day',
    starterGrowth: 'Higher daily allowance by pass',
    agencyPass: 'Highest daily allowance + 10 client workspaces',
  },
  {
    capability: 'Bring Your Own Keys (Gemini, Groq, OpenRouter, NIM, Ollama)',
    guestByok: 'Supported in browser Settings',
    freeAccount: 'Supported + encrypted workspace sync',
    starterGrowth: 'Supported + hosted fallback chain',
    agencyPass: 'Supported + hosted fallback chain',
  },
  {
    capability: 'Live ChatGPT, Perplexity & Google AI Overviews checks',
    guestByok: 'With own DataForSEO login',
    freeAccount: 'With own DataForSEO login',
    starterGrowth: 'With own DataForSEO login',
    agencyPass: 'Included on Agency (or own DataForSEO login)',
  },
  {
    capability: 'MCP Server (/api/mcp) for Claude, Cursor & CMS Fixer tools',
    guestByok: 'Not included',
    freeAccount: 'Not included',
    starterGrowth: 'Included on Growth (Starter is web app only)',
    agencyPass: 'Included + Oracle API & Twenty CRM sync',
  },
] as const;

const SWITCHYARD_DIAGRAM = `Request -> [1. Page & Crawl Pack] -> [2. Model & Search Switchyard]
  |-- Hosted Plan Rail: Gemini / Groq -> NVIDIA NIM -> Workers AI backup
  |-- BYOK Rail (Settings): Your Gemini / Groq / OpenRouter / DataForSEO keys
  v
[3. Claim & Honesty Gate] -> Labels each row Measured | Estimated | Not measured`;

const IntelligencePage: React.FC<IntelligencePageProps> = ({
  onTerminal,
  onNavigateInfrastructure,
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
      footerStatement="Facts before advice."
      wide
      closing={{
        eyebrow: 'Your stack',
        title: (
          <>
            Connect a model, <span className="italic lx-gold-text pr-[0.08em]">then run an audit.</span>
          </>
        ),
        body: 'Add your own keys in Settings, or use the hosted allowance on a free account or 30-day pass. The report only states what that run collected. If a figure was not collected, it says Not measured.',
        cta: { label: 'Open Instant Audit', onClick: onTerminal },
        links: [
          { label: 'How it works', onClick: onNavigateInfrastructure },
          { label: 'See sample report', onClick: handleSample },
          { label: 'View pricing', onClick: handlePricing },
        ],
      }}
    >
      <MarketingPageHeader
        eyebrow="The AI"
        title={
          <>
            The models check the page <span className="italic lx-gold-text pr-[0.08em]">before they advise.</span>
          </>
        }
        lede={`An audit reads live page evidence and web search before generating a single recommendation, and keeps SEO, AEO, and GEO separate instead of inventing a blended score. ${LIVE_ANSWER_CHECKS} If a number was not collected, the report says Not measured.`}
      >
        <button type="button" onClick={onTerminal} className="lx-btn lx-btn-gold">
          Open Instant Audit
        </button>
        <button type="button" onClick={handleSignUp} className="lx-btn lx-btn-ghost">
          Create free account
        </button>
        <button type="button" onClick={handleSample} className="lx-link text-sm">
          See sample report
        </button>
        <button type="button" onClick={handlePricing} className="lx-link text-sm">
          View pricing
        </button>
      </MarketingPageHeader>

      {/* Section 1: Evidence-Before-Advice Grounding Pipeline */}
      <section
        aria-labelledby="grounding-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">Evidence before advice</p>
          <h2 id="grounding-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
            How Luminara stops <span className="italic lx-gold-text pr-[0.08em]">AI hallucinations.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            Generic AI wrappers guess what is on your website from stale training data. Luminara locks every recommendation to live HTTP crawl evidence, search grounding, and deterministic Australian compliance rules.
          </p>
        </div>

        <ol className="m-0 mt-14 grid list-none gap-6 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {groundingSteps.map((item, idx) => (
            <li
              key={item.step}
              data-reveal
              style={{ transitionDelay: `${idx * 70}ms` }}
              className="lx-glass flex flex-col justify-between rounded-[20px] p-6"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-serif text-3xl leading-none lx-gold-text tabular-nums">
                    {item.step}
                  </span>
                  <span className="rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide text-[var(--gold-light)] lx-hairline">
                    {item.tag}
                  </span>
                </div>
                <div aria-hidden className="mt-4 h-px w-full bg-gradient-to-r from-gold/60 to-transparent" />
                <h3 className="mt-4 text-lg font-medium text-[var(--color-ink)]">{item.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-[var(--color-ink-2)]">{item.desc}</p>
              </div>
              <p className="mt-5 border-t pt-3.5 font-mono text-xs leading-relaxed text-[var(--gold-light)] lx-hairline">
                {item.output}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Section 2: Why SEO, AEO, and GEO Stay Separate */}
      <section
        aria-labelledby="disciplines-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="flex flex-wrap items-end justify-between gap-6" data-reveal>
          <div className="max-w-3xl">
            <p className="lx-eyebrow">Three separate checks</p>
            <h2 id="disciplines-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
              SEO, AEO, and GEO stay separate. <span className="italic lx-gold-text pr-[0.08em]">No fake composite score.</span>
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
              Ranking a suburb page in Google, getting extracted as a 50-word direct answer, and being cited as a trusted local entity by conversational AI require different page evidence. We inspect and report each one separately.
            </p>
          </div>
          <button type="button" onClick={onNavigateInfrastructure} className="lx-link text-sm">
            See all 8 audit checks
          </button>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-12">
          {disciplines.map((d, idx) => (
            <article
              key={d.code}
              data-reveal
              style={{ transitionDelay: `${idx * 80}ms` }}
              className="lx-glass flex flex-col justify-between rounded-[20px] p-6 sm:p-8 lg:col-span-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="lx-eyebrow">{d.code}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
                    <EvidenceGlyph state={d.state} />
                    Separate check
                  </span>
                </div>
                <h3 className="mt-4 text-xl font-medium text-[var(--color-ink)]">{d.title}</h3>
                <div aria-hidden className="mt-4 h-px w-full bg-gradient-to-r from-gold/60 to-transparent" />
                <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-2)]">
                  Question answered
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink)]">{d.question}</p>
                <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-2)]">
                  Evidence inspected
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink-2)]">{d.evidence}</p>
              </div>
              <div className="mt-6 border-t pt-4 lx-hairline">
                <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--gold-light)]">
                  Actionable output
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink)]">{d.deliverable}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Section 3: Multi-Provider Switchyard, BYOK & MCP Server Bento */}
      <section
        aria-labelledby="switchyard-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">Model switchyard &amp; agent protocol</p>
          <h2 id="switchyard-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
            Your keys or our hosted allowance, <span className="italic lx-gold-text pr-[0.08em]">with automatic failover.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            Never get locked into a single model vendor. Run on Luminara&apos;s hosted daily allowance, bring your own API keys in Settings, or drive the entire suite from Claude and Cursor over MCP.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-12">
          {/* Left 7-col card: Switchyard & Failover */}
          <article
            data-reveal
            className="lx-glass flex flex-col justify-between rounded-[20px] p-6 sm:p-8 lg:col-span-7"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="lx-eyebrow">Architecture 01 · Switchyard</span>
                <span className="rounded-full border px-2.5 py-0.5 font-mono text-[11px] text-[var(--gold-light)] lx-hairline">
                  Hosted + BYOK
                </span>
              </div>
              <h3 className="mt-4 text-xl font-medium text-[var(--color-ink)]">
                Multi-provider routing with transparent fallback
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">
                Connect Gemini, Groq, OpenRouter, NVIDIA NIM, or local Ollama in Settings, or use the hosted allowance on any signed-in account. When a hosted chat call encounters an upstream rate limit, the Worker falls back through its verified backup chain and labels the model used.
              </p>

              <pre
                tabIndex={0}
                role="region"
                aria-label="Model and search switchyard routing diagram"
                className="mt-5 overflow-x-auto rounded-xl border p-4 font-mono text-xs leading-relaxed text-[var(--color-ink)] lx-hairline"
              >
                <code>{SWITCHYARD_DIAGRAM}</code>
              </pre>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t pt-4 text-xs text-[var(--color-ink-2)] lx-hairline">
              <span>Zero vendor lock-in. Failed backup calls automatically refund your daily check meter.</span>
              <button type="button" onClick={onTerminal} className="lx-link font-medium">
                Test in Instant Audit
              </button>
            </div>
          </article>

          {/* Right 5-col card: MCP Server & Deterministic Guardrails */}
          <article
            data-reveal
            className="lx-glass flex flex-col justify-between rounded-[20px] p-6 sm:p-8 lg:col-span-5"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="lx-eyebrow">Architecture 02 · MCP &amp; Guardrails</span>
                <span className="rounded-full border px-2.5 py-0.5 font-mono text-[11px] text-[var(--gold-light)] lx-hairline">
                  Growth+ &amp; Agency
                </span>
              </div>
              <h3 className="mt-4 text-xl font-medium text-[var(--color-ink)]">
                Programmatic MCP server and statutory safety rails
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">
                Growth and Agency passes unlock `/api/mcp` so your IDE or agent can inspect project context, classify CMS fixes, and query the Enquiry Desk with cryptographic SHA-256 idempotency.
              </p>

              <dl className="mt-5 space-y-2.5 rounded-xl border p-4 text-xs lx-hairline">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <dt className="text-[var(--color-ink-2)]">Free MCP tools (Growth+)</dt>
                  <dd className="font-mono text-[var(--color-ink)]">Projects, context, reports, funnel</dd>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 lx-hairline">
                  <dt className="text-[var(--color-ink-2)]">CMS Fixer MCP</dt>
                  <dd className="font-mono text-[var(--color-ink)]">WordPress, Wix, Squarespace</dd>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 lx-hairline">
                  <dt className="text-[var(--color-ink-2)]">Idempotency ledger</dt>
                  <dd className="font-mono text-[var(--gold-light)]">SHA-256 ExternalEffect keys</dd>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 lx-hairline">
                  <dt className="text-[var(--color-ink-2)]">Statutory escalation</dt>
                  <dd className="font-mono text-[var(--color-ink)]">Section 32 -&gt; Licensed agent</dd>
                </div>
              </dl>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t pt-4 text-xs text-[var(--color-ink-2)] lx-hairline">
              <span>Every booking proposal requires human operator approval.</span>
              <button type="button" onClick={handleEnquiryDesk} className="lx-link font-medium">
                Open Enquiry Desk
              </button>
            </div>
          </article>
        </div>
      </section>

      {/* Section 4: Hosted Passes vs. BYOK Access Matrix */}
      <section
        aria-labelledby="ai-access-heading"
        className="mt-24 border-t pt-20 lx-hairline sm:mt-32 sm:pt-24"
      >
        <div className="max-w-3xl" data-reveal>
          <p className="lx-eyebrow">Hosted allowance vs. your own keys</p>
          <h2 id="ai-access-heading" className="lx-display lx-h3 mt-5 [overflow-wrap:anywhere]">
            Start free or BYOK, <span className="italic lx-gold-text pr-[0.08em]">upgrade for team scale.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            Every account can use either the hosted allowance or personal API keys. Upgrade to a 30-day pass (Starter {cardTermLabel('starter')}, Growth {cardTermLabel('growth')}, Agency {cardTermLabel('agency')}) for higher daily check limits, white-label PDFs, MCP access, and hosted DataForSEO answer checks on Agency.
          </p>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-label="AI model, search grounding, and MCP access by tier"
          className="mt-10 overflow-x-auto rounded-[20px] border lx-glass lx-hairline"
          data-reveal
        >
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wider text-[var(--color-ink-2)] lx-hairline">
                <th scope="col" className="py-4 pl-6 pr-4 font-medium">AI &amp; Grounding Capability</th>
                <th scope="col" className="px-4 py-4 font-medium">Guest + Own Keys</th>
                <th scope="col" className="px-4 py-4 font-medium text-[var(--gold-light)]">Signed-in Free (A$0)</th>
                <th scope="col" className="px-4 py-4 font-medium">Starter / Growth Pass</th>
                <th scope="col" className="py-4 pl-4 pr-6 font-medium text-[var(--color-ink)]">Agency Pass ({cardTermLabel('agency')})</th>
              </tr>
            </thead>
            <tbody className="divide-y lx-hairline">
              {aiAccessRows.map((row) => (
                <tr key={row.capability}>
                  <th scope="row" className="py-4 pl-6 pr-4 font-medium text-[var(--color-ink)]">
                    {row.capability}
                  </th>
                  <td className="px-4 py-4 text-[var(--color-ink-2)] tabular-nums">{row.guestByok}</td>
                  <td className="px-4 py-4 text-[var(--color-ink)] tabular-nums">{row.freeAccount}</td>
                  <td className="px-4 py-4 text-[var(--color-ink)] tabular-nums">{row.starterGrowth}</td>
                  <td className="py-4 pl-4 pr-6 text-[var(--color-ink)] tabular-nums">{row.agencyPass}</td>
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
              Want to test the AI grounding on your own domain?
            </p>
            <p className="mt-1 text-sm text-[var(--color-ink-2)]">
              Run a free crawler-file check right now, sign in for 3 hosted checks per UTC day, or connect your own keys in Settings.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={onTerminal} className="lx-btn lx-btn-gold">
              Open Instant Audit
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

export default IntelligencePage;
