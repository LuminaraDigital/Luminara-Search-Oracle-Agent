/**
 * Sources for the white paper, accessed 2026-11-02.
 * Ids match the research brief. Notes stay with the link they describe.
 */

function source<const I extends string>(
  id: I,
  title: string,
  urls: readonly [string, ...string[]],
  notes: string,
) {
  return { id, title, urls, accessed: '2026-11-02' as const, notes };
}

export const WHITE_PAPER_SOURCES = [
  source('S1', 'Google Search Central: AI features and your website', ['https://developers.google.com/search/docs/appearance/ai-features'], 'No extra technical requirements or special schema for AI Overviews or AI Mode. Query fan-out. No need for AI text files.'),
  source('S2', 'Google: Guide to optimizing for generative AI features on Google Search', ['https://developers.google.com/search/docs/fundamentals/ai-optimization-guide'], 'A site must be indexed, snippet-eligible, and included via the Search generative AI control.'),
  source('S3', 'Pew Research Center: Do people click on links in Google AI summaries? (22 Jul 2025)', ['https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/'], '900 US adults, March 2025 browsing: 8% versus 15% click rate, 1% of visits clicked a link inside the AI summary, 26% versus 16% ended the session. Observational, US only.'),
  source('S4', 'Ahrefs: Update: AI Overviews Reduce Clicks by 58% (4 Feb 2026)', ['https://ahrefs.com/blog/ai-overviews-reduce-clicks-update/'], '300,000 keywords, desktop Search Console data. Modelled about 58% lower position-1 click-through rate (December 2025). An earlier 2025 study reported 34.5% lower.'),
  source('S5', 'Google blog: AI Mode in Google Search, updates from I/O 2025', ['https://blog.google/products-and-platforms/products/search/google-search-ai-mode-update/'], 'Google-reported: AI Overviews had more than 1.5 billion monthly users across 200+ countries and territories. AI Mode was rolling out to all US users.'),
  source('S6', 'Gartner press release (19 Feb 2024): search engine volume forecast', ['https://www.gartner.com/en/newsroom/press-releases/2024-02-19-gartner-predicts-search-engine-volume-will-drop-25-percent-by-2026-due-to-ai-chatbots-and-other-virtual-agents'], 'Forecast only: traditional search engine volume would drop 25% by 2026. The page returned 403 to a direct fetch. The text was confirmed via the search index and press coverage.'),
  source('S7', 'Aggarwal et al.: GEO: Generative Engine Optimization (arXiv 2311.09735)', ['https://arxiv.org/abs/2311.09735'], 'Introduces GEO and GEO-bench. Reports that content changes can boost visibility by up to 40% on that benchmark. Effects vary by domain.'),
  source('S8', 'ACM Digital Library: GEO, KDD 2024', ['https://dl.acm.org/doi/10.1145/3637528.3671900'], 'Peer-reviewed publication record, published 24 Aug 2024.'),
  source('S9', 'Chen et al.: Generative Engine Optimization: How to Dominate AI Search (arXiv 2509.08919)', ['https://arxiv.org/abs/2509.08919'], 'Preprint. AI search engines favor earned third-party sources over brand-owned and social content, and differ in freshness and phrasing sensitivity.'),
  source('S10', 'Search Console Help: Search generative AI control', ['https://support.google.com/webmasters/answer/16908024?hl=en'], 'Rolled out worldwide as of 31 Aug 2026. Include or exclude a site from AI Overviews, AI Mode, and Discover generative features.'),
  source('S11', 'Search Console Help: Generative AI performance report', ['https://support.google.com/webmasters/answer/16984139?hl=en'], 'Rolled out worldwide as of 31 Aug 2026. Impressions by page, country, and device.'),
  source('S12', 'llms.txt proposal (llmstxt.org and Answer.AI, 3 Sep 2024)', ['https://llmstxt.org/', 'https://www.answer.ai/posts/2024-09-03-llmstxt'], 'Community proposal by Jeremy Howard. Not a standard.'),
  source('S13', 'OpenAI: Overview of OpenAI crawlers', ['https://platform.openai.com/docs/bots'], 'Documents GPTBot, OAI-SearchBot, and ChatGPT-User.'),
  source('S14', 'Perplexity: Perplexity crawlers', ['https://docs.perplexity.ai/guides/bots'], 'PerplexityBot documentation.'),
  source('S15', 'ASIC 25-250MR: Updated ASIC guidance (29 Oct 2025)', ['https://www.asic.gov.au/about-asic/news-centre/find-a-media-release/2025-releases/25-250mr-updated-asic-guidance-supports-digital-asset-innovation-and-boosts-investor-protection'], 'INFO 225 reissued. ASIC says many widely traded digital assets are financial products, including stablecoins, wrapped tokens, tokenised securities, and wallets.'),
  source('S16', 'ASIC class no-action letter for digital asset businesses (29 Oct 2025)', ['https://download.asic.gov.au/media/3q3jwena/asic-class-no-action-letter-for-digital-asset-businesses-published-29-october-2025.pdf'], 'Covered firms that lodged an AFSL application by 30 June 2026, for a service provided on or before 31 December 2025. Excludes crypto lending and earn products and most derivatives.'),
  source('S17', 'Parliament of Australia: Corporations Amendment (Digital Assets Framework) Bill 2025', ['https://www.aph.gov.au/Parliamentary_Business/Bills_Legislation/Bills_Search_Results/Result?bId=r7411', 'https://www.legislation.gov.au/C2026A00038/asmade'], 'Became Act No. 38 of 2026.'),
  source('S18', 'Telegram: Bot Payments API for digital goods (Stars)', ['https://core.telegram.org/bots/payments-stars'], 'Digital goods in bots and mini apps must be sold in Stars (XTR). Answer pre-checkout within 10 seconds. Store telegram_payment_charge_id. Users buy Stars via Apple or Google in-app purchase or @PremiumBot.'),
  source('S19', 'Telegram API: Stars, including referral programs', ['https://core.telegram.org/api/stars'], 'Developers can open affiliate programs for mini apps and pay commissions on referred purchases.'),
  source('S19b', 'Telegram blog: Telegram Stars', ['https://telegram.org/blog/Telegram-Stars'], 'Stars via Apple or Google in-app purchase or PremiumBot. Telegram said developers would withdraw Stars as Toncoin via Fragment.'),
  source('S20', 'Luminara Suite home', ['https://www.luminarasuite.com/'], 'Independent real estate agencies in Australia, Oceania, and South-East Asia. Measured, Estimated, or Not measured. No blended score.'),
  source('S21', 'Luminara Suite llms.txt', ['https://www.luminarasuite.com/llms.txt'], 'Plan details, Stars prices, MCP caps, Mini App link, and comparison pages.'),
  source('S22', 'Luminara Suite: What is AEO', ['https://www.luminarasuite.com/docs/what-is-aeo.html'], 'AEO definition, crawler readiness rows, honesty glossary, and robots policy for share pages.'),
  source('S23', 'Luminara Suite Telegram Mini App', ['https://t.me/LuminaraSuiteBot/app'], 'Mini App entry. Bot @LuminaraSuiteBot.'),
  source('S24', 'Google Play listing: Luminara Suite (com.luminarasuite.app)', ['https://play.google.com/store/apps/details?id=com.luminarasuite.app'], 'Companion features, a 10-bot governance matrix, BYOK with Android Keystore AES-256-GCM, and 3 hosted checks per UTC day when signed in. The app does not sell passes.'),
  source('S25', 'Luminara Suite FAQ and Methodology', ['https://www.luminarasuite.com/faq', 'https://www.luminarasuite.com/methodology'], 'Free check versus full audit, label definitions, and WordPress, Webflow, or GitHub fixes.'),
  source('S26', 'Luminara Suite: Why Luminara', ['https://www.luminarasuite.com/why'], 'Schema fixes, Enquiry Desk with Australian statutory guardrails, and a free account with 3 checks a day.'),
  source('S27', 'Luminara Suite Terms of Service (updated 23 Oct 2026)', ['https://www.luminarasuite.com/terms'], 'Stripe 30-day AUD passes. Mini App takes Stars only. Labs features are simulated. Code under AGPL-3.0. Australian Consumer Law. Operator line names the company, ABN, and founding year.'),
  source('S28', 'Luminara Suite sample report', ['https://www.luminarasuite.com/sample-report'], 'The sample report is illustrative, not a measurement.'),
  source('S29', 'Luminara Suite source repository', ['https://github.com/LuminaraDigital/Luminara-Search-Oracle-Agent'], 'Public repository linked from llms.txt. Trademarks reserved.'),
  source('S30', 'Google: common crawlers', ['https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers'], 'Includes the Google-Extended token documentation.'),
  source('S31', 'Semrush: AI Visibility Toolkit pricing', ['https://www.semrush.com/pricing/ai/'], 'US$99 per month per domain, billed annually. 25 tracked prompts. ChatGPT, Google AI, Gemini, and Perplexity.'),
  source('S32', 'Peec AI pricing', ['https://peec.ai/pricing'], 'Starter US$95 per month, 50 prompts, 3 models, daily tracking.'),
  source('S33', 'Profound pricing', ['https://www.tryprofound.com/pricing'], 'Free trial of 50 prompts daily for 7 days. Enterprise is custom, up to 9 answer engines, with SSO, SAML, and SOC 2.'),
  source('S34', 'Ahrefs Brand Radar', ['https://ahrefs.com/brand-radar'], 'Product page. Price was not confirmed on the vendor page.'),
  source('S35', 'Secondary AI visibility market map (unverified)', ['https://areyoufoundbyai.com/research/ai-visibility-market-2026'], 'Secondary source. Cites Otterly at US$29 per month. The Otterly pricing page returned an error on access.'),
  source('S36', 'Fragment Terms of Service', ['https://fragment.com/terms'], 'Rewards issued by default as Grams ($GRAM) to a connected TON wallet. Withdrawals are irreversible on the TON ledger.'),
  source('S37', 'Play Console Help: billing choice program', ['https://support.google.com/googleplay/android-developer/answer/17161464?hl=en'], 'Australia availability from 30 Sep 2026. Example service fees include 10% on the first US$1M of annual earnings, and 20% standard for one-off purchases by new installs via external links.'),
  source('S38', 'Luminara Suite Privacy Policy', ['https://www.luminarasuite.com/privacy'], 'Names Cloudflare hosting, D1, KV, request logs, and D1 Time Travel 30-day restore. Also Firebase, Telegram, Stripe, and model or search providers: Groq, NVIDIA, Google Gemini, OpenRouter, Ollama, Tavily, Exa, Firecrawl. The Open Network and Toncenter receive a payment check only when a user pays on that network. APP 8.'),
  source('S39', 'Telegram: Blockchain Guidelines', ['https://core.telegram.org/bots/blockchain-guidelines'], 'Mini apps that use a blockchain must use TON exclusively for tokens or blockchain assets, connect wallets only through TON Connect, and not promote non-TON wallets or tokens. Assets issued on or after 21 January 2025 must comply. Plain bots without a Mini App are exempt.'),
  source('S40', 'ASIC: Regulatory developments timetable', ['https://www.asic.gov.au/regulatory-resources/find-a-document/regulatory-document-updates/regulatory-developments-timetable'], 'The digital assets framework received Royal Assent on 8 April 2026. ASIC expects the regime to commence 9 April 2027.'),
  source('S41', 'Cloudflare Workers documentation', ['https://developers.cloudflare.com/workers/'], 'Edge compute reference for the Workers platform.'),
  source('S42', 'Cloudflare D1 documentation', ['https://developers.cloudflare.com/d1/'], 'Serverless SQLite reference for D1.'),
  source('S44', 'Telegram Mini Apps documentation', ['https://core.telegram.org/bots/webapps'], 'Mini App platform and initData validation.'),
  source('S46', 'OAIC: Australian Privacy Principles', ['https://www.oaic.gov.au/privacy/australian-privacy-principles'], 'APP 8 covers cross-border disclosure of personal information.'),
  source('S47', 'TON documentation', ['https://docs.ton.org/'], 'The Open Network and TON Connect reference.'),
] as const;

export type SourceId = (typeof WHITE_PAPER_SOURCES)[number]['id'];

const SOURCE_INDEX = new Map(WHITE_PAPER_SOURCES.map((item) => [item.id, item]));

export function whitePaperSource(id: SourceId): (typeof WHITE_PAPER_SOURCES)[number] {
  const found = SOURCE_INDEX.get(id);
  if (!found) {
    throw new Error(`Missing white paper source ${id}`);
  }
  return found;
}

/** S19, then S19b, then S20. */
export function compareSourceIds(a: SourceId, b: SourceId): number {
  const rank = (id: SourceId) => {
    const match = /^S(\d+)([a-z])?$/.exec(id);
    return match ? [Number(match[1]), match[2] ?? ''] as const : [Number.MAX_SAFE_INTEGER, id] as const;
  };
  const [aNum, aSuffix] = rank(a);
  const [bNum, bSuffix] = rank(b);
  if (aNum !== bNum) return aNum - bNum;
  if (aSuffix < bSuffix) return -1;
  if (aSuffix > bSuffix) return 1;
  return 0;
}
