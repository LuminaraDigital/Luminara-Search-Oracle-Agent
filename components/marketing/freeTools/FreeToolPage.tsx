import React, { useEffect } from 'react';
import { MarketingPageHeader, MarketingPageShell } from '../MarketingPageShell';
import {
  FREE_TOOLS,
  FREE_TOOLS_CLOSING,
  FREE_TOOLS_HUB,
  type FreeTool,
  type FreeToolId,
} from '../../../services/marketing/freeTools';
import { productTelemetry } from '../../../services/analytics/productTelemetry';
import { SerpPreviewTool } from './SerpPreviewTool';
import { RobotsTxtTool } from './RobotsTxtTool';
import { LlmsTxtTool } from './LlmsTxtTool';
import { SchemaTool } from './SchemaTool';

const PANELS: Record<FreeToolId, React.FC<{ onCopied: () => void }>> = {
  'serp-preview': SerpPreviewTool,
  'robots-txt-generator': RobotsTxtTool,
  'llms-txt-generator': LlmsTxtTool,
  'schema-generator': SchemaTool,
};

const SECTION = 'mt-16 border-t pt-16 lx-hairline';
const BODY = 'text-[15px] leading-relaxed text-[var(--color-ink-2)]';

const Faq: React.FC<{ items: readonly { question: string; answer: string }[] }> = ({ items }) => (
  <section aria-labelledby="tool-faq-heading" className={SECTION}>
    <h2 id="tool-faq-heading" className="lx-display lx-h3 mb-8">Common questions</h2>
    <div className="max-w-3xl border-b lx-hairline">
      {items.map((item) => (
        <details key={item.question} className="lx-faq group border-t lx-hairline">
          <summary className="py-6 text-lg leading-snug text-[var(--color-ink)]">{item.question}</summary>
          <p className={`-mt-1 max-w-2xl pb-7 ${BODY}`}>{item.answer}</p>
        </details>
      ))}
    </div>
  </section>
);

const ToolCards: React.FC<{ tools: readonly FreeTool[] }> = ({ tools }) => (
  <ul className="grid list-none gap-6 p-0 sm:grid-cols-2">
    {tools.map((tool) => (
      <li key={tool.id}>
        <a href={tool.path} className="lx-glass group block h-full rounded-3xl p-6 sm:p-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]">
          <h3 className="lx-display text-2xl text-[var(--color-ink)]">{tool.label}</h3>
          <p className={`mt-3 ${BODY}`}>{tool.blurb}</p>
          <span className="lx-link mt-5 inline-block text-sm">Open the tool</span>
        </a>
      </li>
    ))}
  </ul>
);

const ToolBody: React.FC<{ tool: FreeTool }> = ({ tool }) => {
  const Panel = PANELS[tool.id];
  return (
    <>
      <section aria-label={tool.label} className="mt-14">
        <Panel onCopied={() => productTelemetry.track('free_tool_copied', { tool: tool.id })} />
      </section>

      <section aria-labelledby="steps-heading" className={SECTION}>
        <h2 id="steps-heading" className="lx-display lx-h3">How to use it</h2>
        <ol className={`mt-6 max-w-3xl list-decimal space-y-3 pl-5 ${BODY}`}>
          {tool.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className={`${SECTION} grid gap-12 md:grid-cols-2`}>
        {tool.why.map((block) => (
          <div key={block.heading}>
            <h2 className="lx-display text-2xl text-[var(--color-ink)]">{block.heading}</h2>
            <p className={`mt-4 ${BODY}`}>{block.body}</p>
          </div>
        ))}
      </section>

      <Faq items={tool.faq} />

      <section aria-labelledby="more-tools-heading" className={SECTION}>
        <h2 id="more-tools-heading" className="lx-eyebrow mb-6">More free tools</h2>
        <ToolCards tools={FREE_TOOLS.filter((other) => other.id !== tool.id)} />
      </section>
    </>
  );
};

/** /free-tools and /free-tools/*. Copy, crawler HTML, and JSON-LD share services/marketing/freeTools. */
const FreeToolPage: React.FC<{ tool: FreeTool | null; onCheckSite: () => void }> = ({ tool, onCheckSite }) => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tool]);

  return (
    <MarketingPageShell
      footerStatement="Measure when we can. Label when we cannot."
      wide
      closing={{
        eyebrow: FREE_TOOLS_CLOSING.eyebrow,
        title: (
          <>
            Now check your <span className="italic lx-gold-text pr-[0.08em]">whole site.</span>
          </>
        ),
        body: FREE_TOOLS_CLOSING.body,
        cta: { label: FREE_TOOLS_CLOSING.cta, onClick: onCheckSite },
      }}
    >
      <MarketingPageHeader
        eyebrow={tool ? 'Free tool · runs in your browser' : 'Free tools'}
        title={tool ? tool.h1 : FREE_TOOLS_HUB.h1}
        lede={tool ? tool.lede : FREE_TOOLS_HUB.lede}
      >
        {!tool && (
          <button type="button" onClick={onCheckSite} className="lx-btn lx-btn-gold">
            {FREE_TOOLS_CLOSING.cta}
          </button>
        )}
      </MarketingPageHeader>

      {tool ? (
        <ToolBody tool={tool} />
      ) : (
        <>
          <section aria-label="Tools" className="mt-14">
            <ToolCards tools={FREE_TOOLS} />
          </section>
          <Faq items={FREE_TOOLS_HUB.faq} />
        </>
      )}
    </MarketingPageShell>
  );
};

export default FreeToolPage;
