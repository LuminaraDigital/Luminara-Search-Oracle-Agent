import React from 'react';

interface Props {
  kind: 'privacy' | 'terms';
  onBack: () => void;
}

const UPDATED = '10 September 2026';
const CONTROLLER = 'Luminara Digital Agency';
const PRIVACY_EMAIL = 'privacy@luminarasuite.com';
const SUPPORT_EMAIL = 'support@luminarasuite.com';
const SECURITY_EMAIL = 'security@luminarasuite.com';

/**
 * Industry-style Privacy and Terms pages, kept truthful to how the product works
 * (browser storage, optional signed-in workspace sync, Telegram, TON, Firebase).
 * Not legal advice. Have counsel review before treating as counsel-approved.
 */
export const LegalPage: React.FC<Props> = ({ kind, onBack }) => {
  const isPrivacy = kind === 'privacy';
  return (
    <div className="min-h-screen bg-black text-gray-300">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <button
          type="button"
          onClick={onBack}
          className="text-[10px] uppercase tracking-[0.3em] font-black text-gold hover:text-gold-light mb-10"
        >
          ← Back
        </button>
        <h1 className="text-3xl md:text-4xl font-semibold gold-text mb-2">
          {isPrivacy ? 'Privacy Policy' : 'Terms of Service'}
        </h1>
        <p className="text-xs text-gray-500 mb-4">
          Luminara Suite · Operated by {CONTROLLER} · Last updated {UPDATED}
        </p>
        {isPrivacy && (
          <p className="text-xs text-gray-500 mb-10 leading-relaxed border border-white/10 rounded-xl p-4 bg-white/[0.02]">
            This policy describes personal data we process when you use luminarasuite.com, the
            Telegram Mini App, and related Cloudflare Workers APIs. It is written to match the
            shipped product. It is not legal advice. If you need a counsel-approved DPA or local
            statutory schedule, contact {PRIVACY_EMAIL}.
          </p>
        )}

        {isPrivacy ? (
          <div className="space-y-8 text-sm leading-relaxed">
            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">1. Who we are</h2>
              <p>
                Controller: {CONTROLLER} (&quot;Luminara&quot;, &quot;we&quot;, &quot;us&quot;). Product: Luminara Suite
                (web app and Telegram Mini App) for search and answer-engine visibility audits.
                Contact: {PRIVACY_EMAIL}. Security: {SECURITY_EMAIL}. Support: {SUPPORT_EMAIL}.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">2. Scope</h2>
              <p>
                Applies to visitors, signed-in users (Firebase email/Google or Telegram), Telegram
                Stars / TON subscribers, and self-hosters who point a client at our hosted Worker.
                Self-hosted deployments you operate yourself are under your own privacy obligations.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">3. Data we process</h2>
              <p className="mb-3">Categories depend on how you use the product:</p>
              <ul className="list-disc pl-5 space-y-2 text-gray-400">
                <li>
                  <span className="text-gray-200">Account identifiers:</span> Firebase UID, email,
                  display name; or Telegram user id, name, username, language (and optional photo URL
                  from Telegram launch data). We may link Telegram and Firebase to one account id.
                </li>
                <li>
                  <span className="text-gray-200">Business content you enter:</span> Business DNA,
                  domains, competitor names, chat messages, audit reports, Brand Memory events,
                  agency client workspaces, watchlists, CMS-related settings you save.
                </li>
                <li>
                  <span className="text-gray-200">BYOK credentials:</span> API keys you paste (Groq,
                  NVIDIA, Gemini, Tavily, Firecrawl, Exa, OpenRouter, Ollama, and related keys) are
                  stored in your browser. If you sign in and workspace sync runs, those keys may also
                  be copied into your server-side workspace payload (Cloudflare D1/KV). Treat synced
                  keys as sensitive; prefer local-only keys if you do not want them on our backend.
                </li>
                <li>
                  <span className="text-gray-200">Usage and billing:</span> plan id, expiry, Stars
                  charge ids, TON order metadata (amount, memo, status, tx hash), daily free-quota
                  counters, Sentinel watch targets (owner id, domain, brand, Telegram chat id,
                  keywords, scores).
                </li>
                <li>
                  <span className="text-gray-200">Technical logs:</span> Cloudflare edge request logs,
                  IP used for abuse rate limits (in-isolate), standard security telemetry. We do not
                  set first-party marketing cookies.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">4. Where it lives</h2>
              <ul className="list-disc pl-5 space-y-2 text-gray-400">
                <li>
                  <span className="text-gray-200">On your device:</span> localStorage / sessionStorage
                  hold DNA, chat session, audits, memory, themes, and keys when you use the app
                  without relying on sync.
                </li>
                <li>
                  <span className="text-gray-200">On our Cloudflare stack:</span> D1 database
                  (users, workspace JSON) and KV (subscriptions, quota, workspace fallback, Sentinel
                  targets, short-lived TON orders, enrichment cache). Hosting and observability are on
                  Cloudflare.
                </li>
                <li>
                  <span className="text-gray-200">Firebase Auth:</span> Google Firebase holds
                  authentication credentials for email/password and Google Sign-In under project
                  luminara-suite.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">5. Why we process it (purposes)</h2>
              <ul className="list-disc pl-5 space-y-2 text-gray-400">
                <li>Provide audits, Oracle chat, Brand Memory, Sentinel, and agency workspaces.</li>
                <li>Authenticate you, meter free daily usage, and fulfill Stars / TON plans.</li>
                <li>Relay blocked browser AI calls (for example NVIDIA NIM) without storing the key.</li>
                <li>Secure the service, prevent abuse, and debug outages.</li>
                <li>Respond to privacy, support, and security requests.</li>
              </ul>
              <p className="mt-3">
                Legal bases (where GDPR/UK GDPR apply): contract performance for the service you
                request; legitimate interests in security and product integrity; consent where you
                optionally connect third-party keys or wallets; legal obligation when we must retain
                payment dispute records.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">6. AI and search processors</h2>
              <p className="mb-3">
                When you run an audit or chat, prompts, URLs, scraped page text, and linked Business
                DNA are sent to the model and search providers you use. Hosted keys on
                luminarasuite.com are used only for signed-in users within quota or an active plan.
                BYOK requests go to the vendor (with NVIDIA and some Gemini paths relayed by our
                Worker). Those vendors process data under their own policies. Processors may include:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-gray-400">
                <li>Groq, NVIDIA NIM, Ollama, Google Gemini, OpenRouter</li>
                <li>Tavily, Exa, Firecrawl (search / crawl evidence)</li>
                <li>LanguageTool and Umami sidecars when you enable those features</li>
                <li>Cloudflare (hosting, KV, D1, logs)</li>
                <li>Firebase / Google (authentication)</li>
                <li>Telegram (Mini App identity, Stars payments, bot alerts)</li>
                <li>TON network / Toncenter (on-chain payment verification)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">7. Telegram and wallets</h2>
              <p>
                Inside Telegram we receive signed launch data Telegram provides. We use it to identify
                you, meter usage, send Sentinel alerts to your chat id, and record Stars purchases. We
                do not receive your phone number or card details. Connecting a TON wallet shares the
                public address with the app in your browser. We do not custody funds or store private
                keys.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">8. Cookies and analytics</h2>
              <p>
                We do not set first-party advertising cookies. Cloudflare and auth vendors may set
                strictly necessary operational cookies. We do not run a first-party page analytics
                pixel. Umami appears only as an optional Results-tracking integration against analytics
                you configure.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">9. Retention</h2>
              <ul className="list-disc pl-5 space-y-2 text-gray-400">
                <li>Browser data: until you clear site storage.</li>
                <li>Daily quota counters: about 2 days (KV TTL).</li>
                <li>Enrichment cache: about 7 days.</li>
                <li>Pending TON orders: about 2 hours if unfinished.</li>
                <li>Subscriptions, user rows, workspace blobs, Sentinel targets: kept while the
                  account is active or until deletion is completed.</li>
                <li>Payment identifiers needed for disputes may be kept as required by payment
                  partners (Telegram Stars / on-chain records you cannot erase from a public chain).</li>
              </ul>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">10. International transfers</h2>
              <p>
                We operate on Cloudflare&apos;s global edge and use US and other-region cloud vendors
                (for example Firebase and AI APIs). Where GDPR applies, transfers rely on the
                vendors&apos; published transfer mechanisms (such as Standard Contractual Clauses) and
                your contract with us for the service.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">11. Your rights</h2>
              <p className="mb-3">
                Depending on your location (including GDPR, UK GDPR, and CCPA/CPRA), you may have
                rights to access, correct, delete, export, restrict, or object to certain processing,
                and to opt out of &quot;sale&quot; or &quot;sharing&quot; of personal information.
              </p>
              <p className="mb-3">
                We do not sell personal information for money. We do not use cross-context behavioral
                advertising. To exercise rights: email {PRIVACY_EMAIL} from the address on your account
                (or include your Telegram id). Telegram users can also message the bot with /status to
                see plan metadata we hold. Local wipe: clear site storage in your browser; Settings can
                remove stored API keys from the device.
              </p>
              <p>
                Server-side erasure is currently handled by our operations team after email
                verification (no self-serve delete API yet). We aim to complete verified deletion
                requests within 30 days, except data we must keep for security, fraud, or legal
                reasons, and except immutable public blockchain payment records.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">12. Children</h2>
              <p>
                The service is for business users and is not directed to children under 16 (or under
                13 where that is the applicable standard). We do not knowingly collect children&apos;s
                data. If you believe we have, contact {PRIVACY_EMAIL} and we will delete it.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">13. Automated processing</h2>
              <p>
                Audits and chat replies are generated by third-party models from evidence available at
                request time. Outputs can be wrong. They are informational tools, not fully automated
                decisions that produce legal or similarly significant effects about you without human
                review on your side.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">14. Security</h2>
              <p>
                We use HTTPS, Cloudflare protections, auth checks on hosted keys, and least-privilege
                Worker bindings. No method of transmission or storage is perfectly secure. Report
                vulnerabilities to {SECURITY_EMAIL}. Prefer keeping BYOK keys local-only when you can.
                Treat any synced key bag on our backend as sensitive. Stronger at-rest protection for
                synced secrets is a planned hardening follow-up.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">15. Breaches</h2>
              <p>
                If we become aware of a personal-data breach that requires notice under applicable law,
                we will notify affected users and regulators as required, using account email or
                Telegram where available.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">16. CCPA / CPRA summary (California)</h2>
              <p>
                Categories collected: identifiers, commercial plan data, internet activity (logs),
                and customer content you upload. Purposes: Section 5. We do not sell personal
                information. To request know / delete / correct, email {PRIVACY_EMAIL}. We will not
                discriminate for exercising privacy rights. Authorized agents must provide proof of
                authority.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">17. Changes</h2>
              <p>
                We may update this policy as the product changes. The &quot;Last updated&quot; date will
                change. Material changes that reduce your rights will be highlighted in-product or by
                email / Telegram when we have a contact channel.
              </p>
            </section>

            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">18. Contact</h2>
              <p>
                Privacy: {PRIVACY_EMAIL}. Security: {SECURITY_EMAIL}. Support: {SUPPORT_EMAIL}.
              </p>
            </section>
          </div>
        ) : (
          <div className="space-y-8 text-sm leading-relaxed">
            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">The service</h2>
              <p>
                Luminara Suite produces AI-assisted search, answer-engine and generative-engine audits
                and related tools. Outputs are generated by third-party language models from the
                evidence available at the time and can be wrong or incomplete. They are information,
                not professional advice, and you are responsible for decisions you make with them.
              </p>
            </section>
            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">Labs features</h2>
              <p>
                Screens marked &quot;Labs&quot; (OracleMind, TimesFM, the Archy harness) are
                demonstrations. Their numbers are simulated for illustration and must not be relied on
                as measurements. Labs stay behind developer tools in the default product path.
              </p>
            </section>
            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">Your keys and accounts</h2>
              <p>
                You may use your own provider API keys. You are responsible for those accounts, their
                costs and their terms. Hosted keys on luminarasuite.com are provided to signed-in users
                within the free daily allowance or an active plan, and may be rate-limited or withdrawn
                to prevent abuse. If you enable workspace sync while signed in, workspace content and
                optional key bags may be stored on our Cloudflare backend for that account.
              </p>
            </section>
            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">Plans and payments</h2>
              <p>
                Plans bought with Telegram Stars run for the stated number of days from purchase and do
                not renew automatically. TON payments are verified on-chain against the order memo you
                are shown. Refunds for Stars follow Telegram&apos;s policy; for billing problems contact{' '}
                {SUPPORT_EMAIL}.
              </p>
            </section>
            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">Acceptable use</h2>
              <p>
                Do not use the service to attack, scrape abusively, or misrepresent third parties, and
                do not attempt to extract hosted credentials. We may suspend access for abuse.
              </p>
            </section>
            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">Open source and trademarks</h2>
              <p>
                The Luminara Suite source code is licensed under the GNU AGPL-3.0. &quot;Luminara&quot;,
                &quot;Luminara Suite&quot; and the Luminara logo are trademarks of {CONTROLLER} and are
                not covered by the code license.
              </p>
            </section>
            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">Liability</h2>
              <p>
                The service is provided &quot;as is&quot;. To the extent permitted by law, {CONTROLLER}{' '}
                is not liable for indirect or consequential losses arising from use of the service.
              </p>
            </section>
            <section>
              <h2 className="text-gold-light font-bold uppercase tracking-widest text-xs mb-2">Privacy</h2>
              <p>
                Personal data is handled as described in the Privacy Policy at #privacy.
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
