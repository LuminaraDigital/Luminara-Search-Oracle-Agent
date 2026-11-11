/** Single source for landing / methodology FAQ UI and FAQPage JSON-LD. Honest only. */

import { PUBLIC_PRIVACY_URL } from '../legal/privacyCopy';
import { LIVE_ANSWER_CHECKS } from './engineCoverage';
import { FREE_ASK_DAILY, FREE_HOSTED_AUDIT_DAILY } from './marketingPositioning';
import { PLATFORM_FAQ_ANSWER } from './platformSurfaces';

export interface MarketingFaqItem {
  question: string;
  answer: string;
}

export const MARKETING_FAQ: MarketingFaqItem[] = [
  {
    question: 'How is it different from asking ChatGPT?',
    answer:
      `Asking ChatGPT gives an answer from its training memory. It does not open your live pages or run a live web search for this check. Suite fetches your public pages and live web search, then labels each result Measured, Estimated, or Not measured. ${LIVE_ANSWER_CHECKS}`,
  },
  {
    question: 'Does the AI make things up?',
    answer:
      'No. Every number is labeled with how it was collected. Measured means a live check or data you supplied, such as a Search Console export. Estimated means a directional read from partial data. Not measured means the check did not run, and the gap stays empty.',
  },
  {
    question: 'I\'m not technical, will I manage?',
    answer:
      'Yes. The check asks for your website address. You get a plain-English verdict and one fix, with copy and schema you can paste. If you would rather not touch the site, send that fix to whoever manages it. Connecting WordPress, Webflow, or GitHub is optional.',
  },
  {
    question: 'Will it change my website?',
    answer:
      'Only if you ask it to. By default it reads your public pages and hands you copy and schema to paste. If you connect WordPress or Webflow it can send the schema for you, or it can open a GitHub pull request. A WordPress change counts as done only when the schema is found on the live page. Webflow and GitHub results tell you what is left to publish or merge.',
  },
  {
    question: 'Is my data safe?',
    answer:
      `The free check reads public pages and does not need an account. We do not sell personal information, and we do not store card numbers. The site uses HTTPS. When a signed-in audit or chat runs, the prompt and page text go to the providers that check uses. No method of sending or storing data is perfectly secure. The privacy policy names the providers: ${PUBLIC_PRIVACY_URL}`,
  },
  {
    question: 'How soon will I see results?',
    answer:
      `The free check returns when it has read your homepage and crawl files. A signed-in Instant Audit returns a verdict and one fix in that run. Suite does not promise a date when an AI answer will start naming your agency. ${LIVE_ANSWER_CHECKS}`,
  },
  {
    question: 'Does it work for my agency?',
    answer:
      'Suite is built for independent real estate agencies in Australia, Oceania and South-East Asia. It checks a public website. If the site blocks the read, the result says blocked instead of guessing. It is not a claim that every business, or every agency site, will be named by AI.',
  },
  {
    question: 'Do I need a credit card to try it?',
    answer:
      `No. The free check needs no card and no account. A free account gets ${FREE_HOSTED_AUDIT_DAILY} hosted Instant Audit checks a day and ${FREE_ASK_DAILY} Ask questions a day. The free plan also includes public share links and MCP with daily caps. A paid pass lifts the free daily cap. It lasts 30 days and does not renew.`,
  },
  {
    question: 'Where can I use Luminara Suite?',
    answer: PLATFORM_FAQ_ANSWER,
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
