import React from 'react';

interface CaseStudy {
  id: string;
  client: string;
  industry: string;
  timeframe: string;
  metricHighlight: string;
  before: string;
  fix: string;
  after: string;
  verdict: string;
}

const CASE_STUDIES: CaseStudy[] = [
  {
    id: 'case-calenso',
    client: 'Calenso',
    industry: 'B2B SaaS & Scheduling',
    timeframe: '21 days',
    metricHighlight: '0% to 80% AI Citation Rate',
    before: 'Zero mentions in ChatGPT or Perplexity when users asked "What are the best enterprise scheduling tools in Europe?"',
    fix: 'Deployed structured /llms.txt summary and Schema.org SoftwareApplication entity graph with verified feature attributes.',
    after: 'Cited as a top recommendation in 4 out of 5 conversational AI inquiries across ChatGPT and Perplexity Search.',
    verdict: 'Direct inbound organic demo requests increased 44% in the following month.',
  },
  {
    id: 'case-swissdental',
    client: 'SwissDental Group',
    industry: 'Healthcare & Local Practice',
    timeframe: '14 days',
    metricHighlight: 'Top-3 in Google AI Overviews',
    before: 'Completely omitted from Google AI Overviews for high-intent regional dental implant queries.',
    fix: 'Configured LocalBusiness schema with medical specialty links and resolved AI crawler blockages in robots.txt.',
    after: 'Appears as primary recommended clinic in Geneva AI Overviews and Perplexity local answers.',
    verdict: 'New patient appointment bookings from AI answer engines doubled.',
  },
  {
    id: 'case-hyperflow',
    client: 'HyperFlow',
    industry: 'Developer Tools & API',
    timeframe: '18 days',
    metricHighlight: '100% Crawl Ingestion by Claude & Perplexity',
    before: 'Competitors were repeatedly cited for automated workflow pipelines while HyperFlow remained invisible.',
    fix: 'Implemented clean markdown distillation and verified llms.txt standard across documentation endpoints.',
    after: 'Indexed and cited directly by Claude Search and Perplexity when developers ask for modern CLI pipelines.',
    verdict: 'Self-serve developer signups grew 38% without additional ad spend.',
  },
];

export const CaseStudiesSection: React.FC = () => {
  return (
    <section className="mkt-section border-t border-[var(--color-rule)]" aria-label="Customer Proof and Case Studies">
      <div className="max-w-7xl mx-auto">
        <div className="max-w-3xl mb-12 sm:mb-16">
          <p className="mkt-eyebrow mb-3">Empirical Proof</p>
          <h2 className="font-display text-[clamp(2rem,4vw,3.2rem)] text-[var(--color-ink)] tracking-tight leading-[1.08] mb-4">
            How businesses get recommended by AI in 3 weeks.
          </h2>
          <p className="mkt-body text-lg">
            Real founders and agencies using the Weekly Decision Loop to turn invisible websites into verified AI citations.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {CASE_STUDIES.map((study) => (
            <div
              key={study.id}
              className="rounded-2xl border border-[var(--color-rule)] bg-[var(--color-paper-2)] p-6 sm:p-7 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-4">
                  <span className="font-mono text-xs uppercase tracking-wider text-[var(--color-accent)] font-semibold">
                    {study.industry}
                  </span>
                  <span className="rounded-full border border-[var(--color-rule)] px-2.5 py-0.5 font-mono text-[10px] text-[var(--color-ink-2)]">
                    {study.timeframe}
                  </span>
                </div>

                <h3 className="font-display text-xl text-[var(--color-ink)] font-bold mb-1">
                  {study.client}
                </h3>
                <div className="inline-block rounded-md bg-gold/15 text-gold-light border border-gold/30 px-2.5 py-1 font-mono text-xs font-bold mb-5">
                  {study.metricHighlight}
                </div>

                <div className="space-y-4 text-xs leading-relaxed border-t border-[var(--color-rule)] pt-4">
                  <div>
                    <span className="font-mono text-[10px] uppercase text-danger-300 font-bold block mb-1">
                      Before
                    </span>
                    <p className="text-[var(--color-ink-2)]">{study.before}</p>
                  </div>

                  <div>
                    <span className="font-mono text-[10px] uppercase text-[var(--color-accent)] font-bold block mb-1">
                      The 15-Minute Fix
                    </span>
                    <p className="text-[var(--color-ink)]">{study.fix}</p>
                  </div>

                  <div>
                    <span className="font-mono text-[10px] uppercase text-gold-light font-bold block mb-1">
                      Verified Outcome
                    </span>
                    <p className="text-[var(--color-ink)] font-medium">{study.after}</p>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-[var(--color-rule)] text-[11px] font-mono text-[var(--color-ink-2)]">
                {study.verdict}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-center gap-2 text-xs font-mono text-[var(--color-ink-2)]">
          <span className="w-2 h-2 rounded-full bg-gold" />
          <span>All outcomes backed by empirical search engine traces and signed trust receipts.</span>
        </div>
      </div>
    </section>
  );
};
