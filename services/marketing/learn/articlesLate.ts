import { LEARN_PATH, LEARN_PATHS, LEARN_PUBLISHED, type LearnArticle } from './model';

const dated = { published: LEARN_PUBLISHED, updated: LEARN_PUBLISHED } as const;

const hub = { label: 'All guides', href: LEARN_PATH };
const schemaTool = { label: 'Schema generator', href: '/free-tools/schema-generator' };
const freeCheck = { label: 'Free check', href: '/' };

/**
 * Guides 5 to 8. Schema.org and Google describe the markup. The templates are examples,
 * not client results. Product limits are the ones this site already publishes.
 */
export const LATE_ARTICLES: readonly LearnArticle[] = [
  {
    ...dated,
    path: LEARN_PATHS.schema,
    label: 'RealEstateAgent schema',
    description:
      'A practical RealEstateAgent JSON-LD guide: fields that match the visible page, a template, and the free schema generator.',
    h1: 'RealEstateAgent schema: a practical guide',
    sources: [
      { label: 'schema.org RealEstateAgent', href: 'https://schema.org/RealEstateAgent' },
      { label: 'schema.org LocalBusiness', href: 'https://schema.org/LocalBusiness' },
      { label: 'schema.org areaServed', href: 'https://schema.org/areaServed' },
      { label: 'Google structured data intro', href: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data' },
      { label: 'Rich Results Test', href: 'https://search.google.com/test/rich-results' },
    ],
    related: [
      hub,
      schemaTool,
      { label: 'Suburb pages', href: LEARN_PATHS.suburb },
      { label: 'llms.txt for agencies', href: LEARN_PATHS.llms },
    ],
    faq: [
      {
        question: 'RealEstateAgent or LocalBusiness?',
        answer:
          'schema.org defines RealEstateAgent as a real-estate agent and lists it with the properties it inherits from LocalBusiness. Use RealEstateAgent for an office that sells or leases property. Use LocalBusiness if the business is local and is not a real estate office. The free generator offers both.',
      },
      {
        question: 'Will the markup create a star rating?',
        answer:
          'This guide leaves ratings out. Put a rating in markup only when the reviews are visible on that page and you are allowed to mark them up. The generator does not invent stars. Google\'s structured data intro says markup should describe content a person can see.',
      },
      {
        question: 'Where does the script go?',
        answer:
          'In the page it describes, usually the office page or the area page, inside a script tag of type application/ld+json. Google says JSON-LD can sit in the head or the body. One page should describe itself, not a different office.',
      },
    ],
    sections: [
      {
        heading: 'What the type is for',
        paragraphs: [
          '[schema.org/RealEstateAgent](https://schema.org/RealEstateAgent) defines the type as a real-estate agent. The property list on that page is mostly inherited. LocalBusiness contributes hours, a price range text, and payment notes. Organization contributes name, url, logo, address, telephone, and sameAs. areaServed is the property for the geographic area where the service is provided. You do not need a private vocabulary. You need the fields that are true on the page.',
          'Google\'s [structured data introduction](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data) calls structured data explicit clues about what a page means. Google recommends JSON-LD when your site can support it, and says the markup must describe content that is visible. Do not create an empty page just to hold a script. Google also says you should follow the general guidelines or the markup can be ineligible for rich results, and that supplying complete accurate fields matters more than filling every optional property. Nothing on that page promises that a RealEstateAgent script produces a special real estate panel.',
          'Treat the script as a typed copy of the office, not as a ranking lever. If the visible page and the JSON disagree, fix the page first and then the script. An assistant or a search engine that trusts the wrong one will quote the wrong phone.',
        ],
      },
      {
        heading: 'Fields that earn their place',
        paragraphs: [
          'name is the trading name, spelled the way the H1 spells it. url is the canonical page for that office, not a campaign link with tracking parameters. telephone is the number printed on the page, in international form. address is a PostalAddress with the locality, region, and country you show in the footer. If you do not publish a street number, do not invent one for the script.',
          'areaServed is a list of places you will take work in. Use the same names as the area pages. A string is enough when the place is a suburb or district name. sameAs is for profile URLs that are actually yours: the Google Business Profile, the company page on a network you control, the licensing board entry if it is a public URL. Do not point sameAs at a competitor or at a portal search you do not own.',
          'openingHours follows the text schema.org documents: two-letter days, 24-hour times, a hyphen between the start and the end. If the office hours on the page say by appointment, write that in the visible paragraph and skip a fake nine-to-five in the script. image and logo only if the file is the logo you show. description is one sentence, the same idea as the llms.txt blockquote.',
        ],
      },
      {
        heading: 'A template to replace',
        paragraphs: [
          'This JSON-LD is an example for a fictional office. Replace every value, including the phone. Delete a field you cannot show on the page. Do not publish example.com.',
        ],
        code: `{
  "@context": "https://schema.org",
  "@type": "RealEstateAgent",
  "name": "Example Agency",
  "url": "https://example.com/",
  "telephone": "REPLACE_WITH_THE_NUMBER_ON_THE_PAGE",
  "description": "Sales and leasing from one office in Northbridge.",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Northbridge",
    "addressRegion": "NSW",
    "addressCountry": "AU"
  },
  "areaServed": ["Northbridge", "Cammeray"],
  "sameAs": ["https://example.com/team"]
}`,
      },
      {
        heading: 'Put it on the page a person sees',
        paragraphs: [
          'Paste the object inside script type="application/ld+json" on the office page. The first paragraph of that page should already say Example Agency, Northbridge, sales and leasing, and the phone. The suburb links in the nav should include Northbridge and Cammeray if those strings are in areaServed. Google\'s intro says not to mark up information a user cannot see, even when the information is accurate. Hidden accuracy is still hidden.',
          'For a suburb page, you can repeat a smaller RealEstateAgent object that links back to the office url, or you can rely on the office page and make the suburb page ordinary HTML that names the same agency. Do not publish two telephone numbers. If the suburb page is the one you hope will be quoted, the agency name and phone still need to be in the visible text. The script does not replace that sentence. The [suburb guide](/learn/suburb-pages) is the outline for the prose.',
          'FAQ markup is a separate type. Add it only for questions and answers that are visible on that same page, worded the same way. The [schema generator](/free-tools/schema-generator) will attach up to three questions you type, and it tells you to use questions that already appear. It does not add review stars. Run it in the browser, copy the script, and hand it to whoever edits the site if that is not you.',
        ],
      },
      {
        heading: 'Check the published page',
        steps: [
          'View source on the live URL and find application/ld+json. Confirm the name and phone match the pixels on the page.',
          'Open Google\'s [Rich Results Test](https://search.google.com/test/rich-results) and paste the URL after it is public. Read the errors. A warning about a missing field you chose to omit is a choice, not an emergency.',
          'Search the script for aggregateRating. If you did not mean to mark up reviews, delete that block.',
          'When you change the phone or the areas, change the HTML and the JSON on the same deploy. Then update [llms.txt](/learn/llms-txt-for-real-estate) if the links moved.',
        ],
        paragraphs: [
          'Developers on a React or Vite site should render the JSON from the same data as the footer, not from a second hardcoded object. One component, one set of strings. Escape the script so a name cannot break out of the JSON. Server-render it if the marketing page is what crawlers fetch first. A script that appears only after a client fetch is a script some fetchers will miss.',
        ],
      },
    ],
  },
  {
    ...dated,
    path: LEARN_PATHS.suburb,
    label: 'Suburb pages AI can quote',
    description:
      'How to structure a suburb page an assistant can quote, with a template, the facts to leave out, and links to schema and llms.txt.',
    h1: 'Suburb pages that AI can quote: structure and examples',
    sources: [
      { label: "Google's SEO starter guide", href: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide' },
      { label: 'Google structured data intro', href: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data' },
    ],
    related: [
      hub,
      { label: 'RealEstateAgent schema', href: LEARN_PATHS.schema },
      { label: 'llms.txt for agencies', href: LEARN_PATHS.llms },
      { label: 'SERP snippet preview', href: '/free-tools/serp-preview' },
      { label: 'What is AEO', href: LEARN_PATHS.aeo },
    ],
    faq: [
      {
        question: 'How many suburb pages should we publish?',
        answer:
          'One for each place you will actually take an instruction, and only when you can write something specific. A page that swaps the suburb name into the same three sentences is thin for a buyer and thin for a quote.',
      },
      {
        question: 'Should the page include median prices?',
        answer:
          'Only when you can link the figure to a source you are allowed to cite, or when it is your own settled sales and you say that. If you do not have the figure, leave it out. An invented median is worse than a gap.',
      },
      {
        question: 'Can one city page replace the suburb pages?',
        answer:
          'A city page can introduce the office. It cannot answer "who sells in this suburb" with the same specificity. Keep the city page, and add area pages for the places you want named. Link them both ways.',
      },
    ],
    sections: [
      {
        heading: 'Why the area page is the quotable one',
        paragraphs: [
          'Buyers and vendors rarely ask an assistant about your brand. They ask about a place and a job. The page that can be quoted is the one whose first paragraph answers that question. Your homepage can introduce the office. The area page does the local sentence. Call it a suburb, a district, or a neighbourhood, matching the word people use in that country.',
          'Google\'s [SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) says a crawler should see the page a visitor sees, and that Search understands content it can read. The same constraint matters for an assistant. If the only mention of the suburb is inside an image of a map, or inside a listing widget that never returns HTML, the sentence is missing.',
        ],
      },
      {
        heading: 'A structure that answers first',
        paragraphs: [
          'Use one H1 that includes the place and the job: selling a house in Northbridge, leasing a shop in the district, managing apartments in the neighbourhood. Do not use the H1 for a slogan. The title tag can match, shortened so it still fits a search result. Check the width in the [SERP snippet preview](/free-tools/serp-preview).',
          'The first paragraph is the quote. Name the agency, name the place, and say what you do there. Mention how someone starts: an appraisal at the property, a landlord instruction, a tenant brief. Put the phone or a link to the contact page in that opening, because a quote without a next step wastes the mention.',
          'Then write sections you can keep true. How an instruction starts, in your real order. What you will and will not take on in that place, if there is a limit, such as residential only. The people who work that area, linking to the team page rather than pasting a new biography. A short FAQ of questions the office actually hears, with the answers on the page. A line that says when the page was updated. Neighbouring areas you also serve, as links, not as a dump of every postcode in the state.',
        ],
      },
      {
        heading: 'An example you must rewrite',
        paragraphs: [
          'The following is a template for a fictional agency. It is not a case study and not a measured ranking. Replace the names, delete any sentence that is not true for your office, and do not add a price you cannot source.',
        ],
        code: `H1: Selling a house in Northbridge
Title: Sell a house in Northbridge | Example Agency

Example Agency sells houses in Northbridge from our office in that suburb. A sale starts with an appraisal at the property and a written note on method and timing. Call the office on the number in the header, or use the contact form.

How an instruction starts
1. We visit the property and confirm what can be sold.
2. We recommend auction or private treaty in writing, with the reason.
3. We agree the fee and the campaign before the listing goes up.

What this page does not claim
We do not publish a median price here. We do not call ourselves the top agency in the suburb.

Updated 15 November 2026.`,
      },
      {
        heading: 'Facts to leave out',
        paragraphs: [
          'Leave out a median, a growth rate, or a "days on market" figure unless the sentence links to the source or clearly counts your own settled sales. Leave out "best agent", "number one", and star ratings you wrote yourself. Google\'s structured data intro says markup has to match visible content. A superlative you cannot show is a bad sentence even before it becomes JSON.',
          'Leave out copied paragraphs from a portal or a council page. A quote an assistant lifts should be yours, because you will be the name beside it. Leave out a list of fifty suburbs on one URL. Split the places you truly serve into pages you can maintain. A page you will not update is a page that will go stale in public.',
        ],
      },
      {
        heading: 'Connect the page to the rest of the site',
        steps: [
          'Link the area page from the homepage and from the office page, in HTML, not only in a map pin.',
          'Add one line for it under the Areas heading in [llms.txt](/learn/llms-txt-for-real-estate).',
          'Use the same place name in [areaServed](/learn/real-estate-agent-schema) on the office page.',
          'Put the trading name and phone in the first paragraph so a quote does not depend on the header chrome.',
          'Set an updated date and change it when the process or the people change. Remove the page when you stop working the area.',
        ],
        paragraphs: [
          'Developers: give the page its own URL and its own title. A single template with a query parameter for the suburb is fine if each combination renders real server HTML and is listed in the sitemap. A map that loads suburbs from an authenticated API is not a public page. Canonicalise one host, with or without www, and use that host in llms.txt and in the schema url.',
          'If you are comparing how to write the page with how a tool drafts it, read [Luminara versus ChatSEO](/compare/chatseo) for the split between a writing tool and a labeled fix. The area page is still your words. A draft that invents a statistic does not get published.',
        ],
      },
      {
        heading: 'One template, different sentences',
        paragraphs: [
          'A developer can ship one template for every area. The fields that must change are the H1, the title, the first paragraph, the instruction steps if they differ, the people who cover it, and the updated date. The chrome, the phone, and the trading name stay shared. If the first paragraph is the only field and someone fills it by replacing the place name in a stock sentence, you have published a doorway page. Write the first paragraph for that place, or do not publish the URL.',
          'Listings do not belong as the whole page. A row of current homes can sit under the answer, and it should be honest about being current stock that will change. The quotable part is the standing description of how you work there. When the last listing sells, the page should still answer the question. Take the listing feed out of the H1.',
          'Across Australia, New Zealand, and South-East Asia the place word changes and the job word changes. Auction and private treaty matter in some cities. A lease by the year matters in others. Use the words your vendors and landlords use, and skip a process you do not offer. A page for a district you only drive through is a page to delete. The [free check](/) will not notice that. A buyer who calls will.',
        ],
      },
    ],
  },
  {
    ...dated,
    path: LEARN_PATHS.check,
    label: 'Check if AI names you',
    description:
      'How to check whether an assistant names your agency, and what the free Luminara check reads: title, description, robots.txt, and llms.txt.',
    h1: 'How to check if AI names your agency',
    sources: [
      { label: 'What the product measures', href: '/docs/what-is-aeo.html' },
      { label: 'Methodology', href: '/methodology' },
      { label: 'OpenAI crawlers', href: 'https://developers.openai.com/api/docs/bots' },
    ],
    related: [
      hub,
      freeCheck,
      { label: 'Robots.txt and AI crawlers', href: LEARN_PATHS.robots },
      { label: 'How an assistant reads your site', href: LEARN_PATHS.how },
      { label: 'Pricing', href: '/pricing' },
    ],
    faq: [
      {
        question: 'Does the free check ask ChatGPT, Claude, or Gemini to name us?',
        answer:
          'The free check reads your homepage title and description, robots.txt, llms.txt, and ai.txt. It does not submit your brand as a question to those products. A named mention is what you see when you ask the assistant yourself and save the reply. Live answers from specific AI products stay Not measured unless you are on Agency or you connect your own search login.',
      },
      {
        question: 'Is one reply a share of voice?',
        answer:
          'One reply is one sample, with a date. Share of voice on this site appears only when that audit run collected live evidence. A missing sample stays Not measured. It is not filled in from a previous week or from a guess.',
      },
      {
        question: 'What should we fix first if we are not named?',
        answer:
          'Look at the search crawler rules, then at the area page that should have answered, then at whether the agency name matches the office page. A missing mention has more than one cause. The crawler documents do not rank those causes.',
      },
    ],
    sections: [
      {
        heading: 'Two different questions',
        paragraphs: [
          'The first question is whether a crawler can read the site. The second is whether a product\'s reply names the agency for a buyer\'s question. They feel like one task. They are not. A file can be perfect and the reply can still name a portal. A reply can name you from a directory even when your own suburb page is blocked. Write down which question you are answering before you change the site.',
          'This page describes both, and it stays inside what we can point at. Crawler behaviour is what OpenAI, Google, and Anthropic publish, linked from the [robots guide](/learn/robots-txt-and-ai-crawlers). Product measurements are what [What is AEO](/docs/what-is-aeo.html) and the [methodology](/methodology) already say. There is no third dataset on this page.',
        ],
      },
      {
        heading: 'What the free check measures',
        paragraphs: [
          'The [free check](/) on the homepage reads the homepage title and description, robots.txt, llms.txt, and ai.txt. It needs no card and no account. Each crawler row is a pass, a fail, or not measured. llms.txt structure means a title and a short summary, and that row is a hint, not a score. None of these rows is a 0 to 100 health figure, and none of them is a citation rate.',
          'Read a fail as a file fact. A disallowed search crawler is something you can open in robots.txt and change. A missing llms.txt is a file you can add with the [generator](/free-tools/llms-txt-generator). The check does not tell you that ChatGPT, Claude, or Gemini named the agency. Live answers from specific AI products stay Not measured unless you are on Agency or you connect your own search login.',
          'Instant Audit can report citation rate, share of voice, and page health only when that run collected live page or search evidence. If the provider failed or the sample was empty, the label is Not measured. The methodology page defines Measured, Estimated, and Not measured in those words. Use them when you repeat a number to a vendor or a principal. An unlabeled number is not a result from this product.',
        ],
      },
      {
        heading: 'How to see a named mention yourself',
        paragraphs: [
          'Write the question the way a buyer would, with the place and the job. "Who can sell a house in Northbridge?" is a test. "Tell me about Example Agency" is a different test: it can be answered from your name alone, including as a navigational link. OpenAI says a site opted out of search can still appear as a navigational link. Do not count that style of reply as a suburb recommendation.',
          'Ask in the product you care about. If you want a colder reply, use a session that is not signed into your agency\'s own tools. Save the full reply, the product name, and the date in a note. One reply is a sample. Ask the same question again later if you are looking for a change, and keep both notes. Do not average them into a percentage. We do not publish a method for turning three chats into a share of voice, and you should not invent one in a client report.',
          'If the reply names you, record which sentence it used and whether that sentence exists on a page you control. If it paraphrases a portal, your next edit is still your own page, not a demand that the portal change. If the reply names a competitor, read their page as a reader. You can see what they published. You cannot see a weight the vendor did not document.',
        ],
      },
      {
        heading: 'If the name is missing',
        steps: [
          'Open robots.txt and check OAI-SearchBot, Claude-SearchBot, and Googlebot, using the [robots guide](/learn/robots-txt-and-ai-crawlers). A sitewide disallow on a search crawler is a reason that product\'s index may skip you. It is not the only reason.',
          'Open the area page with JavaScript disabled. Confirm the first paragraph names the agency and the place.',
          'Compare that name with the homepage H1 and the RealEstateAgent name field.',
          'Run the free check so the file rows are labeled, and keep the screenshot with the date.',
          'Ask the question again after the pages have been fetched. OpenAI says a robots.txt change can take about 24 hours to affect their search systems. That clock is not a schedule for being recommended.',
        ],
        paragraphs: [
          'A signed-in Instant Audit is the next step when you want one labeled fix from a run, not a chat transcript. Plans and what they include are on [pricing](/pricing). The free check remains the no-account read of the homepage and the crawl files. Do not describe it to a client as a watch of ChatGPT, Claude, or Gemini. That description is false, and it is the mistake this page is here to prevent.',
        ],
      },
      {
        heading: 'What to keep in the file',
        paragraphs: [
          'Keep a simple log: date, product, question, whether your trading name appeared, and the URL if the reply showed one. Store it where the office can see it. When an assistant is connected later, the useful history is this log plus the audit you already ran, which is the subject of the [MCP guide](/learn/mcp-for-marketing-data). The log is not a statistic we verify. Label it as your own sample.',
          'Review the log when you change a suburb page or robots.txt, not every morning. Google\'s starter guide says Search changes can take hours or months and that not every edit moves results. Assistants do not publish a matching timetable for being named. Patience is not a metric. It is a reason to avoid a weekly "we grew 10 percent" sentence you cannot source.',
        ],
      },
    ],
  },
  {
    ...dated,
    path: LEARN_PATHS.mcp,
    label: 'MCP for marketing data',
    description:
      'How to connect Cursor or Claude to your agency marketing data with MCP, what the Luminara server can read, and what it will not change.',
    h1: 'Connecting AI agents to your marketing data with MCP',
    sources: [
      { label: 'Model Context Protocol intro', href: 'https://modelcontextprotocol.io/docs/getting-started/intro' },
      { label: 'Luminara MCP docs', href: '/docs/mcp.html' },
    ],
    related: [
      hub,
      { label: 'MCP docs', href: '/docs/mcp.html' },
      { label: 'Tools with an MCP server', href: '/best/ai-visibility-tools-with-mcp' },
      { label: 'Check a named mention', href: LEARN_PATHS.check },
    ],
    faq: [
      {
        question: 'Does connecting MCP make assistants recommend the agency?',
        answer:
          'MCP connects an application to tools and data. It does not change robots.txt, and it does not submit your brand to a public answer engine. A recommendation still depends on what those products can read on the public web. The connection lets your own agent read what you have already stored.',
      },
      {
        question: 'Which plans include the Luminara server?',
        answer:
          'The docs say MCP is on every plan. Free allows 100 calls a day and Starter 300. Growth and Agency have no daily cap. The count is per account. A new token does not reset it. Browser tools need Growth or Agency. Paid research needs Agency or your own research login.',
      },
      {
        question: 'Can the agent edit the website?',
        answer:
          'The three named agents in the docs are read-only. They do not crawl, re-check, or change the site. They answer from what is already stored for the project. An action that needs approval gives you a link, valid for 30 minutes, and you choose Allow or Deny.',
      },
    ],
    sections: [
      {
        heading: 'What MCP is',
        paragraphs: [
          'The [Model Context Protocol](https://modelcontextprotocol.io/docs/getting-started/intro) is an open standard for connecting an AI application to external systems: data, tools, and workflows. Claude, ChatGPT, and editors such as Cursor are named on that page as clients that can speak it. The point for an agency is practical. The person drafting a page, or the developer shipping it, can ask an agent that is allowed to read your project instead of pasting a report into a chat box.',
          'A protocol is not a ranking. Connecting a client does not publish a suburb page, allow a crawler, or cause a public assistant to name you. Those are the earlier guides. MCP is how your own tools see the work you have already done inside Luminara.',
        ],
      },
      {
        heading: 'What the Luminara server will read',
        paragraphs: [
          'The [MCP docs](/docs/mcp.html) describe one server. The endpoint is on that page. You sign in with your Luminara account. The connector flow does not use an API key. The app registers itself, a consent page shows who is asking, and you press Allow. Settings lists connections and a Disconnect button.',
          'Included tools are projects, context, and reports. Three named agents answer from what is stored, and they only read. The Auditor returns findings on record, worst first, with the date of the last audit. The Fixer returns fix drafts stored for the site, and the open findings that have none. The Coach returns the decision set for this week, or a candidate when none is set. Hosts that list prompts show the same three as auditor, fixer, and coach. If nothing is stored, each one points at the free Instant Audit.',
          'That last sentence is the setup step people skip. Connect the server after you have a project. Otherwise the agent can only tell you to run a check. Run the [free check](/) or a signed-in audit first, then ask the Auditor what is on record. You should see your own findings, not a fresh crawl. The docs are explicit: none of the three agents crawls, re-checks, or changes anything.',
        ],
      },
      {
        heading: 'Connect Cursor or Claude',
        paragraphs: [
          'Follow the docs for the current click-path. The shape is the same in both clients: add the server URL, then sign in. For Claude Code the docs give a command that adds an HTTP server named luminara and points it at the endpoint, after which you sign in from the client. For Cursor the docs give an install link and a JSON block you can put in the project MCP config. Copy that block from the docs page so you get the current URL, then start a new agent chat and ask for the Auditor.',
          'A script with no browser can send a Luminara API key as a Bearer token. The docs show that header. Keep the key out of the git repo and out of screenshots. The sign-in flow for Cursor and Claude does not need that key. Use the key for a server you run, not for a laptop chat.',
          'When an action needs a person, the agent gives you a luminarasuite.com link. Sign in, read what it wants, and choose Approve once or Deny. The docs say the link works for 30 minutes. If it expires, start the action again rather than sharing the old URL.',
        ],
      },
      {
        heading: 'Limits that are easy to mis-state',
        paragraphs: [
          'Quote the caps from the docs, not from memory. Free is 100 calls a day. Starter is 300. Growth and Agency have no daily cap. The count is per account, so minting a new token does not reset it. Paid research stays on Agency, or on a research login you connect yourself. Browser tools need Growth or Agency. The included read tools are the ones above.',
          'The docs also say to send one tools call per request. A JSON-RPC batch with more than one tools call is refused. A batch may still carry initialize, tools/list, and ping next to its one call. If you are writing a client, that rule will save you a confusing 400. It is a transport limit, not a content policy.',
          'Other products ship MCP servers too. [AI visibility tools with an MCP server](/best/ai-visibility-tools-with-mcp) compares the job each one does: a saved report, a backlink index, or multi-client analytics. Pick the server that holds the data you need. Connecting three servers does not merge their honesty rules. A number still needs a source.',
        ],
      },
      {
        heading: 'A week of real use',
        steps: [
          'Run an audit on the agency domain so a project exists. Note the date.',
          'Add the server in Cursor or Claude and complete Allow.',
          'Ask the Auditor for the findings on record. Check that the date matches the audit.',
          'Ask the Fixer which findings have a draft. Apply a draft only after a person reads it. The agent will not publish it for you.',
          'Ask the Coach what this week\'s decision is. If none is set, it will say so rather than invent a priority.',
          'Disconnect the client from Settings when a contractor leaves. The docs list Disconnect for every connection.',
        ],
        paragraphs: [
          'Developers building a different server should read the protocol intro for the shape of tools and clients, then keep that server separate from this one. Do not proxy the Luminara endpoint through a key you embed in a public website. The consent screen exists so a person sees who is asking. Hiding it breaks that check.',
          'Bring the public-web work along with the connection. An agent that can read your findings is useful only if the [suburb page](/learn/suburb-pages), the [schema](/learn/real-estate-agent-schema), and the [crawler rules](/learn/robots-txt-and-ai-crawlers) are the ones you meant to publish. MCP reads the record. It does not repair a disallow you shipped last month.',
        ],
      },
    ],
  },
];
