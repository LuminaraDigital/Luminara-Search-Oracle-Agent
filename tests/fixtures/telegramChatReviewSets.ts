/**
 * The sentence sets from the third independent review of the Telegram chat honesty work
 * (Track SW task SW0a-8), kept word for word. tests/telegramChatHonesty.test.ts runs each set
 * in the direction the review states. Nobody tuned these to the code: do not edit a sentence
 * to make a test pass.
 */

/** Direct questions about our plans, prices or payment. */
export const DIRECT_PLAN_QUESTIONS: string[] = [
  'How much is Starter?', 'price?', 'pricing', 'how much', 'How much does it cost?', 'what does it cost', 'is it free', 'is it free?',
  'Is this free?', 'how do I pay', 'How do I pay?', 'how can i pay', 'can I pay with TON', 'do you take cards', 'do you accept paypal',
  'starter', 'Starter', 'growth', 'Growth?', 'pro', 'agency', 'Agency plan', 'whats the cheapest', "what's the cheapest option",
  'refund', 'I want my money back', 'can I get my stars back after I pay?', 'what happens after 30 days?', 'does it renew',
  'will I be charged again?', 'I was charged twice for Starter', 'cancel', 'how do I cancel', 'any discount?', 'promo code?',
  'free trial?', 'do you have a trial', 'what plans do you have', 'plans', 'tiers?', 'subscription', 'how do I subscribe',
  'how do I upgrade', 'upgrade', 'What do I get with Growth?', 'difference between pro and agency', 'is growth worth it',
  'which plan for 5 sites', 'how many stars', 'stars?', 'what is the single audit', 'how much is one audit', 'deep crawl price',
];

/** Indirect, misspelt or casual questions about our plans, prices or payment. */
export const INDIRECT_PLAN_QUESTIONS: string[] = [
  'What do I get if I go bigger?', 'what do i get if i upgrade later', 'whats the damage', 'what will this set me back',
  'how much $$', 'hw much', 'how mch is it', 'howmuch', 'prcie?', 'pricng', 'cost?', 'costs', '$$?', '$?', 'how many ⭐',
  'is there a monthly fee', 'monthly or yearly?', 'per month?', 'do I have to pay', 'do i need to pay for this',
  'is this paid', 'is it paid?', 'paid or free', 'free?', 'free or not', 'whats included', 'what is included in the top one',
  'limits?', 'how many sites can I add', 'how many audits do I get', 'can I add more sites', 'I need more sites',
  'I need more audits', 'I hit the limit', 'why am I limited', 'how do I get unlimited', 'unlimited?', 'how to unlock everything',
  'how do I unlock premium engines', 'unlock', 'do you have an enterprise option', 'team pricing', 'student deal?', 'any deals',
  'black friday?', 'is there a sale', 'cheaper option?', 'something cheaper', 'too expensive', 'can I try before I commit',
  'can I test it first', 'demo?', 'money back?', 'I paid but nothing happened', 'my payment failed', 'I got double billed',
  'where is my receipt', 'how do I stop it', 'how do I turn off auto pay', 'does it auto charge', 'do you keep my card',
  'card?', 'visa?', 'paypal?', 'crypto?', 'TON?', 'usdt?', 'can I pay in dollars', 'apple pay?', 'wallet?',
  'how long does it last', 'when does it end', 'when does mine run out', 'do I lose my data when it ends', 'lifetime?',
  'one time or recurring', 'is it a one off', 'annual?', 'yearly plan?', 'starter vs growth', 'starter or growth',
  'which one should I get', 'which should I buy', 'what do you recommend I buy', 'is the big one worth it', 'the 25 one',
  'the cheap one', 'the 75 stars thing', 'single audit', 'one audit', 'deep crawl', 'how do I buy', 'buy', 'where do I buy',
  'I want to buy', 'take my money', 'sign me up', 'how do i join', 'license key', 'I have a license key', 'gift a plan?',
  'can my team share one', 'invoice for my company', 'VAT?', 'tax?',
];

