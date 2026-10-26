/** Single source for landing / methodology FAQ UI and FAQPage JSON-LD. Honest only. */

export interface MarketingFaqItem {
  question: string;
  answer: string;
}

export const MARKETING_FAQ: MarketingFaqItem[] = [
  {
    question: 'What does Luminara Suite check?',
    answer:
      'Instant Audit checks your site and live web search, then gives a plain-English verdict and one fix. Each result is labeled Measured, Estimated, or Not measured.',
  },
  {
    question: 'What is the difference between the live crawl check and the full audit?',
    answer:
      'The live crawl check on this page reads robots.txt and llms.txt and leaves the answer engines as Not measured. A signed-in audit also checks your site and live web search. Guests can also bring their own AI keys.',
  },
  {
    question: 'Do I need a credit card to try it?',
    answer:
      'No. The live crawl check needs no card and no account. Create a free account to run Instant Audit with a daily hosted allowance. A measured win can be shared on the free plan. Full branded share links and IDE access are part of the Growth and Agency plans.',
  },
  {
    question: 'How is this different from Semrush or Ahrefs?',
    answer:
      'Those tools go deep on classic SEO data such as keywords and backlinks. Luminara checks your site and live web search, and the one fix to make next. Many teams use both.',
  },
  {
    question: 'Can agencies share reports and connect Cursor?',
    answer:
      'A measured win can be shared on the free plan. Growth includes full branded share links and MCP access for Cursor and Claude. Agency adds API access and client workspaces.',
  },
];

export function buildFaqPageJsonLd(
  items: MarketingFaqItem[] = MARKETING_FAQ,
  id = 'https://www.luminarasuite.com/#faq',
): Record<string, unknown> {
  return {
    '@type': 'FAQPage',
    '@id': id,
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
