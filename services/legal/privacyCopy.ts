/**
 * Privacy policy text shared by the public page and the in-app page.
 * The Australian Privacy Act is the main section. Other regions are one short note.
 */
import { OPERATOR_LINE, PUBLIC_CONTACT_LINE } from './consumerTerms';

export const PRIVACY_UPDATED = '1 November 2026';

export const PUBLIC_PRIVACY_URL = 'https://www.luminarasuite.com/privacy';

export const PUBLIC_TERMS_URL = 'https://www.luminarasuite.com/terms';

export const PRIVACY_INTRO =
  'This policy says what personal information Luminara Suite handles on the website, the Android app, the Telegram Mini App, the Telegram bot, and the related Cloudflare APIs. It matches the product as shipped. It is not legal advice. For a counsel-approved data processing agreement, email privacy@luminarasuite.com.';

export interface PrivacySection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
}

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    title: 'Who we are',
    paragraphs: [
      `We are ${OPERATOR_LINE} ("we", "us"). The product is Luminara Suite: the website, the Android app, the Telegram Mini App, and the Telegram bot @LuminaraSuiteBot. ${PUBLIC_CONTACT_LINE} Privacy: privacy@luminarasuite.com. Security: security@luminarasuite.com. Support: support@luminarasuite.com.`,
    ],
  },
  {
    title: 'Australian Privacy Act 1988',
    paragraphs: [
      'Luminara Digital is an Australian business. The Privacy Act 1988 (Cth) and the Australian Privacy Principles (APPs) are the main rules for personal information we handle.',
      'Collection notice. We collect the account, usage, and billing details listed under "Information we handle" when you create an account, run a check, pay, or email us. If you do not give an email address or a Telegram id, we cannot sign you in or deliver a paid plan. The live crawl check on the website does not need an account.',
      'Use and disclosure. We use personal information to run audits, chat, and saved work, to sign you in, to deliver the plan you buy, to limit abuse, and to answer support. We disclose it to the providers named in this section when that step needs them. We do not sell personal information. We do not use it for cross-context behavioural advertising.',
      'Access and correction. Email info@luminara.digital from the address on the account, or include your Telegram id. Ask us to correct information that is wrong, incomplete, or out of date. We will correct it, or tell you why we will not. If you are signed in, open Settings, then Account. Download your data as JSON first. To delete the account, type DELETE and sign in again. That removes the live rows for the account, including workspaces, audits, public win pages, and saved fix state, and it deletes a Firebase sign-in when there is one. Cloudflare D1 Time Travel can restore a database backup for 30 days. We do not restore a deleted account from that backup unless the law requires it. Records a payment partner must keep, and a public blockchain payment, stay.',
      'Overseas disclosure (APP 8). Some of these providers are outside Australia. We disclose personal information to them only so they can do the step we asked for, and we take reasonable steps so they handle it consistently with the APPs. We use Cloudflare for hosting, D1, KV, and request logs. We use Google Firebase for sign-in. We use Telegram for Mini App identity, Stars payments, and the bot. We use Stripe to process card payments. When a check or a chat runs, the prompt and page text go to the providers that check uses: Groq, NVIDIA, Google Gemini, OpenRouter, Ollama, Tavily, Exa, and Firecrawl. The Open Network and Toncenter receive a payment check only when you pay on that network.',
      'Security. The site uses HTTPS. Sign-in checks protect hosted keys. Synced API keys are handled as described under "Information we handle". No method of sending or storing data is perfectly secure. Report a vulnerability to security@luminarasuite.com.',
      'Complaints. Email info@luminara.digital and describe what happened. We will respond. If you are not satisfied, you can complain to the Office of the Australian Information Commissioner (OAIC) at https://www.oaic.gov.au/.',
    ],
  },
  {
    title: 'Who this covers',
    paragraphs: [
      'It covers visitors, people who sign in with Firebase email or Google, people who sign in with Telegram, people who pay by card through Stripe, with Telegram Stars, or with TON, and anyone who points their own client at our hosted Worker. If you run a self-hosted copy, that copy is your responsibility.',
    ],
  },
  {
    title: 'Information we handle',
    paragraphs: ['What we hold depends on how you use the product.'],
    bullets: [
      'Account: a Firebase user id, email, and display name, or a Telegram user id, name, username, language, and an optional photo URL from Telegram\'s signed launch data (initData). We may link a Telegram login and a Firebase login to one account.',
      'What you type: business profile, domains, competitor names, chat messages, audit reports, brand memory, client workspaces, watchlists, and CMS settings you save.',
      'API keys you paste (Groq, NVIDIA, Gemini, Tavily, Firecrawl, Exa, OpenRouter, Ollama, and similar) stay on the device where you entered them. In a browser they stay in that browser. On the Android app, keys you save are stored encrypted on the device with Android Keystore AES-256-GCM. When a provider call needs your own key, the browser or the Android app may send it to our Worker in the x-provider-key header. The Worker forwards that key to the provider for the call and does not save it as an account key. If you are signed in on the website and turn on workspace sync, those keys are encrypted in that browser with AES-256-GCM before upload. The key is derived with PBKDF2-SHA-256 (100,000 iterations) from a secret stored in that browser. Another browser does not have that secret, so it cannot decrypt those keys. If encryption fails, the keys are uploaded without that encryption. Audits, chat, and other workspace content are stored as you saved them, without that encryption.',
      'Plan and billing: plan id, expiry, a Stripe checkout session id when you pay by card, Telegram Stars charge ids, TON order amount, memo, status, and transaction hash, daily free-quota counters, and Sentinel watch targets (owner id, domain, brand, Telegram chat id, keywords, and scores). Stripe is the card payment processor. We do not store card numbers.',
      'Logs: Cloudflare request logs, and the IP address used in memory for abuse limits. We do not set first-party marketing cookies.',
    ],
  },
  {
    title: 'Where it is stored',
    bullets: [
      'On your device: in a browser, localStorage and sessionStorage hold the business profile, chat, audits, memory, themes, and keys when you are not relying on sync. On the Android app, saved API keys are encrypted with Android Keystore AES-256-GCM.',
      'On Cloudflare: a D1 database (users and workspace JSON) and KV (subscriptions, quota, workspace fallback, Sentinel targets, short-lived TON orders, and an enrichment cache). Hosting and logs are on Cloudflare.',
      'Firebase Authentication holds email, password, and Google sign-in credentials for the luminara-suite project.',
      'Stripe holds the card payment. We keep the plan id, expiry, and checkout session id.',
    ],
  },
  {
    title: 'Why we use it',
    bullets: [
      'To run audits, chat, brand memory, Sentinel, and client workspaces.',
      'To sign you in, count the free daily allowance, and deliver a card pass, Stars, or TON plan.',
      'To relay blocked browser AI calls (for example NVIDIA NIM) without storing the key on that relay.',
      'To forward a key you send in the x-provider-key header to the provider for that call, without saving it as an account key.',
      'To keep the service secure, limit abuse, and fix outages.',
      'To answer privacy, support, and security requests.',
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
      'Stripe for card payments. We do not store card numbers.',
      'Telegram for Mini App identity, Stars payments, and bot alerts.',
      'The Open Network and Toncenter for checking an on-chain payment.',
    ],
  },
  {
    title: 'Telegram, wallets, and cards',
    paragraphs: [
      'Inside Telegram we receive the signed launch data Telegram sends. We check it with HMAC-SHA256. We use it to identify you, meter usage, send Sentinel alerts to your chat id, and record Stars purchases. We do not receive your phone number or bank account. Telegram handles Stars payments. The Mini App takes Stars only. You can clear the bot\'s chat memory with /reset or /clear. Connecting a TON wallet shares the public address with the app in your browser. We do not hold funds, and we do not store private keys or seed phrases. If a card payment is processed, Stripe processes it. We store the plan id, expiry, and checkout session id. We do not store the card number.',
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
      'Database backups: Cloudflare D1 Time Travel can restore the database for 30 days. A deleted account is removed from the live database. We do not restore it from that backup unless the law requires it.',
      'Payment identifiers we need for a dispute: as long as the payment partner requires. A public blockchain record cannot be erased.',
      'Records that stay after an account is deleted: spend totals with no content, used for checking provider invoices, and one-time license and trial claims, used to stop repeat use.',
      'A Launchpad campaign that is on a public chain or has vouchers issued also stays after deletion, for the people holding them. We stop listing it and remove its business number and compliance notes.',
    ],
  },
  {
    title: "If you're outside Australia",
    paragraphs: [
      'If the GDPR, UK GDPR, or the CCPA/CPRA applies to you, you may ask to access, correct, delete, export, or restrict personal information, and you may object to some processing. You may opt out of a sale or sharing of personal information. We do not sell personal information. To ask, email privacy@luminarasuite.com from the address on your account, or include your Telegram id. An authorised agent must show proof of authority.',
      'Where the GDPR applies, we rely on the contract for the service you ask for, legitimate interests in security and keeping the product working, consent when you connect optional keys or a wallet, and a legal obligation when we must keep payment dispute records. Overseas transfers use the providers named above and their published transfer tools, such as Standard Contractual Clauses.',
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
    title: 'If something goes wrong',
    paragraphs: [
      'If we learn of a personal-data breach that the law says we must report, we will tell affected users and regulators as the law requires, by account email or Telegram when we have that contact.',
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
      'Privacy: privacy@luminarasuite.com. Security: security@luminarasuite.com. Support: support@luminarasuite.com. Privacy complaints: info@luminara.digital, then the OAIC if we do not resolve them.',
    ],
  },
];
