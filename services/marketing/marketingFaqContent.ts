/** Single source for landing / methodology FAQ UI and FAQPage JSON-LD. Honest only. */
import { LIVE_ANSWER_CHECKS } from './engineCoverage';

export interface MarketingFaqItem {
  question: string;
  answer: string;
}

export const MARKETING_FAQ: MarketingFaqItem[] = [
  {
    question: 'What does Luminara Suite check?',
    answer:
      `Instant Audit checks your site and live web search, then gives a plain-English verdict and one fix. ${LIVE_ANSWER_CHECKS} Each result is labeled Measured, Estimated, or Not measured.`,
  },
  {
    question: 'What is the difference between the live crawl check and the full audit?',
    answer:
      `The live crawl check on this page reads robots.txt and llms.txt and leaves the answer engines as Not measured. A signed-in audit also checks your site and live web search. ${LIVE_ANSWER_CHECKS} Guests can also bring their own AI keys.`,
  },
  {
    question: 'Do I need a credit card to try it?',
    answer:
      'No. The live crawl check needs no card and no account. Create a free account to run Instant Audit with a daily hosted allowance. Share links and IDE access are part of the Growth and Agency plans.',
  },
  {
    question: 'How is this different from Semrush or Ahrefs?',
    answer:
      `Those tools go deep on classic SEO data such as keywords and backlinks. Luminara checks your site and live web search, and the one fix to make next. ${LIVE_ANSWER_CHECKS} Many teams use both.`,
  },
  {
    question: 'Can agencies share reports and connect Cursor?',
    answer:
      'Yes. Growth includes public share links and MCP access for Cursor and Claude. Agency adds API access and client workspaces saved in this browser. Free and Starter do not include share links or MCP.',
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
