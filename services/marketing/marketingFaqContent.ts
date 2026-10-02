/** Single source for landing / methodology FAQ UI and FAQPage JSON-LD. Honest only. */

export interface MarketingFaqItem {
  question: string;
  answer: string;
}

export const MARKETING_FAQ: MarketingFaqItem[] = [
  {
    question: 'What does Luminara Suite check?',
    answer:
      'Instant Audit checks how your site shows up on Google, AI Overviews, ChatGPT, and Perplexity. You get a plain-English verdict and one recommended fix. Each engine result is labeled Measured, Estimated, or Not measured, so you can see what is evidence and what is a best guess.',
  },
  {
    question: 'What is the difference between a sample scout and a live audit?',
    answer:
      'The sample scout on this page uses labeled example engine rows (Not measured). A Live crawl check may confirm robots.txt and llms.txt for the domain you typed. Instant Audit measures answer engines after you create a free account (hosted daily allowance) or sign in. Guests can also bring their own AI keys.',
  },
  {
    question: 'Do I need a credit card to try it?',
    answer:
      'No. The sample scout needs no card and no account. Create a free account to run Live Instant Audit with a daily hosted allowance. Share links and IDE access are part of the Growth and Agency plans.',
  },
  {
    question: 'How is this different from Semrush or Ahrefs?',
    answer:
      'Those tools go deep on classic SEO data such as keywords and backlinks. Luminara focuses on whether AI answer engines mention you, and on the one fix to make next. Many teams use both.',
  },
  {
    question: 'Can agencies share reports and connect Cursor?',
    answer:
      'Yes. Growth includes public share links and MCP access for Cursor and Claude. Agency adds API access and client workspaces. Free and Starter do not include share links or MCP.',
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