/** A plan question inside a longer message about a site. */
export const LONG_PLAN_QUESTIONS: string[] = [
  'My site acme.io sells invoices and I want to be cited by ChatGPT, what would it cost me to have you track it weekly?',
  'I run 3 shops and need audits for all of them. What would that run me here?',
  'Before I spend time on schema, tell me what I get on the paid side and for how much.',
  'We are an agency with 12 clients, can we put them all on one account and what is the bill?',
  'Love the advice. Now how do I get the weekly re-audits you mentioned, is that extra?',
  'If I add 10 more domains do I need to pay more?',
  'Can I keep using this chat for nothing or does it stop at some point?',
  'How many questions can I ask before you make me pay?',
  'I want the PDF export and the API. Which level has those?',
  'Is the Drift Sentinel included or separate?',
];

/** Plan questions in other languages. */
export const NON_ENGLISH_PLAN_QUESTIONS: string[] = [
  'Quanto costa?', 'Quanto costa il piano Starter?', 'È gratis?', 'Come pago?', 'Fiyat nedir?', 'Kaç para?', 'Ücretsiz mi?',
  'Ile to kosztuje?', 'Czy to jest darmowe?', 'Hoeveel kost het?', 'Is het gratis?', 'Vad kostar det?', 'Berapa harganya?',
  'Gratis?', 'Apakah gratis?', 'Скільки коштує?', 'Це безкоштовно?',
  '多少钱？', '免费吗？', 'いくらですか？', '얼마예요?', 'كم السعر؟',
  'قیمت چقدر است؟', 'कितने का है?', 'Bao nhiêu tiền?',
  'Сколько?', 'скок стоит', 'почём?', 'как оплатить?', 'это платно?', 'деньги вернёте?',
  'надо платить?', 'а бесплатная версия есть?', 'можно картой?',
  'cuanto es', 'cuánto sale?', 'es de pago?', 'hay que pagar?', 'cómo pago?', 'quanto é?', 'é pago?', 'como pago?',
  "c'est combien ?", "c'est payant ?", 'comment payer ?', 'wie teuer?', 'ist das gratis?', 'muss ich zahlen?', 'wie zahle ich?',
];

/** Ordinary prompts about search visibility. None is about our plans: each must reach the model. */
export const ORDINARY_PROMPTS: string[] = [
  'How do I get cited by ChatGPT?', 'What is AEO?', 'Explain GEO in one paragraph', 'Can you check stripe.com visibility?',
  'audit acme.io', 'How do I add FAQ schema?', 'Give me breadcrumb JSON-LD for acme.io', 'What is llms.txt?',
  'Should I block GPTBot?', 'Why does Perplexity not mention my brand?', 'How do I rank in AI Overviews?',
  'What is the best schema for a SaaS pricing page?', 'How should I write my pricing page so AI can quote it?',
  'Should I put my prices in schema?', 'Should I show prices on my site?', 'How do I describe my free trial in schema?',
  'Should I offer my customers a discount for reviews?', 'How do I get more reviews?', 'Do 5 star reviews help?',
  'Is it worth paying for Semrush?', 'Should I cancel my Ahrefs account?', 'Can you get me traffic for free?',
  'How much does Ahrefs cost?', 'What is the price of Semrush?', 'Is Google Search Console free?', 'Are there free SEO tools?',
  'What free tools do you recommend?', 'Is ChatGPT Plus worth it for research?', 'Does Perplexity Pro cite more sources?',
  'How much should I spend on content?', 'How much does a link campaign cost?', 'What do agencies charge for AEO?',
  'How much do backlinks cost?', 'Should I buy backlinks?', 'Is buying reviews a bad idea?', 'Should I pay for a press release?',
  'Is it worth hiring an agency?', 'Should I hire a freelancer or an agency?', 'How do I grow organic traffic?',
  'What is a good growth strategy for a new blog?', 'Pro tips for product pages?', 'What starter pages does a new site need?',
  'Give me a 30-day content plan', 'Plan my next 4 blog posts', 'What is a good content plan for Q4?',
  'How do I upgrade my schema to the latest version?', 'Should I upgrade my hosting?', 'When should I renew my domain?',
  'How do I cancel a redirect?', 'How do I subscribe to Google Search Central updates?', 'My checkout page is indexed, is that bad?',
  'How do I mark up a subscription product?', 'How do I mark up a refund policy?', 'Does MerchantReturnPolicy schema help?',
  'How do I write a returns page that AI will cite?', 'My competitor is cheaper, how do I win citations?',
  'How do I compete with free tools?', 'What does it cost to rank?', 'How long until I see results?',
  'Is it expensive to build topical authority?', 'How many pages do I need?', 'What is a good citation rate?',
  'My store sells TON wallets, how do I get cited?', 'I sell Telegram bots, how do I get found?', 'How do Telegram mini apps get discovered?',
  'What is the cheapest way to get backlinks?', 'Do I need a paid tool to track AI mentions?', 'Which tool tracks AI citations?',
  'Can you write me a meta description?', 'Rewrite my H1: Invoices made easy', 'Is my robots.txt ok if it blocks /checkout?',
  'What should my billing page say for trust?', 'How do I explain my pricing tiers clearly?', 'What makes a good plans page?',
  'thanks', 'ok',
];

