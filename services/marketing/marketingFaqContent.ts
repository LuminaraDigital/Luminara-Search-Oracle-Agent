/** Single source for landing / methodology FAQ UI and FAQPage JSON-LD. Honest only. */

export interface MarketingFaqItem {
  question: string;
  answer: string;
}

export const MARKETING_FAQ: MarketingFaqItem[] = [
  {
    question: 'What does Luminara Suite measure?',
    answer:
      'Instant Audit checks how a domain shows up across Google, AI Overviews, ChatGPT, and Perplexity, then returns a plain-English verdict and one ship-first action. Each engine is labeled Measured, Estimated, or Not measured. We never invent a bare composite AI visibility score.',
  },
  {
    question: 'What is a Sample scout versus Live Instant Audit?',
    answer:
      'The landing Workbench Probe is a labeled Sample so you can see the report shape without hosted spend. Live Instant Audit uses your own API keys as a guest, or an account for hosted AI, save, share, and MCP.',
  },
  {
    question: 'Do I need a credit card to try it?',
    answer:
      'No. Sample scouts need no card. Free insight stays free. Share links and MCP keys require Growth or Agency. Hosted Worker AI spend needs a signed-in account.',
  },
  {
    question: 'How is this different from Semrush or Ahrefs?',
    answer:
      'Those tools go deep on classic SEO datasets. Luminara focuses on answer-engine presence plus an owner-first action plan, with honest not-measured labels when evidence is missing. Many teams use both.',
  },
  {
    question: 'Can agencies share reports and connect Cursor?',
    answer:
      'Growth includes public share links and MCP access for Cursor, Claude, and the Luminara plugin. Agency adds API access and larger client workspaces. Free and Starter do not include share or MCP.',
  },
];

export function buildFaqPageJsonLd(items: MarketingFaqItem[] = MARKETING_FAQ): Record<string, unknown> {
  return {
    '@type': 'FAQPage',
    '@id': 'https://www.luminarasuite.com/#faq',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}
