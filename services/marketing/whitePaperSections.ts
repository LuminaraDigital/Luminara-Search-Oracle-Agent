import { estimate, fact, speculation, type Cited, type WhitePaperSection } from './whitePaper';
import type { SourceId } from './whitePaperSources';

const label = (sources: readonly [SourceId, ...SourceId[]], note?: string): Cited => fact('', sources, note);

export const WHITE_PAPER_SECTIONS: readonly WhitePaperSection[] = [
  {
    id: 'executive-summary',
    nav: 'Summary',
    title: 'Executive summary',
    blocks: [
      {
        kind: 'p',
        parts: [
          'This is a product and methodology paper for independent real estate agencies. It is not legal, financial, or investment advice. It does not recommend issuing a token. Traction: Unknown. Market size: Unknown.',
        ],
      },
      {
        kind: 'p',
        parts: [
          fact(
            'Luminara Suite is produced by LUMINARA DIGITAL PTY LTD (ABN 90 693 125 281), founded 2025.',
            ['S27'],
          ),
        ],
      },
      {
        kind: 'p',
        parts: [
          'Search is shifting from ten blue links to synthesized answers. ',
          fact(
            'Google says AI Overviews reached more than 1.5 billion monthly users by May 2025, across 200+ countries and territories.',
            ['S5'],
            'Google-reported',
          ),
          ' ',
          fact(
            'Pew found users clicked a traditional result on 8% of visits with an AI summary, versus 15% without one.',
            ['S3'],
            'observational, not causal',
          ),
          ' ',
          estimate(
            'Ahrefs estimates a roughly 58% lower click-through rate for the top-ranking page when an AI Overview is present, using December 2025 data.',
            ['S4'],
            'published estimate',
          ),
        ],
      },
      {
        kind: 'p',
        parts: [
          'For an independent real estate agency, the question is no longer only whether the site ranks. It is whether the answer names the agency, and whether that can be proved. ',
          fact(
            'Luminara Suite checks a site and live web search, labels every result Measured, Estimated, or Not measured, refuses a blended 0-100 score, and ranks one fix to ship next.',
            ['S20', 'S21', 'S22'],
          ),
        ],
      },
      {
        kind: 'p',
        parts: [
          fact(
            'The Suite ships on four surfaces: a web app with Stripe card checkout, a Telegram Mini App and bot that take Telegram Stars, a free Google Play companion, and a Windows desktop download.',
            ['S20', 'S23', 'S24', 'S27'],
          ),
          ' ',
          fact(
            'Pricing is a one-off 30-day pass that does not auto-renew: A$79, A$229, or A$549, or 2,500, 7,500, and 18,000 Stars.',
            ['S21'],
          ),
        ],
      },
      {
        kind: 'p',
        parts: [
          fact(
            'Australian digital asset law changed materially across 2025 and 2026. On-chain material in this paper is a list of options with legal risk.',
            ['S15', 'S16', 'S17'],
          ),
        ],
      },
      { kind: 'shots', files: ['web-landing.png'] },
    ],
  },
  {
    id: 'problem',
    nav: 'The shift',
    title: 'AI answers are replacing the classic results page',
    blocks: [
      {
        kind: 'ul',
        items: [
          [
            fact(
              'Google states that AI Overviews and AI Mode use query fan-out, issuing multiple related searches to build a response, and that AI Overviews show only when Google judges them additive.',
              ['S1'],
            ),
          ],
          [
            fact(
              'At I/O 2025 Google said AI Mode was rolling out to all US users, and that AI Overviews had more than 1.5 billion monthly users across 200+ countries and territories.',
              ['S5'],
              'Google-reported',
            ),
          ],
          [
            estimate(
              'Gartner forecast in February 2024 that traditional search engine volume would drop 25% by 2026 because of AI chatbots and virtual agents. Treat that as a forecast, not a measurement.',
              ['S6'],
            ),
          ],
        ],
      },
      {
        kind: 'table',
        caption: 'Published click findings. None of them measure Australian real estate queries. That click data: Unknown.',
        columns: ['Finding', 'Study'],
        rows: [
          [
            fact(
              '8% click rate on a traditional result when an AI summary appeared, versus 15% without one.',
              ['S3'],
              'observational, not causal',
            ),
            'Pew Research Center',
          ],
          [
            fact('Clicks on links inside the AI summary: 1% of visits.', ['S3']),
            'Pew Research Center',
          ],
          [
            fact(
              'The session ended after 26% of pages with an AI summary, versus 16% without one.',
              ['S3'],
            ),
            'Pew Research Center',
          ],
          [
            estimate(
              'Position 1 click-through rate about 58% lower when an AI Overview is present. December 2025, 300,000 keywords, desktop Search Console data, published 4 February 2026.',
              ['S4'],
              'published estimate',
            ),
            'Ahrefs',
          ],
          [
            estimate(
              'An earlier Ahrefs study, published April 2025, reported 34.5% lower click-through.',
              ['S4'],
              'published estimate',
            ),
            'Ahrefs',
          ],
        ],
      },
      {
        kind: 'p',
        parts: [
          'Pew\'s data is US-only and observational. Ahrefs uses aggregated desktop Search Console data and a modelled counterfactual. Australian real estate specific click data: Unknown.',
        ],
      },
      {
        kind: 'ul',
        items: [
          [
            fact(
              'The GEO paper (Aggarwal et al., KDD 2024) introduced Generative Engine Optimization and GEO-bench. It reports that content changes can boost visibility in generative engine responses by up to 40% on that benchmark, with effects that vary by domain.',
              ['S7', 'S8'],
            ),
          ],
          [
            fact(
              'A 2025 preprint by Chen et al. reports that AI search engines favor earned, third-party sources over brand-owned and social content, and differ from each other in freshness and phrasing sensitivity.',
              ['S9'],
              'preprint',
            ),
          ],
          [
            fact(
              'In the Pew sample, Wikipedia, YouTube, and Reddit were the most frequently cited sources in both Google AI summaries and standard results.',
              ['S3'],
            ),
          ],
        ],
      },
      {
        kind: 'p',
        parts: [
          speculation(
            'For a local agency, owned-site fixes are necessary and not sufficient. Reviews, directory listings, and press mentions likely matter too. On-page edits alone should not be promised as a way to win citations.',
            ['S3', 'S9'],
          ),
        ],
      },
    ],
  },
  {
    id: 'market-category',
    nav: 'Category',
    title: 'Market and category',
    blocks: [
      {
        kind: 'ul',
        items: [
          ['SEO: optimizing for classic ranked results.'],
          [
            fact(
              'AEO, answer engine optimization: the work of making a page easy for an answer engine to quote. AEO is not a score.',
              ['S22'],
            ),
          ],
          [
            fact(
              'GEO, generative engine optimization: the academic term from Aggarwal et al. for improving visibility in responses synthesized by a language model.',
              ['S7'],
            ),
          ],
          [
            'AI visibility tracking: the commercial category of tools that run prompts against AI products and report mentions, citations, and share of voice.',
          ],
        ],
      },
      {
        kind: 'ul',
        items: [
          [
            fact(
              'Google says there are no additional technical requirements and no special schema to appear in AI Overviews or AI Mode. A page must be indexed and snippet-eligible. Google adds that you do not need to create new machine readable files, AI text files, or markup.',
              ['S1'],
            ),
          ],
          [
            fact(
              'Google also says a site must be included via the Search generative AI control in Search Console to be eligible.',
              ['S2'],
            ),
          ],
          [
            fact(
              'As of 31 August 2026, Google had rolled out a Search Console control to include or exclude a site from AI Overviews, AI Mode, and Discover generative features.',
              ['S10'],
            ),
          ],
          [
            fact(
              'The same rollout added a Generative AI performance report with impressions by page, country, and device.',
              ['S11'],
            ),
          ],
          [
            fact(
              'llms.txt is a community proposal by Jeremy Howard (Answer.AI, 3 September 2024), not a standard. Luminara\'s own docs state that Google Search may ignore it.',
              ['S12', 'S22'],
            ),
          ],
        ],
      },
      {
        kind: 'p',
        parts: [
          speculation(
            'A first-party impressions report means a basic check of whether a site is shown in AI Overviews is becoming free for the site owner. Third-party tools need to differentiate on cross-engine coverage, diagnosis, and the fix. One ranked fix and evidence labels fit that gap. This is reasoning, not a measurement.',
            ['S10', 'S11', 'S20'],
          ),
        ],
      },
      {
        kind: 'p',
        parts: [
          'Market size: Unknown. This paper found no primary, methodologically transparent source that sizes the AEO or GEO tooling market. Secondary blogs quote figures without a method, so those figures are omitted. ',
          fact(
            'The segment the Suite names is independent agencies in Australia, Oceania, and South-East Asia.',
            ['S20'],
          ),
        ],
      },
    ],
  },
  {
    id: 'how-measurement-works',
    nav: 'Measurement',
    title: 'How measurement works',
    blocks: [
      {
        kind: 'ul',
        items: [
          [
            fact(
              'Free check, with no account and no card: homepage title, description, and structured data, plus robots.txt, llms.txt, and ai.txt. Answer engines stay Not measured.',
              ['S20', 'S25'],
            ),
          ],
          [
            fact(
              'Instant Audit, signed in or with your own keys, fetches the live site plus a live web search sample, then gives a plain-English verdict and one fix. Citation rate, share of voice, and page health appear only when that run collected live evidence.',
              ['S22', 'S25'],
            ),
          ],
          [
            fact(
              'Crawler readiness rows cover llms.txt presence, llms.txt structure, AI crawler directives in robots.txt, whether those crawlers are blocked from key paths, and optional ai.txt. Each row is pass, fail, or not measured. None is a 0-100 score.',
              ['S22'],
            ),
          ],
          [
            fact(
              'Live answers from specific AI products stay Not measured unless you are on Agency or you connect your own search login.',
              ['S20', 'S21'],
            ),
          ],
          [
            fact(
              'Measured means evidence from that run, or user-supplied data such as a Search Console export. Estimated is directional. Not measured is never filled in.',
              ['S25', 'S26'],
            ),
          ],
          [
            fact(
              'The Android listing names a 10-bot governance matrix: GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, Applebot-Extended, CCBot, and Bytespider.',
              ['S24', 'S13', 'S14', 'S30'],
            ),
          ],
        ],
      },
      {
        kind: 'p',
        parts: [
          speculation(
            'AI answers vary by engine, location, and phrasing. A tool that prints one score implies precision the sampling does not support. Refusing a blended AI visibility score is a deliberate limit.',
            ['S9', 'S20', 'S22'],
          ),
        ],
      },
      {
        kind: 'ul',
        items: [
          ['Sampled web search is a proxy for any specific AI product\'s answer. It is not a replay of that product.'],
          ['Results are a point in time. Answers drift.'],
          [
            fact(
              'The sample report on the website is illustrative, not a measurement.',
              ['S28'],
            ),
          ],
          [
            fact(
              'Labs features (OracleMind, TimesFM, and the Archy harness) show simulated numbers. They are not measurements.',
              ['S27'],
            ),
          ],
        ],
      },
      { kind: 'shots', files: ['web-product.png', 'telegram-miniapp.png'] },
    ],
  },
  {
    id: 'competitive-map',
    nav: 'Competition',
    title: 'Competitive map',
    blocks: [
      {
        kind: 'p',
        parts: [
          'Prices below are from each vendor\'s own page where it was reachable on the access date, in US dollars unless noted. Vendor pages change often. Ahrefs Brand Radar pricing: Unknown. Re-check before relying on a figure.',
        ],
      },
      {
        kind: 'table',
        caption: 'Entry prices seen on the access date. Luminara prices are non-renewing passes, not monthly subscriptions.',
        columns: ['Vendor', 'Positioning', 'Entry price seen', 'Label'],
        rows: [
          [
            'Semrush AI Visibility Toolkit',
            'AI visibility inside a broad SEO suite, covering ChatGPT, Google AI, Gemini, and Perplexity.',
            fact('US$99 per month per domain, billed annually, with 25 tracked prompts.', ['S31']),
            label(['S31']),
          ],
          [
            'Peec AI',
            'AI search analytics for brands and agencies.',
            fact('Starter US$95 per month, 50 prompts, 3 models, daily tracking.', ['S32']),
            label(['S32']),
          ],
          [
            'Profound',
            'Enterprise AEO platform with agents.',
            fact(
              'Free trial of 50 prompts daily for 7 days. Enterprise is custom, up to 9 answer engines, with SSO, SAML, and SOC 2.',
              ['S33'],
            ),
            label(['S33']),
          ],
          [
            'Ahrefs Brand Radar',
            'AI visibility built on the Ahrefs web index.',
            'Pricing not confirmed on the vendor page. Unknown.',
            'Unknown',
          ],
          [
            'Otterly.AI',
            'Budget AI search monitoring.',
            estimate(
              'The vendor page returned an error. A secondary source cites US$29 per month.',
              ['S35'],
            ),
            estimate('', ['S35']),
          ],
          [
            'Luminara Suite',
            'Evidence-labeled audit and one ranked fix, for independent real estate agencies in Australia, Oceania, and South-East Asia.',
            fact(
              'A$79, A$229, or A$549 per 30-day pass that does not auto-renew. A free account includes 3 checks a day.',
              ['S21', 'S26'],
            ),
            label(['S21', 'S26']),
          ],
        ],
      },
      {
        kind: 'ul',
        items: [
          [fact('Honesty labels, and no blended score.', ['S20', 'S22'])],
          [
            fact(
              'Fix-first output: one ranked fix, ready-to-paste LocalBusiness or FAQPage schema, and an optional WordPress, Webflow, or GitHub push. WordPress counts as done only when the schema is found live.',
              ['S25', 'S26'],
            ),
          ],
          [
            fact(
              'Vertical focus: real estate agencies, with an Enquiry Desk that includes Australian statutory guardrails.',
              ['S26'],
            ),
          ],
          [
            fact(
              'Developer access on every plan: an MCP endpoint for Cursor and Claude, with 100 calls a day on Free.',
              ['S21'],
            ),
          ],
          [
            fact('Non-renewing passes, and Telegram Stars.', ['S21']),
            ' ',
            speculation(
              'The competitors reviewed here are subscription or sales-led.',
              ['S31', 'S32', 'S33'],
            ),
          ],
          [
            fact('The code is under AGPL-3.0. Trademarks are reserved.', ['S27', 'S29']),
          ],
        ],
      },
      {
        kind: 'p',
        parts: [
          fact(
            'Profound offers SSO and SAML, SOC 2, and tracking of up to 9 answer engines on Enterprise. Semrush and Peec run scheduled prompt tracking across several named AI products on entry plans. Luminara keeps live AI product answers Not measured below Agency unless the user brings a search login.',
            ['S33', 'S31', 'S32', 'S21'],
          ),
          ' That coverage gap is a real trade-off.',
        ],
      },
    ],
  },
  {
    id: 'product-surfaces-gtm',
    nav: 'Surfaces',
    title: 'Product surfaces',
    blocks: [
      {
        kind: 'p',
        parts: [
          'The lead audience is independent real estate agencies in Australia, Oceania, and South-East Asia. The same product is available on the web, in Telegram, on Google Play, and as a Windows download. Suite channel performance: Unknown. Traction: Unknown.',
        ],
      },
      {
        kind: 'table',
        caption: 'What each surface does, and how it is paid for.',
        columns: ['Surface', 'What it does', 'Payment'],
        rows: [
          [
            'Web Suite, luminarasuite.com',
            'Free check, Instant Audit, share links, MCP, and plans.',
            fact('Stripe card, for a 30-day pass in Australian dollars.', ['S27']),
          ],
          [
            'Telegram Mini App and bot @LuminaraSuiteBot',
            'Instant Audit with a capped hosted allowance tied to the Telegram session, Ask, and re-audit reminders.',
            fact('Telegram Stars only.', ['S21', 'S27']),
          ],
          [
            'Google Play companion, com.luminarasuite.app',
            'Instant Audit away from the desk, Ask, offline history, and bring-your-own-key or hosted checks when signed in.',
            fact(
              'Free. It does not sell passes. Signed-in users get 3 hosted checks per UTC day, or they bring their own keys.',
              ['S24'],
            ),
          ],
          [
            'Windows desktop',
            'A desktop download is listed.',
            'Payment is not stated. Scope: Unknown.',
          ],
        ],
      },
      { kind: 'links' },
      {
        kind: 'ul',
        items: [
          [
            fact(
              'The site publishes comparison pages and free browser tools, including a robots.txt generator, an llms.txt generator, and a real estate schema generator.',
              ['S21'],
            ),
          ],
          [
            fact(
              'Telegram supports Star referral programs: developers can open affiliate programs for mini apps and pay commissions on referred purchases.',
              ['S19'],
            ),
          ],
          [
            speculation(
              'A Telegram-first funnel may suit markets where Telegram use is common. Suite channel performance data is Unknown, so this paper does not imply a result.',
              ['S19', 'S23'],
            ),
          ],
        ],
      },
      {
        kind: 'shots',
        files: [
          'web-landing.png',
          'telegram-bot.png',
          'telegram-miniapp.png',
          'telegram-miniapp-2.png',
          'play-listing.png',
          'play-listing-screenshots.png',
        ],
      },
    ],
  },
  {
    id: 'monetization',
    nav: 'Pricing',
    title: 'Monetization',
    blocks: [
      { kind: 'shots', files: ['telegram-bot.png'] },
      {
        kind: 'p',
        parts: [
          fact(
            'Free: 1 domain, a capped hosted scout, bring-your-own-key, and 3 public share links a day. A free account includes 3 checks a day. Starter is A$79 or 2,500 Stars. Growth is A$229 or 7,500 Stars. Agency is A$549 or 18,000 Stars. Each paid pass lasts 30 days and does not auto-renew. Agency adds API access, 10 client workspaces, a daily drift check, and a white-label PDF. MCP is on every plan, with 100 calls a day on Free.',
            ['S21', 'S26', 'S27'],
          ),
        ],
      },
      {
        kind: 'p',
        parts: [
          fact(
            'Users can supply their own provider keys and bear those provider costs.',
            ['S27'],
          ),
        ],
      },
      {
        kind: 'ul',
        items: [
          [
            fact(
              'Telegram: digital goods in bots and mini apps must be sold in Stars (currency XTR). Other currencies or third-party providers can get the mini app hidden from mobile users. Bots must answer pre-checkout within 10 seconds and should store telegram_payment_charge_id for refunds. Users buy Stars via Apple or Google in-app purchase, or via @PremiumBot.',
              ['S18'],
            ),
          ],
          [
            fact(
              'Telegram said developers would withdraw Stars as Toncoin via Fragment.',
              ['S19b'],
            ),
          ],
          [
            fact(
              'Fragment\'s current terms describe rewards issued as Grams ($GRAM) to a connected TON wallet, irreversible on the TON ledger.',
              ['S36'],
            ),
          ],
          [
            'Payout asset, holding periods, and rates: verify at the time of writing. This paper does not state a conversion rate.',
          ],
          [
            fact(
              'The Android app does not sell passes. Since 30 September 2026, Australian users can be offered alternative billing or external web links under Google\'s billing choice program. Example service fees include 10% on the first US$1M of annual earnings, and 20% standard for one-off purchases by new installs via external links.',
              ['S24', 'S37'],
            ),
          ],
          [
            speculation(
              'Selling inside the Play app later would need Play Billing or enrollment in that billing choice program.',
              ['S37'],
            ),
          ],
        ],
      },
      {
        kind: 'p',
        parts: [
          speculation(
            'Other models to evaluate, not recommendations: annual agency licences, per-client workspace add-ons, a white-label reseller tier for marketing agencies, and paid research credits. Unit cost per audit (model and search spend) is Unknown, so none of these is ranked.',
            ['S21'],
          ),
        ],
      },
    ],
  },
  {
    id: 'onchain-telegram-adjacency',
    nav: 'On-chain',
    title: 'On-chain options and legal risk',
    blocks: [
      {
        kind: 'p',
        parts: [
          'This paper does not recommend issuing a token. The rows below are options and risks. They are not a plan.',
        ],
      },
      { kind: 'shots', files: ['telegram-miniapp-2.png'] },
      {
        kind: 'ul',
        items: [
          [fact('The Mini App takes Telegram Stars only.', ['S21', 'S27'])],
          [
            fact(
              'The privacy policy says The Open Network and Toncenter receive a payment check only when a user pays on that network.',
              ['S38'],
            ),
          ],
          [
            speculation(
              'It is not clear from public pages whether a direct TON payment path is live. That needs confirmation from the company.',
              ['S38'],
            ),
          ],
          [
            fact(
              'Mini apps that use a blockchain must use TON exclusively for tokens or blockchain assets, connect wallets only through TON Connect, and must not promote non-TON wallets or tokens. New assets issued on or after 21 January 2025 must comply. Plain bots without a Mini App are exempt.',
              ['S39', 'S47'],
            ),
          ],
        ],
      },
      {
        kind: 'table',
        caption: 'Token scenarios. Options only. This paper does not recommend issuing a token.',
        columns: ['Scenario', 'Possible purpose', 'Key risks'],
        rows: [
          [
            'A. No token (status quo)',
            speculation('Stars and card passes.', ['S21']),
            speculation('Lowest legal risk of the four. No extra investor story.', ['S21']),
          ],
          [
            'B. On-chain receipts or proofs',
            speculation('Hash audit reports to TON so a reader can check they were not altered.', ['S47']),
            speculation(
              'Low value if users do not check. Privacy of the hashed data. Engineering cost.',
              ['S39', 'S47'],
            ),
          ],
          [
            'C. Utility credit token',
            speculation('A token redeemable for audits, as prepaid usage.', ['S18']),
            speculation(
              'May still be a financial product or a non-cash payment facility. Telegram\'s TON-only rule applies. App store rules on digital goods apply.',
              ['S15', 'S18', 'S39'],
            ),
          ],
          [
            'D. Investment-style or governance token',
            speculation('Fundraising.', ['S15']),
            speculation(
              'Highest risk: likely a financial product, with disclosure and licensing duties, and misleading-conduct exposure.',
              ['S15', 'S27'],
            ),
          ],
        ],
      },
      {
        kind: 'ul',
        items: [
          [
            fact(
              'ASIC reissued INFO 225 on 29 October 2025. It says many widely traded digital assets are financial products under current law, and lists stablecoins, wrapped tokens, tokenised securities, and wallets among products it considers financial products.',
              ['S15'],
            ),
          ],
          [
            fact(
              'The class no-action position covered firms that lodged an Australian financial services licence application by 30 June 2026, required the service to have been provided on or before 31 December 2025, and excluded crypto lending and earn products and most derivatives.',
              ['S16'],
            ),
          ],
          [
            speculation(
              'A new token launched now would not benefit from that class no-action position.',
              ['S16'],
            ),
          ],
          [
            fact(
              'The Corporations Amendment (Digital Assets Framework) Act 2026 received Royal Assent on 8 April 2026. ASIC expects the regime to commence on 9 April 2027.',
              ['S17', 'S40'],
            ),
          ],
          [
            speculation(
              'Token marketing that implies profit from the team\'s efforts invites securities-law scrutiny in common-law jurisdictions. Misleading statements risk consumer-law action. In Australia that includes the Australian Consumer Law, which the Suite terms already reference.',
              ['S27'],
            ),
          ],
          [
            'Obtain advice from an Australian financial services lawyer before any public token wording. Keep public language to the product, the method, and the risks.',
          ],
        ],
      },
    ],
  },
  {
    id: 'architecture',
    nav: 'Architecture',
    title: 'Architecture',
    blocks: [
      {
        kind: 'p',
        parts: [
          'This section repeats what public docs and the privacy policy already say. It stops there.',
        ],
      },
      {
        kind: 'ul',
        items: [
          [
            fact(
              'APIs run on Cloudflare Workers. The privacy policy names Cloudflare hosting, D1, KV, request logs, and D1 Time Travel with a 30-day restore.',
              ['S38', 'S41', 'S42'],
            ),
          ],
          [
            fact(
              'Android sign-in uses Firebase Auth. The Mini App uses Telegram initData. Telegram documents how to validate initData.',
              ['S21', 'S38', 'S44'],
            ),
          ],
          [
            fact(
              'Signed-in users have a hosted model allowance, or they bring their own keys. The privacy policy names Groq, NVIDIA, Google Gemini, OpenRouter, Ollama, Tavily, Exa, and Firecrawl.',
              ['S38'],
            ),
          ],
          [
            fact(
              'On Android, bring-your-own-key secrets are stored with Android Keystore AES-256-GCM.',
              ['S24'],
            ),
          ],
          [
            fact(
              'The web app uses a one-off Stripe checkout. Telegram uses Stars through the invoice, pre-checkout, and successful payment flow, and grants access only after payment succeeds.',
              ['S18', 'S27'],
            ),
          ],
          [fact('Agents call an MCP endpoint at luminarasuite.com/api/mcp.', ['S21'])],
          [
            fact(
              'Share teasers under /share/teaser/ are crawlable. Full reports are unlisted and noindex. /api/, /verify/, /reports/, and /oauth/ are disallowed.',
              ['S22'],
            ),
          ],
        ],
      },
    ],
  },
  {
    id: 'risks-open-questions',
    nav: 'Risks',
    title: 'Risks and open questions',
    blocks: [
      {
        kind: 'ul',
        items: [
          [
            fact(
              'Platform dependency: Google\'s guidance, AI features, and the Search Console report can change what a third-party tool adds.',
              ['S1', 'S10', 'S11'],
            ),
          ],
          [
            fact(
              'Measurement validity: AI answers vary by engine and phrasing. Sampled web search is a proxy.',
              ['S9'],
            ),
          ],
          [
            fact(
              'Competitive pressure from suites with broader named-engine coverage and scheduled prompt tracking.',
              ['S31', 'S32', 'S33'],
            ),
          ],
          [
            fact(
              'Telegram policy risk: Stars-only and TON-only rules are set by the platform and can change.',
              ['S18', 'S39'],
            ),
          ],
          [
            fact(
              'Regulatory risk for any token, as set out in the on-chain section.',
              ['S15', 'S16', 'S17'],
            ),
          ],
          [
            fact(
              'Positioning: the website targets independent real estate agencies. The Play listing describes a general workbench for website operators and engineering teams. This paper uses the website audience as the lead story.',
              ['S20', 'S24'],
            ),
          ],
          [
            fact(
              'Data protection: overseas disclosure to model and search providers is an APP 8 question.',
              ['S38', 'S46'],
            ),
          ],
          [
            'Unknown: unit economics per audit, traction, retention, Windows app scope, and whether a direct TON payment path is live.',
          ],
        ],
      },
    ],
  },
  {
    id: 'glossary',
    nav: 'Glossary',
    title: 'Glossary',
    blocks: [
      {
        kind: 'table',
        caption: 'Short definitions. Counts and prices stay in the sections above, with their labels.',
        columns: ['Term', 'Meaning'],
        rows: [
          ['AI Overview', 'Google\'s AI-generated summary shown on some results pages.'],
          ['AI Mode', 'Google\'s conversational search mode, which uses query fan-out.'],
          ['AEO', 'Answer engine optimization: making a page easy for an answer engine to quote. AEO is not a score.'],
          ['GEO', 'Generative engine optimization: improving visibility in responses a language model synthesizes.'],
          ['BYOK', 'Bring your own key: the user supplies model or search API keys and bears those costs.'],
          ['llms.txt', 'A proposed Markdown file that summarizes a site for language models. It is not a Google requirement.'],
          ['ai.txt', 'An optional AI usage policy file the Suite checks. It is not an official standard.'],
          ['MCP', 'Model Context Protocol. IDE agents such as Cursor and Claude use it to call tools.'],
          ['Telegram Stars (XTR)', 'Telegram\'s in-app item for digital goods sold in bots and mini apps.'],
          ['Mini App', 'A web app launched inside Telegram.'],
          ['TON / TON Connect', 'The Open Network blockchain, and its wallet connection protocol.'],
          ['AFSL', 'Australian financial services licence.'],
          ['Measured / Estimated / Not measured', 'The Suite\'s evidence labels. Missing data stays Not measured.'],
        ],
      },
    ],
  },
  {
    id: 'sources',
    nav: 'Sources',
    title: 'Sources',
    blocks: [
      {
        kind: 'p',
        parts: [
          'Open a row for the note and the public link. The access date on each row is the day the brief was checked.',
        ],
      },
    ],
  },
];