/** Rewordings of the ordinary prompts that were swallowed. None is about our plans. */
export const ORDINARY_REWORDINGS: string[] = [
  'How do I mark up a refund policy?', 'How do I mark up my refund policy?', 'How do I mark up our refund policy page?',
  'refund policy schema for my store', 'MerchantReturnPolicy for my shop refunds', 'How do I mark up a subscription product?',
  'schema for my subscription product', 'Rewrite my H1: Invoices made easy', 'My product is invoicing software. Rewrite my H1.',
  'How do I cancel a redirect?', 'remove a redirect', 'What should my billing page say for trust?', 'Is Google Search Console free?',
  'How much does Ahrefs cost?', 'I sell trial lessons for kids, how do I get cited?', 'my app has a paywall, can AI read it?',
  'How do I show a discount in Offer schema?', 'Offer schema with priceValidUntil and a discount?', 'receipt page noindex?',
  'How do I get my coupon page out of the index?', 'Should expired product pages be removed?', 'What happens when a page expires from the index?',
];

/** Messages sent after the plan block. With no carry-over only "and the cheapest?" is a plan question. */
export const MESSAGES_AFTER_THE_BLOCK: string[] = [
  'ok, now audit acme.com', 'audit acme.com', 'how do I get cited?', 'what is json-ld?', 'check my competitors please',
  'why are you repeating?', 'help', 'tell me a joke', 'what about chatgpt?', 'and perplexity?', 'who are you', 'stop',
  'thanks', 'ok', 'what is AEO?', 'how do I rank?', 'write me an H1', 'next question: llms.txt',
  'now help me with my homepage', 'lets talk about schema', 'never mind', 'I see', 'hmm', 'makes sense', 'not interested',
];

/** Payment problems, in the payer's words. Each must get the /paysupport reply and no model call. */
export const BILLING_PHRASINGS: string[] = [
  'I paid but nothing happened', 'I paid 2500 stars and my plan is not active', 'payment went through but no access',
  'I was charged twice', 'I was charged twice yesterday and nothing changed on my account', 'money was taken but plan not active',
  'you took my money', 'where are my stars', 'stars gone, no access', 'it took my stars twice', 'double charge',
  'I bought it yesterday and still locked', 'I already paid', 'paid twice by mistake', 'it says premium locked but I paid',
  'my plan is not active', 'my plan disappeared', 'why did my plan change', 'I was downgraded', 'my access is gone',
];

