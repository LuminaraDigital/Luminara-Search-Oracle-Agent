import React, { useEffect, useId } from 'react';
import { CONTACT_EMAIL } from '../../services/legal/consumerTerms';
import { HOW_LINE, REFUND_LINE } from '../../services/help/helpPages';
import { MARKETING_FAQ } from '../../services/marketing/marketingFaqContent';
import { bindTelegramBackButton, isInTelegram } from '../../services/telegram/tma';
import { MarketingPageHeader, MarketingPageShell } from '../marketing/MarketingPageShell';
import { DOCUMENT_CHROME, MarketingChromeContext } from '../marketing/marketingChrome';

interface Props {
  kind: 'faq' | 'contact';
  onBack: () => void;
}

function RefundBlock() {
  return (
    <section className="mx-auto mt-16 max-w-2xl border-t pt-8 text-left text-[15px] leading-relaxed text-[var(--color-ink-2)] lx-hairline">
      <h2 className="font-serif text-2xl text-[var(--color-ink)]">Refunds and cancellation</h2>
      <p className="mt-3">{REFUND_LINE}</p>
    </section>
  );
}

function FaqBody() {
  return (
    <>
      <div className="mx-auto mt-16 max-w-2xl space-y-10 text-left text-[15px] leading-relaxed text-[var(--color-ink-2)]">
        {MARKETING_FAQ.map((item) => (
          <section key={item.question} className="border-t pt-8 lx-hairline">
            <h2 className="font-serif text-2xl text-[var(--color-ink)]">{item.question}</h2>
            <p className="mt-3">{item.answer}</p>
          </section>
        ))}
        <section className="border-t pt-8 lx-hairline">
          <h2 className="font-serif text-2xl text-[var(--color-ink)]">How Luminara works</h2>
          <p className="mt-3">{HOW_LINE}</p>
        </section>
      </div>
      <RefundBlock />
    </>
  );
}

function ContactBody() {
  const emailId = useId();
  const messageId = useId();
  return (
    <>
      <div className="mx-auto mt-16 max-w-xl text-left text-[15px] leading-relaxed text-[var(--color-ink-2)]">
        <form className="space-y-4" action={`mailto:${CONTACT_EMAIL}`} method="post" encType="text/plain">
          <div className="space-y-1.5">
            <label htmlFor={emailId} className="block text-sm text-ink">Your email</label>
            <div className="rounded-xl border border-gold/20 bg-black/50 transition-colors focus-within:border-gold/60">
              <input id={emailId} name="email" type="email" required autoComplete="email" className="w-full rounded-xl bg-transparent px-4 py-3.5 text-base text-ink outline-none" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={messageId} className="block text-sm text-ink">Message</label>
            <div className="rounded-xl border border-gold/20 bg-black/50 transition-colors focus-within:border-gold/60">
              <textarea id={messageId} name="message" required rows={6} className="w-full rounded-xl bg-transparent px-4 py-3.5 text-base text-ink outline-none" />
            </div>
          </div>
          <button type="submit" className="lx-btn lx-btn-gold min-h-11">Email support</button>
        </form>
      </div>
      <RefundBlock />
    </>
  );
}

/** FAQ and contact. Same chrome as pricing. Email only. */
export const HelpPage: React.FC<Props> = ({ kind, onBack }) => {
  const isFaq = kind === 'faq';

  useEffect(() => {
    return bindTelegramBackButton(onBack);
  }, [onBack]);

  const body = isFaq ? <FaqBody /> : <ContactBody />;

  if (isInTelegram()) {
    return (
      <main id="main" tabIndex={-1} className="min-h-screen bg-black px-6 py-12 text-[var(--color-ink-2)] outline-none">
        <div className="mx-auto max-w-2xl">
          <button type="button" onClick={onBack} className="mb-8 text-sm text-[var(--gold-light)]">Back</button>
          <h1 className="font-serif text-4xl text-[var(--color-ink)]">{isFaq ? 'Help' : 'Contact'}</h1>
          {body}
        </div>
      </main>
    );
  }

  return (
    <MarketingChromeContext.Provider value={DOCUMENT_CHROME}>
      <MarketingPageShell>
        <MarketingPageHeader
          eyebrow={isFaq ? 'Help' : 'Contact'}
          title={
            <>
              {isFaq ? 'Help' : 'Contact'} <span className="italic lx-gold-text pr-[0.08em]">{isFaq ? 'and refunds.' : 'by email.'}</span>
            </>
          }
          lede={isFaq ? 'Questions about the check, plans, and refunds.' : `Email ${CONTACT_EMAIL}. There is no phone line.`}
        />
        {body}
      </MarketingPageShell>
    </MarketingChromeContext.Provider>
  );
};
