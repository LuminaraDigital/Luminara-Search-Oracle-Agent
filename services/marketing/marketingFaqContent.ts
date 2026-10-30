/** Single source for landing / methodology FAQ UI and FAQPage JSON-LD. Honest only. */

export interface MarketingFaqItem {
  question: string;
  answer: string;
}

export const MARKETING_FAQ: MarketingFaqItem[] = [
  {
    question: 'What does Luminara Suite check?',
    answer:
      'Instant Audit checks your site and live web search, flags the citation and page leaks that cost you appraisal enquiries, and gives a plain-English verdict with one ready-to-paste fix. Each result is labeled Measured, Estimated, or Not measured.',
  },
  {
    question: 'What is the difference between the free check and the full audit?',
    answer:
      'The free check on this page reads your homepage title, description and structured data, plus robots.txt and llms.txt, and leaves the answer engines as Not measured. A signed-in audit also checks your site and live web search. Guests can also bring their own AI keys.',
  },
  {
    question: 'Do I need a credit card to try it?',
    answer:
      'No. The free check needs no card and no account. Create a free account to run Instant Audit with a daily hosted allowance. The free plan includes public share links and IDE access with daily caps. Growth removes the caps.',
  },
  {
    question: 'How is this different from Semrush or Ahrefs?',
    answer:
      'Those tools go deep on classic SEO data such as keywords and backlinks. Luminara checks your site and live web search for the buyer questions that drive appraisal calls, and gives you the one page, review, or schema fix to ship next. Many teams use both.',
  },
  {
    question: 'How is this different from asking an AI chatbot about my site?',
    answer:
      'A chatbot gives a one-off answer and may guess when it cannot check. Instant Audit fetches your live site and web search, shows the evidence for each result, and labels anything it could not check as Not measured.',
  },
  {
    question: 'Does Luminara make up numbers?',
    answer:
      'No. A result is Measured only when it came from a live check or from data you supplied, such as a Search Console export. A best guess from partial data is labeled Estimated. Missing data stays Not measured and is never filled in.',
  },
  {
    question: 'Does Luminara change my website?',
    answer:
      'Only if you ask it to. By default it reads your public pages and hands you copy and schema to paste. If you connect WordPress or Webflow it can send the schema for you, or it can open a GitHub pull request. A WordPress change counts as done only when the schema is found on the live page. Webflow and GitHub results tell you what is left to publish or merge.',
  },
  {
    question: 'Can agencies share reports and connect Cursor?',
    answer:
      'Yes, on every plan. Free includes share links and MCP for Cursor and Claude with daily caps. Starter adds your own branding, Growth removes the caps, and Agency adds API access and client workspaces.',
  },
];

export function buildFaqPageJsonLd(
  items: readonly MarketingFaqItem[] = MARKETING_FAQ,
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
