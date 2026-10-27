/**
 * Free tools (/free-tools and /free-tools/*). One source for the React view, crawler HTML,
 * JSON-LD, sitemap, and llms.txt, like seoHubPages.ts.
 *
 * Every tool runs in the browser: no network call, no account, nothing stored. Copy says
 * "estimate" wherever Google or an AI product decides the real outcome.
 */
import { LIVE_ANSWER_CHECKS } from './engineCoverage';
import type { MarketingFaqItem } from './marketingFaqContent';

export type FreeToolId = 'serp-preview' | 'robots-txt-generator' | 'llms-txt-generator' | 'schema-generator';

export interface FreeTool {
  id: FreeToolId;
  path: `/free-tools/${FreeToolId}`;
  /** Short name for link lists, llms.txt, and the tab title (under 60 characters with the suffix). */
  label: string;
  /** One line for the hub card. */
  blurb: string;
  description: string;
  h1: string;
  lede: string;
  steps: string[];
  why: { heading: string; body: string }[];
  faq: MarketingFaqItem[];
}

export const FREE_TOOLS_PATH = '/free-tools';

/** Closing call to action on every free tools page, and the last crawler paragraph. */
export const FREE_TOOLS_CLOSING = {
  eyebrow: 'Start free',
  cta: 'Run the free crawl check',
  body: `The free crawl check reads your robots.txt and llms.txt with no card and no account. Instant Audit then checks your site and live web search and gives you one fix to ship. ${LIVE_ANSWER_CHECKS}`,
} as const;

export const FREE_TOOLS_HUB = {
  path: FREE_TOOLS_PATH,
  label: 'Free AI search tools',
  description:
    'Free tools for Google and AI answers: SERP preview, robots.txt with AI crawler switches, llms.txt generator, and real estate schema. No sign-up.',
  h1: 'Free tools for Google and AI answers',
  lede: 'Four tools that run in your browser. No account, no card, and nothing you type leaves this page.',
  faq: [
    {
      question: 'Are these tools free?',
      answer:
        'Yes. They run in your browser with no account and no card. Luminara Suite is the paid product that checks your whole site and live web search.',
    },
    {
      question: 'Do you store what I type?',
      answer: 'No. The tools run on this page and send nothing to our servers. Copy the result and paste it into your site.',
    },
    {
      question: 'Which tool should I start with?',
      answer:
        'Start with the robots.txt generator. If AI crawlers are blocked, no other fix can get your pages quoted in an AI answer.',
    },
  ] satisfies MarketingFaqItem[],
} as const;