/** Wrong answers a model could give to "How much is Starter?", with no plan name and no Stars. */
export const PRICE_ANSWERS: string[] = [
  "It's 2,500 for a month.", "It's 1,000 for a month.", 'Only 25 to try it once.', 'Just 1,000 for 30 days.', '1,000 for 30 days.',
  'Around 1,000.', '2,500.', 'That one is 1,000, the next is 3,000 and the top one is 9,000.',
  'The entry level is 1,000 and the top level is 9,000.', 'You are looking at 1,000 for the small one.',
  'Roughly a thousand for a month.', 'The first one is 1,000 for 30 days, the second 3,000.', 'The number you want is 1,000.',
  '1,000 gets you 30 days.', 'Think 1,000 for the basics.', 'Half of that this week.', 'Nothing for the first week.',
  'The first week is on us.', 'You get your first week at no charge.',
  'There is a 7-day grace period before you are asked for anything.', 'It comes back every 30 days until you turn it off.',
  'It rolls over each month on its own.', 'You will be asked again every month automatically.', 'Cards work too.',
  'Visa and Mastercard are accepted in the app.', 'PayPal works on the website.',
  'You can get it back within 14 days, no questions asked.', 'Use SAVE20 at the last step.',
];

/** Price replies in other languages. */
export const NON_ENGLISH_PRICE_REPLIES: string[] = [
  'Starter kostet 500 Sterne pro Monat.', 'Der Starter-Tarif kostet 500 Sterne pro Monat.',
  'Starter стоит 500 звёзд в месяц.',
  'Тариф Starter стоит 500 звёзд в месяц.',
  'Тариф Стартер стоит 500 звёзд.',
  'Стоимость: 500 звёзд в месяц, продлевается автоматически.',
  'Starter coûte 500 étoiles par mois.', 'Le forfait Starter coûte 500 étoiles par mois.',
  'El plan Starter cuesta 500 estrellas al mes.', 'Cuesta 500 estrellas al mes y se renueva solo.',
  'Starter custa 500 estrelas por mês.', 'Starter costa 500 stelle al mese.',
  'Starter ücreti aylık 500 yıldız.', 'Starter每月500星。',
  'Starter هو 500 نجمة شهريا.', 'Gratis la primera semana.',
  'Первая неделя бесплатно.',
];

/** Short answers to "What is my AI visibility right now?". Each states a measurement nobody made. */
export const SHORT_ANSWERS: string[] = [
  'About 37%.', 'Roughly 60 out of 100.', 'Probably around 40-50%.', 'Right now: 37%.', 'I would estimate 6/10.',
  "I'd put it at 62 out of 100.", 'You are at #3.', 'Third place, behind Rival Corp and Beta Inc.', 'Top 3.',
  '#3 on Perplexity and #5 on ChatGPT.', 'On ChatGPT you come up 4th.', 'It is 37% today.\nThat is low for your category.',
  'Based on what I can see, about 1 in 3.', 'Your site: 37%. Rival Corp: 61%.', 'acme.io: 37/100\nrival.com: 61/100',
  'You: 37%\nRival Corp: 61%', 'Low. Maybe 20%.', 'Your number is 37.', 'Your AEO readiness is 6/10.',
  'Your GEO grade is 72.', 'Your site is 80% ready for AI search.', 'Your schema coverage is 40%.',
  'You are missing 60% of the schema types that matter.', 'ChatGPT knows about 3 of your 10 products.',
];

/** Promised outcomes. Each promises a number nobody can promise. */
export const PROMISED_OUTCOMES: string[] = [
  'Publish 4 case studies to get 50% more traffic.', 'Fix your schema to reach the top 3 in a month.',
  'Add 3 FAQ questions to lift your visibility to 80%.', 'Add FAQ schema to double your citations.',
  'Add FAQ schema and your citations will double.', 'Adding FAQ schema typically raises citations by 30%.',
  'Use Luminara Growth to triple your AI visibility.', 'With these fixes you can expect a 25% increase.',
];

