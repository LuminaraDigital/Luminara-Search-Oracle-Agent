/**
 * Privacy policy text shared by the public page and the in-app page.
 * Plain English. Same disclosures as the previous in-app policy.
 */
import { LEGAL_ENTITY_LINE } from './consumerTerms';

export const PRIVACY_UPDATED = '22 October 2026';

export const PRIVACY_INTRO =
  'This policy says what personal information Luminara Suite handles on the website, the Telegram Mini App, the Telegram bot, and the related Cloudflare APIs. It matches the product as shipped. It is not legal advice. For a counsel-approved data processing agreement, email privacy@luminarasuite.com.';

export interface PrivacySection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
}

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    title: 'Who we are',
    paragraphs: [
      `The controller is ${LEGAL_ENTITY_LINE}, Melbourne ("Luminara Digital", "we", "us"). The product is Luminara Suite: the website, the Telegram Mini App, and the Telegram bot @LuminaraSuiteBot. Privacy: privacy@luminarasuite.com. Security: security@luminarasuite.com. Support: support@luminarasuite.com.`,
    ],
  },
  {
    title: 'Who this covers',
    paragraphs: [
      'It covers visitors, people who sign in with Firebase email or Google, people who sign in with Telegram, people who pay with Telegram Stars or TON, and anyone who points their own client at our hosted Worker. If you run a self-hosted copy, that copy is your responsibility.',
    ],
  },
  {
    title: 'Information we handle',
    paragraphs: ['What we hold depends on how you use the product.'],
    bullets: [
      'Account: a Firebase user id, email, and display name, or a Telegram user id, name, username, language, and an optional photo URL from Telegram\'s signed launch data (initData). We may link a Telegram login and a Firebase login to one account.',
      'What you type: business profile, domains, competitor names, chat messages, audit reports, brand memory, client workspaces, watchlists, and CMS settings you save.',
      'API keys you paste (Groq, NVIDIA, Gemini, Tavily, Firecrawl, Exa, OpenRouter, Ollama, and similar) stay in your browser. If you sign in and turn on workspace sync, those keys can also be stored in your workspace on Cloudflare (D1 or KV). Synced keys are sensitive. Prefer local-only keys if you do not want them on our systems. Stronger encryption for synced keys is not finished yet.',
      'Plan and billing: plan id, expiry, Telegram Stars charge ids, TON order amount, memo, status, and transaction hash, daily free-quota counters, and Sentinel watch targets (owner id, domain, brand, Telegram chat id, keywords, and scores).',
      'Logs: Cloudflare request logs, and the IP address used in memory for abuse limits. We do not set first-party marketing cookies.',
    ],
  },
  {
    title: 'Where it is stored',
    bullets: [
      'On your device: localStorage and sessionStorage hold the business profile, chat, audits, memory, themes, and keys when you are not relying on sync.',
      'On Cloudflare: a D1 database (users and workspace JSON) and KV (subscriptions, quota, workspace fallback, Sentinel targets, short-lived TON orders, and an enrichment cache). Hosting and logs are on Cloudflare.',
      'Firebase Authentication holds email, password, and Google sign-in credentials for the luminara-suite project.',
    ],
  },
  {
    title: 'Why we use it',
    bullets: [
      'To run audits, chat, brand memory, Sentinel, and client workspaces.',
      'To sign you in, count the free daily allowance, and deliver Stars or TON plans.',
      'To relay blocked browser AI calls (for example NVIDIA NIM) without storing the key on that relay.',
      'To keep the service secure, limit abuse, and fix outages.',
      'To answer privacy, support, and security requests.',
    ],
    paragraphs: [
      'Where the GDPR or UK GDPR applies, the legal bases are: performing the contract for the service you ask for; legitimate interests in security and keeping the product working; consent when you connect optional third-party keys or a wallet; and a legal obligation when we must keep payment dispute records.',
    ],
  },
  {
    title: 'AI and search providers',
    paragraphs: [
      'When you run an audit or a chat, prompts, URLs, scraped page text, and the linked business profile are sent to the model and search providers you use. Hosted keys on luminarasuite.com are used only for signed-in users within the free daily allowance or an active plan. If you bring your own key, the request goes to that vendor. Some NVIDIA and Gemini calls are relayed by our Worker, and the key is not stored on that relay. Those vendors process data under their own policies. Providers can include:',
    ],
    bullets: [
      'Groq, NVIDIA NIM, Ollama, Google Gemini, OpenRouter.',
      'Tavily, Exa, and Firecrawl for search and crawl evidence.',
      'LanguageTool and Umami, only if you turn those features on.',
      'Cloudflare for hosting, KV, D1, and logs.',
      'Firebase and Google for sign-in.',
      'Telegram for Mini App identity, Stars payments, and bot alerts.',
      'The Open Network and Toncenter for checking an on-chain payment.',
    ],
  },
  {
    title: 'Telegram and wallets',
    paragraphs: [
      'Inside Telegram we receive the signed launch data Telegram sends. We check it with HMAC-SHA256. We use it to identify you, meter usage, send Sentinel alerts to your chat id, and record Stars purchases. We do not receive your phone number, card number, or bank account. Telegram handles Stars payments. You can clear the bot\'s chat memory with /reset or /clear. Connecting a TON wallet shares the public address with the app in your browser. We do not hold funds, and we do not store private keys or seed phrases.',
    ],
  },
  {
    title: 'Cookies',
    paragraphs: [
      'We do not set first-party advertising cookies. Cloudflare and the sign-in vendors may set cookies the service needs to run. We do not run our own page-analytics pixel. Umami is only an optional results tracker you configure yourself.',
    ],
  },
  {
    title: 'How long we keep it',
    bullets: [
      'Browser data: until you clear site storage.',
      'Daily quota counters: about 2 days (48 hours).',
      'Enrichment cache: about 7 days.',
      'Unfinished TON orders: about 2 hours.',
      'Bot chat context: kept in KV so the conversation can continue, and deleted when you send /reset.',
      'Subscriptions, user rows, workspace data, and Sentinel targets: while the account is active, or until deletion finishes.',
      'Payment identifiers we need for a dispute: as long as the payment partner requires. A public blockchain record cannot be erased.',
    ],
  },
  {
    title: 'International transfers',
    paragraphs: [
      'We use Cloudflare\'s global network and vendors in the United States and other countries, for example Firebase and AI APIs. Where the GDPR applies, transfers rely on those vendors\' published transfer tools, such as Standard Contractual Clauses, and on your contract with us for the service.',
    ],
  },
  {
    title: 'Your rights',
    paragraphs: [
      'Depending on where you live, including the GDPR, UK GDPR, and the CCPA/CPRA, you may access, correct, delete, export, restrict, or object to some processing, and you may opt out of a "sale" or "sharing" of personal information.',
      'We do not sell personal information for money. We do not use cross-context behavioural advertising.',
      'To use these rights, email privacy@luminarasuite.com from the address on your account, or include your Telegram id. In Telegram, /status shows the plan metadata we hold. To wipe this browser, clear site storage. Settings can remove API keys from the device.',
      'If you are signed in, you can download your data with POST /api/privacy/export (a JSON file, and the token lasts 48 hours) and ask for deletion with POST /api/privacy/delete (a soft delete with a 24 hour cancel window). You can still email us. We aim to finish a verified deletion within 30 days, except records we must keep for security, fraud, or the law, and except a public blockchain payment record.',
    ],
  },
  {
    title: 'Children',
    paragraphs: [
      'The service is for businesses. It is not directed at children under 16, or under 13 where that is the local rule. We do not knowingly collect children\'s information. If you think we have, email privacy@luminarasuite.com and we will delete it.',
    ],
  },
  {
    title: 'Automated results',
    paragraphs: [
      'Audits and chat replies are written by third-party models from the evidence available at the time. They can be wrong. They are information for you to review. They are not an automated decision that has a legal or similar effect on you without a person on your side reviewing it.',
    ],
  },
  {
    title: 'Security',
    paragraphs: [
      'We use HTTPS, Cloudflare protections, sign-in checks on hosted keys, and limited Worker permissions. No method of sending or storing data is perfectly secure. Report a vulnerability to security@luminarasuite.com.',
    ],
  },
  {
    title: 'If something goes wrong',
    paragraphs: [
      'If we learn of a personal-data breach that the law says we must report, we will tell affected users and regulators as the law requires, by account email or Telegram when we have that contact.',
    ],
  },
  {
    title: 'California (CCPA / CPRA)',
    paragraphs: [
      'Categories: identifiers, commercial plan data, internet activity (logs), and content you upload. The purposes are in "Why we use it". We do not sell personal information. To ask us to know, delete, or correct information, email privacy@luminarasuite.com. We will not treat you worse for using these rights. An authorised agent must show proof of authority.',
    ],
  },
  {
    title: 'Changes',
    paragraphs: [
      'We may update this policy when the product changes. The "Last updated" date will change. If a change reduces your rights, we will say so in the product, or by email or Telegram when we have a way to reach you.',
    ],
  },
  {
    title: 'Contact',
    paragraphs: [
      'Privacy: privacy@luminarasuite.com. Security: security@luminarasuite.com. Support: support@luminarasuite.com.',
    ],
  },
];
