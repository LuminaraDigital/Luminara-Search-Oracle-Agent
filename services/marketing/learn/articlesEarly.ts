import { LEARN_PATH, LEARN_PATHS, LEARN_PUBLISHED, type LearnArticle } from './model';

const dated = { published: LEARN_PUBLISHED, updated: LEARN_PUBLISHED } as const;

const hub = { label: 'All guides', href: LEARN_PATH };
const freeCheck = { label: 'Free check', href: '/' };
const llmsTool = { label: 'llms.txt generator', href: '/free-tools/llms-txt-generator' };
const robotsTool = { label: 'Robots.txt generator', href: '/free-tools/robots-txt-generator' };

/**
 * Guides 1 to 4. Copy states only what the linked primary source states, plus the
 * page work an agency can do without a published ranking formula.
 */
export const EARLY_ARTICLES: readonly LearnArticle[] = [
  {
    ...dated,
    path: LEARN_PATHS.aeo,
    label: 'What is AEO',
    description:
      'How AEO differs from SEO and GEO for an independent real estate agency, and the page work each job actually asks you to do.',
    h1: 'What is AEO, and how is it different from SEO and GEO',
    sources: [
      { label: "Google's SEO starter guide", href: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide' },
      { label: 'What is AEO on this site', href: '/docs/what-is-aeo.html' },
    ],
    related: [
      hub,
      { label: 'How an assistant reads your site', href: LEARN_PATHS.how },
      { label: 'Suburb pages', href: LEARN_PATHS.suburb },
      { label: 'AEO audit tools', href: '/best/aeo-audit-tools-for-small-business' },
      freeCheck,
    ],
    faq: [
      {
        question: 'Is AEO a replacement for SEO?',
        answer:
          'SEO is the work of being understood in search results. AEO is the work of being quoted in an answer. Buyers still use both, so an agency site needs a page a search engine can index and a sentence an assistant can lift.',
      },
      {
        question: 'Does Google publish an AEO or GEO score?',
        answer:
          "Google's SEO starter guide describes SEO and says there is no secret that ranks a site first. It does not define AEO or GEO, and it does not offer a score under either name.",
      },
      {
        question: 'Will a clear page get the agency named?',
        answer:
          'A clear page can be quoted only when the assistant is allowed to read it and uses it for that question. No vendor documents a guarantee. This site does not invent a citation percentage when a run has no evidence.',
      },
    ],
    sections: [
      {
        heading: 'Three jobs, one website',
        paragraphs: [
          'An independent agency in Australia, New Zealand, or South-East Asia already has a website. Vendors and landlords still search. They also ask an assistant, in one sentence, who sells in a suburb, who leases a shop, or who manages a building. SEO, AEO, and GEO are names for showing up in those different places. They are not scores. None of the companies that run the assistants publishes one number that means the site is finished.',
          'Keep the three jobs separate when you brief a developer or a writer. Mixing them produces a page that chases a score nobody documents. The useful brief is a list of pages, a list of crawlers you intend to allow, and the sentences you want quoted.',
        ],
      },
      {
        heading: 'SEO, in Google\'s own words',
        paragraphs: [
          'Google\'s [SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) describes search engine optimization as helping search engines understand your content, and helping a person decide whether to visit from a search result. The same guide says there is no secret that automatically ranks a site first, and that some of its suggestions will not apply to every business. That is the SEO job: be crawled, be understood, and be worth opening.',
          'Google finds pages mainly by following links, and the guide treats a sitemap as optional. The first check is whether the site is indexed at all: search Google for site:yourdomain and read what comes back. If nothing comes back, fix access before you rewrite copy. The guide also says the crawler should be able to see the page a visitor sees, including the text that sits behind scripts and style sheets.',
          'For an agency, the SEO pages are the ones a person already needs. The office, the team, the live listings, and one page for each suburb, district, or neighbourhood you actually work. Give each page a title and a description that name the place and the job, then check the cut with the [SERP snippet preview](/free-tools/serp-preview). A title that says only the brand name does not tell Search, or a buyer, which area the page covers.',
        ],
      },
      {
        heading: 'AEO is the quoting job',
        paragraphs: [
          'AEO, as this site uses the term, is the work of making a page easy for an answer engine to quote. The short definition is on [What is AEO](/docs/what-is-aeo.html): it is not a score. A quote needs a sentence that already answers the question, with the agency name in it, on a URL a crawler is allowed to fetch. If the answer lives only in a photo of a flyer, or only after a click that never runs for the crawler, there is nothing to quote.',
          'Write that sentence on purpose. On a suburb page the first paragraph should say who you are, which place, and whether you sell, lease, manage, or some mix of those. Two or three sentences is enough. A later section can explain how an appraisal works at your office, in the order you actually do it. The [suburb page guide](/learn/suburb-pages) is the full outline, including what to leave out when you do not have a sourced figure.',
          'Point at the page from somewhere a crawler already visits. A link from the office page, a line in [llms.txt](/learn/llms-txt-for-real-estate), and a visible mention on the homepage are three ordinary ones. None of them forces a citation. They make a citation possible. An assistant that cannot find the URL cannot quote it, whatever the prose is like.',
        ],
      },
      {
        heading: 'GEO is the naming job, without a published formula',
        paragraphs: [
          'GEO is the label people use when the goal is being named inside a generated answer, rather than winning a blue link. Google, OpenAI, and Anthropic do not publish a GEO ranking formula or a GEO score. What they do publish is access. OpenAI documents a search crawler and a separate training crawler. Anthropic documents three bots with three jobs. Google documents Googlebot for Google Search, including Search features, and a separate token for Gemini training and grounding. Those facts, with the links, are in the [robots.txt guide](/learn/robots-txt-and-ai-crawlers).',
          'A developer\'s GEO list is short because the unpublished part cannot be engineered. Allow the search crawlers you want to be eligible for. Publish a page that answers the buyer\'s sentence. State the agency as one entity, with the same name, phone, and address on the page and in [RealEstateAgent markup](/learn/real-estate-agent-schema). Then measure only what a run actually collected. The [checking guide](/learn/check-if-ai-names-your-agency) separates a file check from a named mention.',
        ],
      },
      {
        heading: 'A template you can copy',
        paragraphs: [
          'This is a shape, not a client and not a measurement. Replace every name before you publish it.',
          'Question a buyer might type or ask: who can sell a house in Northbridge? Page title: Sell a house in Northbridge | Example Agency. First paragraph: Example Agency sells houses in Northbridge from one office. A sale starts with an appraisal at the property and a written note on method and timing. The office phone is at the top of this page.',
          'That paragraph names the agency, the place, and the job. It does not invent a median price, a rank, or a rate at which assistants repeat the sentence. If you do not have a figure you can point to, leave the figure out. The page is still a page an assistant can quote, because the quote does not need a number.',
        ],
      },
      {
        heading: 'What to ship this week',
        paragraphs: [
          'Do one suburb properly before you clone the template across twenty. A thin copy on every area page gives an assistant twenty ways to quote something vague.',
        ],
        steps: [
          'Pick one suburb, district, or neighbourhood you really serve.',
          'Rewrite that page so the first paragraph answers the buyer\'s sentence and names the agency.',
          'Link the page from the homepage and add it to llms.txt.',
          'Read robots.txt against the search crawlers in the robots guide. Allow the ones you want to be eligible for.',
          'Run the [free check](/) and read [how results are labeled](/methodology) before you treat any figure as a ranking.',
        ],
      },
      {
        heading: 'Where this sits next to other tools',
        paragraphs: [
          'If you are choosing software, read [AEO audit tools for a small business](/best/aeo-audit-tools-for-small-business) and [Luminara versus Ahrefs](/compare/ahrefs). Ahrefs is a full SEO suite with AI share of voice beside backlinks and keywords. The comparison says what each product is for. It does not score either one. Use a suite when you need the index. Use a labeled check when you need the next edit on your own site.',
        ],
      },
    ],
  },
  {
    ...dated,
    path: LEARN_PATHS.how,
    label: 'How AI picks an agency',
    description:
      'What OpenAI, Google, and Anthropic publish about how an assistant reads an agency site, and what to check before you expect a mention.',
    h1: 'How AI assistants decide which real estate agency to recommend',
    sources: [
      { label: 'OpenAI crawlers', href: 'https://developers.openai.com/api/docs/bots' },
      { label: 'Google common crawlers', href: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' },
      { label: 'Anthropic crawlers', href: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' },
    ],
    related: [
      hub,
      { label: 'Robots.txt and AI crawlers', href: LEARN_PATHS.robots },
      { label: 'Suburb pages', href: LEARN_PATHS.suburb },
      { label: 'Check a named mention', href: LEARN_PATHS.check },
      { label: 'Tools for real estate agencies', href: '/best/ai-visibility-tools-for-real-estate-agencies' },
    ],
    faq: [
      {
        question: 'Is there a published ranking of agencies?',
        answer:
          'No vendor page linked from this guide publishes a formula that ranks one real estate agency above another. They publish how their crawlers get access, and what blocking a crawler changes. The rest is not a document you can implement line by line.',
      },
      {
        question: 'If I block training, can I still be mentioned?',
        answer:
          'OpenAI says the search setting and the training setting are independent. Allowing OAI-SearchBot and disallowing GPTBot is the split they describe. Anthropic uses Claude-SearchBot for search and ClaudeBot for training. Google-Extended does not control inclusion in Google Search. Read the robots guide before you copy a block that disallows every bot.',
      },
      {
        question: 'Does a mention mean the page was crawled today?',
        answer:
          'A single reply is a sample from that product at that moment. It does not tell you which URL was fetched, or when. Save the reply with the date. Then check the crawler rule and the page that should have answered.',
      },
    ],
    sections: [
      {
        heading: 'Start from what is published',
        paragraphs: [
          'People ask which agency an assistant will recommend as if a league table existed. OpenAI, Google, and Anthropic do not publish that table. They publish crawlers, user-agent tokens, and what changes when a site blocks one. Anything more specific than that, a weight for reviews, a bonus for schema, a penalty for a short page, is not in those documents. Leave it out of the brief.',
          'What you can act on is the path from a question to a sentence on your site. The assistant has to be allowed to read you, the page has to contain the answer in text, and the agency has to be the same entity everywhere the text names it. Those three are checks. They are not a promise that you will be the name in the reply.',
        ],
      },
      {
        heading: 'Access comes before wording',
        paragraphs: [
          'OpenAI\'s [crawler overview](https://developers.openai.com/api/docs/bots) says OAI-SearchBot is used to surface websites in search results in ChatGPT search features. A site that opts out of OAI-SearchBot will not be shown in those search answers, though it can still appear as a navigational link. GPTBot is the crawler that may collect content for training foundation models, and OpenAI says each robots.txt setting is independent of the others. Disallowing GPTBot is not the same switch as disallowing search.',
          'The same page describes ChatGPT-User as a user-triggered fetch, not an automatic crawl. Because a person started the action, OpenAI says robots.txt rules may not apply, and that this token is not how Search opt-out is managed. Use OAI-SearchBot for that. A firewall or a login wall can still stop the fetch. OpenAI\'s advertiser notes make the same point for a different bot: a robots.txt line does not help if the page demands a CAPTCHA.',
          'Anthropic\'s [crawler article](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) separates three tokens. ClaudeBot is the training crawler. Claude-SearchBot indexes for search. Claude-User fetches when a person asks. Anthropic says disabling Claude-SearchBot keeps the site out of that index, which may reduce visibility in search results, and that the rules belong on every subdomain you care about.',
          'Google\'s [common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) page says preferences for Googlebot affect Google Search, including Discover and all Google Search features. Google-Extended is a different token. It has no separate request user agent. It controls whether crawled content may train future Gemini models and be used for grounding in Gemini apps and in Grounding with Google Search on Vertex AI. Google says it does not affect inclusion in Google Search and is not a ranking signal there. Blocking Googlebot and leaving Google-Extended open is the wrong way around if the goal is Search.',
        ],
      },
      {
        heading: 'The page has to answer the sentence',
        paragraphs: [
          'Once a crawler can fetch the URL, it still needs a passage that answers the question. "Welcome to our agency" does not answer "who leases shops in this district." The first paragraph of the area page should. Name the agency, name the place, and name the service. Then write the steps you actually take, in order, because a specific process is easier to quote than a slogan.',
          'Match the words a buyer uses. In Australia that is often the suburb and "sell", "auction", "lease", or "property management". In other markets the place name might be a district, a city fringe, or a project. Use the name locals type. Do not add a second name for the same place unless you also explain it in the sentence.',
          'Keep the answer in the HTML. A map, a carousel of sold photos, and a chat widget can sit under that paragraph. They should not be the only place the suburb is mentioned. Google\'s starter guide asks that the crawler see what a visitor sees. The same habit helps any fetcher that does not run every script.',
        ],
      },
      {
        heading: 'One agency, one set of facts',
        paragraphs: [
          'Assistants reconcile names. If the homepage says Harbour and Co, the suburb page says Harbour & Co Realty, and the profile link says a third spelling, you have handed the reader three entities. Pick the trading name you want quoted and use it in the title, the first paragraph, the footer, and the schema name field.',
          'Do the same for the phone number and the office address. [RealEstateAgent markup](/learn/real-estate-agent-schema) should repeat facts that are visible, not add a second office you do not have. areaServed should list places you will actually take an instruction for. A long list of every suburb in the state, with no page behind each name, is a list you cannot defend when someone calls.',
        ],
      },
      {
        heading: 'What still is not a decision you can see',
        paragraphs: [
          'A reply can prefer a directory, a portal, or a news story over your page. Nothing in the crawler documents says your domain wins that choice. Reviews you did not write, ads you did not buy, and a brand search that navigates straight to you are different paths. OpenAI says a site opted out of OAI-SearchBot can still show up as a navigational link. That is not the same as an answer that recommends you for a suburb question.',
          'Do not fill the gap with a score. If a tool shows a blended number and cannot say what was fetched, treat the number as unlabeled. Luminara\'s rule is the opposite: a figure appears when that run collected it, and a missing figure stays missing. The [free check](/) reads the homepage title and description, robots.txt, and llms.txt. It does not ask an assistant to name you. The [checking guide](/learn/check-if-ai-names-your-agency) says how to do that ask yourself, and what a fuller audit measures.',
        ],
      },
      {
        heading: 'A practical order of work',
        steps: [
          'Open robots.txt and find OAI-SearchBot, Claude-SearchBot, and Googlebot. If a search crawler is disallowed and you want to be eligible in that product, remove that disallow. Leave training tokens as a separate decision.',
          'Fetch the suburb page as a simple HTTP GET, with JavaScript off, and read the first screen of text. If the agency name and the place are missing, fix the HTML before you touch design.',
          'Compare the visible name, phone, and address with the JSON-LD on the same page. Delete any fact that is only in the script.',
          'Ask the buyer\'s question in the product you care about. Save the reply and the date. One reply is a sample.',
          'If you were not named, fix the crawler or the page you just checked. Then ask again later. Do not treat the gap as a ranking you can buy your way through.',
        ],
        paragraphs: [
          'Teams comparing products can start with [AI visibility tools for real estate agencies](/best/ai-visibility-tools-for-real-estate-agencies). That page says who each tool is for. It does not invent a winner.',
        ],
      },
    ],
  },
  {
    ...dated,
    path: LEARN_PATHS.llms,
    label: 'llms.txt for agencies',
    description:
      'What to put in llms.txt for a real estate agency: the llmstxt.org sections, a copyable template, and the free generator that writes the file.',
    h1: 'llms.txt for real estate agencies: what to put in it',
    sources: [
      { label: 'llms.txt specification', href: 'https://llmstxt.org/' },
    ],
    related: [
      hub,
      llmsTool,
      { label: 'Robots.txt and AI crawlers', href: LEARN_PATHS.robots },
      { label: 'Suburb pages', href: LEARN_PATHS.suburb },
      { label: 'What is AEO', href: '/docs/what-is-aeo.html' },
    ],
    faq: [
      {
        question: 'Does llms.txt replace robots.txt?',
        answer:
          'No. robots.txt is how you allow or disallow crawlers. llms.txt describes the site and links to pages. The specification does not say the file grants crawl permission. Most agency sites want both.',
      },
      {
        question: 'Will every assistant read the file?',
        answer:
          'The specification is a proposal for a file agents can read. It does not say that every assistant fetches it, and it does not promise a citation. Publish it because it is short and it states your own summary. Do not treat a missing mention as a broken file.',
      },
      {
        question: 'Where does the file live?',
        answer:
          'At the root, so it opens at https://yourdomain/llms.txt. The specification also allows a file in a subpath, covering the pages under that path, with the most specific file winning. An agency with one site should start at the root.',
      },
    ],
    sections: [
      {
        heading: 'What the specification asks for',
        paragraphs: [
          'The [llms.txt specification](https://llmstxt.org/) proposes a Markdown file that gives an agent a short background and links to the pages that matter. The only required part is an H1 with the name of the project or site. After that, in order: a blockquote with a short summary, then any detail that is not a heading, then H2 sections whose lists point at URLs. Each list item is a Markdown link, optionally followed by a colon and a note.',
          'An H2 titled Optional is a convention for links an agent can skip when it wants a shorter context. The specification also describes link relations for discovery: rel="alternate" with type text/markdown for a Markdown version of a page, and rel="describedby" pointing at the llms.txt that covers it. Those relations are optional. The file itself is the part an agency can publish this week without a new template.',
          'Leave a blank line between the blockquote, the detail, and each heading when you save the file. Markdown uses that gap. The sample on this page is the text to adapt. Put the blank lines in when you paste it into the generator or into your repo.',
        ],
      },
      {
        heading: 'What an agency should put in each section',
        paragraphs: [
          'Use the trading name as the H1, the same spelling as the homepage and the schema name. The blockquote is one or two sentences: what you do, and where. Sales, leasing, property management, or the mix you actually offer. Name the city or the region. Do not spend the blockquote on a slogan that could belong to any agency.',
          'The detail under the blockquote can be a short paragraph a principal would say on the phone. One office or several. The kind of property. Who the client is: vendors, buyers, landlords, tenants. Skip awards and rankings you cannot point to. If a sentence would embarrass you when an assistant repeats it next to your name, cut the sentence.',
          'Under an Office heading, link the homepage, the contact page, and the team page. The note after the colon should say what the page is for, not repeat the title. Under an Areas heading, link each suburb or district page you want quoted, one line each. Under Optional, put privacy, careers, and a sold or leased archive if you have one. Do not link a page that is a login, a listing portal you do not control, or a PDF nobody updates.',
        ],
        bullets: [
          'Home: the name, the phone, and the areas you cover.',
          'Team: the people who take instructions, with the names you are allowed to publish.',
          'One area page per place you want named, not a single page that lists fifty suburbs in a row.',
          'Contact: the form or the phone, so the quoted page has a next step.',
        ],
      },
      {
        heading: 'A template, not a real business',
        paragraphs: [
          'Copy this, then replace Example Agency, the suburb, and every URL. It is not a client and not a measured result. Add a blank line between blocks in the file you publish.',
        ],
        code: `# Example Agency
> Independent agency. Sales and leasing in one city. Template, not a real business.
We sell and lease homes from one office. Read the office pages first, then the area page for the place in the question.
## Office
- [Home](https://example.com/): trading name, phone, and the areas we cover
- [Team](https://example.com/team): the people who take a sale or a lease
- [Contact](https://example.com/contact): phone and the enquiry form
## Areas
- [Northbridge sales](https://example.com/areas/northbridge): selling and buying in that suburb
## Optional
- [Privacy](https://example.com/privacy): how an enquiry is stored`,
      },
      {
        heading: 'Publish it, then keep it current',
        paragraphs: [
          'Save the file as llms.txt at the site root. Open https://yourdomain/llms.txt in a browser and check that the H1 is the trading name and that each link returns a page, not a login and not a 404. The [llms.txt generator](/free-tools/llms-txt-generator) builds the same layout in the browser. Nothing you type there is sent to Luminara. Hand the file to whoever deploys the site if that is not you.',
          'Update the file on the day you add an area page, close an office, or change the phone number. A stale link teaches the agent to trust a URL you have abandoned. The same day, change the visible page. The file is a map. It is not a second source of truth.',
          'Developers: serve the file as text from the root. Do not put it behind the app\'s authentication. If the marketing site and the listing app are different hosts, the file belongs on the host you want quoted. A file on a subdomain covers that subdomain\'s paths under the specification\'s "most specific file" rule. Say so in the summary if the agency brand and the listings live on different hosts.',
        ],
      },
      {
        heading: 'What the file does not do',
        paragraphs: [
          'llms.txt does not allow or block a crawler. That is [robots.txt](/learn/robots-txt-and-ai-crawlers). It does not mark up the office as a RealEstateAgent. That is [JSON-LD on the page](/learn/real-estate-agent-schema). It does not measure whether an assistant named you. The [free check](/) can see whether the file is present and whether it has a title and a short summary. Presence is a pass, a fail, or not measured. It is not a citation rate.',
          'Google\'s SEO starter guide does not list llms.txt as a Search requirement. Do not remove titles, links, or the suburb pages because the Markdown file exists. The pages are what a buyer and a crawler read. The file only points at them.',
        ],
      },
    ],
  },
  {
    ...dated,
    path: LEARN_PATHS.robots,
    label: 'AI crawlers in robots.txt',
    description:
      'What GPTBot, OAI-SearchBot, ClaudeBot, and Google-Extended do in robots.txt, with a file you can adapt and the free generator.',
    h1: 'Robots.txt and AI crawlers: GPTBot, OAI-SearchBot, ClaudeBot, Google-Extended',
    sources: [
      { label: 'OpenAI crawlers', href: 'https://developers.openai.com/api/docs/bots' },
      { label: 'Google common crawlers', href: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers' },
      { label: 'Google crawling overview', href: 'https://developers.google.com/crawling' },
      { label: 'Anthropic crawlers', href: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler' },
    ],
    related: [
      hub,
      robotsTool,
      { label: 'llms.txt for agencies', href: LEARN_PATHS.llms },
      { label: 'How an assistant reads your site', href: LEARN_PATHS.how },
      { label: 'Check a named mention', href: LEARN_PATHS.check },
    ],
    faq: [
      {
        question: 'Does blocking GPTBot stop search mentions?',
        answer:
          'OpenAI says GPTBot is for training foundation models and that the setting is independent of OAI-SearchBot. Search opt-out is the OAI-SearchBot token. A disallow on GPTBot alone is not the search switch.',
      },
      {
        question: 'Does Google-Extended remove the site from Google Search?',
        answer:
          'Google says Google-Extended does not affect inclusion in Google Search and is not a ranking signal there. Googlebot is the token for Search, including Search features. Google-Extended controls Gemini training and grounding.',
      },
      {
        question: 'Does every bot honour robots.txt?',
        answer:
          'OpenAI says ChatGPT-User is started by a person, so robots.txt rules may not apply, and that this token is not used to decide Search inclusion. Anthropic says its bots honour robots.txt, including Claude-User. A private URL still needs a real access control. robots.txt is a request to well behaved crawlers.',
      },
    ],
    sections: [
      {
        heading: 'One file, several decisions',
        paragraphs: [
          'robots.txt is a text file at the root of the host. Each group starts with User-agent and then Allow or Disallow. The tokens below are not interchangeable. Copying Disallow: / under the wrong name is how an agency disappears from a product it wanted to be in, or stays in a training crawl it wanted to leave.',
          'Decide search and training separately, then write the lines. If you want to be eligible for an assistant\'s search answers, allow that product\'s search crawler. If you do not want the pages used to train that company\'s models, disallow the training token. Google\'s control for Gemini is a token, not a second crawler that shows up in the log under its own name. The notes below follow the vendor pages linked at the end.',
        ],
      },
      {
        heading: 'OpenAI: GPTBot, OAI-SearchBot, and ChatGPT-User',
        paragraphs: [
          'OpenAI\'s [crawler overview](https://developers.openai.com/api/docs/bots) says OAI-SearchBot surfaces websites in ChatGPT search features. Opting out means the site will not be shown in those search answers. It can still appear as a navigational link. OpenAI recommends allowing OAI-SearchBot, and allowing the IP ranges they publish, if you want to appear. They also say a robots.txt change can take about 24 hours before their search systems adjust. That is a delay for the rule, not a promise that a mention appears 24 hours later.',
          'GPTBot crawls content that may be used to train generative foundation models. Disallowing it tells OpenAI the content should not be used for that training. The settings are independent. OpenAI\'s own example of that independence is allowing search while disallowing training. If you allow both, they may use one crawl for both jobs so they do not fetch twice.',
          'ChatGPT-User is different. OpenAI uses it when a person asks ChatGPT or a custom GPT to visit a page, and for GPT Actions. It is not an automatic crawl of the web. OpenAI says robots.txt rules may not apply because a person started the fetch, and that this token is not how you manage Search opt-out. Write the OAI-SearchBot group for search. Use a login or a firewall for anything that must stay private even when a person asks.',
        ],
      },
      {
        heading: 'Anthropic: ClaudeBot and the search bot',
        paragraphs: [
          'Anthropic\'s [help article](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) names three robots. ClaudeBot collects content that could contribute to training. Restricting it signals that future material should stay out of training sets. Claude-SearchBot crawls to improve search results. Disabling it stops that indexing and, Anthropic says, may reduce visibility and accuracy in search results. Claude-User fetches when a person asks. Disabling it stops retrieval for that user-directed fetch, which may reduce visibility there too.',
          'Anthropic says the bots follow robots.txt, including Disallow, and that they support the non-standard Crawl-delay line. Put the rules in the robots.txt of every subdomain you want to cover. Blocking an IP is not the opt-out they describe: they say that can stop the bot from reading robots.txt, so the opt-out may not stick. Do not publish a Crawl-delay unless you mean it. A delay of many seconds on a small site is usually unnecessary.',
        ],
      },
      {
        heading: 'Google-Extended is a token, Googlebot is Search',
        paragraphs: [
          'On Google\'s [common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) page, Google-Extended has no HTTP user-agent of its own. Crawling is done with existing Google user agents. The robots.txt token is the control. Google describes it as the way a publisher manages whether crawled content may train future Gemini models that power Gemini apps and Vertex AI, and whether it may be used for grounding in those Gemini apps and in Grounding with Google Search on Vertex AI. Grounding, in their words, means providing content from the Search index to the model at prompt time.',
          'The same paragraph says Google-Extended does not affect a site\'s inclusion in Google Search and is not used as a ranking signal in Google Search. [Google\'s crawling overview](https://developers.google.com/crawling) points Google Search at Googlebot, and Gemini apps at Google-Extended. If you disallow Googlebot, you are opting out of Search, not only out of Gemini. If you disallow only Google-Extended, Search inclusion stays as it was. The crawler page also says Google intends to support a shared AI-training preference in robots.txt in early 2027. Until that is live, Google-Extended is the control they document.',
        ],
      },
      {
        heading: 'A starting file, with search and training split',
        paragraphs: [
          'This is a starting point for an agency that wants to be eligible for the search products above and out of the training crawls those vendors describe. It is not legal advice, and it is not every bot on the internet. Merge it into the robots.txt you already have. Do not replace a file that also lists your sitemap and your admin paths. The [robots.txt generator](/free-tools/robots-txt-generator) has the same switches, including a preset that allows answer crawlers and blocks training crawlers. It runs in the browser.',
          'Allow Google-Extended in this sample because an agency that wants Gemini grounding leaves that token open. If you do not want Gemini training or grounding, change that group to Disallow: /. That change still leaves Googlebot, and therefore Google Search, alone. Say the choice out loud before you deploy it.',
        ],
        code: `User-agent: OAI-SearchBot
Allow: /

User-agent: GPTBot
Disallow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Googlebot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: https://example.com/sitemap.xml`,
      },
      {
        heading: 'Check the live file',
        steps: [
          'Open https://yourdomain/robots.txt. Confirm you are on the host buyers use, including www if that is the canonical host.',
          'Search the file for Disallow: / under OAI-SearchBot, Claude-SearchBot, or Googlebot. A sitewide disallow there blocks the search job.',
          'Repeat for each subdomain that serves a public page, as Anthropic asks.',
          'Fetch a suburb URL with a browser and with JavaScript disabled. A 403 or a challenge page is a block robots.txt cannot fix.',
          'Run the [free check](/). It reads robots.txt and reports whether common AI crawlers are blocked. A blocked row is a fail you can see. It is not a count of mentions.',
        ],
        paragraphs: [
          'After a change, keep the previous file in version control. OpenAI\'s about-24-hour note means you should not judge a search reply the same afternoon. Pair the file check with the [named-mention check](/learn/check-if-ai-names-your-agency) a bit later, and write down the date.',
        ],
      },
    ],
  },
];