/** Harmless sentences. The user wrote "I get 1,200 visits a month and have 40 backlinks. What next?". */
export const HARMLESS_USER_TEXT = 'I get 1,200 visits a month and have 40 backlinks. What next?';
export const HARMLESS_SENTENCES: string[] = [
  'Add FAQ schema to your pricing page.', 'Keep each answer under 60 words so engines can quote it.',
  'Keep titles under 60 characters so they rank without truncation.',
  'A meta description of 150 to 160 characters is a common guideline for ranking pages.',
  'Aim for 2 to 3 internal links per page to help crawlers rank it.',
  'Pages that answer a question in the first 2 sentences are easier to cite.',
  'Use schema.org version 28.1 types when you cite products.',
  'Next.js 15 renders JSON-LD on the server, which helps engines cite you.',
  'See https://schema.org/FAQPage for the fields engines cite.',
  'Read https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data#3 to rank.',
  'Call +1 415 555 0100 if your traffic team needs help.', 'You told me you get 1,200 visits a month.',
  'You said your traffic is 1,200 visits a month, so start with the top pages.', 'As you mentioned, you have 40 backlinks.',
  'If your score is below 50 in the app, start with schema.', 'The audit in the app gives a score out of 100.',
  'The audit scores your site from 0 to 100.', 'There are 3 pages on your site that could earn citations.',
  'There are 4 main AI engines that cite sources: ChatGPT, Gemini, Perplexity and Google.',
  'Google AI Overviews launched in 2024 and cites sources.', 'HTTP 301 redirects pass ranking signals.',
  'A 404 page hurts visibility.', 'Set a canonical tag so 2 URLs do not split ranking signals.',
  'Use one H1 and 3 to 5 H2 headings so engines can rank sections.', 'robots.txt line 4 blocks GPTBot, so it cannot cite you.',
  'Use "priority": 0.8 in your sitemap for pages you want cited.', '{"@type":"FAQPage","position":1}',
  'Put `"position": 1` in the first ListItem so engines rank it first.', 'I cannot see your rank, but 3 things usually help.',
  'I have not measured your visibility; open the app for the 7-agent audit.', 'The Growth plan covers 10 sites.',
  'Free users get 1 site.', 'The free tier allows 5 queries a day before you need to share your feedback.',
  'The top 10 results get most clicks.', 'Most users never visit page 2.', 'Reviews with 4 or 5 stars help local rank.',
  'Wikipedia is cited by all 4 engines.', 'Is your traffic above 1,000 visits a month?',
  'What score did the audit give you: above or below 70?', 'IPv4 and HTTP/2 do not affect rank.',
  'ISO 8601 dates help engines cite events.', 'WCAG 2.2 compliance does not change citations directly.',
  'Core Web Vitals: keep LCP under 2.5 seconds to rank well.', 'Core Web Vitals: keep LCP under 2.5s to rank well.',
  'An INP under 200 ms is considered good for ranking.', 'Section 2: Schema and citations',
  '2) Add Organization schema so engines can cite your brand.', 'On 12 October 2026, check your citations again.',
  'Check citations again on 12 October.', 'Check your citations again at 9:30 am.', 'Check citations weekly for Q4 2026.',
  'Your message mentioned 2 competitors: Rival Corp and Beta Inc.', 'Rule of thumb: 1 clear claim per page, cited by a source.',
  'One page, one topic, 100% focus: that is how you earn citations.', 'Be 100% sure the page is crawlable before chasing citations.',
  'Each of those 3 steps helps engines cite you.', 'These 3 changes matter most for visibility.',
  'Two things matter for citations: 1) sources, 2) structure.', 'Use a 1200x630 image so shares look right.',
  'E-E-A-T has 4 parts, and authority is one of them.', 'For a 50-page site, start with the 5 pages that get the most visits.',
];