export const FREE_TOOLS: readonly FreeTool[] = [
  {
    id: 'serp-preview',
    path: '/free-tools/serp-preview',
    label: 'SERP snippet preview',
    blurb: 'See your title and description as a Google result, with pixel widths.',
    description:
      'Free SERP snippet preview: see your title and meta description as a Google result on desktop and mobile, with pixel and character counts.',
    h1: 'SERP snippet preview',
    lede: 'Type a title and description and see the Google result they make. Widths are estimated in pixels, the way Google cuts them.',
    steps: [
      'Paste the page URL so the breadcrumb matches your site.',
      'Write the title. Keep it inside about 600 pixels so Google does not cut it.',
      'Write the meta description. Lead with the answer a buyer or seller is looking for.',
      'Switch between desktop and mobile, then copy the two head tags.',
    ],
    why: [
      {
        heading: 'Why pixels, not characters',
        body: 'Google cuts titles by width. A title full of wide letters such as W and M runs out of room sooner than one with narrow letters, so a character count alone can mislead you.',
      },
      {
        heading: 'Why the description still matters',
        body: 'The description is not a ranking factor, but it is the sales line under your result. A clear one earns the click, and AI answers often lift the same sentence.',
      },
    ],
    faq: [
      {
        question: 'How long should a title tag be?',
        answer: 'About 50 to 60 characters, or up to about 600 pixels on desktop. This tool shows both, and the pixel figure is what decides the cut.',
      },
      {
        question: 'How long should a meta description be?',
        answer: 'About 150 to 160 characters on desktop. Mobile shows less, so put the important part first.',
      },
      {
        question: 'Will Google show exactly this?',
        answer:
          'Not always. Google can rewrite a title or pick a different snippet from the page. This preview is an estimate of what your tags produce, not a measurement of what Google shows.',
      },
    ],
  },
  {
    id: 'robots-txt-generator',
    path: '/free-tools/robots-txt-generator',
    label: 'Robots.txt generator for AI crawlers',
    blurb: 'Allow AI search, block training, or both. One switch per crawler.',
    description:
      'Free robots.txt generator with a switch for each AI crawler: GPTBot, OAI-SearchBot, ClaudeBot, Google-Extended and more. No sign-up.',
    h1: 'Robots.txt generator for AI crawlers',
    lede: 'Choose which AI crawlers may read your site. Allow the ones that cite you in answers, and block the ones that only train models if you prefer.',
    steps: [
      'Pick a starting point: allow every AI crawler, allow answers but not training, or block them all.',
      'Flip any single crawler on or off.',
      'Add private paths, such as /admin/, and your sitemap URL.',
      'Copy the file and save it as robots.txt at the root of your site.',
    ],
    why: [
      {
        heading: 'Answer crawlers and training crawlers are different',
        body: 'OAI-SearchBot, Claude-SearchBot and PerplexityBot fetch pages for answers that can cite you. GPTBot, ClaudeBot, CCBot and Google-Extended control training. You can allow the first group and block the second.',
      },
      {
        heading: 'One wrong line hides you from AI answers',
        body: 'A Disallow: / under the wrong user agent stops an answer engine from reading any page, so no other fix can get you quoted. Check the file whenever your site or host changes.',
      },
    ],
    faq: [
      {
        question: 'Does blocking GPTBot stop ChatGPT from citing me?',
        answer:
          'GPTBot controls training. ChatGPT search uses OAI-SearchBot, and ChatGPT-User fetches a page when a user asks about it. Block GPTBot and allow the other two if you want citations without training.',
      },
      {
        question: 'What is Google-Extended?',
        answer:
          'Google-Extended is a control token, not a separate crawler. Blocking it tells Google not to use your pages for Gemini training. It does not remove you from Google Search.',
      },
      {
        question: 'Does every AI crawler obey robots.txt?',
        answer:
          'The major operators say their crawlers do. robots.txt is a request, not a lock, so use a firewall rule for anything that must stay private.',
      },
    ],
  },
  {
    id: 'llms-txt-generator',
    path: '/free-tools/llms-txt-generator',
    label: 'llms.txt generator',
    blurb: 'Write the short guide file that tells AI tools what your site is.',
    description:
      'Free llms.txt generator: write the site summary and key page links that AI tools read, in the llmstxt.org layout. No sign-up.',
    h1: 'llms.txt generator',
    lede: 'llms.txt is a short Markdown file at the root of your site. It tells AI tools who you are and which pages matter, in plain words.',
    steps: [
      'Enter your business name and a one-sentence summary.',
      'Add a few lines of detail: what you sell, where, and to whom.',
      'List your key pages with a short note on each.',
      'Copy the file and save it as llms.txt at the root of your site.',
    ],
    why: [
      {
        heading: 'A summary you control',
        body: 'Without one, an AI tool guesses what you do from whatever page it reads first. llms.txt gives it your own one-line answer and the pages you want quoted.',
      },
      {
        heading: 'Cheap to add, easy to keep current',
        body: 'It is one text file with no code. Update it when you add a suburb page or a service, the same day you publish.',
      },
    ],
    faq: [
      {
        question: 'Do AI tools read llms.txt?',
        answer:
          'Support varies by product and changes often. Some AI tools and coding agents read it; others do not yet. It costs little to add and does no harm to search.',
      },
      {
        question: 'Where does the file go?',
        answer: 'At the root of your domain, so it opens at https://yoursite.com/llms.txt.',
      },
      {
        question: 'Is llms.txt the same as robots.txt?',
        answer:
          'No. robots.txt says which crawlers may read your pages. llms.txt describes your site and points to the pages that matter. Most sites want both.',
      },
    ],
  },
  {
    id: 'schema-generator',
    path: '/free-tools/schema-generator',
    label: 'Real estate schema generator',
    blurb: 'RealEstateAgent or LocalBusiness JSON-LD, plus FAQ schema.',
    description:
      'Free schema generator for real estate agencies and local businesses: RealEstateAgent or LocalBusiness JSON-LD with suburbs served and FAQ schema.',
    h1: 'Real estate schema generator',
    lede: 'Build RealEstateAgent or LocalBusiness structured data, with the suburbs you serve and your top questions, ready to paste.',
    steps: [
      'Choose RealEstateAgent or LocalBusiness.',
      'Fill in your name, website, phone and address. Leave a field empty to keep it out.',
      'List the suburbs you serve and any profile links, such as your Google Business Profile.',
      'Add up to three common questions, then copy the script tag into your page.',
    ],
    why: [
      {
        heading: 'Structured facts are easier to quote',
        body: 'Schema states your name, area and contact details in a form search engines and AI tools can read without guessing from your layout.',
      },
      {
        heading: 'Only what is true',
        body: 'The tool writes only the fields you fill in. It adds no review stars or ratings, because Google does not show self-written ratings for a business on its own site.',
      },
    ],
    faq: [
      {
        question: 'RealEstateAgent or LocalBusiness?',
        answer: 'RealEstateAgent is a more specific kind of LocalBusiness. Use it if you sell or lease property; otherwise use LocalBusiness.',
      },
      {
        question: 'Where do I paste the code?',
        answer:
          'Inside the head or body of the page it describes, usually the home page. Most website builders have a field for custom code or a header script.',
      },
      {
        question: 'How do I check it worked?',
        answer: "Paste the page URL into Google's Rich Results Test or the Schema.org validator after you publish.",
      },
    ],
  },
];

const TOOL_BY_PATH = new Map(FREE_TOOLS.map((tool) => [tool.path, tool]));

/** Tool for a pathname (trailing slash tolerant), or null. */
export function freeToolForPath(pathname: string): FreeTool | null {
  return TOOL_BY_PATH.get(pathname.replace(/\/+$/, '') as FreeTool['path']) ?? null;
}

/** True for the hub and every tool path. */
export function isFreeToolsPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '');
  return clean === FREE_TOOLS_PATH || TOOL_BY_PATH.has(clean as FreeTool['path']);
}
