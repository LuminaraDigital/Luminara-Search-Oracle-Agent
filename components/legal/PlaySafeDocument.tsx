import React from 'react';
import { DELETE_ACCOUNT_OPERATOR } from '../../services/legal/deleteAccountCopy';
import { ANDROID_DOCUMENT_CHROME } from '../marketing/marketingChrome';

/** Plain legal page for ?client=android. No marketing nav and no Pricing link. */
export function PlaySafeDocument({ title, lede, children }: {
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main" tabIndex={-1} className="min-h-screen bg-black px-6 py-12 text-[var(--color-ink-2)] outline-none">
      <div className="mx-auto max-w-2xl">
        <nav aria-label="Legal" className="mb-8 flex flex-wrap gap-x-4 gap-y-2">
          {ANDROID_DOCUMENT_CHROME.links.map((link) => (
            <button
              key={link.label}
              type="button"
              onClick={link.onClick}
              className="inline-flex min-h-11 items-center text-sm text-[var(--gold-light)]"
            >
              {link.label}
            </button>
          ))}
        </nav>
        <h1 className="font-serif text-4xl text-[var(--color-ink)]">{title}</h1>
        {lede ? <p className="mt-3 text-sm">{lede}</p> : null}
        {children}
        <p className="mt-16 border-t pt-8 text-xs lx-hairline">{DELETE_ACCOUNT_OPERATOR}</p>
      </div>
    </main>
  );
}