/** Advice sentences that use plan and money words in their everyday sense. The user asked "How do I get cited by ChatGPT?". */
export const ADVICE_USER_TEXT = 'How do I get cited by ChatGPT?';
export const ADVICE_SENTENCES: string[] = [
  'Growth comes from being cited by sources engines already trust.', 'Growth is slow at first, then compounds.',
  'Growth is the goal, but trust comes first.', 'Growth takes 3 to 6 months of steady publishing.',
  'Growth for a 10-page site starts with the home page.', 'Organic growth takes time.', 'Focus on growth in branded search.',
  'Pro tip: answer the question in the first sentence.', 'Pro: it is fast. Con: it needs upkeep.',
  'Pros and cons of FAQ schema follow.', 'A pro would start with the pricing page.',
  'Starter pages for a new site: home, pricing, about, contact.', 'Starter question: who is the buyer?',
  'Starter is a fine word for a first draft.', 'A starter checklist helps.', 'Agency sites often bury their case studies.',
  'Agency or in-house, 3 rules apply.', 'Agency: a clear services page matters most.',
  'Agency is a crowded category, so pick a niche.', 'If you run an agency, publish client results with permission.',
  'Hire an agency if you lack time.', 'An agency charges a retainer for this kind of work.',
  'Agencies charge $2,000 to $5,000 a month for this.', 'Agency retainers often start around 2,000 dollars a month.',
  'Growth teams often spend 5,000 USD a month on content.', 'Reviews with 4 or 5 stars help local rank.',
  'Ask customers for 5 star reviews.', 'A 5 Star rating helps.',
  'A 4.8 Star average in AggregateRating schema can show in results.', 'Hotels with 4 Stars rank better in local packs.',
  'Review Stars in search results lift click-through.', 'Mark up ratings so the Stars show under your result.',
  'Use ratingValue 4.8 and bestRating 5 so the stars render.', 'Your GitHub repo with 50 stars is a trust signal.',
  'Google Search Console is free.', 'Use a free tool like Google Search Console.',
  'The free version of Screaming Frog crawls 500 URLs.', 'Ahrefs Webmaster Tools has a free plan for site owners.',
  'Bing Webmaster Tools is free and worth 10 minutes.', 'Free tools are enough to start.',
  'Offer a free trial on your pricing page and say so in schema.',
  'State your refund policy on the pricing page so engines can quote it.', 'Put your prices in Offer schema with priceCurrency.',
  'List each plan on your pricing page with its price.', 'Your pricing page should name each tier and its price.',
  'Add a comparison table of your plans and competitors.', 'The cost of ignoring AI search is rising.',
  'The cost of a link campaign varies widely.', 'Content costs time, not just money.', 'Cheap backlinks hurt more than they help.',
  'Do not buy links.', 'If you buy backlinks, Google may penalize you.',
  'You can buy a domain with history, but check its past first.', 'You can upgrade old posts with fresh data.',
  'Upgrade your hosting if pages load slowly.', 'When you renew your domain, keep the same registrar records.',
  'You can cancel the redirect once the new URL is indexed.', 'Subscribe to Google Search Central updates.',
  'A subscription business should publish its cancellation terms.', 'If you sell subscriptions, add a pricing FAQ.',
  'Checkout pages should be noindex.', 'Buyers ask AI assistants which tool is cheapest.',
  'Shoppers pay with whatever is easiest, so list payment methods in schema.',
  'TON and other crypto projects need clear docs to get cited.', 'Semrush and Ahrefs both have paid plans.',
  'ChatGPT Plus users see browsing results.', 'Perplexity Pro cites more sources per answer.',
  'This tool can also draft your FAQ.', 'Our app has a full audit; tap the button below.', 'Open the app for the full audit.',
  'Tap the "Open Luminara Suite" button below for the full visual suite.', 'I can only give general guidance here.',
  'Plan your content around buyer questions.', 'A 90-day plan works well.', 'Make a content plan for Q4.',
];
